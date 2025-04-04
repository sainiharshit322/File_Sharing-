import eventlet
eventlet.monkey_patch()  # Ensure this is at the top
import os
from flask import Flask, render_template, request, jsonify, url_for
from flask_socketio import SocketIO, join_room, emit
import uuid
import logging
from datetime import datetime, timedelta

# Flask app setup
app = Flask(__name__)
app.config['SECRET_KEY'] = 'p2pfiletransfer'
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='eventlet')

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# In-memory room tracking
active_rooms = {}

@app.route('/')
def index():
    """Home page - File selection for sender"""
    return render_template('index.html')

@app.route('/create-room', methods=['POST'])
def create_room():
    """Create a new room for file sharing"""
    room_id = str(uuid.uuid4())
    active_rooms[room_id] = {
        'created_at': datetime.now(),
        'sender_id': None,
        'receivers': set(),
        'file_info': None,
        'expiry': datetime.now() + timedelta(hours=24)
    }
    share_url = url_for('receive', room_id=room_id, _external=True)
    logger.info(f"New room created: {room_id}")
    return jsonify({'room_id': room_id, 'share_url': share_url})

@app.route('/receive/<room_id>')
def receive(room_id):
    """Page for receiver to join"""
    cleanup_expired_rooms()
    if room_id not in active_rooms:
        return "This sharing link has expired or doesn't exist", 404
    return render_template('receive.html', room_id=room_id)

def cleanup_expired_rooms():
    """Remove expired rooms"""
    now = datetime.now()
    expired_rooms = [r for r, data in active_rooms.items() if now > data['expiry']]
    for room_id in expired_rooms:
        del active_rooms[room_id]
        logger.info(f"Expired room removed: {room_id}")

# WebSocket event handlers
@socketio.on('connect')
def handle_connect():
    logger.info(f"Client connected: {request.sid}")

@socketio.on('disconnect')
def handle_disconnect():
    logger.info(f"Client disconnected: {request.sid}")
    for room_id, data in list(active_rooms.items()):
        if data['sender_id'] == request.sid:
            emit('sender_disconnected', room=room_id)
            logger.info(f"Sender disconnected from room: {room_id}")
        elif request.sid in data['receivers']:
            data['receivers'].remove(request.sid)
            if data['sender_id']:
                emit('receiver_left', {'receiver_id': request.sid}, room=data['sender_id'])
            logger.info(f"Receiver removed from room: {room_id}")

@socketio.on('join_room')
def handle_join_room(data):
    """Handle client joining a room"""
    room_id, role = data.get('room_id'), data.get('role')
    if room_id not in active_rooms:
        emit('error', {'message': 'Room not found or expired'})
        return
    
    join_room(room_id)
    if role == 'sender':
        active_rooms[room_id]['sender_id'] = request.sid
        active_rooms[room_id]['file_info'] = data.get('file_info')
        logger.info(f"Sender joined room: {room_id}")
        if active_rooms[room_id]['file_info']:
            emit('file_ready', active_rooms[room_id]['file_info'], room=room_id, skip_sid=request.sid)
    else:
        active_rooms[room_id]['receivers'].add(request.sid)
        logger.info(f"Receiver joined room: {room_id}")
        if active_rooms[room_id]['sender_id']:
            emit('receiver_joined', {'receiver_id': request.sid}, room=active_rooms[room_id]['sender_id'])
        if active_rooms[room_id]['file_info']:
            emit('file_ready', active_rooms[room_id]['file_info'])

@socketio.on('file_info')
def handle_file_info(data):
    """Process file metadata"""
    room_id, file_info = data.get('room_id'), data.get('file_info')
    if room_id in active_rooms:
        active_rooms[room_id]['file_info'] = file_info
        emit('file_ready', file_info, room=room_id, skip_sid=request.sid)
        logger.info(f"File info broadcasted for room {room_id}")

@socketio.on('webrtc_signal')
def handle_webrtc_signal(data):
    sender_id = request.sid  # Get the sender's socket ID

    # Debugging: Print the received data
    print("Received WebRTC Signal:", data)

    # Ensure 'target_id' exists in data before using it
    if 'target_id' not in data:
        print("Error: 'target_id' is missing in received data.")
        return  # Exit the function safely

    target_id = data['target_id']

    # Relay the signal to the target
    socketio.emit('webrtc_signal', {
        'sender_id': sender_id,
        'signal': data['signal']
    }, room=target_id)


@socketio.on('transfer_progress')
def handle_transfer_progress(data):
    """Broadcast transfer progress"""
    emit('transfer_progress_update', {'progress': data['progress']}, room=data['room_id'], skip_sid=request.sid)

@socketio.on('transfer_complete')
def handle_transfer_complete(data):
    """Handle file transfer completion"""
    emit('transfer_complete', room=data['room_id'])
    logger.info(f"Transfer complete for room {data['room_id']}")

if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=int(os.environ.get("PORT", 5000)))
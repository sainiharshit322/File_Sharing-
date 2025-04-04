// static/js/sender.js
// Handles file selection and sending via WebRTC

document.addEventListener('DOMContentLoaded', () => {
    // UI Elements
    const dropArea = document.getElementById('drop-area');
    const fileInput = document.getElementById('file-input');
    const fileName = document.getElementById('file-name');
    const fileSize = document.getElementById('file-size');
    const fileType = document.getElementById('file-type');
    const sendButton = document.getElementById('send-button');
    const selectedFileSection = document.getElementById('selected-file');
    const shareLinkSection = document.getElementById('share-link');
    const shareUrl = document.getElementById('share-url');
    const copyLinkButton = document.getElementById('copy-link');
    const transferStatusSection = document.getElementById('transfer-status');
    const progressBar = document.getElementById('progress-bar');
    const transferInfo = document.getElementById('transfer-info');
    const transferCompleteSection = document.getElementById('transfer-complete');
    const newTransferButton = document.getElementById('new-transfer');

    // State variables
    let selectedFile = null;
    let roomId = null;
    let peers = {}; // Store WebRTC peer connections
    let fileChunker = null;

    // Prevent default drag behaviors
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropArea.addEventListener(eventName, preventDefaults, false);
    });

    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    function highlight() {
        dropArea.classList.add('highlight');
    }

    function unhighlight() {
        dropArea.classList.remove('highlight');
    }

    dropArea.addEventListener('dragenter', highlight, false);
    dropArea.addEventListener('dragover', highlight, false);
    dropArea.addEventListener('dragleave', unhighlight, false);
    dropArea.addEventListener('drop', unhighlight, false);

    dropArea.addEventListener('drop', handleDrop, false);
    dropArea.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) handleFiles(e.target.files[0]);
    });

    function handleDrop(e) {
        const dt = e.dataTransfer;
        const files = dt.files;
        if (files.length > 0) handleFiles(files[0]);
    }

    function handleFiles(file) {
        selectedFile = file;
        fileChunker = new FileChunker(file);
        fileName.textContent = `File: ${file.name}`;
        fileSize.textContent = `Size: ${formatFileSize(file.size)}`;
        fileType.textContent = `Type: ${file.type || 'Unknown'}`;
        document.getElementById('file-selector').style.display = 'none';
        selectedFileSection.style.display = 'block';
    }

    sendButton.addEventListener('click', () => {
        if (!selectedFile) return;

        fetch('/create-room', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        })
        .then(response => response.json())
        .then(data => {
            roomId = data.room_id;
            shareUrl.value = data.share_url;
            socket.emit('join_room', { room_id: roomId, role: 'sender', file_info: selectedFile });
            selectedFileSection.style.display = 'none';
            shareLinkSection.style.display = 'block';
        })
        .catch(error => showError('Failed to create sharing link. Try again.'));
    });

    copyLinkButton.addEventListener('click', () => {
        navigator.clipboard.writeText(shareUrl.value)
            .then(() => {
                copyLinkButton.textContent = 'Copied!';
                setTimeout(() => copyLinkButton.textContent = 'Copy Link', 2000);
            })
            .catch(err => console.error('Copy failed:', err));
    });

    newTransferButton.addEventListener('click', () => {
        transferCompleteSection.style.display = 'none';
        document.getElementById('file-selector').style.display = 'block';
        progressBar.style.width = '0%';
        transferInfo.textContent = '0% - Connecting to receiver...';
        selectedFile = null;
        roomId = null;
        fileChunker = null;
        peers = {};
    });

    socket.on('receiver_joined', ({ receiver_id }) => {
        if (!peers[receiver_id]) initWebRTCConnection(receiver_id);
    });

    socket.on('receiver_left', ({ receiver_id }) => {
        if (peers[receiver_id]) {
            peers[receiver_id].destroy();
            delete peers[receiver_id];
        }
        showError("Receiver disconnected. Please share the link again.");
    });

    socket.on('webrtc_signal', ({ signal, from_id }) => {
        if (!peers[from_id]) initWebRTCConnection(from_id);
        peers[from_id].signal(signal);
    });

    function initWebRTCConnection(peerId) {
        const peer = new SimplePeer({ initiator: true, trickle: true });
        peers[peerId] = peer;

        peer.on('signal', signal => socket.emit('webrtc_signal', { target_id: peerId, signal }));
        peer.on('connect', () => {
            shareLinkSection.style.display = 'none';
            transferStatusSection.style.display = 'block';
            sendFile(peer);
        });
        peer.on('error', err => showError(`Connection error: ${err.message}`));
        peer.on('close', () => delete peers[peerId]);
    }

    function sendFile(peer) {
        if (!fileChunker) return;
        fileChunker.reset();

        peer.send(JSON.stringify({ type: 'file_info', data: { name: selectedFile.name, size: selectedFile.size, type: selectedFile.type, totalChunks: fileChunker.totalChunks } }));

        function sendNextChunk() {
            const chunkData = fileChunker.getNextChunk();
            if (!chunkData) {
                peer.send(JSON.stringify({ type: 'transfer_complete' }));
                transferStatusSection.style.display = 'none';
                transferCompleteSection.style.display = 'block';
                socket.emit('transfer_complete', { room_id: roomId });
                return;
            }
            progressBar.style.width = `${fileChunker.getProgress()}%`;
            transferInfo.textContent = `${fileChunker.getProgress()}% - Sending file...`;
            socket.emit('transfer_progress', { room_id: roomId, progress: fileChunker.getProgress() });

            peer.send(JSON.stringify({ type: 'chunk', data: { chunkIndex: chunkData.chunkIndex, totalChunks: chunkData.totalChunks, isLastChunk: chunkData.isLastChunk } }));
            const reader = new FileReader();
            reader.onload = () => peer.send(reader.result);
            reader.onerror = err => showError("Failed to read file chunk.");
            reader.readAsArrayBuffer(chunkData.chunk);
            requestIdleCallback(sendNextChunk);
        }
        sendNextChunk();
    }
});

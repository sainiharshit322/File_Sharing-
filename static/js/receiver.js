document.addEventListener('DOMContentLoaded', () => {
    // UI Elements
    const connectingSection = document.getElementById('connecting');
    const fileInfoSection = document.getElementById('file-info');
    const receiveFileName = document.getElementById('receive-file-name');
    const receiveFileSize = document.getElementById('receive-file-size');
    const receiveFileType = document.getElementById('receive-file-type');
    const downloadButton = document.getElementById('download-button');
    const receiveProgressSection = document.getElementById('receive-progress');
    const receiveProgressBar = document.getElementById('receive-progress-bar');
    const receiveProgressInfo = document.getElementById('receive-progress-info');
    const downloadCompleteSection = document.getElementById('download-complete');
    const saveFileLink = document.getElementById('save-file-link');
    const newDownloadButton = document.getElementById('new-download');

    let socket = io(); // Ensure socket is initialized
    let peer = null;
    let fileInfo = null;
    let receivedChunks = [];
    let receivedSize = 0;
    let fileBlob = null;
    let isReceivingChunk = false;
    let currentChunkMetadata = null;

    socket.emit('join_room', { room_id: ROOM_ID, role: 'receiver' });

    socket.on('file_ready', (info) => {
        fileInfo = info;
        receiveFileName.textContent = `File: ${info.name}`;
        receiveFileSize.textContent = `Size: ${formatFileSize(info.size)}`;
        receiveFileType.textContent = `Type: ${info.type || 'Unknown'}`;
        connectingSection.style.display = 'none';
        fileInfoSection.style.display = 'block';
    });

    socket.on('sender_disconnected', () => {
        if (!fileBlob) {
            showError('The sender has disconnected before completing the transfer.');
        }
    });

    socket.on('webrtc_signal', ({ signal, from_id }) => {
        if (!peer) {
            initWebRTCConnection();
        }
        peer.signal(signal);
    });

    function initWebRTCConnection() {
        peer = new SimplePeer({ initiator: false, trickle: true });
        peer.on('signal', signal => {
            if (fileInfo) {
                socket.emit('webrtc_signal', { target_id: fileInfo.sender_id, signal });
            }
        });
        peer.on('connect', () => {
            connectingSection.style.display = 'none';
            fileInfoSection.style.display = 'block';
        });
        peer.on('data', handleIncomingData);
        peer.on('error', err => showError(`Connection error: ${err.message}`));
        peer.on('close', () => {
            if (!fileBlob) {
                showError('Connection closed before file transfer completed.');
            }
        });
    }

    function handleIncomingData(data) {
        if (typeof data === 'string') {
            const message = JSON.parse(data);
            switch (message.type) {
                case 'file_info':
                    fileInfo = message.data;
                    receivedChunks = new Array(fileInfo.totalChunks).fill(null);
                    break;
                case 'chunk':
                    currentChunkMetadata = message.data;
                    isReceivingChunk = true;
                    break;
                case 'transfer_complete':
                    finalizeFile();
                    break;
            }
        } else if (isReceivingChunk && currentChunkMetadata) {
            handleChunk(data);
        }
    }

    function handleChunk(data) {
        const { chunkIndex, isLastChunk } = currentChunkMetadata;
        receivedChunks[chunkIndex] = new Uint8Array(data);
        receivedSize += data.byteLength;
        receiveProgressBar.style.width = `${Math.floor((receivedSize / fileInfo.size) * 100)}%`;
        receiveProgressInfo.textContent = `Receiving... ${Math.floor((receivedSize / fileInfo.size) * 100)}%`;
        isReceivingChunk = false;
        currentChunkMetadata = null;
        if (isLastChunk || receivedChunks.filter(Boolean).length === fileInfo.totalChunks) {
            finalizeFile();
        }
    }

    function finalizeFile() {
        if (fileBlob) return;
        fileBlob = new Blob(receivedChunks.filter(Boolean), { type: fileInfo.type || 'application/octet-stream' });
        saveFileLink.href = URL.createObjectURL(fileBlob);
        saveFileLink.download = fileInfo.name;
        receiveProgressSection.style.display = 'none';
        downloadCompleteSection.style.display = 'block';
    }

    downloadButton.addEventListener('click', () => {
        fileInfoSection.style.display = 'none';
        receiveProgressSection.style.display = 'block';
        if (!peer) initWebRTCConnection();
    });

    newDownloadButton.addEventListener('click', () => {
        window.location.href = '/';
    });
});
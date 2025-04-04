// static/js/main.js
// Common utilities and functions for both sender and receiver

// Format file size in human-readable format
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Connect to Socket.IO server
const socket = io();

// Utility for chunking files for WebRTC transfer
class FileChunker {
    constructor(file, chunkSize = 16384) { // 16KB chunks by default
        this.file = file;
        this.chunkSize = chunkSize;
        this.offset = 0;
        this.totalChunks = Math.ceil(file.size / chunkSize);
    }

    // Get the next chunk of the file
    getNextChunk() {
        if (this.offset >= this.file.size) {
            return null; // No more chunks
        }

        const chunk = this.file.slice(this.offset, this.offset + this.chunkSize);
        this.offset += this.chunkSize;
        
        return {
            chunk,
            chunkIndex: Math.floor(this.offset / this.chunkSize) - 1,
            totalChunks: this.totalChunks,
            fileName: this.file.name,
            fileType: this.file.type,
            fileSize: this.file.size,
            isLastChunk: this.offset >= this.file.size
        };
    }

    // Reset the chunker to start from the beginning
    reset() {
        this.offset = 0;
    }

    // Get progress percentage
    getProgress() {
        return Math.min(100, Math.floor((this.offset / this.file.size) * 100));
    }
}

// Show error message
function showError(message) {
    const errorSection = document.getElementById('error-message');
    const errorDetails = document.getElementById('error-details');
    
    if (errorDetails) {
        errorDetails.textContent = message;
    }
    
    // Hide all other sections
    document.querySelectorAll('main > section').forEach(section => {
        section.style.display = 'none';
    });
    
    // Show error section
    if (errorSection) {
        errorSection.style.display = 'block';
    }
}

// Socket connection event handlers
socket.on('connect', () => {
    console.log('Connected to signaling server');
});

socket.on('disconnect', () => {
    console.log('Disconnected from signaling server');
});

socket.on('error', (data) => {
    console.error('Socket error:', data.message);
    showError(data.message);
});
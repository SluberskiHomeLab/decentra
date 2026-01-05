// Voice chat functionality with WebRTC
class VoiceChat {
    constructor(ws, username) {
        this.ws = ws;
        this.username = username;
        this.peerConnections = new Map(); // Map of username -> RTCPeerConnection
        this.localStream = null;
        this.localVideoStream = null;
        this.localScreenStream = null;
        this.currentVoiceChannel = null;
        this.currentVoiceServer = null;
        this.inDirectCall = false;
        this.directCallPeer = null;
        this.isMuted = false;
        this.isVideoEnabled = false;
        this.isScreenSharing = false;
        this.selectedMicrophoneId = null;
        this.selectedSpeakerId = null;
        this.selectedCameraId = null;
        this.setSinkIdWarningShown = false; // Track if setSinkId warning has been shown
        this.remoteScreenSharing = new Map(); // Track which peers are screen sharing
        this.remoteVideoEnabled = new Map(); // Track which peers have video enabled
        this.remoteShowingScreen = new Map(); // Track which peers are currently showing screen (vs camera)
        this.showingScreen = true; // Default/preferred source when both video and screenshare are active (true = screen, false = camera)
        
        // Video configuration constants
        this.VIDEO_WIDTH = 640;
        this.VIDEO_HEIGHT = 480;
        
        // Screen share settings (default values)
        this.screenShareResolution = 720; // 720p default
        this.screenShareFramerate = 30; // 30 FPS default
        
        // ICE servers configuration (using public STUN servers)
        this.iceServers = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        };
    }
    
    async initLocalStream() {
        try {
            // Check if mediaDevices is supported
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                alert('Your browser does not support audio calls. Please use a modern browser like Chrome, Firefox, or Edge.');
                return false;
            }

            const constraints = { 
                audio: this.selectedMicrophoneId ? 
                    { deviceId: { exact: this.selectedMicrophoneId } } : true, 
                video: false 
            };
            
            console.log('Requesting microphone access with constraints:', constraints);
            this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
            console.log('Microphone access granted, stream:', this.localStream);
            return true;
        } catch (error) {
            console.error('Error accessing microphone:', error);
            if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
                alert('Microphone access denied. Please:\n1. Click the lock icon in your browser address bar\n2. Allow microphone access\n3. Refresh the page and try again');
            } else if (error.name === 'NotFoundError') {
                alert('No microphone found. Please:\n1. Connect a microphone to your computer\n2. Refresh the page\n3. Try again');
            } else if (error.name === 'NotReadableError') {
                alert('Microphone is in use by another application. Please:\n1. Close other apps using the microphone\n2. Try again');
            } else if (error.name === 'OverconstrainedError') {
                alert('Selected microphone is not available. Please:\n1. Select a different microphone\n2. Try again');
                this.selectedMicrophoneId = null; // Reset selection
            } else {
                alert('Cannot access microphone: ' + error.message + '\nPlease check your browser permissions and device settings.');
            }
            return false;
        }
    }
    
    async getAudioDevices() {
        try {
            // Check if mediaDevices is supported
            if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
                console.warn('enumerateDevices not supported');
                return { microphones: [], speakers: [] };
            }

            // Request permission first to get device labels
            // This is required because enumerateDevices() only returns labels after permission is granted
            if (!this.localStream && !this.localVideoStream) {
                try {
                    console.log('Requesting temporary audio access for device enumeration');
                    const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
                    console.log('Temporary access granted, stopping stream');
                    // Stop the temporary stream immediately
                    tempStream.getTracks().forEach(track => track.stop());
                } catch (permError) {
                    console.warn('Could not get permission for device enumeration:', permError);
                    // Continue anyway - devices will be returned but without labels
                }
            }
            
            const devices = await navigator.mediaDevices.enumerateDevices();
            console.log('Enumerated devices:', devices);
            return {
                microphones: devices.filter(d => d.kind === 'audioinput'),
                speakers: devices.filter(d => d.kind === 'audiooutput')
            };
        } catch (error) {
            console.error('Error enumerating devices:', error);
            return { microphones: [], speakers: [] };
        }
    }
    
    async getCameraDevices() {
        try {
            // Request permission first to get device labels
            // This is required because enumerateDevices() only returns labels after permission is granted
            if (!this.localStream && !this.localVideoStream) {
                try {
                    const tempStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
                    // Stop the temporary stream immediately
                    tempStream.getTracks().forEach(track => track.stop());
                } catch (permError) {
                    console.warn('Could not get camera permission for device enumeration:', permError);
                    // Continue anyway - devices will be returned but without labels
                }
            }
            
            const devices = await navigator.mediaDevices.enumerateDevices();
            return devices.filter(d => d.kind === 'videoinput');
        } catch (error) {
            console.error('Error enumerating camera devices:', error);
            return [];
        }
    }
    
    async getMediaDevices() {
        try {
            // Request permissions first to get device labels
            // This is required because enumerateDevices() only returns labels after permission is granted
            if (!this.localStream && !this.localVideoStream) {
                try {
                    // Request both audio and video permission to get all device labels
                    const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
                    // Stop the temporary stream immediately
                    tempStream.getTracks().forEach(track => track.stop());
                } catch (permError) {
                    console.warn('Could not get full permission for device enumeration:', permError);
                    // Try audio only
                    try {
                        const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
                        audioStream.getTracks().forEach(track => track.stop());
                    } catch (audioError) {
                        console.warn('Could not get audio permission:', audioError);
                    }
                    // Try video only
                    try {
                        const videoStream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
                        videoStream.getTracks().forEach(track => track.stop());
                    } catch (videoError) {
                        console.warn('Could not get video permission:', videoError);
                    }
                }
            }
            
            const devices = await navigator.mediaDevices.enumerateDevices();
            return {
                microphones: devices.filter(d => d.kind === 'audioinput'),
                speakers: devices.filter(d => d.kind === 'audiooutput'),
                cameras: devices.filter(d => d.kind === 'videoinput')
            };
        } catch (error) {
            console.error('Error enumerating media devices:', error);
            return { microphones: [], speakers: [], cameras: [] };
        }
    }
    
    async setMicrophone(deviceId) {
        this.selectedMicrophoneId = deviceId;
        
        // If already in a call, restart the stream with the new device
        if (this.localStream) {
            const wasInVoice = this.currentVoiceChannel !== null;
            const oldStream = this.localStream;
            
            // Get new stream
            const constraints = { 
                audio: deviceId ? { deviceId: { exact: deviceId } } : true, 
                video: false 
            };
            
            try {
                this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
                
                // Replace audio track in all peer connections
                this.peerConnections.forEach(pc => {
                    const senders = pc.getSenders();
                    const audioSender = senders.find(s => s.track && s.track.kind === 'audio');
                    if (audioSender && this.localStream) {
                        const newAudioTrack = this.localStream.getAudioTracks()[0];
                        audioSender.replaceTrack(newAudioTrack);
                    }
                });
                
                // Stop old stream
                oldStream.getTracks().forEach(track => track.stop());
                
                // Restore muted state
                if (this.isMuted) {
                    this.localStream.getAudioTracks().forEach(track => {
                        track.enabled = false;
                    });
                }
            } catch (error) {
                console.error('Error switching microphone:', error);
                alert('Failed to switch microphone. Please try again.');
            }
        }
    }
    
    async setSpeaker(deviceId) {
        this.selectedSpeakerId = deviceId;
        
        // Update audio output for all remote audio elements
        // Note: setSinkId is not supported in all browsers (e.g., Safari, Firefox)
        this.peerConnections.forEach(pc => {
            if (pc.remoteAudio) {
                if (typeof pc.remoteAudio.setSinkId === 'function') {
                    pc.remoteAudio.setSinkId(deviceId).catch(error => {
                        console.error('Error setting speaker:', error);
                    });
                } else if (!this.setSinkIdWarningShown) {
                    console.warn('setSinkId is not supported in this browser');
                    this.setSinkIdWarningShown = true;
                }
            }
        });
    }
    
    async setCamera(deviceId) {
        this.selectedCameraId = deviceId;
        
        // If video is currently enabled, restart the video stream with the new device
        if (this.isVideoEnabled && this.localVideoStream) {
            const oldStream = this.localVideoStream;
            
            // Get new stream
            const constraints = { 
                video: deviceId ? 
                    { deviceId: { exact: deviceId }, width: this.VIDEO_WIDTH, height: this.VIDEO_HEIGHT } : 
                    { width: this.VIDEO_WIDTH, height: this.VIDEO_HEIGHT }, 
                audio: false 
            };
            
            try {
                this.localVideoStream = await navigator.mediaDevices.getUserMedia(constraints);
                
                // Replace video track in all peer connections
                this.peerConnections.forEach(pc => {
                    const senders = pc.getSenders();
                    const videoSender = senders.find(s => s.track && s.track.kind === 'video');
                    if (videoSender && this.localVideoStream) {
                        const newVideoTrack = this.localVideoStream.getVideoTracks()[0];
                        videoSender.replaceTrack(newVideoTrack);
                    }
                });
                
                // Update local video display if it exists
                if (window.onLocalVideoTrack) {
                    window.onLocalVideoTrack(this.localVideoStream, false);
                }
                
                // Only stop old stream after successfully creating and applying new stream
                oldStream.getTracks().forEach(track => track.stop());
            } catch (error) {
                console.error('Error switching camera:', error);
                // Restore old stream on error
                this.localVideoStream = oldStream;
                alert('Failed to switch camera. Please try again.');
            }
        }
    }
    
    async toggleVideo() {
        if (!this.isVideoEnabled) {
            // Start video
            try {
                const constraints = {
                    video: this.selectedCameraId ? 
                        { deviceId: { exact: this.selectedCameraId }, width: this.VIDEO_WIDTH, height: this.VIDEO_HEIGHT } : 
                        { width: this.VIDEO_WIDTH, height: this.VIDEO_HEIGHT },
                    audio: false
                };
                this.localVideoStream = await navigator.mediaDevices.getUserMedia(constraints);
                
                this.isVideoEnabled = true;
                
                // Add video tracks to all peer connections
                this.peerConnections.forEach(pc => {
                    this.localVideoStream.getVideoTracks().forEach(track => {
                        pc.addTrack(track, this.localVideoStream);
                    });
                });
                
                // Show local video preview
                if (window.onLocalVideoTrack) {
                    window.onLocalVideoTrack(this.localVideoStream, false);
                }
                
                // Notify server
                this.ws.send(JSON.stringify({
                    type: 'voice_video',
                    video: true
                }));
                
                return true;
            } catch (error) {
                console.error('Error accessing camera:', error);
                alert('Could not access camera. Please check permissions.');
                return false;
            }
        } else {
            // Stop video
            if (this.localVideoStream) {
                this.localVideoStream.getTracks().forEach(track => track.stop());
                
                // Remove video tracks from all peer connections
                this.peerConnections.forEach(pc => {
                    const senders = pc.getSenders();
                    senders.forEach(sender => {
                        if (sender.track && sender.track.kind === 'video') {
                            pc.removeTrack(sender);
                        }
                    });
                });
                
                this.localVideoStream = null;
            }
            
            this.isVideoEnabled = false;
            
            // Remove local video preview
            if (window.onLocalVideoTrack) {
                window.onLocalVideoTrack(null, false);
            }
            
            // Notify server
            this.ws.send(JSON.stringify({
                type: 'voice_video',
                video: false
            }));
            
            return false;
        }
    }
    
    async toggleScreenShare(resolution, framerate) {
        if (!this.isScreenSharing) {
            // Start screen sharing
            try {
                // Normalize inputs to integers
                const res = parseInt(resolution || this.screenShareResolution);
                const fps = parseInt(framerate || this.screenShareFramerate);
                
                // Calculate dimensions based on resolution setting
                let width, height;
                switch (res) {
                    case 1080:
                        width = 1920;
                        height = 1080;
                        break;
                    case 480:
                        width = 854;
                        height = 480;
                        break;
                    case 720:
                    default:
                        width = 1280;
                        height = 720;
                        break;
                }
                
                this.localScreenStream = await navigator.mediaDevices.getDisplayMedia({
                    video: { 
                        cursor: 'always',
                        width: { ideal: width, max: width },
                        height: { ideal: height, max: height },
                        frameRate: { ideal: fps, max: fps }
                    },
                    audio: false
                });
                
                // Handle stream ended (user clicked stop sharing in browser UI)
                this.localScreenStream.getVideoTracks()[0].onended = () => {
                    // Stop screen sharing when user stops from browser UI
                    if (this.isScreenSharing) {
                        // Use a separate cleanup to avoid recursion issues
                        this.stopScreenSharing();
                    }
                };
                
                this.isScreenSharing = true;
                
                // Replace video track or add screen track to all peer connections
                this.peerConnections.forEach(pc => {
                    const screenTrack = this.localScreenStream.getVideoTracks()[0];
                    const senders = pc.getSenders();
                    const videoSender = senders.find(s => s.track && s.track.kind === 'video');
                    
                    if (videoSender) {
                        // Replace existing video track
                        videoSender.replaceTrack(screenTrack);
                    } else {
                        // Add new track
                        pc.addTrack(screenTrack, this.localScreenStream);
                    }
                });
                
                // Show local screen share preview
                if (window.onLocalVideoTrack) {
                    window.onLocalVideoTrack(this.localScreenStream, true);
                }
                
                // Update state - now showing screen
                this.showingScreen = true;
                
                // Notify server
                this.ws.send(JSON.stringify({
                    type: 'voice_screen_share',
                    screen_sharing: true
                }));
                
                // If video is also enabled, notify that we're now showing screen
                if (this.isVideoEnabled) {
                    this.ws.send(JSON.stringify({
                        type: 'video_source_changed',
                        showing_screen: true
                    }));
                }
                
                return true;
            } catch (error) {
                console.error('Error sharing screen:', error);
                if (error.name !== 'NotAllowedError') {
                    alert('Could not share screen. Please try again.');
                }
                return false;
            }
        } else {
            // Stop screen sharing by calling the helper method
            this.stopScreenSharing();
            return false;
        }
    }
    
    stopScreenSharing() {
        // Helper method to cleanly stop screen sharing without toggling
        if (this.localScreenStream) {
            this.localScreenStream.getTracks().forEach(track => track.stop());
            
            // Restore video track or remove screen track from all peer connections
            this.peerConnections.forEach(pc => {
                const senders = pc.getSenders();
                const videoSender = senders.find(s => s.track && s.track.kind === 'video');
                
                if (videoSender) {
                    if (this.isVideoEnabled && this.localVideoStream) {
                        // Restore camera video
                        const videoTrack = this.localVideoStream.getVideoTracks()[0];
                        videoSender.replaceTrack(videoTrack);
                    } else {
                        // Remove video track
                        pc.removeTrack(videoSender);
                    }
                }
            });
            
            this.localScreenStream = null;
        }
        
        this.isScreenSharing = false;
        
        // Update state
        this.showingScreen = false;
        
        // Restore camera preview if video is enabled, otherwise remove preview
        if (window.onLocalVideoTrack) {
            if (this.isVideoEnabled && this.localVideoStream) {
                window.onLocalVideoTrack(this.localVideoStream, false);
            } else {
                window.onLocalVideoTrack(null, false);
            }
        }
        
        // Notify server
        this.ws.send(JSON.stringify({
            type: 'voice_screen_share',
            screen_sharing: false
        }));
        
        // If video is still enabled, notify that we're now showing camera
        if (this.isVideoEnabled) {
            this.ws.send(JSON.stringify({
                type: 'video_source_changed',
                showing_screen: false
            }));
        }
    }
    
    // Switch between showing camera or screen when both are active
    switchVideoSource(targetUsername, showScreen) {
        // Send message to the target user to switch their sent video track
        this.ws.send(JSON.stringify({
            type: 'switch_video_source',
            target: targetUsername,
            show_screen: showScreen
        }));
    }
    
    // Handle request from another user to switch our sent video track
    async handleSwitchVideoSourceRequest(showScreen) {
        // Only applicable if we have both video and screenshare active
        if (!this.isVideoEnabled || !this.isScreenSharing) {
            return;
        }
        
        // Verify streams exist
        if (!this.localVideoStream || !this.localScreenStream) {
            console.warn('Cannot switch video source: streams not available');
            return;
        }
        
        // Verify the target stream has video tracks before proceeding
        const sourceStream = showScreen ? this.localScreenStream : this.localVideoStream;
        const videoTracks = sourceStream.getVideoTracks();
        if (videoTracks.length === 0) {
            console.warn('No video tracks available for replacement from', showScreen ? 'screen stream' : 'video stream');
            return;
        }
        
        this.showingScreen = showScreen;
        const newTrack = videoTracks[0];
        
        // Switch the track being sent to all peers
        const replacePromises = [];
        this.peerConnections.forEach(pc => {
            const senders = pc.getSenders();
            const videoSender = senders.find(s => s.track && s.track.kind === 'video');
            
            if (videoSender) {
                replacePromises.push(videoSender.replaceTrack(newTrack));
            }
        });
        
        // Wait for all track replacements to complete with error handling
        try {
            await Promise.all(replacePromises);
        } catch (error) {
            console.error('Error replacing video tracks:', error);
            // Revert state on failure
            this.showingScreen = !showScreen;
            throw error;
        }
        
        // Update local preview
        if (window.onLocalVideoTrack) {
            if (showScreen) {
                window.onLocalVideoTrack(this.localScreenStream, true);
            } else {
                window.onLocalVideoTrack(this.localVideoStream, false);
            }
        }
        
        // Notify server about the current video source being sent
        this.ws.send(JSON.stringify({
            type: 'video_source_changed',
            showing_screen: showScreen
        }));
    }
    
    async joinVoiceChannel(serverId, channelId) {
        console.log(`Attempting to join voice channel: ${serverId}/${channelId}`);
        
        // Initialize local stream if not already done
        if (!this.localStream) {
            console.log('No local stream, requesting microphone access...');
            const success = await this.initLocalStream();
            if (!success) {
                console.error('Failed to initialize local stream');
                throw new Error('Microphone access denied or unavailable');
            }
            console.log('Local stream initialized successfully');
        }
        
        this.currentVoiceServer = serverId;
        this.currentVoiceChannel = channelId;
        
        // Notify server
        console.log('Sending join_voice_channel message to server');
        this.ws.send(JSON.stringify({
            type: 'join_voice_channel',
            server_id: serverId,
            channel_id: channelId
        }));
        console.log('Join request sent');
    }
    
    leaveVoiceChannel() {
        // Close all peer connections
        this.peerConnections.forEach((pc, username) => {
            pc.close();
        });
        this.peerConnections.clear();
        
        // Notify server
        if (this.currentVoiceServer && this.currentVoiceChannel) {
            this.ws.send(JSON.stringify({
                type: 'leave_voice_channel'
            }));
        }
        
        this.currentVoiceServer = null;
        this.currentVoiceChannel = null;
        
        // Stop all local streams
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
            this.localStream = null;
        }
        
        if (this.localVideoStream) {
            this.localVideoStream.getTracks().forEach(track => track.stop());
            this.localVideoStream = null;
        }
        
        if (this.localScreenStream) {
            this.localScreenStream.getTracks().forEach(track => track.stop());
            this.localScreenStream = null;
        }
        
        this.isMuted = false;
        this.isVideoEnabled = false;
        this.isScreenSharing = false;
        
        // Clear remote state tracking
        this.remoteVideoEnabled.clear();
        this.remoteScreenSharing.clear();
        this.remoteShowingScreen.clear();
    }
    
    async startDirectCall(friendUsername) {
        console.log(`Starting direct call with ${friendUsername}`);
        
        // Initialize local stream if not already done
        if (!this.localStream) {
            console.log('No local stream, requesting microphone access...');
            const success = await this.initLocalStream();
            if (!success) {
                console.error('Failed to initialize local stream for call');
                throw new Error('Microphone access denied or unavailable');
            }
            console.log('Local stream initialized successfully');
        }
        
        this.inDirectCall = true;
        this.directCallPeer = friendUsername;
        
        // Notify server to signal the friend
        console.log(`Sending call request to ${friendUsername}`);
        this.ws.send(JSON.stringify({
            type: 'start_voice_call',
            username: friendUsername
        }));
    }
    
    async acceptDirectCall(callerUsername) {
        // Initialize local stream
        if (!this.localStream) {
            const success = await this.initLocalStream();
            if (!success) return;
        }
        
        this.inDirectCall = true;
        this.directCallPeer = callerUsername;
        
        // Notify server that call is accepted
        this.ws.send(JSON.stringify({
            type: 'accept_voice_call',
            from: callerUsername
        }));
        
        // The caller will initiate the WebRTC connection
    }
    
    rejectDirectCall(callerUsername) {
        this.ws.send(JSON.stringify({
            type: 'reject_voice_call',
            from: callerUsername
        }));
    }
    
    endDirectCall() {
        if (this.directCallPeer && this.peerConnections.has(this.directCallPeer)) {
            this.peerConnections.get(this.directCallPeer).close();
            this.peerConnections.delete(this.directCallPeer);
        }
        
        this.inDirectCall = false;
        this.directCallPeer = null;
        
        // Stop all local streams
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
            this.localStream = null;
        }
        
        if (this.localVideoStream) {
            this.localVideoStream.getTracks().forEach(track => track.stop());
            this.localVideoStream = null;
        }
        
        if (this.localScreenStream) {
            this.localScreenStream.getTracks().forEach(track => track.stop());
            this.localScreenStream = null;
        }
        
        this.isMuted = false;
        this.isVideoEnabled = false;
        this.isScreenSharing = false;
    }
    
    async createPeerConnection(targetUsername, isInitiator = true) {
        console.log(`Creating peer connection with ${targetUsername}, isInitiator: ${isInitiator}`);
        
        // Verify we have a local stream
        if (!this.localStream) {
            console.error('No local stream available for peer connection');
            const success = await this.initLocalStream();
            if (!success) {
                console.error('Failed to initialize local stream');
                return null;
            }
        }
        
        const pc = new RTCPeerConnection(this.iceServers);
        this.peerConnections.set(targetUsername, pc);
        
        console.log(`Local stream tracks: ${this.localStream.getTracks().length}`);
        
        // Add local audio stream tracks
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => {
                console.log(`Adding ${track.kind} track to peer connection`);
                pc.addTrack(track, this.localStream);
            });
        }
        
        // Add local video stream tracks if enabled
        if (this.isVideoEnabled && this.localVideoStream) {
            this.localVideoStream.getTracks().forEach(track => {
                pc.addTrack(track, this.localVideoStream);
            });
        }
        
        // Add screen sharing track if enabled
        if (this.isScreenSharing && this.localScreenStream) {
            this.localScreenStream.getTracks().forEach(track => {
                pc.addTrack(track, this.localScreenStream);
            });
        }
        
        // Handle incoming tracks
        pc.ontrack = (event) => {
            console.log('Received remote track from', targetUsername, 'kind:', event.track.kind);
            
            if (event.track.kind === 'audio') {
                // Handle audio track
                const remoteAudio = new Audio();
                remoteAudio.srcObject = event.streams[0];
                
                // Set speaker if selected and supported
                if (this.selectedSpeakerId && typeof remoteAudio.setSinkId === 'function') {
                    remoteAudio.setSinkId(this.selectedSpeakerId).catch(error => {
                        console.error('Error setting speaker:', error);
                    });
                }
                
                // Handle play promise to avoid unhandled rejection
                const playPromise = remoteAudio.play();
                if (playPromise !== undefined) {
                    playPromise.then(() => {
                        console.log(`Audio playing from ${targetUsername}`);
                    }).catch(error => {
                        console.warn('Audio autoplay blocked:', error);
                        console.warn('User interaction required to play audio. Click anywhere on the page.');
                        // Try playing on next user interaction
                        const playOnInteraction = () => {
                            remoteAudio.play().then(() => {
                                console.log('Audio started after user interaction');
                                document.removeEventListener('click', playOnInteraction);
                            }).catch(e => console.error('Still cannot play:', e));
                        };
                        document.addEventListener('click', playOnInteraction, { once: true });
                    });
                }
                
                // Store audio element for later control
                pc.remoteAudio = remoteAudio;
            } else if (event.track.kind === 'video') {
                // Handle video track - emit event for UI to handle
                // Check if this user is screen sharing
                const isScreenShare = this.remoteScreenSharing.get(targetUsername) || false;
                if (window.onRemoteVideoTrack) {
                    window.onRemoteVideoTrack(targetUsername, event.streams[0], isScreenShare);
                }
            }
        };
        
        // Handle ICE candidates
        pc.onicecandidate = (event) => {
            if (event.candidate) {
                console.log(`Sending ICE candidate to ${targetUsername}:`, event.candidate.type);
                this.ws.send(JSON.stringify({
                    type: 'webrtc_ice_candidate',
                    target: targetUsername,
                    candidate: event.candidate
                }));
            } else {
                console.log(`ICE gathering complete for ${targetUsername}`);
            }
        };
        
        // Handle ICE connection state changes
        pc.oniceconnectionstatechange = () => {
            console.log(`ICE connection state with ${targetUsername}:`, pc.iceConnectionState);
        };
        
        // Handle connection state changes
        pc.onconnectionstatechange = () => {
            console.log(`Connection state with ${targetUsername}:`, pc.connectionState);
            if (pc.connectionState === 'connected') {
                console.log(`✓ Successfully connected to ${targetUsername}`);
            } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
                console.warn(`Connection ${pc.connectionState} with ${targetUsername}`);
                this.handlePeerDisconnected(targetUsername);
            }
        };
        
        // If initiator, create and send offer
        if (isInitiator) {
            try {
                console.log(`Creating offer for ${targetUsername}`);
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                console.log(`Offer created and set as local description for ${targetUsername}`);
                
                this.ws.send(JSON.stringify({
                    type: 'webrtc_offer',
                    target: targetUsername,
                    offer: pc.localDescription,
                    context: {
                        server_id: this.currentVoiceServer,
                        channel_id: this.currentVoiceChannel
                    }
                }));
                console.log(`Offer sent to ${targetUsername}`);
            } catch (error) {
                console.error(`Error creating offer for ${targetUsername}:`, error);
                alert(`Failed to establish connection with ${targetUsername}: ${error.message}`);
            }
        }
        
        return pc;
    }
    
    async handleOffer(fromUsername, offer, context) {
        console.log(`Received offer from ${fromUsername}`);
        
        // Create peer connection if it doesn't exist
        let pc = this.peerConnections.get(fromUsername);
        if (!pc) {
            console.log(`No existing peer connection, creating one for ${fromUsername}`);
            pc = await this.createPeerConnection(fromUsername, false);
            if (!pc) {
                console.error(`Failed to create peer connection for ${fromUsername}`);
                return;
            }
        } else if (pc.signalingState === 'have-local-offer') {
            // Handle glare condition: both peers sent offers simultaneously
            console.log(`Glare detected with ${fromUsername} - ignoring offer`);
            return;
        }
        
        try {
            console.log(`Setting remote description for ${fromUsername}`);
            await pc.setRemoteDescription(new RTCSessionDescription(offer));
            console.log(`Creating answer for ${fromUsername}`);
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            console.log(`Sending answer to ${fromUsername}`);
            
            this.ws.send(JSON.stringify({
                type: 'webrtc_answer',
                target: fromUsername,
                answer: pc.localDescription
            }));
            console.log(`Answer sent to ${fromUsername}`);
        } catch (error) {
            console.error(`Error handling offer from ${fromUsername}:`, error);
            alert(`Failed to process call from ${fromUsername}: ${error.message}`);
        }
    }
    
    async handleAnswer(fromUsername, answer) {
        console.log(`Received answer from ${fromUsername}`);
        
        const pc = this.peerConnections.get(fromUsername);
        if (pc) {
            try {
                console.log(`Setting remote description (answer) for ${fromUsername}`);
                await pc.setRemoteDescription(new RTCSessionDescription(answer));
                console.log(`Answer processed for ${fromUsername}`);
            } catch (error) {
                console.error(`Error handling answer from ${fromUsername}:`, error);
                alert(`Failed to complete connection with ${fromUsername}: ${error.message}`);
            }
        } else {
            console.warn(`Received answer from ${fromUsername} but no peer connection exists`);
        }
    }
    
    async handleIceCandidate(fromUsername, candidate) {
        const pc = this.peerConnections.get(fromUsername);
        if (pc) {
            try {
                await pc.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (error) {
                console.error('Error adding ICE candidate:', error);
            }
        }
    }
    
    handlePeerDisconnected(username) {
        console.log('Peer disconnected:', username);
        const pc = this.peerConnections.get(username);
        if (pc) {
            if (pc.remoteAudio) {
                pc.remoteAudio.pause();
                pc.remoteAudio.srcObject = null;
            }
            pc.close();
            this.peerConnections.delete(username);
        }
    }
    
    toggleMute() {
        if (this.localStream) {
            this.isMuted = !this.isMuted;
            this.localStream.getAudioTracks().forEach(track => {
                track.enabled = !this.isMuted;
            });
            
            // Notify server about mute state
            this.ws.send(JSON.stringify({
                type: 'voice_mute',
                muted: this.isMuted
            }));
            
            return this.isMuted;
        }
        return false;
    }
    
    // Handle voice state updates from server
    async handleVoiceStateUpdate(data) {
        const { username, state, voice_members, server_id, channel_id } = data;
        
        // Only handle if we're in the same voice channel
        if (this.currentVoiceServer !== server_id || this.currentVoiceChannel !== channel_id) {
            return;
        }
        
        if (state === 'joined' && username !== this.username) {
            // New user joined, create peer connection
            await this.createPeerConnection(username, true);
        } else if (state === 'left' && username !== this.username) {
            // User left, close connection
            this.handlePeerDisconnected(username);
        }
    }
}

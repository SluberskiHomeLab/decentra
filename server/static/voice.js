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
            const constraints = { 
                audio: this.selectedMicrophoneId ? 
                    { deviceId: { exact: this.selectedMicrophoneId } } : true, 
                video: false 
            };
            this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
            return true;
        } catch (error) {
            console.error('Error accessing microphone:', error);
            if (error.name === 'NotAllowedError') {
                alert('Microphone access denied. Please grant permission in your browser settings.');
            } else if (error.name === 'NotFoundError') {
                alert('No microphone found. Please connect a microphone and try again.');
            } else {
                alert('Cannot access microphone. Please check your permissions and device.');
            }
            return false;
        }
    }
    
    async getAudioDevices() {
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            return {
                microphones: devices.filter(d => d.kind === 'audioinput'),
                speakers: devices.filter(d => d.kind === 'audiooutput')
            };
        } catch (error) {
            console.error('Error enumerating devices:', error);
            return { microphones: [], speakers: [] };
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
        this.peerConnections.forEach(pc => {
            if (pc.remoteAudio && pc.remoteAudio.setSinkId) {
                pc.remoteAudio.setSinkId(deviceId).catch(error => {
                    console.error('Error setting speaker:', error);
                });
            }
        });
    }
    
    async toggleVideo() {
        if (!this.isVideoEnabled) {
            // Start video
            try {
                this.localVideoStream = await navigator.mediaDevices.getUserMedia({
                    video: { width: 640, height: 480 },
                    audio: false
                });
                
                this.isVideoEnabled = true;
                
                // Add video tracks to all peer connections
                this.peerConnections.forEach(pc => {
                    this.localVideoStream.getVideoTracks().forEach(track => {
                        pc.addTrack(track, this.localVideoStream);
                    });
                });
                
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
            
            // Notify server
            this.ws.send(JSON.stringify({
                type: 'voice_video',
                video: false
            }));
            
            return false;
        }
    }
    
    async toggleScreenShare() {
        if (!this.isScreenSharing) {
            // Start screen sharing
            try {
                this.localScreenStream = await navigator.mediaDevices.getDisplayMedia({
                    video: { cursor: 'always' },
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
                
                // Notify server
                this.ws.send(JSON.stringify({
                    type: 'voice_screen_share',
                    screen_sharing: true
                }));
                
                return true;
            } catch (error) {
                console.error('Error sharing screen:', error);
                if (error.name !== 'NotAllowedError') {
                    alert('Could not share screen. Please try again.');
                }
                return false;
            }
        } else {
            // Stop screen sharing
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
            
            // Notify server
            this.ws.send(JSON.stringify({
                type: 'voice_screen_share',
                screen_sharing: false
            }));
            
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
        
        // Notify server
        this.ws.send(JSON.stringify({
            type: 'voice_screen_share',
            screen_sharing: false
        }));
    }
    
    async joinVoiceChannel(serverId, channelId) {
        // Initialize local stream if not already done
        if (!this.localStream) {
            const success = await this.initLocalStream();
            if (!success) return;
        }
        
        this.currentVoiceServer = serverId;
        this.currentVoiceChannel = channelId;
        
        // Notify server
        this.ws.send(JSON.stringify({
            type: 'join_voice_channel',
            server_id: serverId,
            channel_id: channelId
        }));
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
    }
    
    async startDirectCall(friendUsername) {
        // Initialize local stream if not already done
        if (!this.localStream) {
            const success = await this.initLocalStream();
            if (!success) return;
        }
        
        this.inDirectCall = true;
        this.directCallPeer = friendUsername;
        
        // Notify server to signal the friend
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
        const pc = new RTCPeerConnection(this.iceServers);
        this.peerConnections.set(targetUsername, pc);
        
        // Add local audio stream tracks
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => {
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
                
                // Set speaker if selected
                if (this.selectedSpeakerId && remoteAudio.setSinkId) {
                    remoteAudio.setSinkId(this.selectedSpeakerId).catch(error => {
                        console.error('Error setting speaker:', error);
                    });
                }
                
                // Handle play promise to avoid unhandled rejection
                remoteAudio.play().catch(error => {
                    console.warn('Audio autoplay failed:', error);
                    // Audio will play when user interacts with the page
                });
                
                // Store audio element for later control
                pc.remoteAudio = remoteAudio;
            } else if (event.track.kind === 'video') {
                // Handle video track - emit event for UI to handle
                if (window.onRemoteVideoTrack) {
                    window.onRemoteVideoTrack(targetUsername, event.streams[0]);
                }
            }
        };
        
        // Handle ICE candidates
        pc.onicecandidate = (event) => {
            if (event.candidate) {
                this.ws.send(JSON.stringify({
                    type: 'webrtc_ice_candidate',
                    target: targetUsername,
                    candidate: event.candidate
                }));
            }
        };
        
        // Handle connection state changes
        pc.onconnectionstatechange = () => {
            console.log('Connection state with', targetUsername, ':', pc.connectionState);
            if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
                this.handlePeerDisconnected(targetUsername);
            }
        };
        
        // If initiator, create and send offer
        if (isInitiator) {
            try {
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                
                this.ws.send(JSON.stringify({
                    type: 'webrtc_offer',
                    target: targetUsername,
                    offer: pc.localDescription,
                    context: {
                        server_id: this.currentVoiceServer,
                        channel_id: this.currentVoiceChannel
                    }
                }));
            } catch (error) {
                console.error('Error creating offer:', error);
            }
        }
        
        return pc;
    }
    
    async handleOffer(fromUsername, offer, context) {
        console.log('Received offer from', fromUsername);
        
        // Create peer connection if it doesn't exist
        let pc = this.peerConnections.get(fromUsername);
        if (!pc) {
            pc = await this.createPeerConnection(fromUsername, false);
        } else if (pc.signalingState === 'have-local-offer') {
            // Handle glare condition: both peers sent offers simultaneously
            console.log('Glare detected with', fromUsername, '- ignoring offer');
            return;
        }
        
        try {
            await pc.setRemoteDescription(new RTCSessionDescription(offer));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            
            this.ws.send(JSON.stringify({
                type: 'webrtc_answer',
                target: fromUsername,
                answer: pc.localDescription
            }));
        } catch (error) {
            console.error('Error handling offer:', error);
        }
    }
    
    async handleAnswer(fromUsername, answer) {
        console.log('Received answer from', fromUsername);
        
        const pc = this.peerConnections.get(fromUsername);
        if (pc) {
            try {
                await pc.setRemoteDescription(new RTCSessionDescription(answer));
            } catch (error) {
                console.error('Error handling answer:', error);
            }
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

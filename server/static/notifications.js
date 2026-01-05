// Notification Manager for Decentra
// Handles browser notifications and notification sounds

class NotificationManager {
    constructor() {
        // Load settings from localStorage with proper boolean conversion
        const notifEnabled = localStorage.getItem('notificationsEnabled');
        this.notificationsEnabled = notifEnabled === null ? true : notifEnabled === 'true';
        
        const soundsEnabled = localStorage.getItem('notificationSoundsEnabled');
        this.soundsEnabled = soundsEnabled === null ? true : soundsEnabled === 'true';
        
        // Notification mode: 'all', 'mentions', or 'none'
        this.notificationMode = localStorage.getItem('notificationMode') || 'all';
        
        this.messageSound = localStorage.getItem('messageSound') || 'soft-ping';
        this.callSound = localStorage.getItem('callSound') || 'classic-ring';
        this.audioContext = null;
        this.callSoundInterval = null;
        
        // Store current username for mention detection
        this.currentUsername = null;
        // Cache the mention regex for performance
        this.mentionRegex = null;
    }

    async init() {
        // Request notification permission if not already granted
        if (this.notificationsEnabled && 'Notification' in window) {
            if (Notification.permission === 'default') {
                const permission = await Notification.requestPermission();
                if (permission !== 'granted') {
                    this.notificationsEnabled = false;
                }
            }
        }

        // Initialize Web Audio API
        if (this.soundsEnabled) {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
    }
    
    setCurrentUsername(username) {
        this.currentUsername = username;
        // Cache the mention regex when username is set for better performance
        if (username) {
            const escapedUsername = username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            this.mentionRegex = new RegExp(`\\b@${escapedUsername}\\b`, 'i');
        } else {
            this.mentionRegex = null;
        }
    }

    setNotificationsEnabled(enabled) {
        this.notificationsEnabled = enabled;
        localStorage.setItem('notificationsEnabled', enabled);
        
        // Request permission if enabling
        if (enabled && 'Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission().then(permission => {
                if (permission !== 'granted') {
                    this.notificationsEnabled = false;
                    localStorage.setItem('notificationsEnabled', false);
                }
            });
        }
    }

    setSoundsEnabled(enabled) {
        this.soundsEnabled = enabled;
        localStorage.setItem('notificationSoundsEnabled', enabled);
        
        // Initialize audio context if enabling and not already initialized
        if (enabled && !this.audioContext) {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
    }
    
    setNotificationMode(mode) {
        if (!['all', 'mentions', 'none'].includes(mode)) {
            console.error('Invalid notification mode:', mode);
            return;
        }
        this.notificationMode = mode;
        localStorage.setItem('notificationMode', mode);
    }

    setMessageSound(sound) {
        this.messageSound = sound;
        localStorage.setItem('messageSound', sound);
    }

    setCallSound(sound) {
        this.callSound = sound;
        localStorage.setItem('callSound', sound);
    }

    // Generate notification sounds using Web Audio API
    async playSound(soundType, soundName) {
        // Initialize audio context if it doesn't exist (for test buttons or when sounds were disabled)
        if (!this.audioContext) {
            try {
                this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            } catch (error) {
                console.error('Failed to create AudioContext:', error);
                return;
            }
        }

        // Resume audio context if it's suspended (required by some browsers)
        if (this.audioContext.state === 'suspended') {
            try {
                await this.audioContext.resume();
            } catch (error) {
                console.error('Failed to resume AudioContext:', error);
                return;
            }
        }

        if (soundType === 'message') {
            this._playMessageSound(soundName);
        } else if (soundType === 'call') {
            this._playCallSound(soundName);
        }
    }

    _playMessageSound(soundName) {
        const now = this.audioContext.currentTime;

        switch (soundName) {
            case 'soft-ping':
                this._playSoftPing(now);
                break;
            case 'gentle-chime':
                this._playGentleChime(now);
                break;
            case 'subtle-pop':
                this._playSubtlePop(now);
                break;
            default:
                this._playSoftPing(now);
        }
    }

    _playSoftPing(startTime) {
        const oscillator = this.audioContext.createOscillator();
        const gainNode = this.audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(this.audioContext.destination);

        oscillator.frequency.setValueAtTime(800, startTime);
        oscillator.frequency.exponentialRampToValueAtTime(600, startTime + 0.1);

        gainNode.gain.setValueAtTime(0.3, startTime);
        gainNode.gain.linearRampToValueAtTime(0, startTime + 0.3);

        oscillator.start(startTime);
        oscillator.stop(startTime + 0.3);
    }

    _playGentleChime(startTime) {
        // Play two notes in sequence for a chime effect
        const frequencies = [659.25, 880]; // E5, A5
        const noteDuration = 0.15;

        frequencies.forEach((freq, i) => {
            const oscillator = this.audioContext.createOscillator();
            const gainNode = this.audioContext.createGain();

            oscillator.connect(gainNode);
            gainNode.connect(this.audioContext.destination);

            const noteStart = startTime + (i * noteDuration);
            oscillator.frequency.setValueAtTime(freq, noteStart);
            
            gainNode.gain.setValueAtTime(0.25, noteStart);
            gainNode.gain.linearRampToValueAtTime(0, noteStart + noteDuration);

            oscillator.start(noteStart);
            oscillator.stop(noteStart + noteDuration);
        });
    }

    _playSubtlePop(startTime) {
        const oscillator = this.audioContext.createOscillator();
        const gainNode = this.audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(this.audioContext.destination);

        oscillator.frequency.setValueAtTime(1200, startTime);
        oscillator.frequency.exponentialRampToValueAtTime(200, startTime + 0.05);

        gainNode.gain.setValueAtTime(0.4, startTime);
        gainNode.gain.linearRampToValueAtTime(0, startTime + 0.05);

        oscillator.start(startTime);
        oscillator.stop(startTime + 0.05);
    }

    _playCallSound(soundName) {
        // Call sounds loop until stopped
        if (this.callSoundInterval) {
            this.stopCallSound();
        }

        switch (soundName) {
            case 'classic-ring':
                this._playClassicRing();
                break;
            case 'modern-tone':
                this._playModernTone();
                break;
            case 'upbeat-call':
                this._playUpbeatCall();
                break;
            default:
                this._playClassicRing();
        }
    }

    _playClassicRing() {
        const playRing = () => {
            const now = this.audioContext.currentTime;
            
            // Two rings
            for (let i = 0; i < 2; i++) {
                const oscillator = this.audioContext.createOscillator();
                const gainNode = this.audioContext.createGain();

                oscillator.connect(gainNode);
                gainNode.connect(this.audioContext.destination);

                const ringStart = now + (i * 0.4);
                oscillator.frequency.setValueAtTime(440, ringStart);
                
                gainNode.gain.setValueAtTime(0.3, ringStart);
                gainNode.gain.setValueAtTime(0.3, ringStart + 0.2);
                gainNode.gain.linearRampToValueAtTime(0, ringStart + 0.35);

                oscillator.start(ringStart);
                oscillator.stop(ringStart + 0.35);
            }
        };

        playRing();
        this.callSoundInterval = setInterval(playRing, 2000);
    }

    _playModernTone() {
        const playTone = () => {
            const now = this.audioContext.currentTime;
            const frequencies = [523.25, 659.25]; // C5, E5
            
            frequencies.forEach((freq, i) => {
                const oscillator = this.audioContext.createOscillator();
                const gainNode = this.audioContext.createGain();

                oscillator.connect(gainNode);
                gainNode.connect(this.audioContext.destination);

                const noteStart = now + (i * 0.3);
                oscillator.frequency.setValueAtTime(freq, noteStart);
                oscillator.type = 'sine';
                
                gainNode.gain.setValueAtTime(0.25, noteStart);
                gainNode.gain.linearRampToValueAtTime(0, noteStart + 0.25);

                oscillator.start(noteStart);
                oscillator.stop(noteStart + 0.25);
            });
        };

        playTone();
        this.callSoundInterval = setInterval(playTone, 1500);
    }

    _playUpbeatCall() {
        const playMelody = () => {
            const now = this.audioContext.currentTime;
            const notes = [
                { freq: 523.25, start: 0, duration: 0.15 },      // C5
                { freq: 659.25, start: 0.15, duration: 0.15 },   // E5
                { freq: 783.99, start: 0.3, duration: 0.2 }      // G5
            ];
            
            notes.forEach(note => {
                const oscillator = this.audioContext.createOscillator();
                const gainNode = this.audioContext.createGain();

                oscillator.connect(gainNode);
                gainNode.connect(this.audioContext.destination);

                const noteStart = now + note.start;
                oscillator.frequency.setValueAtTime(note.freq, noteStart);
                oscillator.type = 'sine';
                
                gainNode.gain.setValueAtTime(0.25, noteStart);
                gainNode.gain.linearRampToValueAtTime(0, noteStart + note.duration);

                oscillator.start(noteStart);
                oscillator.stop(noteStart + note.duration);
            });
        };

        playMelody();
        this.callSoundInterval = setInterval(playMelody, 2000);
    }

    stopCallSound() {
        if (this.callSoundInterval) {
            clearInterval(this.callSoundInterval);
            this.callSoundInterval = null;
        }
    }

    showNotification(title, body, icon = null) {
        if (!this.notificationsEnabled) return;

        if ('Notification' in window && Notification.permission === 'granted') {
            const notification = new Notification(title, {
                body: body,
                icon: icon || undefined, // Let browser use default icon
                tag: 'decentra-notification',
                requireInteraction: false
            });

            // Auto-close after 5 seconds
            setTimeout(() => notification.close(), 5000);

            // Focus window when notification is clicked
            notification.onclick = () => {
                window.focus();
                notification.close();
            };
        }
    }

    notifyNewMessage(sender, message) {
        // Check notification mode
        if (this.notificationMode === 'none') {
            return; // No notifications
        }
        
        // Check if this is a mention using cached regex
        let isMention = false;
        if (this.mentionRegex) {
            isMention = this.mentionRegex.test(message);
        }
        
        // If mode is 'mentions' and this is not a mention, skip notification
        if (this.notificationMode === 'mentions' && !isMention) {
            return;
        }
        
        // Only show notification if page is not visible
        // Use Page Visibility API with feature detection
        const isVisible = typeof document.visibilityState !== 'undefined' 
            ? document.visibilityState === 'visible' 
            : true;
            
        if (!isVisible) {
            this.showNotification(
                `New message from ${sender}`,
                message.length > 50 ? message.substring(0, 50) + '...' : message
            );
        }
        
        // Always play sound regardless of visibility (if sounds are enabled)
        // Fire-and-forget: we don't await to avoid blocking the notification
        if (this.soundsEnabled) {
            this.playSound('message', this.messageSound);
        }
    }

    notifyIncomingCall(caller) {
        this.showNotification(
            'Incoming Voice Call',
            `${caller} is calling you...`
        );
        
        // Fire-and-forget: we don't await to avoid blocking the notification
        if (this.soundsEnabled) {
            this.playSound('call', this.callSound);
        }
    }
}

// Export for use in chat.js
window.NotificationManager = NotificationManager;

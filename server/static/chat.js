// Chat page JavaScript with Servers, DMs, and Friends support
(async function() {
    console.log('chat.js loaded and executing');
    // Check if user is authenticated
    const username = sessionStorage.getItem('username');
    const authMode = sessionStorage.getItem('authMode');
    const inviteCode = sessionStorage.getItem('inviteCode');
    const email = sessionStorage.getItem('email');
    const verificationCode = sessionStorage.getItem('verificationCode');
    const token = sessionStorage.getItem('token');
    
    // If we have a token, we can authenticate with it
    if (token && username) {
        // Token authentication - no password needed
        console.log('Using token authentication');
    } else if (authMode === 'verify_email') {
        // For verify_email mode, we only need username and verification code
        if (!username || !verificationCode) {
            window.location.href = '/static/index.html';
            return;
        }
    } else {
        // For login and signup modes, we need password
        const password = sessionStorage.getItem('password');
        if (!username || !password || !authMode) {
            window.location.href = '/static/index.html';
            return;
        }
    }
    
    // Update current user display
    document.getElementById('current-user').textContent = username;
    
    // WebSocket connection
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    let ws = null;
    let authenticated = false;
    let voiceChat = null; // VoiceChat instance
    
    // Current context
    let currentContext = null; // {type: 'server'|'dm'|'global', id: server_id/channel_id or dm_id}
    let servers = [];
    let dms = [];
    let friends = [];
    let friendRequestsSent = [];
    let friendRequestsReceived = [];
    let voiceMembers = {}; // Track voice members by channel: {server_id/channel_id: [usernames]}
    
    // Server settings
    let maxMessageLength = 2000; // Default max message length
    let allowFileAttachments = true; // Default allow attachments
    let maxAttachmentSizeMB = 10; // Default max attachment size
    
    // File attachment state
    let pendingAttachments = []; // Files to be uploaded with next message
    let attachmentUploadQueue = new Map(); // Map of message content hash to attachments
    
    // Video toggle constants
    const DEFAULT_SCREEN_SHARE_PRIORITY = true; // When both video and screenshare are active, show screenshare by default
    
    // DOM elements
    const messagesContainer = document.getElementById('messages');
    const messageForm = document.getElementById('message-form');
    const messageInput = document.getElementById('message-input');
    const submitBtn = messageForm.querySelector('button[type="submit"]');
    const chatTitle = document.getElementById('chat-title');
    const attachFileBtn = document.getElementById('attach-file-btn');
    const fileInput = document.getElementById('file-input');
    const attachmentPreview = document.getElementById('attachment-preview');
    
    // Sidebar elements
    const serversList = document.getElementById('servers-list');
    const dmsList = document.getElementById('dms-list');
    const channelsList = document.getElementById('channels-list');
    const friendsList = document.getElementById('friends-list');
    const channelsView = document.getElementById('channels-view');
    const friendsView = document.getElementById('friends-view');
    const serverNameDisplay = document.getElementById('server-name');
    
    // Button elements
    const userMenuBtn = document.getElementById('user-menu-btn');
    const userMenu = document.getElementById('user-menu');
    const menuCreateServerBtn = document.getElementById('menu-create-server-btn');
    const menuJoinServerBtn = document.getElementById('menu-join-server-btn');
    const menuInviteBtn = document.getElementById('menu-invite-btn');
    const menuLogoutBtn = document.getElementById('menu-logout-btn');
    const menuFriendsBtn = document.getElementById('menu-friends-btn');
    const searchUsersBtn = document.getElementById('search-users-btn');
    const menuAdminBtn = document.getElementById('menu-admin-btn');
    console.log('[DEBUG] Admin button element found:', menuAdminBtn !== null);
    
    // Modal elements
    const inviteModal = document.getElementById('invite-modal');
    const inviteCodeText = document.getElementById('invite-code-text');
    const closeInviteModalBtn = document.getElementById('close-invite-modal');
    
    const createServerModal = document.getElementById('create-server-modal');
    const createServerForm = document.getElementById('create-server-form');
    const serverNameInput = document.getElementById('server-name-input');
    const cancelServerBtn = document.getElementById('cancel-server-btn');
    
    const joinServerModal = document.getElementById('join-server-modal');
    const joinServerForm = document.getElementById('join-server-form');
    const serverInviteInput = document.getElementById('server-invite-input');
    const cancelJoinServerBtn = document.getElementById('cancel-join-server-btn');
    const joinServerError = document.getElementById('join-server-error');
    
    const createVoiceChannelModal = document.getElementById('create-voice-channel-modal');
    const createVoiceChannelForm = document.getElementById('create-voice-channel-form');
    const voiceChannelNameInput = document.getElementById('voice-channel-name-input');
    const cancelVoiceChannelBtn = document.getElementById('cancel-voice-channel-btn');
    
    const createTextChannelModal = document.getElementById('create-text-channel-modal');
    const createTextChannelForm = document.getElementById('create-text-channel-form');
    const textChannelNameInput = document.getElementById('text-channel-name-input');
    const cancelTextChannelBtn = document.getElementById('cancel-text-channel-btn');
    
    const searchUsersModal = document.getElementById('search-users-modal');
    const searchUsersInput = document.getElementById('search-users-input');
    const searchResults = document.getElementById('search-results');
    const closeSearchModalBtn = document.getElementById('close-search-modal');
    
    const serverSettingsModal = document.getElementById('server-settings-modal');
    const serverSettingsBtn = document.getElementById('server-settings-btn');
    const closeServerSettingsModalBtn = document.getElementById('close-server-settings-modal');
    const renameServerForm = document.getElementById('rename-server-form');
    const newServerNameInput = document.getElementById('new-server-name-input');
    const generateServerInviteBtn = document.getElementById('generate-server-invite-btn');
    const serverInviteDisplay = document.getElementById('server-invite-display');
    const serverInviteCodeText = document.getElementById('server-invite-code-text');
    const serverInviteLinkText = document.getElementById('server-invite-link-text');
    const copyInviteLinkBtn = document.getElementById('copy-invite-link-btn');
    const sendInviteToFriendsBtn = document.getElementById('send-invite-to-friends-btn');
    const sendInviteModal = document.getElementById('send-invite-modal');
    const closeSendInviteModalBtn = document.getElementById('close-send-invite-modal');
    const inviteFriendsList = document.getElementById('invite-friends-list');
    const sendSelectedInvitesBtn = document.getElementById('send-selected-invites-btn');
    const serverMembersList = document.getElementById('server-members-list');
    const createTextChannelBtn = document.getElementById('create-text-channel-btn');
    const createVoiceChannelBtn = document.getElementById('create-voice-channel-btn');
    
    // Roles management elements
    const rolesModal = document.getElementById('roles-modal');
    const openRolesManagerBtn = document.getElementById('open-roles-manager-btn');
    const closeRolesModalBtn = document.getElementById('close-roles-modal');
    const createRoleBtn = document.getElementById('create-role-btn');
    const rolesList = document.getElementById('roles-list');
    const roleEditor = document.getElementById('role-editor');
    const roleEditForm = document.getElementById('role-edit-form');
    const roleNameInput = document.getElementById('role-name-input');
    const roleColorInput = document.getElementById('role-color-input');
    const roleColorPreview = document.getElementById('role-color-preview');
    const saveRoleBtn = document.getElementById('save-role-btn');
    const deleteRoleBtn = document.getElementById('delete-role-btn');
    const cancelRoleBtn = document.getElementById('cancel-role-btn');
    const roleMembersList = document.getElementById('role-members-list');
    const assignRoleBtn = document.getElementById('assign-role-btn');
    const assignRoleModal = document.getElementById('assign-role-modal');
    const closeAssignModalBtn = document.getElementById('close-assign-modal');
    const availableMembersList = document.getElementById('available-members-list');
    
    // Voice elements
    const voiceControls = document.getElementById('voice-controls');
    const voiceStatusText = document.getElementById('voice-status-text');
    const muteBtn = document.getElementById('mute-btn');
    const videoBtn = document.getElementById('video-btn');
    const screenShareBtn = document.getElementById('screen-share-btn');
    const micSettingsBtn = document.getElementById('mic-settings-btn');
    const leaveVoiceBtn = document.getElementById('leave-voice-btn');
    const incomingCallModal = document.getElementById('incoming-call-modal');
    const callerNameDisplay = document.getElementById('caller-name');
    const acceptCallBtn = document.getElementById('accept-call-btn');
    const rejectCallBtn = document.getElementById('reject-call-btn');
    
    // Video call area
    const videoCallArea = document.getElementById('video-call-area');
    const videoGrid = document.getElementById('video-grid');
    const maximizedVideoContainer = document.getElementById('maximized-video-container');
    const minimizeVideoBtn = document.getElementById('minimize-video-btn');
    
    // Voice participants panel
    const voiceParticipants = document.getElementById('voice-participants');
    const participantsList = document.getElementById('participants-list');
    
    // Screen share settings modal
    const screenShareSettingsModal = document.getElementById('screen-share-settings-modal');
    const screenResolutionSelect = document.getElementById('screen-resolution-select');
    const screenFramerateSelect = document.getElementById('screen-framerate-select');
    
    // Admin settings modal elements
    const adminSettingsModal = document.getElementById('admin-settings-modal');
    const adminCloseModalBtn = document.getElementById('admin-close-modal-btn');
    const adminSaveSettingsBtn = document.getElementById('admin-save-settings-btn');
    const adminTestSmtpBtn = document.getElementById('admin-test-smtp-btn');
    const startScreenShareBtn = document.getElementById('start-screen-share-btn');
    const cancelScreenShareBtn = document.getElementById('cancel-screen-share-btn');
    
    // Avatar and device modals
    const avatarSettingsModal = document.getElementById('avatar-settings-modal');
    const avatarPicker = document.getElementById('avatar-picker');
    const closeAvatarModalBtn = document.getElementById('close-avatar-modal');
    const menuAvatarBtn = document.getElementById('menu-avatar-btn');
    const currentUserAvatar = document.getElementById('current-user-avatar');
    
    const deviceSettingsModal = document.getElementById('device-settings-modal');
    const microphoneSelect = document.getElementById('microphone-select');
    const speakerSelect = document.getElementById('speaker-select');
    const cameraSelect = document.getElementById('camera-select');
    const closeDeviceSettingsModalBtn = document.getElementById('close-device-settings-modal');
    const testMicrophoneBtn = document.getElementById('test-microphone-btn');
    const micTestStatus = document.getElementById('mic-test-status');
    
    // Notification settings elements
    const notificationSettingsModal = document.getElementById('notification-settings-modal');
    const menuNotificationsBtn = document.getElementById('menu-notifications-btn');
    const closeNotificationSettingsModalBtn = document.getElementById('close-notification-settings-modal');
    const enableNotificationsCheckbox = document.getElementById('enable-notifications');
    const enableNotificationSoundsCheckbox = document.getElementById('enable-notification-sounds');
    const notificationModeSelect = document.getElementById('notification-mode-select');
    const messageSoundSelect = document.getElementById('message-sound-select');
    const callSoundSelect = document.getElementById('call-sound-select');
    const testMessageSoundBtn = document.getElementById('test-message-sound-btn');
    const testCallSoundBtn = document.getElementById('test-call-sound-btn');
    
    // Voice settings elements
    const voiceSettingsModal = document.getElementById('voice-settings-modal');
    const menuVoiceSettingsBtn = document.getElementById('menu-voice-settings-btn');
    const closeVoiceSettingsModalBtn = document.getElementById('close-voice-settings-modal');
    const enablePushToTalkCheckbox = document.getElementById('enable-push-to-talk');
    const pttKeybindDisplay = document.getElementById('ptt-keybind-display');
    const setPttKeybindBtn = document.getElementById('set-ptt-keybind-btn');
    const pttKeybindGroup = document.getElementById('ptt-keybind-group');
    
    // Profile settings elements
    const profileSettingsModal = document.getElementById('profile-settings-modal');
    const menuProfileBtn = document.getElementById('menu-profile-btn');
    const closeProfileModalBtn = document.getElementById('close-profile-modal');
    const statusMessageInput = document.getElementById('status-message-input');
    const bioInput = document.getElementById('bio-input');
    const saveProfileBtn = document.getElementById('save-profile-btn');
    
    // Custom emoji and reaction elements
    const uploadEmojiModal = document.getElementById('upload-emoji-modal');
    const uploadEmojiForm = document.getElementById('upload-emoji-form');
    const emojiNameInput = document.getElementById('emoji-name-input');
    const emojiFileInput = document.getElementById('emoji-file-input');
    const emojiPreviewContainer = document.getElementById('emoji-preview-container');
    const emojiPreview = document.getElementById('emoji-preview');
    const uploadEmojiError = document.getElementById('upload-emoji-error');
    const cancelUploadEmojiBtn = document.getElementById('cancel-upload-emoji-btn');
    const uploadCustomEmojiBtn = document.getElementById('upload-custom-emoji-btn');
    const serverEmojisList = document.getElementById('server-emojis-list');
    
    // Server purge settings elements
    const saveServerPurgeSettingsBtn = document.getElementById('save-server-purge-settings');
    
    const emojiPickerModal = document.getElementById('emoji-picker-modal');
    const closeEmojiPickerBtn = document.getElementById('close-emoji-picker');
    const standardEmojisGrid = document.getElementById('standard-emojis');
    const customEmojisGrid = document.getElementById('custom-emojis');
    
    // Right sidebar (members list) elements
    const rightSidebar = document.getElementById('right-sidebar');
    const toggleMembersBtn = document.getElementById('toggle-members-btn');
    const serverMembersDisplay = document.getElementById('server-members-display');
    
    // Main container for layout changes
    const mainContainer = document.querySelector('.main-container');
    
    // Mention autocomplete elements
    const mentionAutocomplete = document.getElementById('mention-autocomplete');
    
    let incomingCallFrom = null;
    let currentlySelectedServer = null;
    let currentAvatar = '👤';
    let isMembersSidebarCollapsed = false;
    
    // Roles management state
    let serverRoles = [];
    let currentEditingRole = null;
    let isCreatingNewRole = false;
    
    // Mention autocomplete state
    let mentionActive = false;
    let mentionStartPos = -1;
    let mentionQuery = '';
    let selectedMentionIndex = 0;
    let currentServerMembers = [];
    
    // Custom emoji and reaction state
    let customEmojis = {}; // {server_id: [emojis]}
    let currentPickerTargetMessageId = null;
    let standardEmojis = ['😀', '😃', '😄', '😁', '😊', '😍', '🤩', '😎', '🥳', '😇', '🙂', '😉', '😌', '😋', '😜', '🤪', '😂', '🤣', '😅', '😆', '😏', '😒', '🙄', '😬', '🤔', '🤨', '😐', '😑', '😶', '🙃', '😯', '😲', '😮', '😱', '😨', '😰', '😥', '😓', '🤗', '🤭', '🤫', '🤥', '😦', '😧', '🥱', '😴', '🤤', '😪', '😵', '🤐', '🥴', '🤢', '🤮', '🤧', '😷', '🤒', '🤕', '🤑', '🤠', '👍', '👎', '👌', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '👇', '☝️', '👏', '🙌', '👐', '🤲', '🤝', '🙏', '✍️', '💅', '🤳', '💪', '🦾', '🦿', '🦵', '🦶', '👂', '🦻', '👃', '🧠', '🫀', '🫁', '🦷', '🦴', '👀', '👁️', '👅', '👄', '💋', '🩸', '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❤️‍🔥', '❤️‍🩹', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '☮️', '✝️', '☪️', '🕉️', '☸️', '✡️', '🔯', '🕎', '☯️', '☦️', '🛐', '⛎', '♈', '♉', '♊', '♋', '♌', '♍', '♎', '♏', '♐', '♑', '♒', '♓', '🆔', '⚛️', '🉑', '☢️', '☣️', '🔰', '✅', '❌', '⭕', '🚫', '💯', '💢', '♨️', '🚷', '🚯', '🚳', '🚱', '🔞', '📵', '🚭', '❗', '❕', '❓', '❔', '‼️', '⁉️', '🔅', '🔆', '〽️', '⚠️', '🚸', '🔱', '⚜️', '♻️', '✳️', '❇️', '✴️', '💠', '🔸', '🔹', '🔶', '🔷', '🔺', '🔻', '💎', '🎉', '🎊', '🎈', '🎁', '🏆', '🥇', '🥈', '🥉', '⭐', '🌟', '✨', '🔥', '💫', '💥', '💦', '💨', '👋', '🙋'];
    
    // Initialize notification manager
    let notificationManager = null;
    if (window.NotificationManager) {
        notificationManager = new NotificationManager();
        try {
            await notificationManager.init();
        } catch (error) {
            console.error('Failed to initialize notification manager:', error);
            // Continue without notifications - the app should still work
        }
    }
    
    // Connect to WebSocket
    let reconnectAttempts = 0;
    const maxReconnectAttempts = 10; // Cap the counter used for exponential backoff delay calculation
    const maxReconnectDelay = 30000; // Maximum 30 seconds between retries
    let isIntentionalClose = false; // Track if close was intentional (e.g., logout)
    
    function connect() {
        ws = new WebSocket(wsUrl);
        
        ws.onopen = () => {
            console.log('WebSocket connected');
            reconnectAttempts = 0; // Reset reconnect attempts on successful connection
            authenticate();
        };
        
        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            handleMessage(data);
        };
        
        ws.onerror = (error) => {
            console.error('WebSocket error:', error);
        };
        
        ws.onclose = () => {
            console.log('WebSocket disconnected');
            
            // Don't reconnect if this was an intentional close (e.g., user logged out)
            if (isIntentionalClose) {
                isIntentionalClose = false;
                return;
            }
            
            // Always attempt to reconnect, whether authenticated or not
            // Use exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s (max)
            // Compute the exponential backoff attempt number, capped so the delay cannot grow beyond maxReconnectDelay
            const attemptNum = Math.min(reconnectAttempts, maxReconnectAttempts);
            const delay = Math.min(1000 * Math.pow(2, attemptNum), maxReconnectDelay);
            
            // Cap reconnectAttempts to prevent unbounded growth
            if (reconnectAttempts < maxReconnectAttempts) {
                reconnectAttempts++;
            }
            
            const delaySeconds = Math.round(delay / 1000);
            appendSystemMessage(`Connection lost. Reconnecting in ${delaySeconds} second${delaySeconds !== 1 ? 's' : ''}...`);
            setTimeout(connect, delay);
        };
    }
    
    // Helper to sanitize avatar image URLs coming from untrusted sources.
    // Returns a safe URL string or null if the value is not acceptable.
    function sanitizeAvatarUrl(rawUrl) {
        if (typeof rawUrl !== 'string') {
            return null;
        }
        const trimmed = rawUrl.trim();
        if (!trimmed) {
            return null;
        }

        // Allow data URLs for images only
        if (trimmed.startsWith('data:')) {
            const lower = trimmed.toLowerCase();
            if (lower.startsWith('data:image/')) {
                return trimmed;
            }
            return null;
        }

        try {
            // Support absolute and relative URLs; resolve relative to current origin.
            const url = new URL(trimmed, window.location.origin);

            // Only allow http/https, and require same origin for http.
            if (url.protocol === 'https:') {
                return url.toString();
            }
            if (url.protocol === 'http:' && url.origin === window.location.origin) {
                return url.toString();
            }
        } catch (e) {
            // Invalid URL
            return null;
        }

        return null;
    }
    
    // Helper function to create avatar element
    function createAvatarElement(avatarData, className = 'user-avatar') {
        const avatarEl = document.createElement('span');
        avatarEl.className = className;
        
        if (avatarData && avatarData.avatar_type === 'image' && avatarData.avatar_data) {
            // Image avatar
            const img = document.createElement('img');
            const safeSrc = sanitizeAvatarUrl(avatarData.avatar_data);
            if (safeSrc) {
                img.src = safeSrc;
                img.alt = 'Avatar';
                avatarEl.appendChild(img);
            } else {
                // Fallback to emoji avatar if URL is not safe
                avatarEl.textContent = (avatarData && avatarData.avatar) || '👤';
            }
        } else {
            // Emoji avatar
            avatarEl.textContent = (avatarData && avatarData.avatar) || '👤';
        }
        
        return avatarEl;
    }
    
    // Helper function to update avatar element
    function updateAvatarElement(element, avatarData) {
        // Clear existing content
        element.innerHTML = '';
        
        if (avatarData && avatarData.avatar_type === 'image' && avatarData.avatar_data) {
            // Image avatar
            const img = document.createElement('img');
            const safeSrc = sanitizeAvatarUrl(avatarData.avatar_data);
            if (safeSrc) {
                img.src = safeSrc;
                img.alt = 'Avatar';
                element.appendChild(img);
            } else {
                // Fallback to emoji avatar if URL is not safe
                element.textContent = (avatarData && avatarData.avatar) || '👤';
            }
        } else {
            // Emoji avatar
            element.textContent = (avatarData && avatarData.avatar) || '👤';
        }
    }
    
    // Authenticate with server
    function authenticate() {
        const storedToken = sessionStorage.getItem('token');
        
        // If we have a valid token, use token-based authentication
        if (storedToken) {
            const authData = {
                type: 'token',
                token: storedToken
            };
            ws.send(JSON.stringify(authData));
            return;
        }
        
        // Otherwise, use password-based authentication
        const authData = {
            type: authMode,
            username: username
        };
        
        if (authMode === 'signup') {
            authData.password = sessionStorage.getItem('password');
            authData.email = email || '';
            authData.invite_code = inviteCode || '';
        } else if (authMode === 'verify_email') {
            authData.code = verificationCode;
        } else {
            // login mode
            authData.password = sessionStorage.getItem('password');
        }
        
        ws.send(JSON.stringify(authData));
    }
    
    // Handle incoming messages
    function handleMessage(data) {
        switch (data.type) {
            case 'auth_success':
                authenticated = true;
                console.log('Authentication successful');
                
                // Store the JWT token for future reconnections
                if (data.token) {
                    sessionStorage.setItem('token', data.token);
                    console.log('JWT token stored');
                }
                
                // Clean up sensitive data - password is no longer needed
                sessionStorage.removeItem('password');
                sessionStorage.removeItem('authMode');
                sessionStorage.removeItem('inviteCode');
                sessionStorage.removeItem('email');
                sessionStorage.removeItem('verificationCode');
                
                // Initialize voice chat
                voiceChat = new VoiceChat(ws, username);
                // Check if user is admin
                ws.send(JSON.stringify({type: 'check_admin'}));
                // Request admin settings to get file attachment limits
                ws.send(JSON.stringify({type: 'get_admin_settings'}));
                break;
                
            case 'auth_error':
                authenticated = false;
                alert('Authentication failed: ' + data.message);
                logout();
                break;
                
            case 'verification_required':
                // Redirect back to login page to enter verification code
                alert(data.message + '. Please check your email and enter the verification code.');
                // Store username for verification flow
                sessionStorage.setItem('pendingUsername', username);
                sessionStorage.removeItem('password');
                sessionStorage.removeItem('email');
                sessionStorage.removeItem('inviteCode');
                window.location.href = '/static/index.html?verify=true';
                break;
                
            case 'init':
                servers = data.servers || [];
                dms = data.dms || [];
                friends = data.friends || [];
                friendRequestsSent = data.friend_requests_sent || [];
                friendRequestsReceived = data.friend_requests_received || [];
                updateAvatarElement(currentUserAvatar, data);
                updateServersList();
                updateDMsList();
                updateFriendsList();
                
                // Store current user's profile data
                window.currentUserProfile = {
                    bio: data.bio || '',
                    status_message: data.status_message || ''
                };
                
                // Initialize notification manager with username and notification mode
                if (notificationManager) {
                    notificationManager.setCurrentUsername(username);
                    if (data.notification_mode) {
                        notificationManager.setNotificationMode(data.notification_mode);
                    }
                }
                
                // Handle admin status from init message
                if (data.is_admin !== undefined) {
                    console.log('[DEBUG] Admin status from init message:', data.is_admin);
                    if (menuAdminBtn) {
                        if (data.is_admin) {
                            console.log('[DEBUG] Showing admin settings button');
                            menuAdminBtn.classList.remove('hidden');
                        } else {
                            console.log('[DEBUG] Hiding admin settings button');
                            menuAdminBtn.classList.add('hidden');
                        }
                    } else {
                        console.error('[ERROR] Admin settings button element not found!');
                    }
                } else {
                    console.log('[DEBUG] Admin status undefined in init message');
                }
                break;
                
            case 'history':
                // Legacy global chat history
                if (data.messages && data.messages.length > 0) {
                    data.messages.forEach(msg => appendMessage(msg));
                    scrollToBottom();
                }
                break;
                
            case 'channel_history':
                messagesContainer.innerHTML = '';
                if (data.messages && data.messages.length > 0) {
                    data.messages.forEach(msg => appendMessage(msg));
                }
                scrollToBottom();
                break;
                
            case 'dm_history':
                messagesContainer.innerHTML = '';
                if (data.messages && data.messages.length > 0) {
                    data.messages.forEach(msg => appendMessage(msg));
                }
                scrollToBottom();
                break;
                
            case 'message':
                console.log('Received message:', data);
                console.log('Current context:', currentContext);
                console.log('Is for current context:', isMessageForCurrentContext(data));
                
                // If this is our own message and has an ID, upload queued attachments.
                // Prefer matching by messageKey, but fall back to a single pending entry
                // if the server did not echo messageKey back.
                if (data.username === username && data.id) {
                    let attachments = null;
                    let keyToDelete = null;

                    if (data.messageKey) {
                        attachments = attachmentUploadQueue.get(data.messageKey) || null;
                        if (attachments) {
                            keyToDelete = data.messageKey;
                        }
                    } else if (attachmentUploadQueue && attachmentUploadQueue.size === 1) {
                        // Fallback: if there is exactly one pending attachment set, assume it
                        // belongs to this message. This avoids leaking the queue when the
                        // server does not return messageKey.
                        const [entryKey, entryAttachments] = attachmentUploadQueue.entries().next().value;
                        attachments = entryAttachments || null;
                        keyToDelete = entryKey;
                    }

                    if (attachments && attachments.length > 0) {
                        console.log('Uploading attachments for message:', data.id);
                        uploadAttachmentsForMessage(data.id, attachments);
                        if (keyToDelete !== null) {
                            attachmentUploadQueue.delete(keyToDelete);
                        }
                    }
                }
                
                if (isMessageForCurrentContext(data)) {
                    console.log('Appending message to chat');
                    appendMessage(data);
                    scrollToBottom();
                } else {
                    console.log('Message not for current context, ignoring');
                }
                
                // Trigger notification if message is from another user
                // The notificationManager will handle visibility checks
                if (data.username && data.username !== username && notificationManager) {
                    notificationManager.notifyNewMessage(data.username, data.content || '');
                }
                break;
                
            case 'system':
                appendSystemMessage(data.content);
                break;
                
            case 'server_created':
                servers.push(data.server);
                updateServersList();
                selectServer(data.server.id);
                createServerModal.classList.add('hidden');
                serverNameInput.value = '';
                break;
                
            case 'server_joined':
                servers.push(data.server);
                updateServersList();
                joinServerModal.classList.add('hidden');
                serverInviteInput.value = '';
                joinServerError.classList.add('hidden');
                selectServer(data.server.id);
                break;
                
            case 'friend_added':
                // Check if friend is already in the list (by username)
                const existingFriend = friends.find(f => 
                    (typeof f === 'object' ? f.username : f) === data.username
                );
                if (!existingFriend) {
                    friends.push({
                        username: data.username,
                        avatar: data.avatar || '👤'
                    });
                    updateFriendsList();
                }
                break;
                
            case 'friend_removed':
                friends = friends.filter(f => f !== data.username);
                updateFriendsList();
                break;
                
            case 'friend_request_sent':
                // Add to sent requests list
                if (!friendRequestsSent.find(r => r.username === data.username)) {
                    friendRequestsSent.push({
                        username: data.username,
                        avatar: data.avatar || '👤',
                        avatar_type: data.avatar_type || 'emoji',
                        avatar_data: data.avatar_data
                    });
                    updateFriendsList();
                }
                break;
                
            case 'friend_request_received':
                // Add to received requests list
                if (!friendRequestsReceived.find(r => r.username === data.username)) {
                    friendRequestsReceived.push({
                        username: data.username,
                        avatar: data.avatar || '👤',
                        avatar_type: data.avatar_type || 'emoji',
                        avatar_data: data.avatar_data
                    });
                    updateFriendsList();
                }
                break;
                
            case 'friend_request_approved':
                // Remove from received requests and add to friends
                friendRequestsReceived = friendRequestsReceived.filter(r => r.username !== data.username);
                if (!friends.find(f => f.username === data.username)) {
                    friends.push({
                        username: data.username,
                        avatar: data.avatar || '👤',
                        avatar_type: data.avatar_type || 'emoji',
                        avatar_data: data.avatar_data
                    });
                }
                updateFriendsList();
                break;
                
            case 'friend_request_accepted':
                // Your request was accepted - remove from sent and add to friends
                friendRequestsSent = friendRequestsSent.filter(r => r.username !== data.username);
                if (!friends.find(f => f.username === data.username)) {
                    friends.push({
                        username: data.username,
                        avatar: data.avatar || '👤',
                        avatar_type: data.avatar_type || 'emoji',
                        avatar_data: data.avatar_data
                    });
                }
                updateFriendsList();
                break;
                
            case 'friend_request_denied':
                // Remove from received requests
                friendRequestsReceived = friendRequestsReceived.filter(r => r.username !== data.username);
                updateFriendsList();
                break;
                
            case 'friend_request_cancelled':
                // Remove from sent requests
                friendRequestsSent = friendRequestsSent.filter(r => r.username !== data.username);
                updateFriendsList();
                break;
                
            case 'friend_request_cancelled_by_sender':
                // Someone cancelled their request to you
                friendRequestsReceived = friendRequestsReceived.filter(r => r.username !== data.username);
                updateFriendsList();
                break;
                
            case 'dm_started':
                if (!dms.find(dm => dm.id === data.dm.id)) {
                    dms.push(data.dm);
                    updateDMsList();
                }
                selectDM(data.dm.id);
                break;
                
            case 'search_results':
                displaySearchResults(data.results);
                break;
                
            case 'invite_code':
                showInviteModal(data.code);
                break;
                
            // Server settings messages
            case 'server_renamed':
                const renamedServer = servers.find(s => s.id === data.server_id);
                if (renamedServer) {
                    renamedServer.name = data.name;
                    updateServersList();
                    if (currentlySelectedServer === data.server_id) {
                        serverNameDisplay.textContent = data.name;
                    }
                }
                break;
            
            case 'server_icon_update':
                const updatedServer = servers.find(s => s.id === data.server_id);
                if (updatedServer) {
                    updatedServer.icon = data.icon;
                    updatedServer.icon_type = data.icon_type;
                    updatedServer.icon_data = data.icon_data;
                    updateServersList();
                    // Show notification only for the current server
                    if (data.server_id === currentlySelectedServer) {
                        showNotification('Server icon updated successfully!');
                    }
                }
                break;
                
            case 'server_invite_code':
                showServerInviteCode(data.code);
                break;
                
            case 'server_members':
                displayServerMembers(data.members, data.server_id);
                // Also update the sidebar if we're viewing this server
                if (currentlySelectedServer === data.server_id) {
                    displayServerMembersInSidebar(data.members);
                    // Store current server members for mention autocomplete
                    currentServerMembers = data.members;
                }
                break;
                
            case 'permissions_updated':
                const serverWithUpdatedPerms = servers.find(s => s.id === data.server_id);
                if (serverWithUpdatedPerms) {
                    serverWithUpdatedPerms.permissions = data.permissions;
                }
                break;
                
            case 'permissions_updated_success':
                // Refresh member list if settings modal is open
                if (!serverSettingsModal.classList.contains('hidden')) {
                    ws.send(JSON.stringify({
                        type: 'get_server_members',
                        server_id: currentlySelectedServer
                    }));
                }
                break;
                
            case 'member_joined':
                // Refresh member list if settings modal is open
                if (!serverSettingsModal.classList.contains('hidden') && currentlySelectedServer === data.server_id) {
                    ws.send(JSON.stringify({
                        type: 'get_server_members',
                        server_id: currentlySelectedServer
                    }));
                }
                break;
                
            case 'error':
                // Show error in admin settings modal if it's open
                if (adminSettingsModal && !adminSettingsModal.classList.contains('hidden')) {
                    const statusEl = document.getElementById('admin-status-message');
                    if (statusEl) {
                        statusEl.textContent = data.message;
                        statusEl.className = 'status-message error';
                        statusEl.style.display = 'block';
                        setTimeout(() => {
                            statusEl.style.display = 'none';
                        }, 5000);
                    }
                }
                // Show error in join server modal if it's open
                else if (!joinServerModal.classList.contains('hidden')) {
                    joinServerError.textContent = data.message;
                    joinServerError.classList.remove('hidden');
                } else {
                    alert(data.message);
                }
                break;
            
            case 'message_edited':
                // Update the edited message in the UI
                const editedMessageDiv = messagesContainer.querySelector(`[data-message-id="${data.message_id}"]`);
                if (editedMessageDiv) {
                    const contentDiv = editedMessageDiv.querySelector('.message-content');
                    if (contentDiv) {
                        contentDiv.textContent = data.content;
                    }
                    
                    // Add or update edited indicator
                    const headerDiv = editedMessageDiv.querySelector('.message-header');
                    if (headerDiv) {
                        let editedSpan = headerDiv.querySelector('.message-edited');
                        if (!editedSpan) {
                            editedSpan = document.createElement('span');
                            editedSpan.className = 'message-edited';
                            editedSpan.textContent = '(edited)';
                            headerDiv.appendChild(editedSpan);
                        }
                    }
                }
                break;
            
            case 'message_deleted':
                // Mark the message as deleted in the UI
                const deletedMessageDiv = messagesContainer.querySelector(`[data-message-id="${data.message_id}"]`);
                if (deletedMessageDiv) {
                    deletedMessageDiv.classList.add('deleted');
                    
                    const contentDiv = deletedMessageDiv.querySelector('.message-content');
                    if (contentDiv) {
                        contentDiv.textContent = '[Message deleted]';
                        contentDiv.style.fontStyle = 'italic';
                        contentDiv.style.opacity = '0.6';
                    }
                    
                    // Remove edit/delete buttons
                    const actionsDiv = deletedMessageDiv.querySelector('.message-actions');
                    if (actionsDiv) {
                        actionsDiv.remove();
                    }
                }
                break;
            
            case 'announcement_update':
                handleAnnouncementUpdate(data);
                // Update max message length from server settings
                if (data.max_message_length !== undefined) {
                    maxMessageLength = data.max_message_length;
                }
                break;
            
            case 'admin_status':
                // Show or hide admin settings menu item based on admin status
                console.log('[DEBUG] Admin status from check_admin:', data.is_admin);
                if (menuAdminBtn) {
                    if (data.is_admin) {
                        console.log('[DEBUG] Showing admin settings button');
                        menuAdminBtn.classList.remove('hidden');
                    } else {
                        console.log('[DEBUG] Hiding admin settings button');
                        menuAdminBtn.classList.add('hidden');
                    }
                } else {
                    console.error('[ERROR] Admin settings button element not found!');
                }
                break;
            
            case 'admin_settings':
                // Load admin settings into the modal
                loadAdminSettings(data.settings);
                
                // Update global settings for file attachments
                if (data.settings.allow_file_attachments !== undefined) {
                    allowFileAttachments = data.settings.allow_file_attachments;
                }
                if (data.settings.max_attachment_size_mb !== undefined) {
                    maxAttachmentSizeMB = data.settings.max_attachment_size_mb;
                }
                
                // Enable/disable attach button based on settings
                if (attachFileBtn) {
                    attachFileBtn.disabled = !allowFileAttachments;
                    attachFileBtn.title = allowFileAttachments ? 'Attach File' : 'File attachments disabled';
                }
                break;
            
            case 'settings_saved':
                // Show success message when settings are saved
                showAdminStatus('Settings saved successfully!', 'success');
                break;
            
            case 'smtp_test_result':
                // Show SMTP test result
                showAdminSmtpTestResult(data.success, data.message);
                break;
                
            // Channel creation messages
            case 'channel_created':
                const createdServer = servers.find(s => s.id === data.server_id);
                if (createdServer) {
                    createdServer.channels.push(data.channel);
                    if (currentContext && currentContext.type === 'server' && currentContext.serverId === data.server_id) {
                        updateChannelsForServer(data.server_id);
                    }
                }
                break;
                
            case 'voice_state_update':
                if (voiceChat) {
                    // Initialize state for all voice members BEFORE handling voice state,
                    // so that any peer connections or incoming tracks can use the correct state.
                    if (voiceChat.remoteScreenSharing && typeof voiceChat.remoteScreenSharing.clear === 'function') {
                        voiceChat.remoteScreenSharing.clear();
                    }
                    if (voiceChat.remoteVideoEnabled && typeof voiceChat.remoteVideoEnabled.clear === 'function') {
                        voiceChat.remoteVideoEnabled.clear();
                    }
                    if (voiceChat.remoteShowingScreen && typeof voiceChat.remoteShowingScreen.clear === 'function') {
                        voiceChat.remoteShowingScreen.clear();
                    }
                    if (data.voice_members) {
                        data.voice_members.forEach(member => {
                            const memberUsername = typeof member === 'object' ? member.username : member;
                            const isScreenSharing = typeof member === 'object' ? member.screen_sharing : false;
                            const hasVideo = typeof member === 'object' ? member.video : false;
                            const showingScreen = typeof member === 'object' ? member.showing_screen : false;
                            
                            if (voiceChat.remoteScreenSharing && typeof voiceChat.remoteScreenSharing.set === 'function') {
                                voiceChat.remoteScreenSharing.set(memberUsername, isScreenSharing);
                            }
                            if (voiceChat.remoteVideoEnabled && typeof voiceChat.remoteVideoEnabled.set === 'function') {
                                voiceChat.remoteVideoEnabled.set(memberUsername, hasVideo);
                            }
                            if (voiceChat.remoteShowingScreen && typeof voiceChat.remoteShowingScreen.set === 'function') {
                                voiceChat.remoteShowingScreen.set(memberUsername, showingScreen);
                            }
                        });
                    }

                    voiceChat.handleVoiceStateUpdate(data);
                }
                // Update voice members display
                const channelKey = `${data.server_id}/${data.channel_id}`;
                voiceMembers[channelKey] = data.voice_members || [];
                updateChannelsForServer(data.server_id);
                updateVoiceParticipants(data.voice_members);
                break;
            
            case 'avatar_update':
                // Update avatar in friends list
                const friendToUpdate = friends.find(f => 
                    (typeof f === 'object' ? f.username : f) === data.username
                );
                if (friendToUpdate && typeof friendToUpdate === 'object') {
                    friendToUpdate.avatar = data.avatar;
                    updateFriendsList();
                }
                
                // Update avatar in DMs list
                const dmToUpdate = dms.find(dm => dm.username === data.username);
                if (dmToUpdate) {
                    dmToUpdate.avatar = data.avatar;
                    updateDMsList();
                }
                
                // Update avatar in voice participants
                if (voiceChat && voiceChat.currentVoiceChannel) {
                    const currentKey = `${voiceChat.currentVoiceServer}/${voiceChat.currentVoiceChannel}`;
                    if (voiceMembers[currentKey]) {
                        const participant = voiceMembers[currentKey].find(p => 
                            (typeof p === 'object' ? p.username : p) === data.username
                        );
                        if (participant && typeof participant === 'object') {
                            participant.avatar = data.avatar;
                            updateVoiceParticipants(voiceMembers[currentKey]);
                        }
                    }
                }
                break;
            
            case 'avatar_updated':
                updateAvatarElement(currentUserAvatar, data);
                break;
            
            case 'profile_update':
                // Update profile data in friends list
                const friendProfileUpdate = friends.find(f => 
                    (typeof f === 'object' ? f.username : f) === data.username
                );
                if (friendProfileUpdate && typeof friendProfileUpdate === 'object') {
                    friendProfileUpdate.bio = data.bio || '';
                    friendProfileUpdate.status_message = data.status_message || '';
                    updateFriendsList();
                }
                
                // Update profile in DMs list
                const dmProfileUpdate = dms.find(dm => dm.username === data.username);
                if (dmProfileUpdate) {
                    dmProfileUpdate.bio = data.bio || '';
                    dmProfileUpdate.status_message = data.status_message || '';
                    updateDMsList();
                }
                
                // Update profile in current server members list, if available
                if (typeof currentServerMembers !== 'undefined' && Array.isArray(currentServerMembers)) {
                    const memberProfileUpdate = currentServerMembers.find(m => 
                        (typeof m === 'object' ? m.username : m) === data.username
                    );
                    if (memberProfileUpdate && typeof memberProfileUpdate === 'object') {
                        memberProfileUpdate.bio = data.bio || '';
                        memberProfileUpdate.status_message = data.status_message || '';
                        if (typeof updateServerMembersList === 'function') {
                            updateServerMembersList();
                        }
                    }
                }
                break;
            
            case 'profile_updated':
                // Update current user's profile data
                window.currentUserProfile = {
                    bio: data.bio || '',
                    status_message: data.status_message || ''
                };
                break;
            
            case 'voice_video_update':
                // Update video state in participants list (voice channels or direct calls)
                if (voiceChat) {
                    // Track video state for toggle functionality
                    voiceChat.remoteVideoEnabled.set(data.username, data.video);
                    
                    // Initialize remoteShowingScreen if video is enabled and screenshare is also active
                    if (data.video) {
                        const hasScreenShare = voiceChat.remoteScreenSharing.get(data.username) || false;
                        if (hasScreenShare) {
                            // Both video and screenshare are active, set to show screen by default
                            voiceChat.remoteShowingScreen.set(data.username, true);
                        }
                    } else {
                        // Clean up state if both video and screenshare are disabled
                        const hasScreenShare = voiceChat.remoteScreenSharing.get(data.username) || false;
                        if (!hasScreenShare) {
                            voiceChat.remoteShowingScreen.delete(data.username);
                        }
                    }
                    
                    // Update toggle button if both video and screenshare are active
                    updateVideoToggleButton(data.username);
                    
                    // Update participant list if in a voice channel
                    if (voiceChat.currentVoiceChannel) {
                        const currentKey = `${voiceChat.currentVoiceServer}/${voiceChat.currentVoiceChannel}`;
                        if (voiceMembers[currentKey]) {
                            const participant = voiceMembers[currentKey].find(p => 
                                (typeof p === 'object' ? p.username : p) === data.username
                            );
                            if (participant && typeof participant === 'object') {
                                participant.video = data.video;
                            }
                            updateVoiceParticipants(voiceMembers[currentKey]);
                        }
                    }
                }
                break;
            
            case 'voice_screen_share_update':
                // Update screen sharing state in participants list (voice channels or direct calls)
                if (voiceChat) {
                    // Track screen sharing state for video display
                    voiceChat.remoteScreenSharing.set(data.username, data.screen_sharing);
                    
                    // When screenshare starts, assume they're showing screen (default behavior)
                    if (data.screen_sharing) {
                        voiceChat.remoteShowingScreen.set(data.username, true);
                    } else {
                        // When screenshare stops, they're showing camera if video is still enabled
                        const hasVideo = voiceChat.remoteVideoEnabled.get(data.username) || false;
                        if (hasVideo) {
                            voiceChat.remoteShowingScreen.set(data.username, false);
                        } else {
                            // Neither video nor screenshare active, remove from tracking
                            voiceChat.remoteShowingScreen.delete(data.username);
                        }
                    }
                    
                    // Update toggle button if both video and screenshare are active
                    updateVideoToggleButton(data.username);
                    
                    // When screen sharing stops, remove any existing screen share video element
                    if (!data.screen_sharing) {
                        const screenShareVideo = document.getElementById(`video-${data.username}`);
                        if (screenShareVideo && screenShareVideo.classList.contains('screen-share')) {
                            screenShareVideo.remove();
                            updateVideoGridLayout();
                        }
                    }
                    
                    // Update participant list if in a voice channel
                    if (voiceChat.currentVoiceChannel) {
                        const currentKey = `${voiceChat.currentVoiceServer}/${voiceChat.currentVoiceChannel}`;
                        if (voiceMembers[currentKey]) {
                            const participant = voiceMembers[currentKey].find(p => 
                                (typeof p === 'object' ? p.username : p) === data.username
                            );
                            if (participant && typeof participant === 'object') {
                                participant.screen_sharing = data.screen_sharing;
                            }
                            updateVoiceParticipants(voiceMembers[currentKey]);
                        }
                    }
                }
                break;
            
            case 'switch_video_source_request':
                // Handle request from another user to switch our video source
                if (voiceChat) {
                    voiceChat.handleSwitchVideoSourceRequest(data.show_screen);
                }
                break;
            
            case 'video_source_changed_update':
                // Update UI when a user switches their video source
                if (data.username && voiceChat) {
                    // Track the state
                    voiceChat.remoteShowingScreen.set(data.username, data.showing_screen);
                    updateVideoSourceDisplay(data.username, data.showing_screen);
                }
                break;
            
            case 'incoming_voice_call':
                handleIncomingCall(data.from);
                break;
                
            case 'voice_call_accepted':
                if (voiceChat && voiceChat.directCallPeer === data.from) {
                    // Start WebRTC connection
                    voiceChat.createPeerConnection(data.from, true);
                }
                break;
                
            case 'voice_call_rejected':
                if (voiceChat) {
                    voiceChat.endDirectCall();
                    hideVoiceControls();
                    alert(`${data.from} rejected your call`);
                }
                break;
                
            case 'direct_call_ended':
                // Handle peer disconnection during direct call
                if (voiceChat) {
                    voiceChat.endDirectCall();
                    hideVoiceControls();
                    const reason = data.reason === 'disconnected' ? 'disconnected' : 'ended the call';
                    alert(`${data.from} ${reason}`);
                }
                break;
                
            case 'webrtc_offer':
                if (voiceChat) {
                    voiceChat.handleOffer(data.from, data.offer, data.context);
                }
                break;
                
            case 'webrtc_answer':
                if (voiceChat) {
                    voiceChat.handleAnswer(data.from, data.answer);
                }
                break;
                
            case 'webrtc_ice_candidate':
                if (voiceChat) {
                    voiceChat.handleIceCandidate(data.from, data.candidate);
                }
                break;
            
            // Role management messages
            case 'server_roles':
                serverRoles = data.roles || [];
                console.log('Received server_roles:', serverRoles);
                displayRolesList();
                break;
            
            case 'role_created':
                console.log('role_created message received:', data);
                console.log('currentlySelectedServer:', currentlySelectedServer);
                console.log('data.server_id:', data.server_id);
                if (currentlySelectedServer === data.server_id) {
                    serverRoles.push(data.role);
                    console.log('Role created, serverRoles now:', serverRoles);
                    displayRolesList();
                } else {
                    console.log('Role not added - server mismatch');
                }
                break;
            
            case 'role_updated':
                if (currentlySelectedServer === data.server_id) {
                    const index = serverRoles.findIndex(r => r.role_id === data.role.role_id);
                    if (index !== -1) {
                        serverRoles[index] = data.role;
                        displayRolesList();
                        if (currentEditingRole && currentEditingRole.role_id === data.role.role_id) {
                            loadRoleForEditing(data.role);
                        }
                    }
                }
                break;
            
            case 'role_deleted':
                if (currentlySelectedServer === data.server_id) {
                    serverRoles = serverRoles.filter(r => r.role_id !== data.role_id);
                    displayRolesList();
                    if (currentEditingRole && currentEditingRole.role_id === data.role_id) {
                        cancelRoleEdit();
                    }
                }
                break;
            
            case 'role_assigned':
            case 'role_removed':
                // Refresh the current role's member list if viewing
                if (currentEditingRole) {
                    loadRoleMembersList(currentEditingRole.role_id);
                }
                break;
            
            case 'member_role_updated':
                // Refresh the role's member list if viewing that role
                if (currentEditingRole && currentEditingRole.role_id === data.role_id) {
                    loadRoleMembersList(data.role_id);
                }
                break;
            
            // Custom emoji cases
            case 'server_emojis':
                customEmojis[data.server_id] = data.emojis;
                if (currentlySelectedServer === data.server_id) {
                    displayServerEmojis(data.emojis);
                }
                break;
            
            case 'custom_emoji_added':
                if (!customEmojis[data.server_id]) {
                    customEmojis[data.server_id] = [];
                }
                customEmojis[data.server_id].push(data.emoji);
                if (currentlySelectedServer === data.server_id) {
                    displayServerEmojis(customEmojis[data.server_id]);
                }
                break;
            
            case 'custom_emoji_deleted':
                if (customEmojis[data.server_id]) {
                    customEmojis[data.server_id] = customEmojis[data.server_id].filter(
                        e => e.emoji_id !== data.emoji_id
                    );
                    if (currentlySelectedServer === data.server_id) {
                        displayServerEmojis(customEmojis[data.server_id]);
                    }
                }
                break;
            
            case 'emoji_upload_success':
                uploadEmojiError.textContent = '';
                alert('Emoji uploaded successfully!');
                break;
            
            // Server purge settings cases
            case 'server_purge_settings':
                if (data.server_id === currentlySelectedServer) {
                    // Set the purge schedule dropdown
                    document.getElementById('server-purge-schedule').value = data.purge_schedule || 0;
                    
                    // Populate channel exemptions list
                    const channelExemptionsList = document.getElementById('channel-exemptions-list');
                    channelExemptionsList.innerHTML = '';
                    
                    // Get all channels for this server
                    const server = servers.find(s => s.id === data.server_id);
                    if (server && server.channels) {
                        server.channels.forEach(channel => {
                            const checkboxWrapper = document.createElement('div');
                            checkboxWrapper.className = 'checkbox-wrapper';
                            
                            const checkbox = document.createElement('input');
                            checkbox.type = 'checkbox';
                            checkbox.id = `exempt-${channel.id}`;
                            checkbox.dataset.channelId = channel.id;
                            checkbox.checked = data.exempted_channels.includes(channel.id);
                            
                            const label = document.createElement('label');
                            label.htmlFor = `exempt-${channel.id}`;
                            label.textContent = `# ${channel.name}`;
                            
                            checkboxWrapper.appendChild(checkbox);
                            checkboxWrapper.appendChild(label);
                            channelExemptionsList.appendChild(checkboxWrapper);
                        });
                    }
                }
                break;
            
            case 'server_purge_settings_updated':
                if (data.server_id === currentlySelectedServer) {
                    alert('Purge settings saved successfully!');
                }
                break;
            
            // Reaction cases
            case 'reaction_added':
            case 'reaction_removed':
                updateMessageReactions(data.message_id, data.reactions);
                break;
        }
    }
    
    // Update reactions for a specific message
    function updateMessageReactions(messageId, reactions) {
        const reactionsContainer = document.getElementById(`reactions-${messageId}`);
        if (reactionsContainer) {
            renderReactions(messageId, reactions, reactionsContainer);
        }
    }
    
    // Check if message is for current context
    function isMessageForCurrentContext(msg) {
        if (!currentContext) return msg.context === 'global';
        
        if (currentContext.type === 'server') {
            return msg.context === 'server' && 
                   msg.context_id === `${currentContext.serverId}/${currentContext.channelId}`;
        } else if (currentContext.type === 'dm') {
            return msg.context === 'dm' && msg.context_id === currentContext.dmId;
        }
        return msg.context === 'global';
    }
    
    // Update servers list
    function updateServersList() {
        serversList.innerHTML = '';
        servers.forEach(server => {
            const serverItem = document.createElement('div');
            serverItem.className = 'server-item';
            
            // Create server icon element
            const serverIcon = document.createElement('span');
            serverIcon.className = 'server-icon';
            
            if (server.icon_type === 'image' && server.icon_data) {
                const iconImg = document.createElement('img');
                iconImg.src = server.icon_data;
                iconImg.alt = server.name;
                serverIcon.appendChild(iconImg);
            } else {
                serverIcon.textContent = server.icon || '🏠';
            }
            
            // Create server name element
            const serverName = document.createElement('span');
            serverName.className = 'server-name';
            serverName.textContent = server.name;
            
            serverItem.appendChild(serverIcon);
            serverItem.appendChild(serverName);
            serverItem.onclick = () => selectServer(server.id);
            serversList.appendChild(serverItem);
        });
    }
    
    // Update DMs list
    function updateDMsList() {
        dmsList.innerHTML = '';
        dms.forEach(dm => {
            const dmItem = document.createElement('div');
            dmItem.className = 'dm-item';
            
            const avatarEl = createAvatarElement(dm, 'dm-avatar');
            
            const nameSpan = document.createElement('span');
            nameSpan.textContent = dm.username;
            
            const callBtn = document.createElement('button');
            callBtn.className = 'btn btn-small btn-icon voice-call-btn';
            callBtn.textContent = '📞';
            callBtn.title = 'Voice Call';
            callBtn.onclick = (e) => {
                e.stopPropagation();
                startVoiceCall(dm.username);
            };
            
            dmItem.appendChild(avatarEl);
            dmItem.appendChild(nameSpan);
            dmItem.appendChild(callBtn);
            dmItem.onclick = () => selectDM(dm.id);
            dmsList.appendChild(dmItem);
        });
    }
    
    // Update friends list
    function updateFriendsList() {
        friendsList.innerHTML = '';
        
        // Display incoming friend requests
        if (friendRequestsReceived.length > 0) {
            const requestsHeader = document.createElement('div');
            requestsHeader.className = 'friends-section-header';
            requestsHeader.textContent = 'Incoming Friend Requests';
            friendsList.appendChild(requestsHeader);
            
            friendRequestsReceived.forEach(request => {
                const requestItem = document.createElement('div');
                requestItem.className = 'friend-item friend-request-item';
                
                const avatarEl = createAvatarElement(request, 'friend-avatar');
                
                const nameSpan = document.createElement('span');
                nameSpan.textContent = request.username;
                
                const actionsDiv = document.createElement('div');
                actionsDiv.className = 'friend-actions';
                
                const approveBtn = document.createElement('button');
                approveBtn.className = 'btn btn-small btn-success';
                approveBtn.textContent = '✓';
                approveBtn.title = 'Approve';
                approveBtn.onclick = () => approveFriendRequest(request.username);
                
                const denyBtn = document.createElement('button');
                denyBtn.className = 'btn btn-small btn-danger';
                denyBtn.textContent = '✗';
                denyBtn.title = 'Deny';
                denyBtn.onclick = () => denyFriendRequest(request.username);
                
                actionsDiv.appendChild(approveBtn);
                actionsDiv.appendChild(denyBtn);
                requestItem.appendChild(avatarEl);
                requestItem.appendChild(nameSpan);
                requestItem.appendChild(actionsDiv);
                friendsList.appendChild(requestItem);
            });
        }
        
        // Display outgoing friend requests
        if (friendRequestsSent.length > 0) {
            const sentHeader = document.createElement('div');
            sentHeader.className = 'friends-section-header';
            sentHeader.textContent = 'Pending Requests';
            friendsList.appendChild(sentHeader);
            
            friendRequestsSent.forEach(request => {
                const requestItem = document.createElement('div');
                requestItem.className = 'friend-item friend-request-sent-item';
                
                const avatarEl = createAvatarElement(request, 'friend-avatar');
                
                const nameSpan = document.createElement('span');
                nameSpan.textContent = request.username;
                
                const actionsDiv = document.createElement('div');
                actionsDiv.className = 'friend-actions';
                
                const cancelBtn = document.createElement('button');
                cancelBtn.className = 'btn btn-small btn-secondary';
                cancelBtn.textContent = 'Cancel';
                cancelBtn.onclick = () => cancelFriendRequest(request.username);
                
                actionsDiv.appendChild(cancelBtn);
                requestItem.appendChild(avatarEl);
                requestItem.appendChild(nameSpan);
                requestItem.appendChild(actionsDiv);
                friendsList.appendChild(requestItem);
            });
        }
        
        // Display friends
        if (friends.length > 0) {
            const friendsHeader = document.createElement('div');
            friendsHeader.className = 'friends-section-header';
            friendsHeader.textContent = 'Friends';
            friendsList.appendChild(friendsHeader);
            
            friends.forEach(friend => {
                const friendItem = document.createElement('div');
                friendItem.className = 'friend-item';
                
                const friendUsername = typeof friend === 'object' ? friend.username : friend;
                const avatarEl = createAvatarElement(friend, 'friend-avatar');
                
                const userInfoDiv = document.createElement('div');
                userInfoDiv.className = 'friend-info';
                
                const nameSpan = document.createElement('span');
                nameSpan.className = 'friend-name';
                nameSpan.textContent = friendUsername;
                userInfoDiv.appendChild(nameSpan);
                
                // Add status message if available
                if (typeof friend === 'object' && friend.status_message) {
                    const statusSpan = document.createElement('span');
                    statusSpan.className = 'friend-status';
                    statusSpan.textContent = friend.status_message;
                    userInfoDiv.appendChild(statusSpan);
                }
                
                const actionsDiv = document.createElement('div');
                actionsDiv.className = 'friend-actions';
                
                const callBtn = document.createElement('button');
                callBtn.className = 'btn btn-small btn-success btn-icon';
                callBtn.textContent = '📞';
                callBtn.title = 'Voice Call';
                callBtn.onclick = () => startVoiceCall(friendUsername);
                
                const dmBtn = document.createElement('button');
                dmBtn.className = 'btn btn-small btn-primary btn-icon';
                dmBtn.textContent = 'DM';
                dmBtn.onclick = () => startDM(friendUsername);
                
                actionsDiv.appendChild(callBtn);
                actionsDiv.appendChild(dmBtn);
                friendItem.appendChild(avatarEl);
                friendItem.appendChild(userInfoDiv);
                friendItem.appendChild(actionsDiv);
                friendsList.appendChild(friendItem);
            });
        }
    }
    
    // Select server
    function selectServer(serverId) {
        const server = servers.find(s => s.id === serverId);
        if (!server) return;
        
        currentlySelectedServer = serverId;
        
        // Update UI
        document.querySelectorAll('.server-item').forEach(item => {
            item.classList.remove('active');
            if (item.textContent === server.name) {
                item.classList.add('active');
            }
        });
        document.querySelectorAll('.dm-item').forEach(item => item.classList.remove('active'));
        
        // Show channels view
        channelsView.classList.remove('hidden');
        friendsView.classList.add('hidden');
        
        serverNameDisplay.textContent = server.name;
        
        // Show/hide settings button based on ownership
        if (server.owner === username) {
            serverSettingsBtn.classList.remove('hidden');
        } else {
            serverSettingsBtn.classList.add('hidden');
        }
        
        updateChannelsForServer(serverId);
        
        // Load custom emojis for this server
        loadServerEmojis(serverId);
        
        // Auto-select first text channel
        const firstTextChannel = server.channels.find(ch => ch.type === 'text');
        if (firstTextChannel) {
            selectChannel(serverId, firstTextChannel.id, firstTextChannel.name, firstTextChannel.type);
        }
        
        // Show and update members sidebar
        updateServerMembers(serverId);
        rightSidebar.classList.remove('hidden');
    }
    
    // Update server members sidebar
    function updateServerMembers(serverId) {
        const server = servers.find(s => s.id === serverId);
        if (!server) {
            rightSidebar.classList.add('hidden');
            return;
        }
        
        serverMembersDisplay.innerHTML = '';
        
        // Get server members by checking who's in this server
        // First, get owner
        const membersList = new Set();
        membersList.add(server.owner);
        
        // Add all members from server data if available
        // Note: We'll need to request this from server
        ws.send(JSON.stringify({
            type: 'get_server_members',
            server_id: serverId
        }));
    }
    
    // Display server members (called when we receive member data from server)
    function displayServerMembersInSidebar(members) {
        serverMembersDisplay.innerHTML = '';
        
        members.forEach(member => {
            const memberItem = document.createElement('div');
            memberItem.className = 'member-item';
            
            const avatarEl = createAvatarElement(member, 'member-avatar');
            
            const nameSpan = document.createElement('span');
            nameSpan.textContent = member.username;
            
            memberItem.appendChild(avatarEl);
            memberItem.appendChild(nameSpan);
            serverMembersDisplay.appendChild(memberItem);
        });
    }
    
    // Mention autocomplete functions
    function getAvailableMentions() {
        // Return list of users based on current context
        if (currentContext && currentContext.type === 'server') {
            // In a server channel - show server members
            return currentServerMembers.map(m => ({
                username: m.username,
                avatar: m.avatar || '👤',
                avatar_type: m.avatar_type || 'emoji',
                avatar_data: m.avatar_data
            }));
        } else if (currentContext && currentContext.type === 'dm') {
            // In a DM - show the other person
            const currentDm = dms.find(dm => dm.id === currentContext.dmId);
            if (currentDm) {
                return [{
                    username: currentDm.username,
                    avatar: currentDm.avatar || '👤',
                    avatar_type: currentDm.avatar_type || 'emoji',
                    avatar_data: currentDm.avatar_data
                }];
            }
        }
        return [];
    }
    
    function showMentionAutocomplete(query) {
        const availableUsers = getAvailableMentions();
        if (availableUsers.length === 0) {
            hideMentionAutocomplete();
            return;
        }
        
        // Filter users based on query
        const queryLower = query.toLowerCase();
        const filteredUsers = query 
            ? availableUsers.filter(u => u.username.toLowerCase().startsWith(queryLower))
            : availableUsers;
        
        if (filteredUsers.length === 0) {
            hideMentionAutocomplete();
            return;
        }
        
        // Build autocomplete HTML
        mentionAutocomplete.innerHTML = '';
        
        const header = document.createElement('div');
        header.className = 'mention-autocomplete-header';
        header.textContent = 'Mention';
        mentionAutocomplete.appendChild(header);
        
        // Reset selected index if it's out of bounds
        if (selectedMentionIndex >= filteredUsers.length) {
            selectedMentionIndex = 0;
        }
        
        filteredUsers.forEach((user, index) => {
            const item = document.createElement('div');
            item.className = 'mention-item';
            if (index === selectedMentionIndex) {
                item.classList.add('selected');
            }
            
            const avatarEl = createAvatarElement(user, 'member-avatar');
            
            const usernameSpan = document.createElement('span');
            usernameSpan.className = 'mention-username';
            usernameSpan.textContent = user.username;
            
            item.appendChild(avatarEl);
            item.appendChild(usernameSpan);
            
            // Click handler
            item.addEventListener('click', () => {
                selectMention(user.username);
            });
            
            mentionAutocomplete.appendChild(item);
        });
        
        mentionAutocomplete.classList.remove('hidden');
    }
    
    function hideMentionAutocomplete() {
        mentionAutocomplete.classList.add('hidden');
        mentionActive = false;
        mentionStartPos = -1;
        mentionQuery = '';
        selectedMentionIndex = 0;
    }
    
    function selectMention(username) {
        const currentValue = messageInput.value;
        const beforeMention = currentValue.substring(0, mentionStartPos);
        const afterMention = currentValue.substring(messageInput.selectionStart);
        
        messageInput.value = beforeMention + '@' + username + ' ' + afterMention;
        messageInput.focus();
        
        // Set cursor position after the inserted mention
        const newCursorPos = beforeMention.length + username.length + 2; // +2 for @ and space
        messageInput.setSelectionRange(newCursorPos, newCursorPos);
        
        hideMentionAutocomplete();
    }
    
    function navigateMentionAutocomplete(direction) {
        const items = mentionAutocomplete.querySelectorAll('.mention-item');
        if (items.length === 0) return;
        
        // Remove current selection
        items[selectedMentionIndex]?.classList.remove('selected');
        
        // Update index
        if (direction === 'up') {
            selectedMentionIndex = selectedMentionIndex > 0 ? selectedMentionIndex - 1 : items.length - 1;
        } else {
            selectedMentionIndex = selectedMentionIndex < items.length - 1 ? selectedMentionIndex + 1 : 0;
        }
        
        // Add new selection
        items[selectedMentionIndex]?.classList.add('selected');
        
        // Scroll into view
        items[selectedMentionIndex]?.scrollIntoView({ block: 'nearest' });
    }
    
    function selectCurrentMention() {
        const items = mentionAutocomplete.querySelectorAll('.mention-item');
        if (items.length > 0 && items[selectedMentionIndex]) {
            const username = items[selectedMentionIndex].querySelector('.mention-username').textContent;
            selectMention(username);
        }
    }
    
    // Update channels list for a server
    function updateChannelsForServer(serverId) {
        const server = servers.find(s => s.id === serverId);
        if (!server) return;
        
        channelsList.innerHTML = '';
        
        server.channels.forEach(channel => {
            const channelItem = document.createElement('div');
            channelItem.className = 'channel-item';
            
            if (channel.type === 'voice') {
                channelItem.classList.add('voice-channel');
                const channelKey = `${serverId}/${channel.id}`;
                const members = voiceMembers[channelKey] || [];
                const memberCount = members.length;
                
                channelItem.innerHTML = `
                    <span>🔊 ${escapeHtml(channel.name)}</span>
                    ${memberCount > 0 ? `<span class="voice-count">${memberCount}</span>` : ''}
                `;
                channelItem.onclick = () => joinVoiceChannel(serverId, channel.id, channel.name);
            } else {
                channelItem.textContent = '# ' + channel.name;
                channelItem.onclick = () => selectChannel(serverId, channel.id, channel.name, channel.type);
            }
            
            channelsList.appendChild(channelItem);
        });
    }
    
    // Select channel
    function selectChannel(serverId, channelId, channelName, channelType) {
        if (channelType === 'voice') {
            joinVoiceChannel(serverId, channelId, channelName);
            return;
        }
        
        currentContext = { type: 'server', serverId, channelId };
        
        // Update UI
        document.querySelectorAll('.channel-item').forEach(item => {
            item.classList.remove('active');
            if (item.textContent === '# ' + channelName) {
                item.classList.add('active');
            }
        });
        
        const server = servers.find(s => s.id === serverId);
        chatTitle.textContent = `${server.name} - # ${channelName}`;
        
        // Enable input
        messageInput.disabled = false;
        submitBtn.disabled = false;
        messageInput.placeholder = `Message #${channelName}`;
        
        // Request channel history
        ws.send(JSON.stringify({
            type: 'get_channel_history',
            server_id: serverId,
            channel_id: channelId
        }));
    }
    
    // Select DM
    function selectDM(dmId) {
        const dm = dms.find(d => d.id === dmId);
        if (!dm) return;
        
        currentContext = { type: 'dm', dmId };
        
        // Update UI
        document.querySelectorAll('.server-item').forEach(item => item.classList.remove('active'));
        document.querySelectorAll('.dm-item').forEach(item => {
            item.classList.remove('active');
            if (item.textContent === dm.username) {
                item.classList.add('active');
            }
        });
        
        channelsView.classList.add('hidden');
        friendsView.classList.add('hidden');
        
        // Hide members sidebar for DMs
        rightSidebar.classList.add('hidden');
        
        chatTitle.textContent = `Direct Message - ${dm.username}`;
        
        // Enable input
        messageInput.disabled = false;
        submitBtn.disabled = false;
        messageInput.placeholder = `Message ${dm.username}`;
        
        // Request DM history
        ws.send(JSON.stringify({
            type: 'get_dm_history',
            dm_id: dmId
        }));
    }
    
    // Start DM
    function startDM(friendUsername) {
        ws.send(JSON.stringify({
            type: 'start_dm',
            username: friendUsername
        }));
    }
    
    // Append a message to the chat
    function appendMessage(msg) {
        console.log('appendMessage called with:', msg);
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message';
        
        // Store message ID for edit/delete operations
        if (msg.id) {
            messageDiv.dataset.messageId = msg.id;
        }
        
        const isOwnMessage = msg.username === username;
        if (isOwnMessage) {
            messageDiv.classList.add('own');
        } else {
            messageDiv.classList.add('other');
        }
        
        // Mark deleted messages
        if (msg.deleted) {
            messageDiv.classList.add('deleted');
        }
        
        const timestamp = new Date(msg.timestamp).toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit'
        });
        
        // Create avatar element with fallback
        console.log('Creating avatar with data:', {
            avatar: msg.avatar || '👤',
            avatar_type: msg.avatar_type || 'emoji',
            avatar_data: msg.avatar_data || null
        });
        const avatarEl = createAvatarElement({
            avatar: msg.avatar || '👤',
            avatar_type: msg.avatar_type || 'emoji',
            avatar_data: msg.avatar_data || null
        }, 'message-avatar');
        
        console.log('Avatar element created:', avatarEl);
        
        const contentWrapper = document.createElement('div');
        contentWrapper.className = 'message-content-wrapper';
        
        // Create message header
        const messageHeader = document.createElement('div');
        messageHeader.className = 'message-header';
        messageHeader.innerHTML = `
            <span class="message-username ${isOwnMessage ? 'own' : 'other'}">${escapeHtml(msg.username)}</span>
            <span class="message-time">${timestamp}</span>
        `;
        
        // Create message content with linkified text
        const messageContent = document.createElement('div');
        messageContent.className = 'message-content';
        messageContent.innerHTML = linkifyText(msg.content);
        
        // Add header and content to wrapper
        contentWrapper.appendChild(messageHeader);
        contentWrapper.appendChild(messageContent);
        
        // Process and add embeds
        const embeds = processMessageEmbeds(msg.content);
        embeds.forEach(embed => {
            contentWrapper.appendChild(embed);
        });
        // Build the edited indicator
        let editedIndicator = '';
        if (msg.edited_at) {
            editedIndicator = '<span class="message-edited">(edited)</span>';
        }
        
        contentWrapper.innerHTML = `
            <div class="message-header">
                <span class="message-username ${isOwnMessage ? 'own' : 'other'}">${escapeHtml(msg.username)}</span>
                <span class="message-time">${timestamp}</span>
                ${editedIndicator}
            </div>
            <div class="message-content">${escapeHtml(msg.content)}</div>
        `;
        
        // Add reactions container
        if (msg.id) {
            const reactionsContainer = document.createElement('div');
            reactionsContainer.className = 'message-reactions';
            reactionsContainer.id = `reactions-${msg.id}`;
            
            // Display existing reactions
            if (msg.reactions && msg.reactions.length > 0) {
                renderReactions(msg.id, msg.reactions, reactionsContainer);
            }
            
            // Add reaction button
            const addReactionBtn = document.createElement('button');
            addReactionBtn.className = 'add-reaction-btn';
            addReactionBtn.textContent = '➕';
            addReactionBtn.title = 'Add reaction';
            addReactionBtn.onclick = () => openEmojiPicker(msg.id);
            
            reactionsContainer.appendChild(addReactionBtn);
            contentWrapper.appendChild(reactionsContainer);
            
            // Store message ID on the element for later reference
            messageDiv.dataset.messageId = msg.id;
        }
        
        // Add edit/delete buttons if message is not deleted
        if (!msg.deleted && msg.id) {
            const actionsDiv = document.createElement('div');
            actionsDiv.className = 'message-actions';
            
            // Check if user has permissions for other users' messages
            let canEditOthers = false;
            let canDeleteOthers = false;
            
            if (currentContext && currentContext.type === 'server') {
                // For server messages, apply server-based permissions for other users' messages
                if (!isOwnMessage) {
                    const server = servers.find(s => s.id === currentContext.serverId);
                    if (server) {
                        // Server owner can edit/delete all messages
                        if (server.owner === username) {
                            canEditOthers = true;
                            canDeleteOthers = true;
                        } else if (server.permissions) {
                            // Check member permissions
                            canEditOthers = server.permissions.can_edit_messages || false;
                            canDeleteOthers = server.permissions.can_delete_messages || false;
                        }
                    }
                }
            } else {
                // For DMs and other non-server contexts, users can only edit/delete their own messages.
                // canEditOthers and canDeleteOthers remain false.
            }
            
            // Show edit/delete buttons for own messages or if user has permissions
            if (isOwnMessage || canEditOthers || canDeleteOthers) {
                const showEdit = isOwnMessage || canEditOthers;
                const showDelete = isOwnMessage || canDeleteOthers;
                
                actionsDiv.innerHTML = `
                    ${showEdit ? `<button class="message-action-btn edit-message-btn" title="Edit message">
                        <span>✏️</span>
                    </button>` : ''}
                    ${showDelete ? `<button class="message-action-btn delete-message-btn" title="Delete message">
                        <span>🗑️</span>
                    </button>` : ''}
                `;
                
                contentWrapper.appendChild(actionsDiv);
            }
            
            // Load and display attachments if message has ID
            loadMessageAttachments(msg.id, contentWrapper);
        }
        
        messageDiv.appendChild(avatarEl);
        messageDiv.appendChild(contentWrapper);
        messagesContainer.appendChild(messageDiv);
        console.log('Message appended to container');
    }
    
    // Validate a message ID before using it in URLs
    function isValidMessageId(messageId) {
        if (messageId === null || messageId === undefined) {
            return false;
        }
        const idStr = String(messageId);
        // Allow only simple, URL-safe IDs (alphanumeric, underscore, hyphen), and bound length
        if (idStr.length === 0 || idStr.length > 64) {
            return false;
        }
        return /^[a-zA-Z0-9_-]+$/.test(idStr);
    }
    
    // Sanitize filename for safe use in download attribute
    function sanitizeFilename(filename) {
        // Remove control characters and path separators
        return String(filename).replace(/[\x00-\x1F\x7F\/\\]/g, '').substring(0, 255) || 'download';
    }
    
    // Helper function to create attachment download link
    function createAttachmentDownloadLink(downloadUrl, filename, fileSize) {
        const attachmentLink = document.createElement('a');
        attachmentLink.className = 'message-attachment';
        attachmentLink.href = downloadUrl;
        attachmentLink.download = sanitizeFilename(filename);
        attachmentLink.innerHTML = `
            <span class="message-attachment-icon">📎</span>
            <div class="message-attachment-info">
                <div class="message-attachment-name">${escapeHtml(filename)}</div>
                <div class="message-attachment-size">${formatFileSize(fileSize)}</div>
            </div>
        `;
        return attachmentLink;
    }
    
    // Load and display attachments for a message
    async function loadMessageAttachments(messageId, container) {
        const safeMessageId = String(messageId);
        if (!isValidMessageId(safeMessageId)) {
            console.warn('Refusing to load attachments for invalid messageId:', safeMessageId);
            return;
        }
        const encodedMessageId = encodeURIComponent(safeMessageId);
        try {
            const response = await fetch(`/api/message-attachments/${encodedMessageId}`);
            const result = await response.json();
            
            if (result.success && result.attachments && result.attachments.length > 0) {
                const attachmentsDiv = document.createElement('div');
                attachmentsDiv.className = 'message-attachments';
                
                for (const attachment of result.attachments) {
                    // Validate attachment_id to prevent XSS
                    const attachmentId = String(attachment.attachment_id);
                    if (!isValidMessageId(attachmentId)) {
                        console.warn('Skipping attachment with invalid ID:', attachmentId);
                        continue;
                    }
                    
                    const downloadUrl = `/api/download-attachment/${encodeURIComponent(attachmentId)}`;
                    const filename = attachment.filename || 'file';
                    const contentType = attachment.content_type || '';
                    
                    // Check if this is a media file that should be embedded
                    // Reuse existing regex patterns for consistency
                    const isImage = contentType.startsWith('image/') || IMAGE_EXTENSIONS.test(filename);
                    const isVideo = contentType.startsWith('video/') || VIDEO_EXTENSIONS.test(filename);
                    
                    if (isVideo) {
                        // Create embedded video player
                        const videoEmbed = document.createElement('div');
                        videoEmbed.className = 'embed embed-video';
                        
                        const video = document.createElement('video');
                        video.controls = true;
                        video.src = downloadUrl;
                        video.setAttribute('aria-label', `Video attachment: ${escapeHtml(filename)}`);
                        
                        // Add error handling for video playback issues
                        video.onerror = function() {
                            console.error('Failed to load video:', filename);
                            // Replace video with download link on error
                            videoEmbed.replaceWith(createAttachmentDownloadLink(downloadUrl, filename, attachment.file_size));
                        };
                        
                        videoEmbed.appendChild(video);
                        attachmentsDiv.appendChild(videoEmbed);
                    } else if (isImage) {
                        // Create embedded image
                        const imageEmbed = document.createElement('div');
                        imageEmbed.className = 'embed embed-image';
                        
                        const img = document.createElement('img');
                        img.src = downloadUrl;
                        img.alt = escapeHtml(filename);
                        
                        // Add error handling for image loading issues
                        img.onerror = function() {
                            console.error('Failed to load image:', filename);
                            // Replace image with download link on error
                            imageEmbed.replaceWith(createAttachmentDownloadLink(downloadUrl, filename, attachment.file_size));
                        };
                        
                        imageEmbed.appendChild(img);
                        attachmentsDiv.appendChild(imageEmbed);
                    } else {
                        // Create download link for other files
                        attachmentsDiv.appendChild(createAttachmentDownloadLink(downloadUrl, filename, attachment.file_size));
                    }
                }
                
                container.appendChild(attachmentsDiv);
            }
        } catch (error) {
            console.error('Error loading attachments:', error);
        }
    }
    
    // Append system message
    function appendSystemMessage(content) {
        const messageDiv = document.createElement('div');
        messageDiv.className = 'system-message';
        messageDiv.textContent = content;
        messagesContainer.appendChild(messageDiv);
        scrollToBottom();
    }
    
    // Send message
    messageForm.addEventListener('submit', (e) => {
        e.preventDefault();
        
        // Hide autocomplete if open
        if (mentionActive) {
            hideMentionAutocomplete();
        }
        
        const message = messageInput.value.trim();
        // Allow sending if there's a message OR if there are attachments
        if ((!message && pendingAttachments.length === 0) || !authenticated) {
            console.log('Cannot send message - empty (no text or attachments) or not authenticated');
            return;
        }
        
        let msgData = {
            type: 'message',
            content: message
        };
        
        if (currentContext && currentContext.type === 'server') {
            msgData.context = 'server';
            msgData.context_id = `${currentContext.serverId}/${currentContext.channelId}`;
        } else if (currentContext && currentContext.type === 'dm') {
            msgData.context = 'dm';
            msgData.context_id = currentContext.dmId;
        } else {
            msgData.context = 'global';
        }
        
        console.log('Sending message:', msgData);
        
        // Store attachments in queue before sending (to avoid race conditions)
        // Use timestamp + random component + message for uniqueness
        // Use 'attachment_only' as fallback when message is empty
        const messageKey = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}_${message || 'attachment_only'}`;
        if (pendingAttachments.length > 0) {
            attachmentUploadQueue.set(messageKey, [...pendingAttachments]);
            console.log(`Queued ${pendingAttachments.length} attachments for message`);
            pendingAttachments = [];
            updateAttachmentPreview();
        }
        
        // Send message with key for correlation
        msgData.messageKey = messageKey;
        ws.send(JSON.stringify(msgData));
        messageInput.value = '';
    });
    
    // File attachment button click
    if (attachFileBtn) {
        attachFileBtn.addEventListener('click', () => {
            if (!allowFileAttachments) {
                alert('File attachments are disabled by the administrator');
                return;
            }
            fileInput.click();
        });
    }
    
    // Helper function to validate and add files to pending attachments
    function validateAndAddFiles(files) {
        const validFiles = [];
        const invalidFiles = [];
        
        for (const file of files) {
            const sizeMB = file.size / (1024 * 1024);
            if (sizeMB > maxAttachmentSizeMB) {
                invalidFiles.push(file);
            } else {
                validFiles.push(file);
            }
        }
        
        if (invalidFiles.length > 0) {
            const names = invalidFiles.map(f => `"${f.name}"`).join(', ');
            alert(`The following file(s) exceed the maximum size of ${maxAttachmentSizeMB}MB and were not added: ${names}`);
        }
        
        if (validFiles.length > 0) {
            pendingAttachments.push(...validFiles);
            updateAttachmentPreview();
        }
        
        return validFiles.length > 0;
    }
    
    // File input change
    if (fileInput) {
        fileInput.addEventListener('change', (e) => {
            const files = Array.from(e.target.files);
            validateAndAddFiles(files);
            
            // Reset file input
            fileInput.value = '';
        });
    }
    
    // Drag and drop file handling
    const chatContainer = document.querySelector('.chat-container');
    let dragCounter = 0; // Counter to track drag depth for preventing flickering
    
    if (chatContainer) {
        // Prevent default drag behaviors on the entire chat container
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            chatContainer.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
            }, false);
        });
        
        // Highlight drop zone when dragging files
        chatContainer.addEventListener('dragenter', (e) => {
            dragCounter++;
            if (allowFileAttachments && dragCounter === 1) {
                chatContainer.classList.add('drag-over');
                // Announce to screen readers
                chatContainer.setAttribute('aria-label', 'Drop zone active. Drop files to attach them to your message.');
            }
        }, false);
        
        chatContainer.addEventListener('dragover', (e) => {
            // Keep drag-over state active
            if (allowFileAttachments) {
                chatContainer.classList.add('drag-over');
            }
        }, false);
        
        chatContainer.addEventListener('dragleave', (e) => {
            dragCounter--;
            if (dragCounter === 0) {
                chatContainer.classList.remove('drag-over');
                chatContainer.removeAttribute('aria-label');
            }
        }, false);
        
        // Handle dropped files
        chatContainer.addEventListener('drop', (e) => {
            dragCounter = 0; // Reset counter on drop
            chatContainer.classList.remove('drag-over');
            chatContainer.removeAttribute('aria-label');
            
            if (!allowFileAttachments) {
                alert('File attachments are disabled by the administrator');
                return;
            }
            
            const dt = e.dataTransfer;
            const files = Array.from(dt.files);
            
            if (files.length === 0) {
                return;
            }
            
            // Use the extracted validation function
            if (validateAndAddFiles(files)) {
                // Focus the message input for user convenience
                messageInput.focus();
            }
        }, false);
    }
    
    // Update attachment preview
    function updateAttachmentPreview() {
        if (pendingAttachments.length === 0) {
            attachmentPreview.classList.add('hidden');
            attachmentPreview.innerHTML = '';
            return;
        }
        
        attachmentPreview.classList.remove('hidden');
        attachmentPreview.innerHTML = '';
        
        pendingAttachments.forEach((file, index) => {
            const item = document.createElement('div');
            item.className = 'attachment-item';
            
            const icon = document.createElement('span');
            icon.textContent = '📎';
            
            const info = document.createElement('div');
            info.style.display = 'flex';
            info.style.flexDirection = 'column';
            info.style.gap = '2px';
            
            const name = document.createElement('div');
            name.className = 'attachment-item-name';
            name.textContent = file.name;
            name.title = file.name;
            
            const size = document.createElement('div');
            size.className = 'attachment-item-size';
            size.textContent = formatFileSize(file.size);
            
            info.appendChild(name);
            info.appendChild(size);
            
            const removeBtn = document.createElement('button');
            removeBtn.className = 'attachment-item-remove';
            removeBtn.textContent = '×';
            removeBtn.type = 'button';
            removeBtn.onclick = () => {
                const idx = pendingAttachments.indexOf(file);
                if (idx !== -1) {
                    pendingAttachments.splice(idx, 1);
                    updateAttachmentPreview();
                }
            };
            
            item.appendChild(icon);
            item.appendChild(info);
            item.appendChild(removeBtn);
            
            attachmentPreview.appendChild(item);
        });
    }
    
    // Format file size for display
    function formatFileSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }
    
    // Upload attachments for a message
    async function uploadAttachmentsForMessage(messageId, attachments) {
        if (!attachments || attachments.length === 0) return;
        
        const token = sessionStorage.getItem('token');
        if (!token) {
            console.error('Cannot upload attachments: no token in session');
            return;
        }
        
        let uploadedCount = 0;
        for (const file of attachments) {
            try {
                // Note: Token is sent in form body rather than Authorization header
                // because this is a multipart/form-data request. The server supports
                // this for file uploads while maintaining security through JWT validation.
                const formData = new FormData();
                formData.append('file', file);
                formData.append('message_id', messageId);
                formData.append('token', token);
                
                const response = await fetch('/api/upload-attachment', {
                    method: 'POST',
                    body: formData
                });
                
                const result = await response.json();
                if (!result.success) {
                    console.error('Failed to upload attachment:', result.error);
                    alert(`Failed to upload "${file.name}": ${result.error}`);
                } else {
                    console.log(`Uploaded attachment: ${file.name}`);
                    uploadedCount++;
                }
            } catch (error) {
                console.error('Error uploading attachment:', error);
                alert(`Error uploading "${file.name}": ${error.message}`);
            }
        }
        
        // Refresh the message to show uploaded attachments
        if (uploadedCount > 0) {
            // Wait for the message element to appear in the DOM
            // Try multiple times with increasing delays to handle fast uploads
            let messageDiv = null;
            for (let attempt = 0; attempt < 5; attempt++) {
                messageDiv = document.querySelector(`[data-message-id="${messageId}"]`);
                if (messageDiv) break;
                await new Promise(resolve => setTimeout(resolve, 50 * (attempt + 1)));
            }
            
            if (messageDiv) {
                const contentWrapper = messageDiv.querySelector('.message-content-wrapper');
                if (contentWrapper) {
                    // Remove existing attachments div if present
                    const existingAttachments = contentWrapper.querySelector('.message-attachments');
                    if (existingAttachments) {
                        existingAttachments.remove();
                    }
                    // Reload attachments to display the newly uploaded ones
                    await loadMessageAttachments(messageId, contentWrapper);
                }
            } else {
                console.warn(`Message element not found for ID ${messageId}, attachments may not display until refresh`);
            }
        }
    }
    
    // Message input - handle mention autocomplete
    messageInput.addEventListener('input', (e) => {
        const value = messageInput.value;
        const cursorPos = messageInput.selectionStart;
        
        // Find @ symbol before cursor
        let atPos = -1;
        for (let i = cursorPos - 1; i >= 0; i--) {
            if (value[i] === '@') {
                // Check if @ is at start or preceded by whitespace
                if (i === 0 || /\s/.test(value[i - 1])) {
                    atPos = i;
                    break;
                }
            } else if (/\s/.test(value[i])) {
                // Hit whitespace before finding valid @
                break;
            }
        }
        
        if (atPos !== -1) {
            // Extract query after @
            const query = value.substring(atPos + 1, cursorPos);
            
            // Only show autocomplete if query doesn't contain whitespace
            if (!/\s/.test(query)) {
                mentionActive = true;
                mentionStartPos = atPos;
                mentionQuery = query;
                selectedMentionIndex = 0;
                showMentionAutocomplete(query);
            } else {
                hideMentionAutocomplete();
            }
        } else {
            hideMentionAutocomplete();
        }
    });
    
    // Message input - handle keyboard navigation for mentions
    messageInput.addEventListener('keydown', (e) => {
        if (!mentionActive) return;
        
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            navigateMentionAutocomplete('down');
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            navigateMentionAutocomplete('up');
        } else if (e.key === 'Enter' && !e.shiftKey) {
            // Check if autocomplete is visible and has items
            if (!mentionAutocomplete.classList.contains('hidden')) {
                e.preventDefault();
                selectCurrentMention();
            }
        } else if (e.key === 'Escape') {
            e.preventDefault();
            hideMentionAutocomplete();
        }
    });
    
    // Handle edit and delete message button clicks using event delegation
    messagesContainer.addEventListener('click', (e) => {
        const editBtn = e.target.closest('.edit-message-btn');
        const deleteBtn = e.target.closest('.delete-message-btn');
        
        if (editBtn) {
            const messageDiv = editBtn.closest('.message');
            if (messageDiv && messageDiv.dataset.messageId) {
                startEditingMessage(messageDiv);
            }
        } else if (deleteBtn) {
            const messageDiv = deleteBtn.closest('.message');
            if (messageDiv && messageDiv.dataset.messageId) {
                deleteMessage(messageDiv);
            }
        }
    });
    
    // Start editing a message
    function startEditingMessage(messageDiv) {
        const messageId = messageDiv.dataset.messageId;
        const contentDiv = messageDiv.querySelector('.message-content');
        const originalContent = contentDiv.textContent;
        
        // Create edit form
        const editForm = document.createElement('form');
        editForm.className = 'message-edit-form';
        
        const editInput = document.createElement('input');
        editInput.type = 'text';
        editInput.className = 'message-edit-input';
        editInput.value = originalContent;
        editInput.maxLength = maxMessageLength;
        
        const saveBtn = document.createElement('button');
        saveBtn.type = 'submit';
        saveBtn.className = 'message-edit-save';
        saveBtn.textContent = '✓ Save';
        
        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'message-edit-cancel';
        cancelBtn.textContent = '✗ Cancel';
        
        editForm.appendChild(editInput);
        editForm.appendChild(saveBtn);
        editForm.appendChild(cancelBtn);
        
        // Replace content with edit form
        contentDiv.replaceWith(editForm);
        editInput.focus();
        editInput.select();
        
        // Handle save
        editForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const newContent = editInput.value.trim();

            // Prevent saving empty messages and keep the edit form open
            if (!newContent) {
                // Use built-in form validation messaging for feedback
                if (editInput.setCustomValidity) {
                    editInput.setCustomValidity('Message cannot be empty.');
                    editInput.reportValidity && editInput.reportValidity();
                } else {
                    alert('Message cannot be empty.');
                }
                return;
            }

            // Clear any previous validation message
            if (editInput.setCustomValidity) {
                editInput.setCustomValidity('');
            }
            
            // Validate message length
            if (newContent.length > maxMessageLength) {
                if (editInput.setCustomValidity) {
                    editInput.setCustomValidity(`Message exceeds maximum length of ${maxMessageLength} characters.`);
                    editInput.reportValidity && editInput.reportValidity();
                } else {
                    alert(`Message exceeds maximum length of ${maxMessageLength} characters.`);
                }
                return;
            }

            // If nothing changed, just restore the original content
            if (newContent === originalContent) {
                const restoredContentDiv = document.createElement('div');
                restoredContentDiv.className = 'message-content';
                restoredContentDiv.textContent = originalContent;
                editForm.replaceWith(restoredContentDiv);
                return;
            }
            
            // Send edit request to server
            ws.send(JSON.stringify({
                type: 'edit_message',
                message_id: parseInt(messageId),
                content: newContent
            }));

            // Optimistically update the UI to show the new content
            const updatedContentDiv = document.createElement('div');
            updatedContentDiv.className = 'message-content';
            updatedContentDiv.textContent = newContent;
            editForm.replaceWith(updatedContentDiv);
        });
        
        // Handle cancel
        cancelBtn.addEventListener('click', () => {
            const restoredContentDiv = document.createElement('div');
            restoredContentDiv.className = 'message-content';
            restoredContentDiv.textContent = originalContent;
            editForm.replaceWith(restoredContentDiv);
        });
    }
    
    // Delete confirmation modal
    function showDeleteConfirmationDialog() {
        return new Promise((resolve) => {
            // Overlay
            const overlay = document.createElement('div');
            overlay.style.position = 'fixed';
            overlay.style.top = '0';
            overlay.style.left = '0';
            overlay.style.width = '100%';
            overlay.style.height = '100%';
            overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
            overlay.style.display = 'flex';
            overlay.style.alignItems = 'center';
            overlay.style.justifyContent = 'center';
            overlay.style.zIndex = '1000';
            
            // Modal container
            const modal = document.createElement('div');
            modal.style.backgroundColor = '#1f2933';
            modal.style.color = '#f9fafb';
            modal.style.padding = '16px 20px';
            modal.style.borderRadius = '8px';
            modal.style.boxShadow = '0 10px 25px rgba(0, 0, 0, 0.4)';
            modal.style.maxWidth = '400px';
            modal.style.width = '90%';
            modal.style.fontFamily = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
            
            const message = document.createElement('p');
            message.textContent = 'Are you sure you want to delete this message?';
            message.style.margin = '0 0 16px 0';
            
            const buttonsContainer = document.createElement('div');
            buttonsContainer.style.display = 'flex';
            buttonsContainer.style.justifyContent = 'flex-end';
            buttonsContainer.style.gap = '8px';
            
            const cancelBtn = document.createElement('button');
            cancelBtn.type = 'button';
            cancelBtn.textContent = 'Cancel';
            cancelBtn.style.padding = '6px 12px';
            cancelBtn.style.borderRadius = '4px';
            cancelBtn.style.border = '1px solid #4b5563';
            cancelBtn.style.backgroundColor = '#111827';
            cancelBtn.style.color = '#e5e7eb';
            cancelBtn.style.cursor = 'pointer';
            
            const deleteBtn = document.createElement('button');
            deleteBtn.type = 'button';
            deleteBtn.textContent = 'Delete';
            deleteBtn.style.padding = '6px 12px';
            deleteBtn.style.borderRadius = '4px';
            deleteBtn.style.border = 'none';
            deleteBtn.style.backgroundColor = '#b91c1c';
            deleteBtn.style.color = '#f9fafb';
            deleteBtn.style.cursor = 'pointer';
            
            buttonsContainer.appendChild(cancelBtn);
            buttonsContainer.appendChild(deleteBtn);
            
            modal.appendChild(message);
            modal.appendChild(buttonsContainer);
            overlay.appendChild(modal);
            document.body.appendChild(overlay);
            
            function cleanup() {
                document.body.removeChild(overlay);
                document.removeEventListener('keydown', onKeyDown);
            }
            
            function onKeyDown(e) {
                if (e.key === 'Escape') {
                    cleanup();
                    resolve(false);
                }
            }
            
            cancelBtn.addEventListener('click', () => {
                cleanup();
                resolve(false);
            });
            
            deleteBtn.addEventListener('click', () => {
                cleanup();
                resolve(true);
            });
            
            // Close when clicking outside the modal
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) {
                    cleanup();
                    resolve(false);
                }
            });
            
            document.addEventListener('keydown', onKeyDown);
        });
    }
    
    // Delete a message
    async function deleteMessage(messageDiv) {
        const messageId = messageDiv.dataset.messageId;
        
        const confirmed = await showDeleteConfirmationDialog();
        if (!confirmed) {
            return;
        }
        
        ws.send(JSON.stringify({
            type: 'delete_message',
            message_id: parseInt(messageId)
        }));
    }
    
    // User menu toggle
    userMenuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        userMenu.classList.toggle('hidden');
    });
    
    // Close menu when clicking outside
    document.addEventListener('click', (e) => {
        if (!userMenu.contains(e.target) && !userMenuBtn.contains(e.target)) {
            userMenu.classList.add('hidden');
        }
    });
    
    // Create server (from menu)
    menuCreateServerBtn.addEventListener('click', () => {
        userMenu.classList.add('hidden');
        createServerModal.classList.remove('hidden');
        serverNameInput.focus();
    });
    
    menuJoinServerBtn.addEventListener('click', () => {
        userMenu.classList.add('hidden');
        joinServerModal.classList.remove('hidden');
        joinServerError.classList.add('hidden');
        serverInviteInput.value = '';
        serverInviteInput.focus();
    });
    
    createServerForm.addEventListener('submit', (e) => {
        e.preventDefault();
        
        const serverName = serverNameInput.value.trim();
        if (!serverName) return;
        
        // Check if WebSocket is connected and authenticated
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            alert('Connection error. Please refresh the page and try again.');
            return;
        }
        
        if (!authenticated) {
            alert('Please wait for authentication to complete before creating a server.');
            return;
        }
        
        ws.send(JSON.stringify({
            type: 'create_server',
            name: serverName
        }));
    });
    
    joinServerForm.addEventListener('submit', (e) => {
        e.preventDefault();
        
        const inviteCode = serverInviteInput.value.trim();
        if (!inviteCode) return;
        
        ws.send(JSON.stringify({
            type: 'join_server_with_invite',
            invite_code: inviteCode
        }));
    });
    
    cancelServerBtn.addEventListener('click', () => {
        createServerModal.classList.add('hidden');
        serverNameInput.value = '';
    });
    
    cancelJoinServerBtn.addEventListener('click', () => {
        joinServerModal.classList.add('hidden');
        serverInviteInput.value = '';
        joinServerError.classList.add('hidden');
    });
    
    // Create text channel (from server settings)
    createTextChannelBtn.addEventListener('click', () => {
        if (!currentlySelectedServer) {
            alert('Please select a server first');
            return;
        }
        
        const server = servers.find(s => s.id === currentlySelectedServer);
        if (!server) return;
        
        // Check if user has permission (owner or has can_create_channel permission)
        const hasPermission = server.owner === username || 
                            (server.permissions && server.permissions.can_create_channel);
        
        if (!hasPermission) {
            alert('You do not have permission to create channels');
            return;
        }
        
        // Close server settings modal before showing channel creation modal
        serverSettingsModal.classList.add('hidden');
        
        createTextChannelModal.classList.remove('hidden');
        textChannelNameInput.focus();
    });
    
    createTextChannelForm.addEventListener('submit', (e) => {
        e.preventDefault();
        
        const channelName = textChannelNameInput.value.trim();
        if (!channelName || !currentlySelectedServer) return;
        
        ws.send(JSON.stringify({
            type: 'create_channel',
            server_id: currentlySelectedServer,
            name: channelName,
            channel_type: 'text'
        }));
        
        createTextChannelModal.classList.add('hidden');
        textChannelNameInput.value = '';
    });
    
    cancelTextChannelBtn.addEventListener('click', () => {
        createTextChannelModal.classList.add('hidden');
        textChannelNameInput.value = '';
    });
    
    // Create voice channel (from server settings)
    createVoiceChannelBtn.addEventListener('click', () => {
        if (!currentlySelectedServer) {
            alert('Please select a server first');
            return;
        }
        
        const server = servers.find(s => s.id === currentlySelectedServer);
        if (!server) return;
        
        // Check if user has permission (owner or has can_create_channel permission)
        const hasPermission = server.owner === username || 
                            (server.permissions && server.permissions.can_create_channel);
        
        if (!hasPermission) {
            alert('You do not have permission to create channels');
            return;
        }
        
        // Close server settings modal before showing channel creation modal
        serverSettingsModal.classList.add('hidden');
        
        createVoiceChannelModal.classList.remove('hidden');
        voiceChannelNameInput.focus();
    });
    
    createVoiceChannelForm.addEventListener('submit', (e) => {
        e.preventDefault();
        
        const channelName = voiceChannelNameInput.value.trim();
        if (!channelName || !currentlySelectedServer) return;
        
        ws.send(JSON.stringify({
            type: 'create_channel',
            server_id: currentlySelectedServer,
            name: channelName,
            channel_type: 'voice'
        }));
        
        createVoiceChannelModal.classList.add('hidden');
        voiceChannelNameInput.value = '';
    });
    
    cancelVoiceChannelBtn.addEventListener('click', () => {
        createVoiceChannelModal.classList.add('hidden');
        voiceChannelNameInput.value = '';
    });
    
    // Friends view (from menu)
    menuFriendsBtn.addEventListener('click', () => {
        userMenu.classList.add('hidden');
        channelsView.classList.add('hidden');
        friendsView.classList.remove('hidden');
        chatTitle.textContent = 'Friends';
        
        // Hide members sidebar for friends view
        rightSidebar.classList.add('hidden');
        
        // Clear current context
        currentContext = null;
        messageInput.disabled = true;
        submitBtn.disabled = true;
        messageInput.placeholder = 'Select a friend to start chatting...';
        messagesContainer.innerHTML = '<div class="welcome-message"><h2>Your Friends</h2><p>Search for users and add them as friends to start chatting!</p></div>';
        
        document.querySelectorAll('.server-item, .dm-item').forEach(item => item.classList.remove('active'));
    });
    
    // Search users
    searchUsersBtn.addEventListener('click', () => {
        searchUsersModal.classList.remove('hidden');
        searchUsersInput.focus();
    });
    
    searchUsersInput.addEventListener('input', (e) => {
        const query = e.target.value.trim();
        if (query.length >= 2) {
            ws.send(JSON.stringify({
                type: 'search_users',
                query: query
            }));
        } else {
            searchResults.innerHTML = '';
        }
    });
    
    closeSearchModalBtn.addEventListener('click', () => {
        searchUsersModal.classList.add('hidden');
        searchUsersInput.value = '';
        searchResults.innerHTML = '';
    });
    
    // Server settings
    serverSettingsBtn.addEventListener('click', () => {
        if (!currentlySelectedServer) return;
        
        const server = servers.find(s => s.id === currentlySelectedServer);
        if (!server || server.owner !== username) return;
        
        serverSettingsModal.classList.remove('hidden');
        newServerNameInput.value = server.name;
        serverInviteDisplay.classList.add('hidden');
        
        // Switch to general tab
        switchSettingsTab('general');
        
        // Load server members
        ws.send(JSON.stringify({
            type: 'get_server_members',
            server_id: currentlySelectedServer
        }));
        
        // Load server purge settings
        ws.send(JSON.stringify({
            type: 'get_server_purge_settings',
            server_id: currentlySelectedServer
        }));
    });
    
    closeServerSettingsModalBtn.addEventListener('click', () => {
        serverSettingsModal.classList.add('hidden');
    });
    
    // Settings tabs
    document.querySelectorAll('.settings-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const tabName = tab.dataset.tab;
            switchSettingsTab(tabName);
        });
    });
    
    function switchSettingsTab(tabName) {
        // Update tab buttons
        document.querySelectorAll('.settings-tab').forEach(t => {
            t.classList.toggle('active', t.dataset.tab === tabName);
        });
        
        // Update tab content
        document.querySelectorAll('.settings-tab-content').forEach(content => {
            content.classList.add('hidden');
        });
        document.getElementById(`settings-tab-${tabName}`).classList.remove('hidden');
    }
    
    // Rename server
    renameServerForm.addEventListener('submit', (e) => {
        e.preventDefault();
        
        const newName = newServerNameInput.value.trim();
        if (!newName || !currentlySelectedServer) return;
        
        ws.send(JSON.stringify({
            type: 'rename_server',
            server_id: currentlySelectedServer,
            name: newName
        }));
        
        serverSettingsModal.classList.add('hidden');
    });
    
    // Save server purge settings
    saveServerPurgeSettingsBtn.addEventListener('click', () => {
        if (!currentlySelectedServer) return;
        
        const purgeSchedule = parseInt(document.getElementById('server-purge-schedule').value, 10);
        
        // Validate purge schedule value
        const validValues = [0, 7, 30, 90, 180, 365];
        if (!validValues.includes(purgeSchedule)) {
            alert('Invalid purge schedule value');
            return;
        }
        
        // Get exempted channels
        const exemptedChannels = [];
        const checkboxes = document.querySelectorAll('#channel-exemptions-list input[type="checkbox"]:checked');
        checkboxes.forEach(checkbox => {
            const channelId = checkbox.dataset.channelId;
            if (channelId) {  // Only add if channelId exists
                exemptedChannels.push(channelId);
            }
        });
        
        ws.send(JSON.stringify({
            type: 'update_server_purge_settings',
            server_id: currentlySelectedServer,
            purge_schedule: purgeSchedule,
            exempted_channels: exemptedChannels
        }));
    });
    
    // Server icon tab switching
    const iconTabs = document.querySelectorAll('.icon-tab');
    const iconTabContents = document.querySelectorAll('.icon-tab-content');
    
    iconTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const tabName = tab.dataset.tab;
            
            // Update active tab
            iconTabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            
            // Show corresponding content
            iconTabContents.forEach(content => {
                if (content.id === `server-icon-tab-${tabName}`) {
                    content.classList.remove('hidden');
                } else {
                    content.classList.add('hidden');
                }
            });
        });
    });
    
    // Server icon emoji selection
    const emojiOptions = document.querySelectorAll('.emoji-option');
    emojiOptions.forEach(option => {
        option.addEventListener('click', () => {
            const emoji = option.dataset.emoji;
            if (!currentlySelectedServer) return;
            
            try {
                ws.send(JSON.stringify({
                    type: 'set_server_icon',
                    server_id: currentlySelectedServer,
                    icon_type: 'emoji',
                    icon: emoji
                }));
                
                // Inform the user that the update has been requested; actual success depends on server confirmation.
                showNotification('Server icon update requested. Changes will appear once confirmed.');
            } catch (err) {
                console.error('Failed to send server icon update:', err);
                showNotification('Failed to update server icon. Please try again.');
            }
        });
    });
    
    // Handle server icon image upload
    const serverIconFileInput = document.getElementById('server-icon-file-input');
    const serverIconPreview = document.getElementById('server-icon-preview');
    const uploadServerIconBtn = document.getElementById('upload-server-icon-btn');
    let selectedServerIconFile = null;
    
    serverIconFileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            // Validate file type
            if (!file.type.startsWith('image/')) {
                alert('Please select an image file');
                return;
            }
            
            // Validate file size (10MB)
            if (file.size > 10 * 1024 * 1024) {
                alert('Image is too large. Maximum size is 10MB.');
                return;
            }
            
            selectedServerIconFile = file;
            serverIconPreview.textContent = `📷 ${file.name}`;
            uploadServerIconBtn.classList.remove('hidden');
        }
    });
    
    uploadServerIconBtn.addEventListener('click', () => {
        if (!selectedServerIconFile || !currentlySelectedServer) return;
        
        const reader = new FileReader();
        reader.onload = (e) => {
            const base64Data = e.target.result;
            
            ws.send(JSON.stringify({
                type: 'set_server_icon',
                server_id: currentlySelectedServer,
                icon_type: 'image',
                icon_data: base64Data
            }));
            
            uploadServerIconBtn.classList.add('hidden');
            selectedServerIconFile = null;
            serverIconPreview.textContent = '📁 Choose an image';
            serverIconFileInput.value = '';
        };
        reader.onerror = (e) => {
            console.error('Failed to read server icon file:', reader.error || e);
            showNotification('Failed to read server icon file. Please try again.');
            // Reset file input so the user can select a file again
            selectedServerIconFile = null;
            serverIconPreview.textContent = '📁 Choose an image';
            serverIconFileInput.value = '';
        };
        reader.readAsDataURL(selectedServerIconFile);
    });
    
    // Generate server invite
    generateServerInviteBtn.addEventListener('click', () => {
        if (!currentlySelectedServer) return;
        
        ws.send(JSON.stringify({
            type: 'generate_server_invite',
            server_id: currentlySelectedServer
        }));
    });
    
    // Copy invite link to clipboard
    copyInviteLinkBtn.addEventListener('click', async () => {
        const inviteLink = serverInviteLinkText.textContent;
        try {
            await navigator.clipboard.writeText(inviteLink);
            const originalText = copyInviteLinkBtn.textContent;
            copyInviteLinkBtn.textContent = '✓ Copied!';
            setTimeout(() => {
                copyInviteLinkBtn.textContent = originalText;
            }, 2000);
        } catch (err) {
            console.error('Failed to copy invite link:', err);
            alert('Failed to copy link to clipboard');
        }
    });
    
    // Open send invite to friends modal
    sendInviteToFriendsBtn.addEventListener('click', () => {
        if (friends.length === 0) {
            alert('You have no friends to send invites to. Add some friends first!');
            return;
        }
        
        // Populate friends list with checkboxes
        inviteFriendsList.innerHTML = '';
        friends.forEach(friend => {
            const friendItem = document.createElement('div');
            friendItem.className = 'invite-friend-item';
            
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.id = `invite-friend-${friend.username}`;
            checkbox.value = friend.username;
            checkbox.className = 'friend-checkbox';
            
            const avatarEl = createAvatarElement(friend, 'friend-avatar-small');
            
            const label = document.createElement('label');
            label.htmlFor = checkbox.id;
            label.textContent = friend.username;
            
            friendItem.appendChild(checkbox);
            friendItem.appendChild(avatarEl);
            friendItem.appendChild(label);
            inviteFriendsList.appendChild(friendItem);
        });
        
        sendInviteModal.classList.remove('hidden');
    });
    
    // Send invites to selected friends
    sendSelectedInvitesBtn.addEventListener('click', () => {
        const selectedFriends = Array.from(document.querySelectorAll('.friend-checkbox:checked'))
            .map(cb => cb.value);
        
        if (selectedFriends.length === 0) {
            alert('Please select at least one friend to send the invite to.');
            return;
        }
        
        const inviteCode = serverInviteDisplay.dataset.currentInviteCode;
        const inviteLink = `${window.location.origin}/static/index.html?invite=${inviteCode}`;
        const serverName = servers.find(s => s.id === currentlySelectedServer)?.name || 'a server';
        
        selectedFriends.forEach(friendUsername => {
            ws.send(JSON.stringify({
                type: 'send_dm',
                to_user: friendUsername,
                content: `🎉 You've been invited to join **${serverName}**!\n\nClick here to join: ${inviteLink}\n\nOr use invite code: ${inviteCode}`
            }));
        });
        
        alert(`Invite sent to ${selectedFriends.length} friend(s)!`);
        sendInviteModal.classList.add('hidden');
    });
    
    // Close send invite modal
    closeSendInviteModalBtn.addEventListener('click', () => {
        sendInviteModal.classList.add('hidden');
    });
    
    sendInviteModal.addEventListener('click', (e) => {
        if (e.target === sendInviteModal) {
            sendInviteModal.classList.add('hidden');
        }
    });

    // ========== Custom Emoji Functions ==========
    
    // Open emoji picker for reactions
    function openEmojiPicker(messageId) {
        currentPickerTargetMessageId = messageId;
        
        // Populate standard emojis
        standardEmojisGrid.innerHTML = '';
        standardEmojis.forEach(emoji => {
            const btn = document.createElement('button');
            btn.textContent = emoji;
            btn.onclick = () => {
                addReaction(messageId, emoji, 'standard');
                closeEmojiPicker();
            };
            standardEmojisGrid.appendChild(btn);
        });
        
        // Populate custom emojis if in a server
        customEmojisGrid.innerHTML = '';
        if (currentContext && currentContext.type === 'server' && customEmojis[currentContext.serverId]) {
            customEmojis[currentContext.serverId].forEach(emoji => {
                const btn = document.createElement('button');
                const img = document.createElement('img');
                img.src = sanitizeImageSrc(emoji.image_data);
                img.alt = emoji.name;
                btn.appendChild(img);
                btn.title = emoji.name;
                btn.onclick = () => {
                    addReaction(messageId, emoji.emoji_id, 'custom');
                    closeEmojiPicker();
                };
                customEmojisGrid.appendChild(btn);
            });
        }
        
        emojiPickerModal.classList.remove('hidden');
    }
    
    function closeEmojiPicker() {
        emojiPickerModal.classList.add('hidden');
        currentPickerTargetMessageId = null;
    }

    // ========== Custom Emoji Event Listeners ==========
    
    // Upload custom emoji button
    uploadCustomEmojiBtn.addEventListener('click', () => {
        if (!currentlySelectedServer) return;
        uploadEmojiModal.classList.remove('hidden');
    });
    
    // Cancel upload emoji
    cancelUploadEmojiBtn.addEventListener('click', () => {
        uploadEmojiModal.classList.add('hidden');
        uploadEmojiForm.reset();
        emojiPreviewContainer.classList.add('hidden');
        uploadEmojiError.textContent = '';
    });
    
    // Preview emoji image
    emojiFileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        // Validate file size (max 256KB)
        if (file.size > 256 * 1024) {
            uploadEmojiError.textContent = 'Image must be smaller than 256KB';
            emojiFileInput.value = '';
            emojiPreviewContainer.classList.add('hidden');
            return;
        }
        
        // Show preview
        const reader = new FileReader();
        reader.onload = (e) => {
            emojiPreview.src = e.target.result;
            emojiPreviewContainer.classList.remove('hidden');
            uploadEmojiError.textContent = '';
        };
        reader.readAsDataURL(file);
    });
    
    // Submit upload emoji form
    uploadEmojiForm.addEventListener('submit', (e) => {
        e.preventDefault();
        
        const name = emojiNameInput.value.trim();
        const file = emojiFileInput.files[0];
        
        if (!name || !file || !currentlySelectedServer) return;
        
        const reader = new FileReader();
        reader.onload = (e) => {
            ws.send(JSON.stringify({
                type: 'upload_custom_emoji',
                server_id: currentlySelectedServer,
                name: name,
                image_data: e.target.result
            }));
            
            uploadEmojiModal.classList.add('hidden');
            uploadEmojiForm.reset();
            emojiPreviewContainer.classList.add('hidden');
        };
        reader.readAsDataURL(file);
    });
    
    // Close emoji picker
    closeEmojiPickerBtn.addEventListener('click', closeEmojiPicker);
    
    // Emoji picker modal - close on background click
    emojiPickerModal.addEventListener('click', (e) => {
        if (e.target === emojiPickerModal) {
            closeEmojiPicker();
        }
    });
    
    // Upload emoji modal - close on background click
    uploadEmojiModal.addEventListener('click', (e) => {
        if (e.target === uploadEmojiModal) {
            uploadEmojiModal.classList.add('hidden');
            uploadEmojiForm.reset();
            emojiPreviewContainer.classList.add('hidden');
            uploadEmojiError.textContent = '';
        }
    });
    
    // Emoji picker tab switching
    document.querySelectorAll('.emoji-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const tabName = tab.dataset.tab;
            
            // Update active tab
            document.querySelectorAll('.emoji-tab').forEach(t => {
                t.classList.toggle('active', t.dataset.tab === tabName);
            });
            
            // Show corresponding emoji grid
            if (tabName === 'standard') {
                standardEmojisGrid.classList.remove('hidden');
                customEmojisGrid.classList.add('hidden');
            } else {
                standardEmojisGrid.classList.add('hidden');
                customEmojisGrid.classList.remove('hidden');
            }
        });
    });
    
    
    function showServerInviteCode(code) {
        serverInviteCodeText.textContent = code;
        const inviteLink = `${window.location.origin}/static/index.html?invite=${code}`;
        serverInviteLinkText.textContent = inviteLink;
        serverInviteDisplay.classList.remove('hidden');
        
        // Store the current invite code for later use
        serverInviteDisplay.dataset.currentInviteCode = code;
    }
    
    function displayServerMembers(members, serverId) {
        serverMembersList.innerHTML = '';
        
        members.forEach(member => {
            const memberItem = document.createElement('div');
            memberItem.className = 'member-item';
            
            const memberInfo = document.createElement('div');
            memberInfo.className = 'member-info';
            
            const memberName = document.createElement('span');
            memberName.className = 'member-name';
            memberName.textContent = member.username;
            memberInfo.appendChild(memberName);
            
            if (member.is_owner) {
                const ownerBadge = document.createElement('span');
                ownerBadge.className = 'owner-badge';
                ownerBadge.textContent = 'Owner';
                memberInfo.appendChild(ownerBadge);
            }
            
            memberItem.appendChild(memberInfo);
            
            // Add permission toggles for non-owners
            if (!member.is_owner) {
                const permsDiv = document.createElement('div');
                permsDiv.className = 'member-permissions';
                
                const permissions = ['can_create_channel', 'can_edit_channel', 'can_delete_channel', 'can_edit_messages', 'can_delete_messages'];
                const permLabels = {
                    'can_create_channel': 'Create',
                    'can_edit_channel': 'Edit',
                    'can_delete_channel': 'Delete',
                    'can_edit_messages': 'Edit Msgs',
                    'can_delete_messages': 'Del Msgs'
                };
                
                permissions.forEach(perm => {
                    const permToggle = document.createElement('div');
                    permToggle.className = 'permission-toggle';
                    
                    const checkbox = document.createElement('input');
                    checkbox.type = 'checkbox';
                    checkbox.checked = member.permissions && member.permissions[perm];
                    checkbox.dataset.permission = perm;  // Add data attribute for permission type
                    checkbox.onchange = () => {
                        updatePermission(serverId, member.username, perm, checkbox.checked);
                    };
                    
                    const label = document.createElement('label');
                    label.textContent = permLabels[perm];
                    
                    permToggle.appendChild(checkbox);
                    permToggle.appendChild(label);
                    permsDiv.appendChild(permToggle);
                });
                
                memberItem.appendChild(permsDiv);
            }
            
            serverMembersList.appendChild(memberItem);
        });
    }
    
    function updatePermission(serverId, targetUsername, permission, value) {
        const server = servers.find(s => s.id === serverId);
        if (!server) return;
        
        // Get current permissions by reading from checkboxes using data attributes
        const currentPerms = {};
        
        // Find the member's row and read all checkboxes
        document.querySelectorAll('.member-item').forEach(item => {
            const name = item.querySelector('.member-name').textContent;
            if (name === targetUsername) {
                const checkboxes = item.querySelectorAll('input[type="checkbox"]');
                checkboxes.forEach(cb => {
                    const perm = cb.dataset.permission;
                    if (perm) {
                        currentPerms[perm] = cb.checked;
                    }
                });
            }
        });
        
        ws.send(JSON.stringify({
            type: 'update_user_permissions',
            server_id: serverId,
            username: targetUsername,
            permissions: currentPerms
        }));
    }
    
    // Display search results
    function displaySearchResults(results) {
        searchResults.innerHTML = '';
        
        if (results.length === 0) {
            searchResults.innerHTML = '<p style="text-align: center; color: #999;">No users found</p>';
            return;
        }
        
        results.forEach(result => {
            const resultItem = document.createElement('div');
            resultItem.className = 'search-result-item';
            
            const avatarEl = createAvatarElement(result, 'search-result-avatar');
            
            const usernameSpan = document.createElement('span');
            usernameSpan.className = 'username';
            usernameSpan.textContent = result.username;
            
            resultItem.appendChild(avatarEl);
            resultItem.appendChild(usernameSpan);
            
            if (result.is_friend) {
                const badge = document.createElement('span');
                badge.className = 'badge';
                badge.textContent = 'Friend';
                resultItem.appendChild(badge);
            } else if (result.request_sent) {
                const badge = document.createElement('span');
                badge.className = 'badge badge-secondary';
                badge.textContent = 'Request Sent';
                resultItem.appendChild(badge);
            } else if (result.request_received) {
                const approveBtn = document.createElement('button');
                approveBtn.className = 'btn btn-small btn-success';
                approveBtn.textContent = 'Approve';
                approveBtn.onclick = () => approveFriendRequest(result.username);
                resultItem.appendChild(approveBtn);
                
                const denyBtn = document.createElement('button');
                denyBtn.className = 'btn btn-small btn-danger';
                denyBtn.textContent = 'Deny';
                denyBtn.onclick = () => denyFriendRequest(result.username);
                resultItem.appendChild(denyBtn);
            } else {
                const addBtn = document.createElement('button');
                addBtn.className = 'btn btn-small btn-primary';
                addBtn.textContent = 'Add Friend';
                addBtn.onclick = () => addFriend(result.username, addBtn);
                resultItem.appendChild(addBtn);
            }
            
            searchResults.appendChild(resultItem);
        });
    }
    
    // Add friend (send friend request)
    function addFriend(friendUsername, button) {
        ws.send(JSON.stringify({
            type: 'add_friend',
            username: friendUsername
        }));
        button.disabled = true;
        button.textContent = 'Request Sent';
    }
    
    // Approve friend request
    function approveFriendRequest(username) {
        ws.send(JSON.stringify({
            type: 'approve_friend_request',
            username: username
        }));
    }
    
    // Deny friend request
    function denyFriendRequest(username) {
        ws.send(JSON.stringify({
            type: 'deny_friend_request',
            username: username
        }));
    }
    
    // Cancel friend request
    function cancelFriendRequest(username) {
        ws.send(JSON.stringify({
            type: 'cancel_friend_request',
            username: username
        }));
    }
    
    // Generate invite code (from menu)
    menuInviteBtn.addEventListener('click', () => {
        userMenu.classList.add('hidden');
        
        // Check if WebSocket is connected and authenticated
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            alert('Connection error. Please refresh the page and try again.');
            return;
        }
        
        if (!authenticated) {
            alert('Please wait for authentication to complete before generating an invite.');
            return;
        }
        
        ws.send(JSON.stringify({
            type: 'generate_invite'
        }));
    });
    
    // Show invite modal
    function showInviteModal(code) {
        inviteCodeText.textContent = code;
        inviteModal.classList.remove('hidden');
    }
    
    // Close invite modal
    closeInviteModalBtn.addEventListener('click', () => {
        inviteModal.classList.add('hidden');
    });
    
    // Close modals on outside click
    inviteModal.addEventListener('click', (e) => {
        if (e.target === inviteModal) {
            inviteModal.classList.add('hidden');
        }
    });
    
    createServerModal.addEventListener('click', (e) => {
        if (e.target === createServerModal) {
            createServerModal.classList.add('hidden');
            serverNameInput.value = '';
        }
    });
    
    searchUsersModal.addEventListener('click', (e) => {
        if (e.target === searchUsersModal) {
            searchUsersModal.classList.add('hidden');
            searchUsersInput.value = '';
            searchResults.innerHTML = '';
        }
    });
    
    createVoiceChannelModal.addEventListener('click', (e) => {
        if (e.target === createVoiceChannelModal) {
            createVoiceChannelModal.classList.add('hidden');
            voiceChannelNameInput.value = '';
        }
    });
    
    createTextChannelModal.addEventListener('click', (e) => {
        if (e.target === createTextChannelModal) {
            createTextChannelModal.classList.add('hidden');
            textChannelNameInput.value = '';
        }
    });
    
    // Logout (from menu)
    menuLogoutBtn.addEventListener('click', logout);
    
    // Admin settings (from menu)
    if (menuAdminBtn) {
        menuAdminBtn.addEventListener('click', () => {
            // Show admin settings modal instead of navigating
            if (!adminSettingsModal) {
                console.error('Admin settings modal element not found');
                return;
            }
            adminSettingsModal.classList.remove('hidden');
            // Request admin settings from server
            ws.send(JSON.stringify({
                type: 'get_admin_settings'
            }));
        });
    }
    
    // Admin settings modal handlers
    if (adminCloseModalBtn) {
        adminCloseModalBtn.addEventListener('click', () => {
            if (adminSettingsModal) {
                adminSettingsModal.classList.add('hidden');
            }
        });
    }
    
    // Close admin modal on outside click
    if (adminSettingsModal) {
        adminSettingsModal.addEventListener('click', (e) => {
            if (e.target === adminSettingsModal) {
                adminSettingsModal.classList.add('hidden');
            }
        });
        
        // Admin settings tab switching
        const adminTabs = adminSettingsModal.querySelectorAll('.settings-tab');
        const adminTabContents = {
            'general': document.getElementById('admin-general-tab'),
            'smtp': document.getElementById('admin-smtp-tab'),
            'announcements': document.getElementById('admin-announcements-tab')
        };
        
        adminTabs.forEach(tab => {
            tab.addEventListener('click', () => {
                const tabName = tab.getAttribute('data-tab');
                
                // Update active tab and ARIA attributes
                adminTabs.forEach(t => {
                    t.classList.remove('active');
                    t.setAttribute('aria-selected', 'false');
                });
                tab.classList.add('active');
                tab.setAttribute('aria-selected', 'true');
                
                // Show corresponding content
                Object.keys(adminTabContents).forEach(key => {
                    const contentEl = adminTabContents[key];
                    if (!contentEl) {
                        return;
                    }
                    if (key === tabName) {
                        contentEl.classList.remove('hidden');
                        contentEl.classList.add('active');
                    } else {
                        contentEl.classList.add('hidden');
                        contentEl.classList.remove('active');
                    }
                });
            });
        });
    }
    
    // Admin save settings handler
    if (adminSaveSettingsBtn) {
        adminSaveSettingsBtn.addEventListener('click', () => {
            // Helper function to validate numeric fields
            function validateNumericField(value, min, max, errorMessage) {
                if (isNaN(value) || value < min || value > max) {
                    showAdminStatus(errorMessage, 'error');
                    return false;
                }
                return true;
            }
            
            // Parse and validate numeric fields
            const maxMessageLength = parseInt(document.getElementById('admin-max-message-length').value, 10);
            const maxFileSize = parseInt(document.getElementById('admin-max-file-size').value, 10);
            const maxServersPerUser = parseInt(document.getElementById('admin-max-servers-per-user').value, 10);
            const maxChannelsPerServer = parseInt(document.getElementById('admin-max-channels-per-server').value, 10);
            const smtpPort = parseInt(document.getElementById('admin-smtp-port').value, 10);
            const announcementDuration = parseInt(document.getElementById('admin-announcement-duration').value, 10);
            
            // Validate all numeric fields
            if (!validateNumericField(maxMessageLength, 100, 10000, 'Maximum message length must be between 100 and 10000 characters.')) {
                return;
            }
            
            if (!validateNumericField(maxFileSize, 1, 100, 'Maximum file size must be between 1 and 100 MB.')) {
                return;
            }
            
            if (!validateNumericField(maxServersPerUser, 0, 100, 'Max servers per user must be between 0 and 100.')) {
                return;
            }
            
            if (!validateNumericField(maxChannelsPerServer, 0, 500, 'Max channels per server must be between 0 and 500.')) {
                return;
            }
            
            if (!validateNumericField(smtpPort, 1, 65535, 'SMTP port must be between 1 and 65535.')) {
                return;
            }
            
            if (!validateNumericField(announcementDuration, 1, 10080, 'Announcement duration must be between 1 and 10080 minutes (7 days).')) {
                return;
            }
            
            // Retrieve and validate all required DOM elements before accessing their properties
            const serverNameInput = document.getElementById('admin-server-name');
            const allowRegistrationsInput = document.getElementById('admin-allow-registrations');
            const requireInviteInput = document.getElementById('admin-require-invite');
            const requireEmailVerificationInput = document.getElementById('admin-require-email-verification');
            const smtpEnabledInput = document.getElementById('admin-smtp-enabled');
            const smtpHostInput = document.getElementById('admin-smtp-host');
            const smtpUsernameInput = document.getElementById('admin-smtp-username');
            const smtpPasswordInput = document.getElementById('admin-smtp-password');
            const smtpFromEmailInput = document.getElementById('admin-smtp-from-email');
            const smtpFromNameInput = document.getElementById('admin-smtp-from-name');
            const smtpUseTlsInput = document.getElementById('admin-smtp-use-tls');
            const announcementEnabledInput = document.getElementById('admin-announcement-enabled');
            const announcementMessageInput = document.getElementById('admin-announcement-message');

            if (
                !serverNameInput ||
                !allowRegistrationsInput ||
                !requireInviteInput ||
                !requireEmailVerificationInput ||
                !smtpEnabledInput ||
                !smtpHostInput ||
                !smtpUsernameInput ||
                !smtpPasswordInput ||
                !smtpFromEmailInput ||
                !smtpFromNameInput ||
                !smtpUseTlsInput ||
                !announcementEnabledInput ||
                !announcementMessageInput
            ) {
                console.error('One or more admin settings elements are missing from the DOM.');
                showAdminStatus('Unable to save settings because some form fields are missing. Please reload the page and try again.', 'error');
                return;
            }

            const settings = {
                server_name: serverNameInput.value,
                max_message_length: maxMessageLength,
                allow_registration: allowRegistrationsInput.checked,
                require_invite: requireInviteInput.checked,
                max_file_size_mb: maxFileSize,
                max_servers_per_user: maxServersPerUser,
                max_channels_per_server: maxChannelsPerServer,
                // SMTP settings
                require_email_verification: requireEmailVerificationInput.checked,
                smtp_enabled: smtpEnabledInput.checked,
                smtp_host: smtpHostInput.value,
                smtp_port: smtpPort,
                smtp_username: smtpUsernameInput.value,
                smtp_password: smtpPasswordInput.value,
                smtp_from_email: smtpFromEmailInput.value,
                smtp_from_name: smtpFromNameInput.value,
                smtp_use_tls: smtpUseTlsInput.checked,
                // Announcements
                announcement_enabled: announcementEnabledInput.checked,
                announcement_message: announcementMessageInput.value,
                announcement_duration_minutes: announcementDuration
            };
            
            ws.send(JSON.stringify({
                type: 'save_admin_settings',
                settings: settings
            }));
        });
    }
    
    // Admin test SMTP handler
    if (adminTestSmtpBtn) {
        adminTestSmtpBtn.addEventListener('click', () => {
            const smtpPortEl = document.getElementById('admin-smtp-port');
            const smtpEnabledEl = document.getElementById('admin-smtp-enabled');
            const smtpHostEl = document.getElementById('admin-smtp-host');
            const smtpUsernameEl = document.getElementById('admin-smtp-username');
            const smtpPasswordEl = document.getElementById('admin-smtp-password');
            const smtpFromEmailEl = document.getElementById('admin-smtp-from-email');
            const smtpFromNameEl = document.getElementById('admin-smtp-from-name');
            const smtpUseTlsEl = document.getElementById('admin-smtp-use-tls');
            
            if (!smtpPortEl || !smtpEnabledEl || !smtpHostEl || !smtpUsernameEl || 
                !smtpPasswordEl || !smtpFromEmailEl || !smtpFromNameEl || !smtpUseTlsEl) {
                showAdminSmtpTestResult(false, 'Unable to test SMTP: some form fields are missing. Please reload the page.');
                return;
            }
            
            const port = parseInt(smtpPortEl.value, 10);
            
            // Validate port first
            if (isNaN(port) || port < 1 || port > 65535) {
                showAdminSmtpTestResult(false, 'SMTP port must be a valid number between 1 and 65535');
                return;
            }
            
            const smtpSettings = {
                smtp_enabled: smtpEnabledEl.checked,
                smtp_host: smtpHostEl.value,
                smtp_port: port,
                smtp_username: smtpUsernameEl.value,
                smtp_password: smtpPasswordEl.value,
                smtp_from_email: smtpFromEmailEl.value,
                smtp_from_name: smtpFromNameEl.value,
                smtp_use_tls: smtpUseTlsEl.checked
            };
            
            // Validate SMTP settings if enabled
            if (smtpSettings.smtp_enabled) {
                if (!smtpSettings.smtp_host) {
                    showAdminSmtpTestResult(false, 'SMTP Host is required when email notifications are enabled');
                    return;
                }
                if (!smtpSettings.smtp_from_email) {
                    showAdminSmtpTestResult(false, 'From Email Address is required when email notifications are enabled');
                    return;
                }
            }
            
            ws.send(JSON.stringify({
                type: 'test_smtp',
                settings: smtpSettings
            }));
        });
    }
    
    // Helper functions for admin settings
    function loadAdminSettings(settings) {
        if (!settings || typeof settings !== 'object') return;
        
        const serverNameEl = document.getElementById('admin-server-name');
        if (serverNameEl) {
            serverNameEl.value = settings.server_name || 'Decentra Chat';
        }
        
        const maxMessageLengthEl = document.getElementById('admin-max-message-length');
        if (maxMessageLengthEl) {
            maxMessageLengthEl.value = settings.max_message_length || 2000;
        }
        
        const allowRegistrationsEl = document.getElementById('admin-allow-registrations');
        if (allowRegistrationsEl) {
            allowRegistrationsEl.checked = settings.allow_registration !== false;
        }
        
        const requireInviteEl = document.getElementById('admin-require-invite');
        if (requireInviteEl) {
            requireInviteEl.checked = settings.require_invite !== false;
        }
        
        const maxFileSizeEl = document.getElementById('admin-max-file-size');
        if (maxFileSizeEl) {
            maxFileSizeEl.value = settings.max_file_size_mb || 10;
        }
        
        const maxServersPerUserEl = document.getElementById('admin-max-servers-per-user');
        if (maxServersPerUserEl) {
            maxServersPerUserEl.value = settings.max_servers_per_user || 0;
        }
        
        const maxChannelsPerServerEl = document.getElementById('admin-max-channels-per-server');
        if (maxChannelsPerServerEl) {
            maxChannelsPerServerEl.value = settings.max_channels_per_server || 0;
        }
        
        // Load SMTP settings
        const requireEmailVerificationEl = document.getElementById('admin-require-email-verification');
        if (requireEmailVerificationEl) {
            requireEmailVerificationEl.checked = settings.require_email_verification !== false;
        }
        
        const smtpEnabledEl = document.getElementById('admin-smtp-enabled');
        if (smtpEnabledEl) {
            smtpEnabledEl.checked = settings.smtp_enabled !== false;
        }
        
        const smtpHostEl = document.getElementById('admin-smtp-host');
        if (smtpHostEl) {
            smtpHostEl.value = settings.smtp_host || '';
        }
        
        const smtpPortEl = document.getElementById('admin-smtp-port');
        if (smtpPortEl) {
            smtpPortEl.value = settings.smtp_port || 587;
        }
        
        const smtpUsernameEl = document.getElementById('admin-smtp-username');
        if (smtpUsernameEl) {
            smtpUsernameEl.value = settings.smtp_username || '';
        }
        
        const smtpPasswordEl = document.getElementById('admin-smtp-password');
        if (smtpPasswordEl) {
            smtpPasswordEl.value = settings.smtp_password || '';
        }
        
        const smtpFromEmailEl = document.getElementById('admin-smtp-from-email');
        if (smtpFromEmailEl) {
            smtpFromEmailEl.value = settings.smtp_from_email || '';
        }
        
        const smtpFromNameEl = document.getElementById('admin-smtp-from-name');
        if (smtpFromNameEl) {
            smtpFromNameEl.value = settings.smtp_from_name || 'Decentra';
        }
        
        const smtpUseTlsEl = document.getElementById('admin-smtp-use-tls');
        if (smtpUseTlsEl) {
            smtpUseTlsEl.checked = settings.smtp_use_tls !== false;
        }
        
        // Load announcement settings
        const announcementEnabledEl = document.getElementById('admin-announcement-enabled');
        if (announcementEnabledEl) {
            announcementEnabledEl.checked = settings.announcement_enabled !== false;
        }
        
        const announcementMessageEl = document.getElementById('admin-announcement-message');
        if (announcementMessageEl) {
            announcementMessageEl.value = settings.announcement_message || '';
        }
        
        const announcementDurationEl = document.getElementById('admin-announcement-duration');
        if (announcementDurationEl) {
            announcementDurationEl.value = settings.announcement_duration_minutes || 60;
        }
    }
    
    function showStatusMessage(elementId, message, className) {
        const el = document.getElementById(elementId);
        if (!el) return;
        
        el.textContent = message;
        el.className = className;
        el.style.display = 'block';
        
        setTimeout(() => {
            el.style.display = 'none';
        }, 5000);
    }
    
    function showAdminStatus(message, type) {
        const className = `status-message ${type}`;
        showStatusMessage('admin-status-message', message, className);
    }
    
    function showAdminSmtpTestResult(success, message) {
        const className = success ? 'status-message success' : 'status-message error';
        showStatusMessage('admin-smtp-test-result', message, className);
    }
    
    function logout() {
        // Clean up voice chat
        if (voiceChat) {
            voiceChat.leaveVoiceChannel();
            voiceChat.endDirectCall();
        }
        
        sessionStorage.clear();
        if (ws) {
            isIntentionalClose = true; // Mark this as an intentional close
            ws.close();
        }
        window.location.href = '/static/index.html';
    }
    
    // Voice chat functions
    async function joinVoiceChannel(serverId, channelId, channelName) {
        if (!voiceChat) return;
        
        // Show loading status
        showVoiceControls(`Connecting to ${channelName}...`);
        
        try {
            await voiceChat.joinVoiceChannel(serverId, channelId);
            showVoiceControls(`Voice: ${channelName}`);
            
            // Update UI - keep current text channel selected if available
            const server = servers.find(s => s.id === serverId);
            if (server) {
                const firstTextChannel = server.channels.find(ch => ch.type === 'text');
                if (firstTextChannel && (!currentContext || currentContext.type !== 'server' || currentContext.serverId !== serverId)) {
                    selectChannel(serverId, firstTextChannel.id, firstTextChannel.name, firstTextChannel.type);
                }
            }
        } catch (error) {
            console.error('Failed to join voice channel:', error);
            hideVoiceControls();
            alert('Failed to join voice channel. Please check your microphone permissions.');
        }
    }
    
    async function startVoiceCall(friendUsername) {
        if (!voiceChat) return;
        
        showVoiceControls(`Calling ${friendUsername}...`);
        
        try {
            await voiceChat.startDirectCall(friendUsername);
        } catch (error) {
            console.error('Failed to start voice call:', error);
            hideVoiceControls();
            alert('Failed to start call. Please check your microphone permissions.');
        }
    }
    
    function handleIncomingCall(fromUsername) {
        incomingCallFrom = fromUsername;
        callerNameDisplay.textContent = `${fromUsername} is calling you...`;
        incomingCallModal.classList.remove('hidden');
        
        // Trigger notification
        if (notificationManager) {
            notificationManager.notifyIncomingCall(fromUsername);
        }
    }
    
    function showVoiceControls(statusText) {
        voiceStatusText.textContent = statusText;
        voiceControls.classList.remove('hidden');
        
        // Update mute button based on PTT mode
        if (voiceChat) {
            if (voiceChat.isPushToTalkEnabled) {
                muteBtn.textContent = '🔇';
                muteBtn.title = `Push-to-Talk (${voiceChat.pttKeyDisplayName})`;
            } else {
                muteBtn.textContent = voiceChat.isMuted ? '🔇' : '🎤';
                muteBtn.title = voiceChat.isMuted ? 'Unmute' : 'Mute';
            }
        }
        
        // Apply layout changes for call UI
        mainContainer.classList.add('in-voice-call');
        videoCallArea.classList.remove('hidden');
    }
    
    function hideVoiceControls() {
        voiceControls.classList.add('hidden');
        
        // Remove layout changes
        mainContainer.classList.remove('in-voice-call');
        videoCallArea.classList.add('hidden');
        
        // Clear video elements
        videoGrid.innerHTML = '';
        maximizedVideoContainer.innerHTML = '';
        maximizedVideoContainer.classList.add('hidden');
    }
    
    // Voice control event listeners
    muteBtn.addEventListener('click', () => {
        if (voiceChat) {
            // In PTT mode, clicking mute button should disable PTT
            if (voiceChat.isPushToTalkEnabled) {
                voiceChat.setPushToTalkEnabled(false);
                enablePushToTalkCheckbox.checked = false;
                pttKeybindGroup.style.display = 'none';
            }
            
            const muted = voiceChat.toggleMute();
            muteBtn.textContent = muted ? '🔇' : '🎤';
            muteBtn.title = muted ? 'Unmute' : 'Mute';
        }
    });
    
    videoBtn.addEventListener('click', async () => {
        if (voiceChat) {
            const enabled = await voiceChat.toggleVideo();
            videoBtn.textContent = enabled ? '📹✓' : '📹';
            videoBtn.title = enabled ? 'Stop Video' : 'Start Video';
        }
    });
    
    screenShareBtn.addEventListener('click', async () => {
        if (voiceChat) {
            if (voiceChat.isScreenSharing) {
                // Stop sharing
                const sharing = await voiceChat.toggleScreenShare();
                screenShareBtn.textContent = sharing ? '🖥️✓' : '🖥️';
                screenShareBtn.title = sharing ? 'Stop Sharing' : 'Share Screen';
            } else {
                // Show settings modal before starting
                screenShareSettingsModal.classList.remove('hidden');
            }
        }
    });
    
    micSettingsBtn.addEventListener('click', async () => {
        deviceSettingsModal.classList.remove('hidden');
        await populateDeviceSelects();
    });
    
    leaveVoiceBtn.addEventListener('click', () => {
        if (voiceChat) {
            if (voiceChat.inDirectCall) {
                voiceChat.endDirectCall();
            } else {
                voiceChat.leaveVoiceChannel();
            }
            hideVoiceControls();
            muteBtn.textContent = '🎤';
            muteBtn.title = 'Mute';
            videoBtn.textContent = '📹';
            videoBtn.title = 'Start Video';
            screenShareBtn.textContent = '🖥️';
            screenShareBtn.title = 'Share Screen';
            voiceParticipants.classList.add('hidden');
        }
    });
    
    acceptCallBtn.addEventListener('click', () => {
        if (incomingCallFrom && voiceChat) {
            voiceChat.acceptDirectCall(incomingCallFrom);
            showVoiceControls(`In call with ${incomingCallFrom}`);
            incomingCallModal.classList.add('hidden');
            incomingCallFrom = null;
            // Stop call notification sound
            if (notificationManager) {
                notificationManager.stopCallSound();
            }
        }
    });
    
    rejectCallBtn.addEventListener('click', () => {
        if (incomingCallFrom && voiceChat) {
            voiceChat.rejectDirectCall(incomingCallFrom);
            incomingCallModal.classList.add('hidden');
            incomingCallFrom = null;
            // Stop call notification sound
            if (notificationManager) {
                notificationManager.stopCallSound();
            }
        }
    });
    
    // Close incoming call modal on outside click
    incomingCallModal.addEventListener('click', (e) => {
        if (e.target === incomingCallModal) {
            if (incomingCallFrom && voiceChat) {
                voiceChat.rejectDirectCall(incomingCallFrom);
            }
            incomingCallModal.classList.add('hidden');
            incomingCallFrom = null;
            // Stop call notification sound
            if (notificationManager) {
                notificationManager.stopCallSound();
            }
        }
    });
    
    // Avatar settings
    menuAvatarBtn.addEventListener('click', () => {
        userMenu.classList.add('hidden');
        avatarSettingsModal.classList.remove('hidden');
    });
    
    closeAvatarModalBtn.addEventListener('click', () => {
        avatarSettingsModal.classList.add('hidden');
    });
    
    avatarSettingsModal.addEventListener('click', (e) => {
        if (e.target === avatarSettingsModal) {
            avatarSettingsModal.classList.add('hidden');
        }
    });
    
    // Avatar tabs switching
    const avatarTabs = document.querySelectorAll('.avatar-tab');
    const avatarTabContents = document.querySelectorAll('.avatar-tab-content');
    
    avatarTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const tabName = tab.dataset.tab;
            
            // Update active tab
            avatarTabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            
            // Show corresponding content
            avatarTabContents.forEach(content => {
                if (content.id === `avatar-tab-${tabName}`) {
                    content.classList.remove('hidden');
                } else {
                    content.classList.add('hidden');
                }
            });
        });
    });
    
    // Handle emoji avatar selection
    avatarPicker.addEventListener('click', (e) => {
        if (e.target.classList.contains('avatar-option')) {
            const selectedAvatar = e.target.dataset.avatar;
            
            // Update UI
            document.querySelectorAll('.avatar-option').forEach(btn => {
                btn.classList.remove('selected');
            });
            e.target.classList.add('selected');
            
            // Check if WebSocket is connected
            if (!ws || ws.readyState !== WebSocket.OPEN) {
                alert('Connection error. Please refresh the page and try again.');
                return;
            }
            
            if (!authenticated) {
                alert('Please wait for authentication to complete before changing your avatar.');
                return;
            }
            
            // Send to server
            ws.send(JSON.stringify({
                type: 'set_avatar',
                avatar_type: 'emoji',
                avatar: selectedAvatar
            }));
        }
    });
    
    // Handle custom image avatar upload
    const avatarFileInput = document.getElementById('avatar-file-input');
    const selectFileBtn = document.getElementById('select-file-btn');
    const uploadAvatarBtn = document.getElementById('upload-avatar-btn');
    const removeAvatarBtn = document.getElementById('remove-avatar-btn');
    const avatarPreview = document.getElementById('avatar-preview');
    const avatarPreviewImg = document.getElementById('avatar-preview-img');
    
    let selectedAvatarFile = null;
    
    selectFileBtn.addEventListener('click', () => {
        avatarFileInput.click();
    });
    
    avatarFileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            // Validate file size (2MB max)
            if (file.size > 2 * 1024 * 1024) {
                alert('File too large. Maximum size is 2MB.');
                return;
            }
            
            // Validate file type
            if (!file.type.match(/image\/(png|jpeg|jpg|gif)/)) {
                alert('Invalid file type. Please select a PNG, JPG, or GIF image.');
                return;
            }
            
            selectedAvatarFile = file;
            
            // Show preview
            const reader = new FileReader();
            reader.onload = (e) => {
                avatarPreviewImg.src = e.target.result;
                avatarPreview.classList.remove('hidden');
                uploadAvatarBtn.classList.remove('hidden');
            };
            reader.readAsDataURL(file);
        }
    });
    
    uploadAvatarBtn.addEventListener('click', () => {
        if (selectedAvatarFile) {
            // Check if WebSocket is connected
            if (!ws || ws.readyState !== WebSocket.OPEN) {
                alert('Connection error. Please refresh the page and try again.');
                return;
            }
            
            if (!authenticated) {
                alert('Please wait for authentication to complete before uploading your avatar.');
                return;
            }
            
            const reader = new FileReader();
            reader.onload = (e) => {
                const base64Data = e.target.result;
                
                // Send to server
                ws.send(JSON.stringify({
                    type: 'set_avatar',
                    avatar_type: 'image',
                    avatar_data: base64Data
                }));
                
                uploadAvatarBtn.classList.add('hidden');
                removeAvatarBtn.classList.remove('hidden');
            };
            reader.readAsDataURL(selectedAvatarFile);
        }
    });
    
    removeAvatarBtn.addEventListener('click', () => {
        // Reset to default emoji avatar
        ws.send(JSON.stringify({
            type: 'set_avatar',
            avatar_type: 'emoji',
            avatar: '👤'
        }));
        
        // Reset UI
        avatarPreview.classList.add('hidden');
        uploadAvatarBtn.classList.add('hidden');
        removeAvatarBtn.classList.add('hidden');
        avatarFileInput.value = '';
        selectedAvatarFile = null;
    });
    
    // Device settings
    closeDeviceSettingsModalBtn.addEventListener('click', () => {
        deviceSettingsModal.classList.add('hidden');
    });
    
    testMicrophoneBtn.addEventListener('click', async () => {
        micTestStatus.textContent = 'Testing microphone...';
        micTestStatus.style.color = '#7289da';
        
        try {
            const constraints = {
                audio: microphoneSelect.value ? { deviceId: { exact: microphoneSelect.value } } : true
            };
            
            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            micTestStatus.textContent = '✓ Microphone working! Permission granted.';
            micTestStatus.style.color = '#43b581';
            
            // Stop the test stream
            stream.getTracks().forEach(track => track.stop());
            
            // Refresh device list in case permissions just granted
            await populateDeviceSelects();
        } catch (error) {
            console.error('Microphone test failed:', error);
            micTestStatus.textContent = `✗ Error: ${error.name} - ${error.message}`;
            micTestStatus.style.color = '#f04747';
            
            if (error.name === 'NotAllowedError') {
                micTestStatus.textContent = '✗ Permission denied. Click the lock icon in your address bar to allow microphone access.';
            } else if (error.name === 'NotFoundError') {
                micTestStatus.textContent = '✗ No microphone found. Please connect a microphone.';
            }
        }
    });
    
    deviceSettingsModal.addEventListener('click', (e) => {
        if (e.target === deviceSettingsModal) {
            deviceSettingsModal.classList.add('hidden');
        }
    });
    
    microphoneSelect.addEventListener('change', async (e) => {
        if (voiceChat) {
            await voiceChat.setMicrophone(e.target.value);
        }
    });
    
    speakerSelect.addEventListener('change', async (e) => {
        if (voiceChat) {
            await voiceChat.setSpeaker(e.target.value);
        }
    });
    
    cameraSelect.addEventListener('change', async (e) => {
        if (voiceChat) {
            await voiceChat.setCamera(e.target.value);
        }
    });
    
    // Notification settings
    menuNotificationsBtn.addEventListener('click', () => {
        userMenu.classList.add('hidden');
        notificationSettingsModal.classList.remove('hidden');
        
        // Load current settings
        if (notificationManager) {
            enableNotificationsCheckbox.checked = notificationManager.notificationsEnabled;
            enableNotificationSoundsCheckbox.checked = notificationManager.soundsEnabled;
            notificationModeSelect.value = notificationManager.notificationMode;
            messageSoundSelect.value = notificationManager.messageSound;
            callSoundSelect.value = notificationManager.callSound;
        }
    });
    
    closeNotificationSettingsModalBtn.addEventListener('click', () => {
        notificationSettingsModal.classList.add('hidden');
    });
    
    notificationSettingsModal.addEventListener('click', (e) => {
        if (e.target === notificationSettingsModal) {
            notificationSettingsModal.classList.add('hidden');
        }
    });
    
    enableNotificationsCheckbox.addEventListener('change', (e) => {
        if (notificationManager) {
            notificationManager.setNotificationsEnabled(e.target.checked);
        }
    });
    
    enableNotificationSoundsCheckbox.addEventListener('change', (e) => {
        if (notificationManager) {
            notificationManager.setSoundsEnabled(e.target.checked);
        }
    });
    
    notificationModeSelect.addEventListener('change', (e) => {
        if (notificationManager) {
            notificationManager.setNotificationMode(e.target.value);
            
            // Send to server to persist the setting
            if (ws && ws.readyState === WebSocket.OPEN && authenticated) {
                ws.send(JSON.stringify({
                    type: 'set_notification_mode',
                    notification_mode: e.target.value
                }));
            }
        }
    });
    
    messageSoundSelect.addEventListener('change', (e) => {
        if (notificationManager) {
            notificationManager.setMessageSound(e.target.value);
        }
    });
    
    callSoundSelect.addEventListener('change', (e) => {
        if (notificationManager) {
            notificationManager.setCallSound(e.target.value);
        }
    });
    
    testMessageSoundBtn.addEventListener('click', () => {
        if (notificationManager) {
            notificationManager.playSound('message', messageSoundSelect.value);
        }
    });
    
    testCallSoundBtn.addEventListener('click', () => {
        if (notificationManager) {
            const CALL_SOUND_TEST_DURATION = 3000; // 3 seconds
            notificationManager.playSound('call', callSoundSelect.value);
            // Stop the call sound after a short duration for testing
            setTimeout(() => {
                if (notificationManager) {
                    notificationManager.stopCallSound();
                }
            }, CALL_SOUND_TEST_DURATION);
        }
    });
    
    // Voice settings handlers
    menuVoiceSettingsBtn.addEventListener('click', () => {
        userMenu.classList.add('hidden');
        voiceSettingsModal.classList.remove('hidden');
        
        // Load current settings
        if (voiceChat) {
            enablePushToTalkCheckbox.checked = voiceChat.isPushToTalkEnabled;
            pttKeybindDisplay.value = voiceChat.pttKeyDisplayName;
            
            // Show/hide keybind group based on PTT enabled state
            pttKeybindGroup.style.display = voiceChat.isPushToTalkEnabled ? 'block' : 'none';
        }
    });
    
    closeVoiceSettingsModalBtn.addEventListener('click', () => {
        voiceSettingsModal.classList.add('hidden');
    });
    
    voiceSettingsModal.addEventListener('click', (e) => {
        if (e.target === voiceSettingsModal) {
            voiceSettingsModal.classList.add('hidden');
        }
    });
    
    enablePushToTalkCheckbox.addEventListener('change', (e) => {
        if (voiceChat) {
            voiceChat.setPushToTalkEnabled(e.target.checked);
            
            // Show/hide keybind group
            pttKeybindGroup.style.display = e.target.checked ? 'block' : 'none';
            
            // Update mute button if in a call (use the globally defined muteBtn variable)
            if (muteBtn && !voiceControls.classList.contains('hidden')) {
                if (e.target.checked) {
                    muteBtn.textContent = '🔇';
                    muteBtn.title = `Push-to-Talk (${voiceChat.pttKeyDisplayName})`;
                } else {
                    muteBtn.textContent = voiceChat.isMuted ? '🔇' : '🎤';
                    muteBtn.title = voiceChat.isMuted ? 'Unmute' : 'Mute';
                }
            }
        }
    });
    
    // Keybind recording state
    let isRecordingKeybind = false;
    
    // Helper function to get a user-friendly display name for a keyboard key
    function getKeyDisplayName(event) {
        if (event.code.startsWith('Key')) {
            return event.code.substring(3); // Remove "Key" prefix
        } else if (event.code.startsWith('Digit')) {
            return event.code.substring(5); // Remove "Digit" prefix
        } else if (event.key === ' ') {
            return 'Space';
        } else if (event.key.length === 1) {
            return event.key.toUpperCase();
        } else {
            return event.code;
        }
    }
    
    setPttKeybindBtn.addEventListener('click', () => {
        if (!isRecordingKeybind) {
            isRecordingKeybind = true;
            setPttKeybindBtn.textContent = 'Press any key...';
            setPttKeybindBtn.classList.add('btn-primary');
            pttKeybindDisplay.value = 'Press any key...';
        }
    });
    
    // Global keydown handler for keybind recording
    document.addEventListener('keydown', (e) => {
        // Handle keybind recording
        if (isRecordingKeybind) {
            e.preventDefault();
            e.stopPropagation();
            
            // Get a friendly name for the key
            const keyDisplayName = getKeyDisplayName(e);
            
            // Save the keybind
            if (voiceChat) {
                voiceChat.setPushToTalkKey(e.code, keyDisplayName);
                pttKeybindDisplay.value = keyDisplayName;
            }
            
            // Reset recording state
            isRecordingKeybind = false;
            setPttKeybindBtn.textContent = 'Change Key';
            setPttKeybindBtn.classList.remove('btn-primary');
            return;
        }
        
        // Handle push-to-talk when not recording
        // handlePushToTalkKeyDown checks internally if PTT is enabled and user is in a call
        // Don't trigger PTT when typing in message input
        if (voiceChat && document.activeElement !== messageInput && voiceChat.handlePushToTalkKeyDown(e)) {
            // Prevent default action to avoid key triggering other actions
            e.preventDefault();
        }
    });
    
    // Global keyup handler for push-to-talk
    document.addEventListener('keyup', (e) => {
        if (!isRecordingKeybind && voiceChat && document.activeElement !== messageInput) {
            if (voiceChat.handlePushToTalkKeyUp(e)) {
                // Prevent default action
                e.preventDefault();
            }
        }
    });
    
    // Profile settings handlers
    menuProfileBtn.addEventListener('click', () => {
        userMenu.classList.add('hidden');
        profileSettingsModal.classList.remove('hidden');
        
        // Load current profile data from user's data
        // These will be populated from the init message
        // Always initialize fields to avoid stale values if currentUserProfile is missing
        statusMessageInput.value = (window.currentUserProfile && window.currentUserProfile.status_message) || '';
        bioInput.value = (window.currentUserProfile && window.currentUserProfile.bio) || '';
    });
    
    closeProfileModalBtn.addEventListener('click', () => {
        profileSettingsModal.classList.add('hidden');
    });
    
    profileSettingsModal.addEventListener('click', (e) => {
        if (e.target === profileSettingsModal) {
            profileSettingsModal.classList.add('hidden');
        }
    });
    
    saveProfileBtn.addEventListener('click', () => {
        const bio = bioInput.value.trim();
        const statusMessage = statusMessageInput.value.trim();
        
        // Check if WebSocket is connected
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            alert('Connection error. Please refresh the page and try again.');
            return;
        }
        
        if (!authenticated) {
            alert('Please wait for authentication to complete before updating your profile.');
            return;
        }
        
        // Send update to server
        ws.send(JSON.stringify({
            type: 'update_profile',
            bio: bio,
            status_message: statusMessage
        }));
        
        // Close modal
        profileSettingsModal.classList.add('hidden');
    });
    
    // Screen share settings modal handlers
    startScreenShareBtn.addEventListener('click', async () => {
        if (voiceChat) {
            const resolution = screenResolutionSelect.value;
            const framerate = screenFramerateSelect.value;
            
            // Start screen sharing with selected settings
            const sharing = await voiceChat.toggleScreenShare(resolution, framerate);
            screenShareBtn.textContent = sharing ? '🖥️✓' : '🖥️';
            screenShareBtn.title = sharing ? 'Stop Sharing' : 'Share Screen';
            
            // Close modal
            screenShareSettingsModal.classList.add('hidden');
        }
    });
    
    cancelScreenShareBtn.addEventListener('click', () => {
        screenShareSettingsModal.classList.add('hidden');
    });
    
    screenShareSettingsModal.addEventListener('click', (e) => {
        if (e.target === screenShareSettingsModal) {
            screenShareSettingsModal.classList.add('hidden');
        }
    });
    
    // Populate device selects
    async function populateDeviceSelects() {
        if (!voiceChat) return;
        
        const devices = await voiceChat.getMediaDevices();
        
        // Clear existing options (except default)
        microphoneSelect.innerHTML = '<option value="">Default</option>';
        speakerSelect.innerHTML = '<option value="">Default</option>';
        cameraSelect.innerHTML = '<option value="">Default</option>';
        
        // Add microphones
        devices.microphones.forEach(device => {
            const option = document.createElement('option');
            option.value = device.deviceId;
            option.textContent = device.label || `Microphone ${device.deviceId.substring(0, 8)}`;
            if (device.deviceId === voiceChat.selectedMicrophoneId) {
                option.selected = true;
            }
            microphoneSelect.appendChild(option);
        });
        
        // Add speakers (if supported)
        devices.speakers.forEach(device => {
            const option = document.createElement('option');
            option.value = device.deviceId;
            option.textContent = device.label || `Speaker ${device.deviceId.substring(0, 8)}`;
            if (device.deviceId === voiceChat.selectedSpeakerId) {
                option.selected = true;
            }
            speakerSelect.appendChild(option);
        });
        
        // Add cameras
        devices.cameras.forEach(device => {
            const option = document.createElement('option');
            option.value = device.deviceId;
            option.textContent = device.label || `Camera ${device.deviceId.substring(0, 8)}`;
            if (device.deviceId === voiceChat.selectedCameraId) {
                option.selected = true;
            }
            cameraSelect.appendChild(option);
        });
    }
    
    // Update voice participants panel
    function updateVoiceParticipants(members) {
        if (!members || members.length === 0) {
            voiceParticipants.classList.add('hidden');
            participantsList.innerHTML = '';
            return;
        }
        
        voiceParticipants.classList.remove('hidden');
        participantsList.innerHTML = '';
        
        members.forEach(member => {
            const memberUsername = typeof member === 'object' ? member.username : member;
            const muted = typeof member === 'object' ? member.muted : false;
            const video = typeof member === 'object' ? member.video : false;
            const screenSharing = typeof member === 'object' ? member.screen_sharing : false;
            
            const participantItem = document.createElement('div');
            participantItem.className = 'participant-item';
            
            const avatarEl = createAvatarElement(member, 'participant-avatar');
            
            const infoDiv = document.createElement('div');
            infoDiv.className = 'participant-info';
            
            const nameSpan = document.createElement('span');
            nameSpan.className = 'participant-name';
            nameSpan.textContent = memberUsername;
            
            const statusDiv = document.createElement('div');
            statusDiv.className = 'participant-status';
            
            // Microphone status
            const micStatus = document.createElement('span');
            micStatus.className = 'status-indicator' + (muted ? ' muted' : '');
            micStatus.textContent = muted ? '🔇' : '🎤';
            micStatus.title = muted ? 'Muted' : 'Unmuted';
            statusDiv.appendChild(micStatus);
            
            // Video status
            if (video) {
                const videoStatus = document.createElement('span');
                videoStatus.className = 'status-indicator';
                videoStatus.textContent = '📹';
                videoStatus.title = 'Video On';
                statusDiv.appendChild(videoStatus);
            }
            
            // Screen sharing status
            if (screenSharing) {
                const screenStatus = document.createElement('span');
                screenStatus.className = 'status-indicator';
                screenStatus.textContent = '🖥️';
                screenStatus.title = 'Sharing Screen';
                statusDiv.appendChild(screenStatus);
            }
            
            infoDiv.appendChild(nameSpan);
            infoDiv.appendChild(statusDiv);
            
            participantItem.appendChild(avatarEl);
            participantItem.appendChild(infoDiv);
            
            participantsList.appendChild(participantItem);
        });
    }
    
    // Toggle members sidebar
    toggleMembersBtn.addEventListener('click', () => {
        isMembersSidebarCollapsed = !isMembersSidebarCollapsed;
        if (isMembersSidebarCollapsed) {
            rightSidebar.classList.add('collapsed');
            toggleMembersBtn.textContent = '▶';
            toggleMembersBtn.title = 'Expand';
        } else {
            rightSidebar.classList.remove('collapsed');
            toggleMembersBtn.textContent = '◀';
            toggleMembersBtn.title = 'Collapse';
        }
    });
    
    // Maximize/minimize video functionality
    const MAXIMIZE_ICON = '⛶';
    let currentMaximizedVideo = null;
    
    function maximizeVideo(videoElement, username, isScreenShare) {
        // Prevent multiple maximizations
        if (currentMaximizedVideo) {
            minimizeVideo();
        }
        
        // Clone the video element
        const clonedVideo = videoElement.cloneNode(true);
        clonedVideo.srcObject = videoElement.srcObject;
        
        // Clear and populate maximized container
        maximizedVideoContainer.innerHTML = '';
        
        const label = document.createElement('div');
        label.className = 'video-label';
        label.textContent = isScreenShare ? `${username} (Screen)` : username;
        label.style.fontSize = '18px';
        label.style.padding = '10px 20px';
        
        maximizedVideoContainer.appendChild(clonedVideo);
        maximizedVideoContainer.appendChild(label);
        maximizedVideoContainer.appendChild(minimizeVideoBtn);
        maximizedVideoContainer.classList.remove('hidden');
        
        currentMaximizedVideo = { videoElement, username, isScreenShare };
    }
    
    function minimizeVideo() {
        maximizedVideoContainer.classList.add('hidden');
        maximizedVideoContainer.innerHTML = '';
        currentMaximizedVideo = null;
    }
    
    // Minimize video button event
    minimizeVideoBtn.addEventListener('click', minimizeVideo);
    
    // Handle remote video tracks
    window.onRemoteVideoTrack = function(username, stream, isScreenShare = false) {
        // Remove existing video for this user
        const existingVideo = document.getElementById(`video-${username}`);
        if (existingVideo) {
            existingVideo.remove();
        }
        
        // Create video element
        const videoContainer = document.createElement('div');
        videoContainer.className = 'video-container';
        videoContainer.id = `video-${username}`;
        
        // Mark as screen share for priority display
        if (isScreenShare) {
            videoContainer.classList.add('screen-share');
        }
        
        const video = document.createElement('video');
        video.srcObject = stream;
        video.autoplay = true;
        video.playsInline = true;
        
        const label = document.createElement('div');
        label.className = 'video-label';
        label.textContent = isScreenShare ? `${username} (Screen)` : username;
        
        const maximizeBtn = document.createElement('button');
        maximizeBtn.className = 'maximize-btn';
        maximizeBtn.textContent = MAXIMIZE_ICON;
        maximizeBtn.title = 'Maximize';
        maximizeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            maximizeVideo(video, username, isScreenShare);
        });
        
        videoContainer.appendChild(video);
        videoContainer.appendChild(label);
        videoContainer.appendChild(maximizeBtn);
        
        // Add toggle button if both video and screenshare are active
        // The toggle button will be added/updated by updateVideoToggleButton function
        
        // Add click to maximize on the whole container
        videoContainer.addEventListener('click', () => {
            maximizeVideo(video, username, isScreenShare);
        });
        
        // Insert screen shares at the beginning for priority
        if (isScreenShare) {
            videoGrid.insertBefore(videoContainer, videoGrid.firstChild);
        } else {
            videoGrid.appendChild(videoContainer);
        }
        
        // Update grid layout based on video count
        updateVideoGridLayout();
        
        // Check if toggle button should be shown
        updateVideoToggleButton(username);
    };
    
    // Handle local video track (when user enables their own camera or screen share)
    window.onLocalVideoTrack = function(stream, isScreenShare = false) {
        // Remove existing local video preview if it exists
        const existingVideo = document.getElementById('video-local');
        if (existingVideo) {
            existingVideo.remove();
        }
        
        if (stream) {
            // Create video element for local preview
            const videoContainer = document.createElement('div');
            videoContainer.className = 'video-container';
            videoContainer.id = 'video-local';
            
            // Add screen-share class for screen shares to apply priority display styling
            if (isScreenShare) {
                videoContainer.classList.add('screen-share');
            }
            
            const video = document.createElement('video');
            video.srcObject = stream;
            video.autoplay = true;
            video.playsInline = true;
            video.muted = true; // Mute local preview to avoid feedback
            
            const label = document.createElement('div');
            label.className = 'video-label';
            label.textContent = isScreenShare ? `${username} (Your Screen)` : `${username} (You)`;
            
            const maximizeBtn = document.createElement('button');
            maximizeBtn.className = 'maximize-btn';
            maximizeBtn.textContent = MAXIMIZE_ICON;
            maximizeBtn.title = 'Maximize';
            maximizeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                maximizeVideo(video, username, isScreenShare);
            });
            
            videoContainer.appendChild(video);
            videoContainer.appendChild(label);
            videoContainer.appendChild(maximizeBtn);
            
            // Add click to maximize on the whole container
            videoContainer.addEventListener('click', () => {
                maximizeVideo(video, username, isScreenShare);
            });
            
            videoGrid.appendChild(videoContainer);
            
            // Update grid layout
            updateVideoGridLayout();
        } else {
            // Update grid layout after removing video
            updateVideoGridLayout();
        }
    };
    
    // Update video grid layout based on number of videos
    function updateVideoGridLayout() {
        const videoCount = videoGrid.querySelectorAll('.video-container:not(.screen-share)').length;
        
        // Remove all grid classes
        videoGrid.classList.remove('grid-2', 'grid-3');
        
        // Add appropriate grid class based on count
        if (videoCount >= 5) {
            videoGrid.classList.add('grid-3');
        } else if (videoCount >= 2) {
            videoGrid.classList.add('grid-2');
        }
        // 1 video or 0 videos uses default single column
    }
    
    // Update or add toggle button for switching between video and screenshare
    function updateVideoToggleButton(username) {
        if (!voiceChat) return;
        
        const hasVideo = voiceChat.remoteVideoEnabled.get(username) || false;
        const hasScreenShare = voiceChat.remoteScreenSharing.get(username) || false;
        const videoContainer = document.getElementById(`video-${username}`);
        
        if (!videoContainer) return;
        
        // Check if both video and screenshare are active
        const bothActive = hasVideo && hasScreenShare;
        
        // Remove existing toggle button if present
        const existingToggleBtn = videoContainer.querySelector('.toggle-video-btn');
        if (existingToggleBtn) {
            existingToggleBtn.remove();
        }
        
        if (bothActive) {
            // Add toggle button
            const toggleBtn = document.createElement('button');
            toggleBtn.className = 'toggle-video-btn';
            // Use tracked state instead of CSS class to determine current view
            const isShowingScreen = voiceChat.remoteShowingScreen.get(username) ?? DEFAULT_SCREEN_SHARE_PRIORITY;
            toggleBtn.textContent = isShowingScreen ? '📹 Show Camera' : '🖥️ Show Screen';
            toggleBtn.title = isShowingScreen ? 'Switch to camera view' : 'Switch to screen share';
            toggleBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                // Get current state dynamically each time button is clicked
                const currentShowingScreen = voiceChat.remoteShowingScreen.get(username) ?? DEFAULT_SCREEN_SHARE_PRIORITY;
                const newShowScreen = !currentShowingScreen;
                voiceChat.switchVideoSource(username, newShowScreen);
            });
            
            videoContainer.appendChild(toggleBtn);
        }
    }
    
    // Update video source display when user switches between camera and screen
    function updateVideoSourceDisplay(username, showingScreen) {
        const videoContainer = document.getElementById(`video-${username}`);
        if (!videoContainer) return;
        
        const label = videoContainer.querySelector('.video-label');
        
        // Update container class and label based on what's being shown
        if (showingScreen) {
            videoContainer.classList.add('screen-share');
            if (label) label.textContent = `${username} (Screen)`;
        } else {
            videoContainer.classList.remove('screen-share');
            if (label) label.textContent = username;
        }
        
        // Update toggle button text
        const toggleBtn = videoContainer.querySelector('.toggle-video-btn');
        if (toggleBtn) {
            toggleBtn.textContent = showingScreen ? '📹 Show Camera' : '🖥️ Show Screen';
            toggleBtn.title = showingScreen ? 'Switch to camera view' : 'Switch to screen share';
        }
    }
    
    // Scroll to bottom of messages
    function scrollToBottom() {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
    
    // Escape HTML to prevent XSS
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    // ========== Rich Embeds Functions ==========
    
    // URL regex to detect links in messages
    const URL_REGEX = /(https?:\/\/[^\s]+)/gi;
    
    // Image extensions
    const IMAGE_EXTENSIONS = /\.(jpg|jpeg|png|gif|webp|bmp|svg)(\?[^\s]*)?$/i;
    
    // Video extensions
    const VIDEO_EXTENSIONS = /\.(mp4|webm|ogg|mov)(\?[^\s]*)?$/i;
    
    // YouTube URL patterns - requires https:// to match URL_REGEX
    const YOUTUBE_REGEX = /https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/i;
    
    /**
     * Detect if a URL is an image
     */
    function isImageUrl(url) {
        return IMAGE_EXTENSIONS.test(url);
    }
    
    /**
     * Detect if a URL is a video
     */
    function isVideoUrl(url) {
        return VIDEO_EXTENSIONS.test(url);
    }
    
    /**
     * Extract YouTube video ID from URL
     */
    function getYouTubeVideoId(url) {
        const match = url.match(YOUTUBE_REGEX);
        return match ? match[1] : null;
    }
    
    /**
     * Sanitize a URL used in message embeds to allow only http/https.
     * Returns a safe, normalized URL string or null if the URL is not allowed.
     */
    function sanitizeEmbedUrl(rawUrl) {
        if (typeof rawUrl !== 'string') {
            return null;
        }
        try {
            const urlObj = new URL(rawUrl, window.location.origin);
            const protocol = urlObj.protocol.toLowerCase();
            if (protocol === 'http:' || protocol === 'https:') {
                return urlObj.toString();
            }
            return null;
        } catch (e) {
            return null;
        }
    }
    
    // Sanitize image sources for custom emojis to prevent XSS
    function sanitizeImageSrc(raw) {
        if (typeof raw !== 'string') {
            return null;
        }
        const value = raw.trim();
        if (!value) {
            return null;
        }
        // Allow data: URIs only for images
        if (value.startsWith('data:')) {
            // Basic check: data:[<mediatype>][;base64],...
            const commaIndex = value.indexOf(',');
            const header = commaIndex === -1 ? value : value.substring(0, commaIndex);
            // header like "data:image/png;base64"
            if (/^data:image\//i.test(header)) {
                return value;
            }
            return null;
        }
        // Allow same-origin URLs only
        try {
            const url = new URL(value, window.location.origin);
            if ((url.protocol === 'http:' || url.protocol === 'https:') && url.origin === window.location.origin) {
                return url.href;
            }
            return null;
        } catch (e) {
            // Invalid URL
            return null;
        }
    }
    
    /**
     * Create an image embed element
     */
    function createImageEmbed(url) {
        const embedDiv = document.createElement('div');
        embedDiv.className = 'embed embed-image';
        
        const img = document.createElement('img');
        img.src = url;
        img.alt = 'Embedded image';
        img.loading = 'lazy';
        
        // Add error handler in case image fails to load
        img.onerror = function() {
            embedDiv.innerHTML = `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="embed-link">🖼️ ${escapeHtml(url)}</a>`;
        };
        
        // Make image clickable to open in new tab
        const link = document.createElement('a');
        link.href = url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.appendChild(img);
        
        embedDiv.appendChild(link);
        return embedDiv;
    }
    
    /**
     * Create a video embed element
     */
    function createVideoEmbed(url) {
        const embedDiv = document.createElement('div');
        embedDiv.className = 'embed embed-video';
        
        const video = document.createElement('video');
        video.src = url;
        video.controls = true;
        video.preload = 'metadata';
        
        // Add error handler in case video fails to load
        video.onerror = function() {
            embedDiv.innerHTML = `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="embed-link">🎥 ${escapeHtml(url)}</a>`;
        };
        
        embedDiv.appendChild(video);
        return embedDiv;
    }
    
    /**
     * Create a YouTube embed element
     */
    function createYouTubeEmbed(videoId, url) {
        const embedDiv = document.createElement('div');
        embedDiv.className = 'embed embed-youtube';
        
        const iframe = document.createElement('iframe');
        iframe.src = `https://www.youtube.com/embed/${encodeURIComponent(videoId)}`;
        iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
        iframe.allowFullscreen = true;
        iframe.title = 'YouTube video';
        iframe.style.border = 'none';
        
        embedDiv.appendChild(iframe);
        return embedDiv;
    }
    
    /**
     * Create a link embed element for regular URLs
     */
    function createLinkEmbed(url) {
        const embedDiv = document.createElement('div');
        embedDiv.className = 'embed embed-link';
        
        const link = document.createElement('a');
        link.href = url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = url;
        
        embedDiv.appendChild(link);
        return embedDiv;
    }
    
    /**
     * Process message content and create embeds for URLs
     */
    function processMessageEmbeds(content) {
        const embeds = [];
        const urls = content.match(URL_REGEX);
        
        if (!urls) {
            return embeds;
        }
        
        // Track processed URLs to avoid duplicates
        const processedUrls = new Set();
        
        urls.forEach(url => {
            // Skip if already processed
            if (processedUrls.has(url)) {
                return;
            }
            processedUrls.add(url);

            // Sanitize the URL before creating any embeds
            const safeUrl = sanitizeEmbedUrl(url);
            if (!safeUrl) {
                return;
            }
            
            // Check for YouTube videos first
            const youtubeId = getYouTubeVideoId(safeUrl);
            if (youtubeId) {
                embeds.push(createYouTubeEmbed(youtubeId, safeUrl));
            }
            // Check for images
            else if (isImageUrl(safeUrl)) {
                embeds.push(createImageEmbed(safeUrl));
            }
            // Check for videos
            else if (isVideoUrl(safeUrl)) {
                embeds.push(createVideoEmbed(safeUrl));
            }
            // Regular link
            else {
                embeds.push(createLinkEmbed(safeUrl));
            }
        });
        
        return embeds;
    }
    
    /**
     * Make URLs in text clickable
     */
    function linkifyText(text) {
        const escapedText = escapeHtml(text);
        return escapedText.replace(URL_REGEX, (url) => {
            const safeUrl = sanitizeEmbedUrl(url);
            // If the URL is not safe, render it as plain, already-escaped text
            if (!safeUrl) {
                return escapeHtml(url);
            }
            const escapedHref = escapeHtml(safeUrl);
            const escapedLabel = escapeHtml(safeUrl);
            return `<a href="${escapedHref}" target="_blank" rel="noopener noreferrer" class="message-link">${escapedLabel}</a>`;
        });
    }
    
    // ========== Custom Emoji and Reaction Functions ==========
    
    // Render reactions for a message
    function renderReactions(messageId, reactions, container) {
        container.innerHTML = '';
        
        // Group reactions by emoji
        const reactionGroups = {};
        reactions.forEach(reaction => {
            const key = reaction.emoji;
            if (!reactionGroups[key]) {
                reactionGroups[key] = {
                    emoji: reaction.emoji,
                    emoji_type: reaction.emoji_type,
                    users: [],
                    count: 0
                };
            }
            reactionGroups[key].users.push(reaction.username);
            reactionGroups[key].count++;
        });
        
        // Create reaction buttons
        Object.values(reactionGroups).forEach(group => {
            const reactionBtn = document.createElement('button');
            reactionBtn.className = 'reaction-item';
            
            const userReacted = group.users.includes(username);
            if (userReacted) {
                reactionBtn.classList.add('user-reacted');
            }
            
            const emojiSpan = document.createElement('span');
            emojiSpan.className = 'reaction-emoji';
            
            if (group.emoji_type === 'custom') {
                // Find custom emoji data
                let emojiData = null;
                for (const serverId in customEmojis) {
                    const emoji = customEmojis[serverId].find(e => e.emoji_id === group.emoji);
                    if (emoji) {
                        emojiData = emoji;
                        break;
                    }
                }
                if (emojiData) {
                    const safeSrc = sanitizeImageSrc(emojiData.image_data);
                    if (safeSrc) {
                        const img = document.createElement('img');
                        img.src = safeSrc;
                        img.alt = emojiData.name;
                        emojiSpan.appendChild(img);
                    } else {
                        // Fallback to text emoji if the image source is not safe
                        emojiSpan.textContent = group.emoji;
                    }
                } else {
                    emojiSpan.textContent = group.emoji;
                }
            } else {
                emojiSpan.textContent = group.emoji;
            }
            
            const countSpan = document.createElement('span');
            countSpan.className = 'reaction-count';
            countSpan.textContent = group.count;
            
            reactionBtn.appendChild(emojiSpan);
            reactionBtn.appendChild(countSpan);
            reactionBtn.title = group.users.join(', ');
            
            reactionBtn.onclick = () => {
                if (userReacted) {
                    removeReaction(messageId, group.emoji);
                } else {
                    addReaction(messageId, group.emoji, group.emoji_type);
                }
            };
            
            container.appendChild(reactionBtn);
        });
        
        // Re-add the add reaction button
        const addReactionBtn = document.createElement('button');
        addReactionBtn.className = 'add-reaction-btn';
        addReactionBtn.textContent = '➕';
        addReactionBtn.title = 'Add reaction';
        addReactionBtn.onclick = () => openEmojiPicker(messageId);
        container.appendChild(addReactionBtn);
    }
    
    // Add reaction to a message
    function addReaction(messageId, emoji, emojiType = 'standard') {
        ws.send(JSON.stringify({
            type: 'add_reaction',
            message_id: messageId,
            emoji: emoji,
            emoji_type: emojiType
        }));
    }
    
    // Remove reaction from a message
    function removeReaction(messageId, emoji) {
        ws.send(JSON.stringify({
            type: 'remove_reaction',
            message_id: messageId,
            emoji: emoji
        }));
    }
    
    // Load custom emojis for a server
    function loadServerEmojis(serverId) {
        ws.send(JSON.stringify({
            type: 'get_server_emojis',
            server_id: serverId
        }));
    }
    
    // Display custom emojis in server settings
    function displayServerEmojis(emojis) {
        serverEmojisList.innerHTML = '';
        
        if (emojis.length === 0) {
            serverEmojisList.innerHTML = '<p class="empty-state">No custom emojis yet. Upload one to get started!</p>';
            return;
        }
        
        emojis.forEach(emoji => {
            const emojiItem = document.createElement('div');
            emojiItem.className = 'custom-emoji-item';
            
            const img = document.createElement('img');
            const safeSrc = sanitizeImageSrc(emoji.image_data);
            if (safeSrc) {
                img.src = safeSrc;
            } else {
                console.warn('Discarding unsafe emoji image source', emoji.image_data);
            }
            img.alt = emoji.name;
            
            const nameDiv = document.createElement('div');
            nameDiv.className = 'custom-emoji-name';
            nameDiv.textContent = `:${emoji.name}:`;
            
            const uploaderDiv = document.createElement('div');
            uploaderDiv.className = 'custom-emoji-uploader';
            uploaderDiv.textContent = `by ${emoji.uploader}`;
            
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'custom-emoji-delete';
            deleteBtn.textContent = 'Delete';
            deleteBtn.onclick = () => deleteCustomEmoji(emoji.emoji_id);
            
            emojiItem.appendChild(img);
            emojiItem.appendChild(nameDiv);
            emojiItem.appendChild(uploaderDiv);
            
            // Only show delete button for server owner or uploader
            const currentServer = servers.find(s => s.id === currentlySelectedServer);
            if (currentServer && (currentServer.owner === username || emoji.uploader === username)) {
                emojiItem.appendChild(deleteBtn);
            }
            
            serverEmojisList.appendChild(emojiItem);
        });
    }
    
    function deleteCustomEmoji(emojiId) {
        if (confirm('Are you sure you want to delete this emoji?')) {
            ws.send(JSON.stringify({
                type: 'delete_custom_emoji',
                emoji_id: emojiId
            }));
        }
    }
    
    // ========== Roles Management Functions ==========
    
    console.log('Setting up roles management listeners');
    console.log('openRolesManagerBtn:', openRolesManagerBtn);
    console.log('rolesModal:', rolesModal);
    console.log('rolesList:', rolesList);
    
    // Open roles manager
    openRolesManagerBtn.addEventListener('click', () => {
        console.log('Roles button clicked, currentlySelectedServer:', currentlySelectedServer);
        if (!currentlySelectedServer) return;
        
        // Request roles from server
        console.log('Sending get_server_roles request');
        ws.send(JSON.stringify({
            type: 'get_server_roles',
            server_id: currentlySelectedServer
        }));
        
        serverSettingsModal.classList.add('hidden');
        rolesModal.classList.remove('hidden');
        console.log('Roles modal should be visible now');
    });
    
    // Close roles modal
    closeRolesModalBtn.addEventListener('click', () => {
        rolesModal.classList.add('hidden');
        cancelRoleEdit();
    });
    
    // Display roles list
    function displayRolesList() {
        console.log('displayRolesList called with:', serverRoles);
        console.log('rolesList element:', rolesList);
        console.log('Number of roles:', serverRoles.length);
        rolesList.innerHTML = '';
        
        if (serverRoles.length === 0) {
            console.log('No roles to display');
            return;
        }
        
        serverRoles.forEach((role, index) => {
            console.log(`Creating role item ${index}:`, role);
            const roleItem = document.createElement('div');
            roleItem.className = 'role-item';
            roleItem.dataset.roleId = role.role_id;
            
            const colorDot = document.createElement('div');
            colorDot.className = 'role-color-dot';
            colorDot.style.background = role.color;
            
            const roleName = document.createElement('span');
            roleName.className = 'role-item-name';
            roleName.textContent = role.name;
            
            roleItem.appendChild(colorDot);
            roleItem.appendChild(roleName);
            
            roleItem.addEventListener('click', () => {
                // Remove active from all
                document.querySelectorAll('.role-item').forEach(r => r.classList.remove('active'));
                roleItem.classList.add('active');
                loadRoleForEditing(role);
            });
            
            rolesList.appendChild(roleItem);
            console.log(`Added role item to list:`, roleItem);
        });
        
        console.log('Final rolesList children:', rolesList.children.length);
    }
    
    // Create new role
    createRoleBtn.addEventListener('click', () => {
        console.log('Create role button clicked');
        isCreatingNewRole = true;
        currentEditingRole = {
            name: '',
            color: '#99AAB5',
            permissions: {}
        };
        
        // Show edit form
        roleEditor.classList.add('hidden');
        roleEditForm.classList.remove('hidden');
        
        // Reset form
        roleNameInput.value = '';
        roleColorInput.value = '#99AAB5';
        roleColorPreview.style.background = '#99AAB5';
        roleColorPreview.textContent = 'Preview';
        
        // Clear all permissions
        document.querySelectorAll('.permission-checkbox').forEach(cb => cb.checked = false);
        
        // Clear members list
        roleMembersList.innerHTML = '<p style="color: #72767d; font-size: 12px;">No members yet</p>';
        
        // Hide delete button for new role
        deleteRoleBtn.style.display = 'none';
        assignRoleBtn.style.display = 'none';
    });
    
    // Load role for editing
    function loadRoleForEditing(role) {
        isCreatingNewRole = false;
        currentEditingRole = role;
        
        // Show edit form
        roleEditor.classList.add('hidden');
        roleEditForm.classList.remove('hidden');
        
        // Populate form
        roleNameInput.value = role.name;
        roleColorInput.value = role.color;
        roleColorPreview.style.background = role.color;
        roleColorPreview.textContent = role.name;
        
        // Set permissions
        document.querySelectorAll('.permission-checkbox').forEach(cb => {
            const permission = cb.dataset.permission;
            cb.checked = role.permissions[permission] || false;
        });
        
        // Load members
        loadRoleMembersList(role.role_id);
        
        // Show delete and assign buttons
        deleteRoleBtn.style.display = 'inline-block';
        assignRoleBtn.style.display = 'inline-block';
    }
    
    // Load role members list
    function loadRoleMembersList(roleId) {
        // Request members with this role
        ws.send(JSON.stringify({
            type: 'get_server_members',
            server_id: currentlySelectedServer
        }));
        
        // The response will populate server members, then we filter by role
        // For now, show placeholder
        roleMembersList.innerHTML = '<p style="color: #72767d; font-size: 12px;">Loading members...</p>';
    }
    
    // Update color preview when color changes
    roleColorInput.addEventListener('input', (e) => {
        roleColorPreview.style.background = e.target.value;
        if (roleNameInput.value) {
            roleColorPreview.textContent = roleNameInput.value;
        }
    });
    
    roleNameInput.addEventListener('input', (e) => {
        if (e.target.value) {
            roleColorPreview.textContent = e.target.value;
        } else {
            roleColorPreview.textContent = 'Preview';
        }
    });
    
    // Save role
    saveRoleBtn.addEventListener('click', () => {
        console.log('Save role button clicked');
        const name = roleNameInput.value.trim();
        if (!name) {
            alert('Please enter a role name');
            return;
        }
        
        const color = roleColorInput.value;
        const permissions = {};
        
        // Collect permissions
        document.querySelectorAll('.permission-checkbox').forEach(cb => {
            permissions[cb.dataset.permission] = cb.checked;
        });
        
        if (isCreatingNewRole) {
            // Create new role
            console.log('Sending create_role message:', { name, color, permissions });
            ws.send(JSON.stringify({
                type: 'create_role',
                server_id: currentlySelectedServer,
                name: name,
                color: color,
                permissions: permissions
            }));
        } else {
            // Update existing role
            ws.send(JSON.stringify({
                type: 'update_role',
                role_id: currentEditingRole.role_id,
                name: name,
                color: color,
                permissions: permissions
            }));
        }
        
        cancelRoleEdit();
    });
    
    // Delete role
    deleteRoleBtn.addEventListener('click', () => {
        if (!currentEditingRole || !currentEditingRole.role_id) return;
        
        if (confirm(`Are you sure you want to delete the role "${currentEditingRole.name}"?`)) {
            ws.send(JSON.stringify({
                type: 'delete_role',
                role_id: currentEditingRole.role_id
            }));
        }
    });
    
    // Cancel role edit
    function cancelRoleEdit() {
        isCreatingNewRole = false;
        currentEditingRole = null;
        roleEditor.classList.remove('hidden');
        roleEditForm.classList.add('hidden');
        
        // Deselect all role items
        document.querySelectorAll('.role-item').forEach(r => r.classList.remove('active'));
    }
    
    cancelRoleBtn.addEventListener('click', cancelRoleEdit);
    
    // Assign role to members
    assignRoleBtn.addEventListener('click', () => {
        if (!currentEditingRole) return;
        
        // Get server members
        ws.send(JSON.stringify({
            type: 'get_server_members',
            server_id: currentlySelectedServer
        }));
        
        assignRoleModal.classList.remove('hidden');
        loadAvailableMembers();
    });
    
    // Load available members for role assignment
    function loadAvailableMembers() {
        // This will be populated when we receive server members
        availableMembersList.innerHTML = '<p style="color: #72767d;">Loading members...</p>';
    }
    
    // Close assign modal
    closeAssignModalBtn.addEventListener('click', () => {
        assignRoleModal.classList.add('hidden');
    });
    
    // Populate available members when server members are loaded
    window.populateAvailableMembersForRole = function(members) {
        if (!currentEditingRole) return;
        
        availableMembersList.innerHTML = '';
        
        members.forEach(member => {
            const memberItem = document.createElement('div');
            memberItem.className = 'available-member-item';
            
            const nameSpan = document.createElement('span');
            nameSpan.textContent = member.username;
            
            const addBtn = document.createElement('button');
            addBtn.className = 'add-member-btn';
            addBtn.textContent = 'Add to Role';
            
            addBtn.addEventListener('click', () => {
                ws.send(JSON.stringify({
                    type: 'assign_role',
                    server_id: currentlySelectedServer,
                    username: member.username,
                    role_id: currentEditingRole.role_id
                }));
                
                addBtn.disabled = true;
                addBtn.textContent = 'Added';
            });
            
            memberItem.appendChild(nameSpan);
            memberItem.appendChild(addBtn);
            availableMembersList.appendChild(memberItem);
        });
    };
    
    // Announcement banner handling
    const announcementBanner = document.getElementById('announcement-banner');
    const announcementText = document.getElementById('announcement-text');
    const closeAnnouncementBtn = document.getElementById('close-announcement');
    const ANNOUNCEMENT_DISMISSED_KEY = 'announcement_dismissed';
    let currentAnnouncementData = null; // Store current announcement data
    
    // Only set up announcement handling if elements exist
    if (!announcementBanner || !announcementText || !closeAnnouncementBtn) {
        console.warn('Announcement banner elements not found in DOM');
    }
    
    function handleAnnouncementUpdate(data) {
        if (!announcementBanner || !announcementText) {
            return; // Elements not available
        }
        
        currentAnnouncementData = data; // Store for later use when dismissing
        
        if (!data.enabled || !data.message) {
            hideAnnouncement();
            return;
        }
        
        // Check if announcement has expired
        if (data.set_at && data.duration_minutes) {
            const setAt = new Date(data.set_at);
            const expiresAt = new Date(setAt.getTime() + data.duration_minutes * 60000);
            const now = new Date();
            
            if (now > expiresAt) {
                hideAnnouncement();
                return;
            }
        }
        
        // Check if user has dismissed this specific announcement
        const dismissedData = localStorage.getItem(ANNOUNCEMENT_DISMISSED_KEY);
        if (dismissedData) {
            try {
                const dismissed = JSON.parse(dismissedData);
                // Check if this is the same announcement that was dismissed
                // Handle both null and defined set_at values
                const isSameMessage = dismissed.message === data.message;
                const isSameTimestamp = (dismissed.set_at === data.set_at) || 
                                       (dismissed.set_at === null && data.set_at === null);
                
                if (isSameMessage && isSameTimestamp) {
                    hideAnnouncement();
                    return;
                }
            } catch (e) {
                // Invalid JSON, ignore
            }
        }
        
        // Show announcement
        announcementText.textContent = data.message;
        announcementBanner.classList.remove('hidden');
        document.body.classList.add('announcement-visible');
    }
    
    function hideAnnouncement() {
        if (!announcementBanner) return;
        announcementBanner.classList.add('hidden');
        document.body.classList.remove('announcement-visible');
    }
    
    if (closeAnnouncementBtn) {
        closeAnnouncementBtn.addEventListener('click', () => {
            if (!currentAnnouncementData) return;
            
            // Store dismissal in localStorage
            try {
                localStorage.setItem(ANNOUNCEMENT_DISMISSED_KEY, JSON.stringify({
                    message: currentAnnouncementData.message,
                    set_at: currentAnnouncementData.set_at,
                    dismissed_at: new Date().toISOString()
                }));
            } catch (e) {
                console.error('Failed to store announcement dismissal:', e);
            }
        
            hideAnnouncement();
        });
    }
    
    // Mobile menu functionality
    const MOBILE_BREAKPOINT = 768; // px - matches CSS media query
    const MOBILE_SIDEBAR_CLOSE_DELAY = 100; // ms - allows click event to complete before sidebar closes
    
    const mobileMenuToggle = document.getElementById('mobile-menu-toggle');
    const mobileOverlay = document.getElementById('mobile-overlay');
    const leftSidebar = document.getElementById('left-sidebar');
    const middleSidebar = document.getElementById('middle-sidebar');
    
    // Track which sidebar is currently open on mobile
    let currentMobileSidebar = null;
    
    function closeMobileSidebars() {
        if (leftSidebar) leftSidebar.classList.remove('mobile-visible');
        if (middleSidebar) middleSidebar.classList.remove('mobile-visible');
        if (mobileOverlay) mobileOverlay.classList.remove('active');
        currentMobileSidebar = null;
        
        // Update aria-expanded attribute
        if (mobileMenuToggle) {
            mobileMenuToggle.setAttribute('aria-expanded', 'false');
        }
    }
    
    function openMobileSidebar(sidebar) {
        closeMobileSidebars();
        if (sidebar) {
            sidebar.classList.add('mobile-visible');
            if (mobileOverlay) mobileOverlay.classList.add('active');
            currentMobileSidebar = sidebar;
            
            // Update aria-expanded attribute
            if (mobileMenuToggle) {
                mobileMenuToggle.setAttribute('aria-expanded', 'true');
            }
        }
    }
    
    if (mobileMenuToggle) {
        mobileMenuToggle.addEventListener('click', (e) => {
            // Smart sidebar selection for mobile navigation:
            // - If no sidebar is visible, show left sidebar (servers) first
            // - If left sidebar (servers) is currently visible, switch to middle sidebar (channels)
            // - If middle sidebar (channels) is currently visible, switch back to left sidebar (servers)
            // This creates a toggle behavior: hamburger menu -> servers -> channels -> servers...
            if (!currentMobileSidebar) {
                openMobileSidebar(leftSidebar);
            } else if (currentMobileSidebar === leftSidebar) {
                openMobileSidebar(middleSidebar);
            } else if (currentMobileSidebar === middleSidebar) {
                openMobileSidebar(leftSidebar);
            } else {
                // Fallback: if for some reason currentMobileSidebar is something else, default to servers
                openMobileSidebar(leftSidebar);
            }
        });
    }
    
    if (mobileOverlay) {
        mobileOverlay.addEventListener('click', closeMobileSidebars);
        
        // Keyboard support for overlay (Enter/Space keys)
        mobileOverlay.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                // Prevent default for Space to avoid scrolling
                if (e.key === ' ') {
                    e.preventDefault();
                }
                closeMobileSidebars();
            }
        });
    }
    
    // Allow closing mobile sidebars with the Escape key for keyboard users
    document.addEventListener('keydown', (e) => {
        // Only act on Escape and when a mobile sidebar is currently open
        if ((e.key === 'Escape' || e.key === 'Esc') && currentMobileSidebar) {
            closeMobileSidebars();
        }
    });
    
    // Close mobile sidebar when selecting an item
    function setupMobileClose() {
        // Close when clicking server/channel/DM items
        document.addEventListener('click', (e) => {
            // Skip if clicking the mobile menu toggle button
            if (mobileMenuToggle && (e.target === mobileMenuToggle || mobileMenuToggle.contains(e.target))) {
                return;
            }
            
            // Only close if we're on mobile and a sidebar is currently open
            const isMobile = window.innerWidth <= MOBILE_BREAKPOINT;
            if (isMobile && currentMobileSidebar && e.target.closest('.server-item, .channel-item, .dm-item, .friend-item')) {
                // Delay ensures navigation completes before closing; prevents race conditions
                setTimeout(closeMobileSidebars, MOBILE_SIDEBAR_CLOSE_DELAY);
            }
        });
    }
    
    setupMobileClose();
    
    // Update mobile menu behavior based on screen size
    function updateMobileMenu() {
        const isMobile = window.innerWidth <= MOBILE_BREAKPOINT;
        if (!isMobile) {
            closeMobileSidebars();
        }
    }
    
    // Debounce helper to prevent excessive resize event calls
    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }
    
    // Debounce resize handler to improve performance
    window.addEventListener('resize', debounce(updateMobileMenu, 150));
    updateMobileMenu();
    
    
    console.log('chat.js: About to call connect()');
    // Initialize connection
    connect();
})();

// Chat page JavaScript with Servers, DMs, and Friends support
(function() {
    console.log('chat.js loaded and executing');
    // Check if user is authenticated
    const username = sessionStorage.getItem('username');
    const password = sessionStorage.getItem('password');
    const authMode = sessionStorage.getItem('authMode');
    const inviteCode = sessionStorage.getItem('inviteCode');
    
    if (!username || !password || !authMode) {
        window.location.href = '/static/index.html';
        return;
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
    
    // DOM elements
    const messagesContainer = document.getElementById('messages');
    const messageForm = document.getElementById('message-form');
    const messageInput = document.getElementById('message-input');
    const submitBtn = messageForm.querySelector('button[type="submit"]');
    const chatTitle = document.getElementById('chat-title');
    
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
    
    // Voice participants panel
    const voiceParticipants = document.getElementById('voice-participants');
    const participantsList = document.getElementById('participants-list');
    const remoteVideos = document.getElementById('remote-videos');
    const closeParticipantsBtn = document.getElementById('close-participants-btn');
    
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
    const messageSoundSelect = document.getElementById('message-sound-select');
    const callSoundSelect = document.getElementById('call-sound-select');
    const testMessageSoundBtn = document.getElementById('test-message-sound-btn');
    const testCallSoundBtn = document.getElementById('test-call-sound-btn');
    
    // Right sidebar (members list) elements
    const rightSidebar = document.getElementById('right-sidebar');
    const toggleMembersBtn = document.getElementById('toggle-members-btn');
    const serverMembersDisplay = document.getElementById('server-members-display');
    
    let incomingCallFrom = null;
    let currentlySelectedServer = null;
    let currentAvatar = '👤';
    let isMembersSidebarCollapsed = false;
    
    // Roles management state
    let serverRoles = [];
    let currentEditingRole = null;
    let isCreatingNewRole = false;
    
    // Initialize notification manager
    let notificationManager = null;
    if (window.NotificationManager) {
        notificationManager = new NotificationManager();
        notificationManager.init();
    }
    
    // Connect to WebSocket
    function connect() {
        ws = new WebSocket(wsUrl);
        
        ws.onopen = () => {
            console.log('WebSocket connected');
            authenticate();
        };
        
        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            handleMessage(data);
        };
        
        ws.onerror = (error) => {
            console.error('WebSocket error:', error);
            appendSystemMessage('Connection error. Please refresh the page.');
        };
        
        ws.onclose = () => {
            console.log('WebSocket disconnected');
            if (authenticated) {
                appendSystemMessage('Disconnected from server. Attempting to reconnect...');
                setTimeout(connect, 3000);
            }
        };
    }
    
    // Helper function to create avatar element
    function createAvatarElement(avatarData, className = 'user-avatar') {
        const avatarEl = document.createElement('span');
        avatarEl.className = className;
        
        if (avatarData && avatarData.avatar_type === 'image' && avatarData.avatar_data) {
            // Image avatar
            const img = document.createElement('img');
            img.src = avatarData.avatar_data;
            img.alt = 'Avatar';
            avatarEl.appendChild(img);
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
            img.src = avatarData.avatar_data;
            img.alt = 'Avatar';
            element.appendChild(img);
        } else {
            // Emoji avatar
            element.textContent = (avatarData && avatarData.avatar) || '👤';
        }
    }
    
    // Authenticate with server
    function authenticate() {
        const authData = {
            type: authMode,
            username: username,
            password: password
        };
        
        if (authMode === 'signup') {
            authData.invite_code = inviteCode || '';
        }
        
        ws.send(JSON.stringify(authData));
    }
    
    // Handle incoming messages
    function handleMessage(data) {
        switch (data.type) {
            case 'auth_success':
                authenticated = true;
                console.log('Authentication successful');
                // Keep credentials in sessionStorage to allow reconnection after container restarts
                // NOTE: Password is stored in sessionStorage (set by auth.js during login).
                // While not ideal for security, it's necessary for WebSocket reconnection.
                // TODO: Consider implementing token-based authentication for better security.
                // sessionStorage.removeItem('password');
                // sessionStorage.removeItem('authMode');
                sessionStorage.removeItem('inviteCode');
                // Initialize voice chat
                voiceChat = new VoiceChat(ws, username);
                // Check if user is admin
                ws.send(JSON.stringify({type: 'check_admin'}));
                break;
                
            case 'auth_error':
                authenticated = false;
                alert('Authentication failed: ' + data.message);
                logout();
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
                
            case 'server_invite_code':
                showServerInviteCode(data.code);
                break;
                
            case 'server_members':
                displayServerMembers(data.members, data.server_id);
                // Also update the sidebar if we're viewing this server
                if (currentlySelectedServer === data.server_id) {
                    displayServerMembersInSidebar(data.members);
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
                // Show error in join server modal if it's open
                if (!joinServerModal.classList.contains('hidden')) {
                    joinServerError.textContent = data.message;
                    joinServerError.classList.remove('hidden');
                } else {
                    alert(data.message);
                }
                break;
            
            case 'admin_status':
                // Show or hide admin config menu item based on admin status
                if (data.is_admin) {
                    menuAdminBtn.classList.remove('hidden');
                } else {
                    menuAdminBtn.classList.add('hidden');
                }
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
            
            case 'voice_video_update':
                // Update video state in participants list
                if (voiceChat && voiceChat.currentVoiceChannel) {
                    const currentKey = `${voiceChat.currentVoiceServer}/${voiceChat.currentVoiceChannel}`;
                    if (voiceMembers[currentKey]) {
                        const participant = voiceMembers[currentKey].find(p => 
                            (typeof p === 'object' ? p.username : p) === data.username
                        );
                        if (participant && typeof participant === 'object') {
                            participant.video = data.video;
                            updateVoiceParticipants(voiceMembers[currentKey]);
                        }
                    }
                }
                break;
            
            case 'voice_screen_share_update':
                // Update screen sharing state in participants list
                if (voiceChat && voiceChat.currentVoiceChannel) {
                    const currentKey = `${voiceChat.currentVoiceServer}/${voiceChat.currentVoiceChannel}`;
                    if (voiceMembers[currentKey]) {
                        const participant = voiceMembers[currentKey].find(p => 
                            (typeof p === 'object' ? p.username : p) === data.username
                        );
                        if (participant && typeof participant === 'object') {
                            participant.screen_sharing = data.screen_sharing;
                            updateVoiceParticipants(voiceMembers[currentKey]);
                        }
                    }
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
            serverItem.textContent = server.name;
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
                
                const nameSpan = document.createElement('span');
                nameSpan.textContent = friendUsername;
                
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
                friendItem.appendChild(nameSpan);
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
        
        const isOwnMessage = msg.username === username;
        if (isOwnMessage) {
            messageDiv.classList.add('own');
        } else {
            messageDiv.classList.add('other');
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
        contentWrapper.innerHTML = `
            <div class="message-header">
                <span class="message-username ${isOwnMessage ? 'own' : 'other'}">${escapeHtml(msg.username)}</span>
                <span class="message-time">${timestamp}</span>
            </div>
            <div class="message-content">${escapeHtml(msg.content)}</div>
        `;
        
        messageDiv.appendChild(avatarEl);
        messageDiv.appendChild(contentWrapper);
        messagesContainer.appendChild(messageDiv);
        console.log('Message appended to container');
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
        
        const message = messageInput.value.trim();
        if (!message || !authenticated) {
            console.log('Cannot send message - empty or not authenticated');
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
        ws.send(JSON.stringify(msgData));
        messageInput.value = '';
    });
    
    // User menu toggle
    userMenuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        userMenu.classList.toggle('hidden');
    });
    
    // Close menu when clicking outside
    document.addEventListener('click', (e) => {
        if (!userMenu.contains(e.target) && e.target !== userMenuBtn) {
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
                
                const permissions = ['can_create_channel', 'can_edit_channel', 'can_delete_channel'];
                const permLabels = {
                    'can_create_channel': 'Create',
                    'can_edit_channel': 'Edit',
                    'can_delete_channel': 'Delete'
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
        const currentPerms = {
            can_create_channel: false,
            can_edit_channel: false,
            can_delete_channel: false
        };
        
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
        if (!authenticated) return;
        
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
    
    // Admin config (from menu)
    menuAdminBtn.addEventListener('click', () => {
        window.location.href = '/static/adminconfig.html';
    });
    
    function logout() {
        // Clean up voice chat
        if (voiceChat) {
            voiceChat.leaveVoiceChannel();
            voiceChat.endDirectCall();
        }
        
        sessionStorage.clear();
        if (ws) {
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
    }
    
    function hideVoiceControls() {
        voiceControls.classList.add('hidden');
    }
    
    // Voice control event listeners
    muteBtn.addEventListener('click', () => {
        if (voiceChat) {
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
            const sharing = await voiceChat.toggleScreenShare();
            screenShareBtn.textContent = sharing ? '🖥️✓' : '🖥️';
            screenShareBtn.title = sharing ? 'Stop Sharing' : 'Share Screen';
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
    
    // Close voice participants panel
    closeParticipantsBtn.addEventListener('click', () => {
        voiceParticipants.classList.add('hidden');
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
    // Handle remote video tracks
    window.onRemoteVideoTrack = function(username, stream) {
        // Remove existing video for this user
        const existingVideo = document.getElementById(`video-${username}`);
        if (existingVideo) {
            existingVideo.remove();
        }
        
        // Create video element
        const videoContainer = document.createElement('div');
        videoContainer.className = 'remote-video-container';
        videoContainer.id = `video-${username}`;
        
        const video = document.createElement('video');
        video.srcObject = stream;
        video.autoplay = true;
        video.playsInline = true;
        
        const label = document.createElement('div');
        label.className = 'remote-video-label';
        label.textContent = username;
        
        videoContainer.appendChild(video);
        videoContainer.appendChild(label);
        remoteVideos.appendChild(videoContainer);
    };
    
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
    
    console.log('chat.js: About to call connect()');
    // Initialize connection
    connect();
})();

// Chat page JavaScript with Servers, DMs, and Friends support
(function() {
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
    const menuCreateVoiceChannelBtn = document.getElementById('menu-create-voice-channel-btn');
    const menuInviteBtn = document.getElementById('menu-invite-btn');
    const menuLogoutBtn = document.getElementById('menu-logout-btn');
    const menuFriendsBtn = document.getElementById('menu-friends-btn');
    const searchUsersBtn = document.getElementById('search-users-btn');
    
    // Modal elements
    const inviteModal = document.getElementById('invite-modal');
    const inviteCodeText = document.getElementById('invite-code-text');
    const closeInviteModalBtn = document.getElementById('close-invite-modal');
    
    const createServerModal = document.getElementById('create-server-modal');
    const createServerForm = document.getElementById('create-server-form');
    const serverNameInput = document.getElementById('server-name-input');
    const cancelServerBtn = document.getElementById('cancel-server-btn');
    
    const createVoiceChannelModal = document.getElementById('create-voice-channel-modal');
    const createVoiceChannelForm = document.getElementById('create-voice-channel-form');
    const voiceChannelNameInput = document.getElementById('voice-channel-name-input');
    const cancelVoiceChannelBtn = document.getElementById('cancel-voice-channel-btn');
    
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
    const serverMembersList = document.getElementById('server-members-list');
    
    // Voice elements
    const voiceControls = document.getElementById('voice-controls');
    const voiceStatusText = document.getElementById('voice-status-text');
    const muteBtn = document.getElementById('mute-btn');
    const leaveVoiceBtn = document.getElementById('leave-voice-btn');
    const incomingCallModal = document.getElementById('incoming-call-modal');
    const callerNameDisplay = document.getElementById('caller-name');
    const acceptCallBtn = document.getElementById('accept-call-btn');
    const rejectCallBtn = document.getElementById('reject-call-btn');
    let incomingCallFrom = null;
    let currentlySelectedServer = null;
    
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
                sessionStorage.removeItem('password');
                sessionStorage.removeItem('authMode');
                sessionStorage.removeItem('inviteCode');
                // Initialize voice chat
                voiceChat = new VoiceChat(ws, username);
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
                if (isMessageForCurrentContext(data)) {
                    appendMessage(data);
                    scrollToBottom();
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
                break;
                
            case 'friend_added':
                if (!friends.includes(data.username)) {
                    friends.push(data.username);
                    updateFriendsList();
                }
                break;
                
            case 'friend_removed':
                friends = friends.filter(f => f !== data.username);
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
                alert(data.message);
                break;
                
            // Voice chat messages
            case 'voice_channel_created':
                const server = servers.find(s => s.id === data.server_id);
                if (server) {
                    server.channels.push(data.channel);
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
            
            dmItem.appendChild(nameSpan);
            dmItem.appendChild(callBtn);
            dmItem.onclick = () => selectDM(dm.id);
            dmsList.appendChild(dmItem);
        });
    }
    
    // Update friends list
    function updateFriendsList() {
        friendsList.innerHTML = '';
        friends.forEach(friend => {
            const friendItem = document.createElement('div');
            friendItem.className = 'friend-item';
            
            const nameSpan = document.createElement('span');
            nameSpan.textContent = friend;
            
            const actionsDiv = document.createElement('div');
            actionsDiv.className = 'friend-actions';
            
            const callBtn = document.createElement('button');
            callBtn.className = 'btn btn-small btn-success btn-icon';
            callBtn.textContent = '📞';
            callBtn.title = 'Voice Call';
            callBtn.onclick = () => startVoiceCall(friend);
            
            const dmBtn = document.createElement('button');
            dmBtn.className = 'btn btn-small btn-primary btn-icon';
            dmBtn.textContent = 'DM';
            dmBtn.onclick = () => startDM(friend);
            
            actionsDiv.appendChild(callBtn);
            actionsDiv.appendChild(dmBtn);
            friendItem.appendChild(nameSpan);
            friendItem.appendChild(actionsDiv);
            friendsList.appendChild(friendItem);
        });
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
        
        messageDiv.innerHTML = `
            <div class="message-header">
                <span class="message-username ${isOwnMessage ? 'own' : 'other'}">${escapeHtml(msg.username)}</span>
                <span class="message-time">${timestamp}</span>
            </div>
            <div class="message-content">${escapeHtml(msg.content)}</div>
        `;
        
        messagesContainer.appendChild(messageDiv);
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
    
    createServerForm.addEventListener('submit', (e) => {
        e.preventDefault();
        
        const serverName = serverNameInput.value.trim();
        if (!serverName) return;
        
        ws.send(JSON.stringify({
            type: 'create_server',
            name: serverName
        }));
    });
    
    cancelServerBtn.addEventListener('click', () => {
        createServerModal.classList.add('hidden');
        serverNameInput.value = '';
    });
    
    // Create voice channel (from menu)
    menuCreateVoiceChannelBtn.addEventListener('click', () => {
        userMenu.classList.add('hidden');
        
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
            type: 'create_voice_channel',
            server_id: currentlySelectedServer,
            name: channelName
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
    
    function showServerInviteCode(code) {
        serverInviteCodeText.textContent = code;
        serverInviteDisplay.classList.remove('hidden');
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
            
            const usernameSpan = document.createElement('span');
            usernameSpan.className = 'username';
            usernameSpan.textContent = result.username;
            
            resultItem.appendChild(usernameSpan);
            
            if (result.is_friend) {
                const badge = document.createElement('span');
                badge.className = 'badge';
                badge.textContent = 'Friend';
                resultItem.appendChild(badge);
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
    
    // Add friend
    function addFriend(friendUsername, button) {
        ws.send(JSON.stringify({
            type: 'add_friend',
            username: friendUsername
        }));
        button.disabled = true;
        button.textContent = 'Added!';
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
    
    // Logout (from menu)
    menuLogoutBtn.addEventListener('click', logout);
    
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
    function joinVoiceChannel(serverId, channelId, channelName) {
        if (!voiceChat) return;
        
        voiceChat.joinVoiceChannel(serverId, channelId);
        showVoiceControls(`Voice: ${channelName}`);
        
        // Update UI - keep current text channel selected if available
        const server = servers.find(s => s.id === serverId);
        if (server) {
            const firstTextChannel = server.channels.find(ch => ch.type === 'text');
            if (firstTextChannel && (!currentContext || currentContext.type !== 'server' || currentContext.serverId !== serverId)) {
                selectChannel(serverId, firstTextChannel.id, firstTextChannel.name, firstTextChannel.type);
            }
        }
    }
    
    function startVoiceCall(friendUsername) {
        if (!voiceChat) return;
        
        voiceChat.startDirectCall(friendUsername);
        showVoiceControls(`Calling ${friendUsername}...`);
    }
    
    function handleIncomingCall(fromUsername) {
        incomingCallFrom = fromUsername;
        callerNameDisplay.textContent = `${fromUsername} is calling you...`;
        incomingCallModal.classList.remove('hidden');
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
        }
    });
    
    acceptCallBtn.addEventListener('click', () => {
        if (incomingCallFrom && voiceChat) {
            voiceChat.acceptDirectCall(incomingCallFrom);
            showVoiceControls(`In call with ${incomingCallFrom}`);
            incomingCallModal.classList.add('hidden');
            incomingCallFrom = null;
        }
    });
    
    rejectCallBtn.addEventListener('click', () => {
        if (incomingCallFrom && voiceChat) {
            voiceChat.rejectDirectCall(incomingCallFrom);
            incomingCallModal.classList.add('hidden');
            incomingCallFrom = null;
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
        }
    });
    
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
    
    // Initialize connection
    connect();
})();

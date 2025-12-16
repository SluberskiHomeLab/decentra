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
    
    // Current context
    let currentContext = null; // {type: 'server'|'dm'|'global', id: server_id/channel_id or dm_id}
    let servers = [];
    let dms = [];
    let friends = [];
    
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
    
    const searchUsersModal = document.getElementById('search-users-modal');
    const searchUsersInput = document.getElementById('search-users-input');
    const searchResults = document.getElementById('search-results');
    const closeSearchModalBtn = document.getElementById('close-search-modal');
    
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
            dmItem.textContent = dm.username;
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
            
            const dmBtn = document.createElement('button');
            dmBtn.className = 'btn btn-small btn-primary btn-icon';
            dmBtn.textContent = 'DM';
            dmBtn.onclick = () => startDM(friend);
            
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
        channelsList.innerHTML = '';
        
        server.channels.forEach(channel => {
            const channelItem = document.createElement('div');
            channelItem.className = 'channel-item';
            channelItem.textContent = '# ' + channel.name;
            channelItem.onclick = () => selectChannel(serverId, channel.id, channel.name);
            channelsList.appendChild(channelItem);
        });
        
        // Auto-select first channel
        if (server.channels.length > 0) {
            selectChannel(serverId, server.channels[0].id, server.channels[0].name);
        }
    }
    
    // Select channel
    function selectChannel(serverId, channelId, channelName) {
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
    
    // Logout (from menu)
    menuLogoutBtn.addEventListener('click', logout);
    
    function logout() {
        sessionStorage.clear();
        if (ws) {
            ws.close();
        }
        window.location.href = '/static/index.html';
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
    
    // Initialize connection
    connect();
})();

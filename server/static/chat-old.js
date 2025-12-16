// Chat page JavaScript
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
    
    // DOM elements
    const messagesContainer = document.getElementById('messages');
    const messageForm = document.getElementById('message-form');
    const messageInput = document.getElementById('message-input');
    const inviteBtn = document.getElementById('invite-btn');
    const logoutBtn = document.getElementById('logout-btn');
    const inviteModal = document.getElementById('invite-modal');
    const inviteCodeText = document.getElementById('invite-code-text');
    const closeModalBtn = document.getElementById('close-modal');
    
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
                // Clear session storage
                sessionStorage.removeItem('password');
                sessionStorage.removeItem('authMode');
                sessionStorage.removeItem('inviteCode');
                break;
                
            case 'auth_error':
                authenticated = false;
                alert('Authentication failed: ' + data.message);
                logout();
                break;
                
            case 'history':
                if (data.messages && data.messages.length > 0) {
                    appendHistoryDivider();
                    data.messages.forEach(msg => appendMessage(msg));
                    scrollToBottom();
                }
                break;
                
            case 'message':
                appendMessage(data);
                scrollToBottom();
                break;
                
            case 'system':
                appendSystemMessage(data.content);
                break;
                
            case 'invite_code':
                showInviteModal(data.code);
                break;
        }
    }
    
    // Append history divider
    function appendHistoryDivider() {
        const divider = document.createElement('div');
        divider.className = 'history-divider';
        divider.textContent = 'Message History';
        messagesContainer.appendChild(divider);
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
        
        const msgData = {
            type: 'message',
            content: message
        };
        
        ws.send(JSON.stringify(msgData));
        messageInput.value = '';
    });
    
    // Generate invite code
    inviteBtn.addEventListener('click', () => {
        if (!authenticated) {
            return;
        }
        
        const inviteData = {
            type: 'generate_invite'
        };
        
        ws.send(JSON.stringify(inviteData));
    });
    
    // Show invite modal
    function showInviteModal(code) {
        inviteCodeText.textContent = code;
        inviteModal.classList.remove('hidden');
    }
    
    // Close modal
    closeModalBtn.addEventListener('click', () => {
        inviteModal.classList.add('hidden');
    });
    
    // Close modal on outside click
    inviteModal.addEventListener('click', (e) => {
        if (e.target === inviteModal) {
            inviteModal.classList.add('hidden');
        }
    });
    
    // Logout
    logoutBtn.addEventListener('click', logout);
    
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

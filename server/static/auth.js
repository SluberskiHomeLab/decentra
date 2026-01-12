// Authentication page JavaScript
(function() {
    const form = document.getElementById('auth-form');
    const loginBtn = document.getElementById('login-btn');
    const signupBtn = document.getElementById('signup-btn');
    const emailGroup = document.getElementById('email-group');
    const inviteGroup = document.getElementById('invite-group');
    const verificationGroup = document.getElementById('verification-group');
    const errorMessage = document.getElementById('error-message');
    
    let isSignupMode = false;
    let isVerificationMode = false;
    let pendingUsername = '';
    
    // Check if we need to show verification mode (redirected from chat.js)
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('verify') === 'true') {
        const storedUsername = sessionStorage.getItem('pendingUsername');
        if (storedUsername) {
            document.getElementById('username').value = storedUsername;
            switchToVerificationMode(storedUsername);
        }
    }
    
    // Toggle between login and signup
    signupBtn.addEventListener('click', () => {
        if (isVerificationMode) {
            // Reset from verification mode
            isVerificationMode = false;
            isSignupMode = false;
            pendingUsername = '';
            sessionStorage.removeItem('pendingUsername');
            resetToLogin();
            return;
        }
        
        isSignupMode = !isSignupMode;
        
        if (isSignupMode) {
            signupBtn.textContent = 'Switch to Login';
            signupBtn.classList.remove('btn-secondary');
            signupBtn.classList.add('btn-primary');
            loginBtn.textContent = 'Create Account';
            emailGroup.style.display = 'block';
            inviteGroup.style.display = 'block';
            document.getElementById('email').required = true;
        } else {
            resetToLogin();
        }
        
        hideError();
    });
    
    function resetToLogin() {
        signupBtn.textContent = 'Sign Up';
        signupBtn.classList.add('btn-secondary');
        signupBtn.classList.remove('btn-primary');
        loginBtn.textContent = 'Login';
        emailGroup.style.display = 'none';
        inviteGroup.style.display = 'none';
        verificationGroup.style.display = 'none';
        document.getElementById('email').required = false;
        document.getElementById('verification-code').required = false;
        
        // Show password field
        const passwordGroup = document.getElementById('password').parentElement;
        passwordGroup.style.display = 'block';
    }
    
    function switchToVerificationMode(username) {
        isVerificationMode = true;
        pendingUsername = username;
        loginBtn.textContent = 'Verify Email';
        signupBtn.textContent = 'Cancel';
        signupBtn.classList.add('btn-secondary');
        signupBtn.classList.remove('btn-primary');
        
        // Hide email, password, and invite fields
        emailGroup.style.display = 'none';
        inviteGroup.style.display = 'none';
        const passwordGroup = document.getElementById('password').parentElement;
        passwordGroup.style.display = 'none';
        
        // Show verification field
        verificationGroup.style.display = 'block';
        document.getElementById('verification-code').required = true;
        document.getElementById('verification-code').focus();
    }
    
    // Handle form submission
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const username = document.getElementById('username').value.trim();
        const email = document.getElementById('email').value.trim();
        const inviteCode = document.getElementById('invite-code').value.trim();
        const verificationCode = document.getElementById('verification-code').value.trim();
        let password = '';
        if (!isVerificationMode) {
            password = document.getElementById('password').value;
        }
        
        if (isVerificationMode) {
            // Handle verification code submission
            if (!verificationCode) {
                showError('Verification code is required');
                return;
            }
            
            // Authenticate via WebSocket before redirecting
            hideError();
            loginBtn.disabled = true;
            loginBtn.textContent = 'Verifying...';
            
            try {
                await authenticateAndRedirect('verify_email', pendingUsername, null, email, verificationCode, inviteCode);
            } catch (error) {
                showError(error.message || 'Verification failed');
                loginBtn.disabled = false;
                loginBtn.textContent = 'Verify Email';
            }
        } else if (isSignupMode) {
            // Handle signup
            if (!username || !password || !email) {
                showError('Username, password, and email are required');
                return;
            }
            
            // Authenticate via WebSocket before redirecting
            hideError();
            loginBtn.disabled = true;
            loginBtn.textContent = 'Creating Account...';
            
            try {
                await authenticateAndRedirect('signup', username, password, email, null, inviteCode);
            } catch (error) {
                showError(error.message || 'Signup failed');
                loginBtn.disabled = false;
                loginBtn.textContent = 'Create Account';
            }
        } else {
            // Handle login
            if (!username || !password) {
                showError('Username and password are required');
                return;
            }
            
            // Authenticate via WebSocket before redirecting
            hideError();
            loginBtn.disabled = true;
            loginBtn.textContent = 'Logging in...';
            
            try {
                await authenticateAndRedirect('login', username, password, null, null, inviteCode);
            } catch (error) {
                showError(error.message || 'Login failed');
                loginBtn.disabled = false;
                loginBtn.textContent = 'Login';
            }
        }
    });
    
    // Authenticate via WebSocket and redirect on success
    async function authenticateAndRedirect(authMode, username, password, email, verificationCode, inviteCode) {
        return new Promise((resolve, reject) => {
            // Connect to WebSocket
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsUrl = `${protocol}//${window.location.host}/ws`;
            const ws = new WebSocket(wsUrl);
            
            // Set a timeout for authentication
            const timeout = setTimeout(() => {
                ws.close();
                reject(new Error('Authentication timeout'));
            }, 10000); // 10 second timeout
            
            let authCompleted = false;
            
            ws.onopen = () => {
                // Send authentication request
                const authData = {
                    type: authMode,
                    username: username
                };
                
                if (authMode === 'signup') {
                    authData.password = password;
                    authData.email = email || '';
                    authData.invite_code = inviteCode || '';
                } else if (authMode === 'verify_email') {
                    authData.code = verificationCode;
                } else {
                    // login mode
                    authData.password = password;
                }
                
                ws.send(JSON.stringify(authData));
            };
            
            ws.onmessage = (event) => {
                clearTimeout(timeout);
                
                try {
                    const data = JSON.parse(event.data);
                    
                    if (data.type === 'auth_success') {
                        authCompleted = true;
                        // Store token and username for the chat page
                        if (data.token) {
                            sessionStorage.setItem('token', data.token);
                        }
                        sessionStorage.setItem('username', username);
                        
                        // Close WebSocket and redirect
                        ws.close();
                        window.location.href = '/static/chat.html';
                        resolve();
                    } else if (data.type === 'auth_error') {
                        authCompleted = true;
                        ws.close();
                        reject(new Error(data.message || 'Authentication failed'));
                    } else if (data.type === 'verification_required') {
                        authCompleted = true;
                        // Email verification is required
                        ws.close();
                        // Store username for verification flow
                        sessionStorage.setItem('pendingUsername', username);
                        // Show verification mode
                        switchToVerificationMode(username);
                        const baseMessage = data.message || 'Verification required';
                        const extraMessage = 'Please check your email and enter the verification code.';
                        const fullMessage = /[.!?]$/.test(baseMessage)
                            ? baseMessage + ' ' + extraMessage
                            : baseMessage + '. ' + extraMessage;
                        showError(fullMessage);
                        resolve(); // Resolve successfully since we're switching to verification mode
                    } else {
                        // Unexpected message type from server
                        authCompleted = true;
                        ws.close();
                        reject(new Error('Unexpected response from server: ' + String(data.type)));
                    }
                } catch (error) {
                    // Handle malformed JSON from server
                    authCompleted = true;
                    ws.close();
                    reject(new Error('Invalid response from server'));
                }
            };
            
            ws.onerror = (error) => {
                clearTimeout(timeout);
                ws.close();
                reject(new Error('Connection error. Please try again.'));
            };
            
            ws.onclose = (event) => {
                clearTimeout(timeout);
                // Only reject if connection closed without completing authentication
                if (!authCompleted && !event.wasClean) {
                    reject(new Error('Connection closed unexpectedly'));
                }
            };
        });
    }
    
    function showError(message) {
        errorMessage.textContent = message;
        errorMessage.classList.remove('hidden');
    }
    
    function hideError() {
        errorMessage.classList.add('hidden');
    }
})();

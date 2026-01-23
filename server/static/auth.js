// Authentication page JavaScript
(function() {
    const form = document.getElementById('auth-form');
    const loginBtn = document.getElementById('login-btn');
    const signupBtn = document.getElementById('signup-btn');
    const emailGroup = document.getElementById('email-group');
    const inviteGroup = document.getElementById('invite-group');
    const verificationGroup = document.getElementById('verification-group');
    const totpGroup = document.getElementById('totp-group');
    const passwordGroup = document.getElementById('password-group');
    const resetEmailGroup = document.getElementById('reset-email-group');
    const newPasswordGroup = document.getElementById('new-password-group');
    const forgotPasswordLink = document.getElementById('forgot-password-link');
    const forgotPasswordBtn = document.getElementById('forgot-password-btn');
    const errorMessage = document.getElementById('error-message');
    
    let isSignupMode = false;
    let isVerificationMode = false;
    let isPasswordResetMode = false;
    let isPasswordResetCompletionMode = false;
    let is2FAMode = false;
    let pendingUsername = '';
    let resetToken = '';
    
    // Check URL parameters for password reset token or verification
    const urlParams = new URLSearchParams(window.location.search);
    const resetTokenParam = urlParams.get('reset_token');
    
    if (resetTokenParam) {
        // User clicked on password reset link from email
        resetToken = resetTokenParam;
        switchToPasswordResetCompletionMode();
    } else if (urlParams.get('verify') === 'true') {
        const storedUsername = sessionStorage.getItem('pendingUsername');
        if (storedUsername) {
            document.getElementById('username').value = storedUsername;
            switchToVerificationMode(storedUsername);
        }
    }
    
    // Forgot password button click handler
    forgotPasswordBtn.addEventListener('click', (e) => {
        e.preventDefault();
        switchToPasswordResetMode();
    });
    
    // Toggle between login and signup
    signupBtn.addEventListener('click', () => {
        if (isVerificationMode || isPasswordResetMode || isPasswordResetCompletionMode || is2FAMode) {
            // Reset from any special mode
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
        isSignupMode = false;
        isVerificationMode = false;
        isPasswordResetMode = false;
        isPasswordResetCompletionMode = false;
        is2FAMode = false;
        pendingUsername = '';
        resetToken = '';
        sessionStorage.removeItem('pendingUsername');
        sessionStorage.removeItem('pending2FAPassword'); // Clear stored password for security
        
        signupBtn.textContent = 'Sign Up';
        signupBtn.classList.add('btn-secondary');
        signupBtn.classList.remove('btn-primary');
        loginBtn.textContent = 'Login';
        emailGroup.style.display = 'none';
        inviteGroup.style.display = 'none';
        verificationGroup.style.display = 'none';
        totpGroup.style.display = 'none';
        resetEmailGroup.style.display = 'none';
        newPasswordGroup.style.display = 'none';
        passwordGroup.style.display = 'block';
        forgotPasswordLink.style.display = 'block';
        document.getElementById('email').required = false;
        document.getElementById('verification-code').required = false;
        document.getElementById('totp-code').required = false;
        document.getElementById('reset-email').required = false;
        document.getElementById('new-password').required = false;
        document.getElementById('password').required = true;
    }
    
    function switchToPasswordResetMode() {
        isPasswordResetMode = true;
        isSignupMode = false;
        isVerificationMode = false;
        isPasswordResetCompletionMode = false;
        is2FAMode = false;
        
        loginBtn.textContent = 'Send Reset Link';
        signupBtn.textContent = 'Back to Login';
        signupBtn.classList.add('btn-secondary');
        signupBtn.classList.remove('btn-primary');
        
        // Show reset email field, hide others
        resetEmailGroup.style.display = 'block';
        passwordGroup.style.display = 'none';
        emailGroup.style.display = 'none';
        inviteGroup.style.display = 'none';
        verificationGroup.style.display = 'none';
        totpGroup.style.display = 'none';
        newPasswordGroup.style.display = 'none';
        forgotPasswordLink.style.display = 'none';
        
        document.getElementById('reset-email').required = true;
        document.getElementById('password').required = false;
        document.getElementById('reset-email').focus();
    }
    
    function switchToPasswordResetCompletionMode() {
        isPasswordResetCompletionMode = true;
        isPasswordResetMode = false;
        isSignupMode = false;
        isVerificationMode = false;
        is2FAMode = false;
        
        loginBtn.textContent = 'Reset Password';
        signupBtn.textContent = 'Cancel';
        signupBtn.classList.add('btn-secondary');
        signupBtn.classList.remove('btn-primary');
        
        // Validate the token first
        validateResetToken(resetToken);
        
        // Show new password field, hide others
        newPasswordGroup.style.display = 'block';
        passwordGroup.style.display = 'none';
        resetEmailGroup.style.display = 'none';
        emailGroup.style.display = 'none';
        inviteGroup.style.display = 'none';
        verificationGroup.style.display = 'none';
        totpGroup.style.display = 'none';
        forgotPasswordLink.style.display = 'none';
        
        document.getElementById('new-password').required = true;
        document.getElementById('password').required = false;
        document.getElementById('new-password').focus();
    }
    
    function switchTo2FAMode(username) {
        is2FAMode = true;
        pendingUsername = username;
        
        loginBtn.textContent = 'Verify 2FA';
        signupBtn.textContent = 'Cancel';
        signupBtn.classList.add('btn-secondary');
        signupBtn.classList.remove('btn-primary');
        
        // Hide password field, show 2FA code field
        passwordGroup.style.display = 'none';
        totpGroup.style.display = 'block';
        emailGroup.style.display = 'none';
        inviteGroup.style.display = 'none';
        verificationGroup.style.display = 'none';
        resetEmailGroup.style.display = 'none';
        newPasswordGroup.style.display = 'none';
        forgotPasswordLink.style.display = 'none';
        
        document.getElementById('totp-code').required = true;
        document.getElementById('password').required = false;
        document.getElementById('totp-code').focus();
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
        passwordGroup.style.display = 'none';
        totpGroup.style.display = 'none';
        resetEmailGroup.style.display = 'none';
        newPasswordGroup.style.display = 'none';
        forgotPasswordLink.style.display = 'none';
        
        // Show verification field
        verificationGroup.style.display = 'block';
        document.getElementById('verification-code').required = true;
        document.getElementById('password').required = false;
        document.getElementById('verification-code').focus();
    }
    
    // Validate reset token with server
    async function validateResetToken(token) {
        return new Promise((resolve, reject) => {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsUrl = `${protocol}//${window.location.host}/ws`;
            const ws = new WebSocket(wsUrl);
            
            const timeout = setTimeout(() => {
                ws.close();
                showError('Connection timeout. Please try again.');
                reject();
            }, 10000);
            
            ws.onopen = () => {
                ws.send(JSON.stringify({
                    type: 'validate_reset_token',
                    token: token
                }));
            };
            
            ws.onmessage = (event) => {
                clearTimeout(timeout);
                try {
                    const data = JSON.parse(event.data);
                    
                    if (data.type === 'reset_token_valid') {
                        // Token is valid, show username
                        document.getElementById('username').value = data.username;
                        hideError();
                        ws.close();
                        resolve();
                    } else if (data.type === 'auth_error') {
                        showError(data.message || 'Invalid or expired reset token');
                        ws.close();
                        // Redirect to login after showing error
                        setTimeout(() => {
                            window.location.href = '/static/index.html';
                        }, 3000);
                        reject();
                    }
                } catch (error) {
                    ws.close();
                    showError('Invalid response from server');
                    reject();
                }
            };
            
            ws.onerror = () => {
                clearTimeout(timeout);
                ws.close();
                showError('Connection error. Please try again.');
                reject();
            };
        });
    }
    
    // Handle form submission
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const username = document.getElementById('username').value.trim();
        const email = document.getElementById('email').value.trim();
        const inviteCode = document.getElementById('invite-code').value.trim();
        const verificationCode = document.getElementById('verification-code').value.trim();
        const totpCode = document.getElementById('totp-code').value.trim();
        const resetEmail = document.getElementById('reset-email').value.trim();
        const newPassword = document.getElementById('new-password').value;
        let password = '';
        if (!isVerificationMode && !isPasswordResetMode && !isPasswordResetCompletionMode && !is2FAMode) {
            password = document.getElementById('password').value;
        }
        
        if (isPasswordResetMode) {
            // Handle password reset request
            if (!resetEmail) {
                showError('Email or username is required');
                return;
            }
            
            hideError();
            loginBtn.disabled = true;
            loginBtn.textContent = 'Sending...';
            
            try {
                await sendPasswordResetRequest(resetEmail);
                showSuccess('If an account exists with that email, a password reset link has been sent.');
                loginBtn.disabled = false;
                loginBtn.textContent = 'Send Reset Link';
            } catch (error) {
                showError(error.message || 'Failed to send reset link');
                loginBtn.disabled = false;
                loginBtn.textContent = 'Send Reset Link';
            }
        } else if (isPasswordResetCompletionMode) {
            // Handle password reset completion
            if (!newPassword) {
                showError('New password is required');
                return;
            }
            
            hideError();
            loginBtn.disabled = true;
            loginBtn.textContent = 'Resetting...';
            
            try {
                await completePasswordReset(resetToken, newPassword);
                showSuccess('Password has been reset successfully. Redirecting to login...');
                loginBtn.disabled = false;
                setTimeout(() => {
                    window.location.href = '/static/index.html';
                }, 2000);
            } catch (error) {
                showError(error.message || 'Failed to reset password');
                loginBtn.disabled = false;
                loginBtn.textContent = 'Reset Password';
            }
        } else if (is2FAMode) {
            // Handle 2FA verification
            if (!totpCode) {
                showError('2FA code is required');
                return;
            }
            
            hideError();
            loginBtn.disabled = true;
            loginBtn.textContent = 'Verifying...';
            
            // Get the password that was used before switching to 2FA mode
            const savedPassword = sessionStorage.getItem('pending2FAPassword') || '';
            
            try {
                await authenticateAndRedirect('login', pendingUsername, savedPassword, null, null, null, totpCode);
                // Clear the saved password after successful login
                sessionStorage.removeItem('pending2FAPassword');
            } catch (error) {
                showError(error.message || '2FA verification failed');
                loginBtn.disabled = false;
                loginBtn.textContent = 'Verify 2FA';
            }
        } else if (isVerificationMode) {
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
                await authenticateAndRedirect('signup', username, password, email, null, inviteCode, null);
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
                await authenticateAndRedirect('login', username, password, null, null, inviteCode, null);
            } catch (error) {
                showError(error.message || 'Login failed');
                loginBtn.disabled = false;
                loginBtn.textContent = 'Login';
            }
        }
    });
    
    // Send password reset request
    async function sendPasswordResetRequest(identifier) {
        return new Promise((resolve, reject) => {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsUrl = `${protocol}//${window.location.host}/ws`;
            const ws = new WebSocket(wsUrl);
            
            const timeout = setTimeout(() => {
                ws.close();
                reject(new Error('Connection timeout'));
            }, 10000);
            
            ws.onopen = () => {
                ws.send(JSON.stringify({
                    type: 'request_password_reset',
                    identifier: identifier
                }));
            };
            
            ws.onmessage = (event) => {
                clearTimeout(timeout);
                try {
                    const data = JSON.parse(event.data);
                    
                    if (data.type === 'password_reset_requested') {
                        ws.close();
                        resolve();
                    } else if (data.type === 'auth_error') {
                        ws.close();
                        reject(new Error(data.message || 'Failed to send reset link'));
                    }
                } catch (error) {
                    ws.close();
                    reject(new Error('Invalid response from server'));
                }
            };
            
            ws.onerror = () => {
                clearTimeout(timeout);
                ws.close();
                reject(new Error('Connection error'));
            };
        });
    }
    
    // Complete password reset
    async function completePasswordReset(token, newPassword) {
        return new Promise((resolve, reject) => {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsUrl = `${protocol}//${window.location.host}/ws`;
            const ws = new WebSocket(wsUrl);
            
            const timeout = setTimeout(() => {
                ws.close();
                reject(new Error('Connection timeout'));
            }, 10000);
            
            ws.onopen = () => {
                ws.send(JSON.stringify({
                    type: 'reset_password',
                    token: token,
                    new_password: newPassword
                }));
            };
            
            ws.onmessage = (event) => {
                clearTimeout(timeout);
                try {
                    const data = JSON.parse(event.data);
                    
                    if (data.type === 'password_reset_success') {
                        ws.close();
                        resolve();
                    } else if (data.type === 'auth_error') {
                        ws.close();
                        reject(new Error(data.message || 'Failed to reset password'));
                    }
                } catch (error) {
                    ws.close();
                    reject(new Error('Invalid response from server'));
                }
            };
            
            ws.onerror = () => {
                clearTimeout(timeout);
                ws.close();
                reject(new Error('Connection error'));
            };
        });
    }
    
    // Authenticate via WebSocket and redirect on success
    async function authenticateAndRedirect(authMode, username, password, email, verificationCode, inviteCode, totpCode) {
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
                    if (totpCode) {
                        authData.totp_code = totpCode;
                    }
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
                    } else if (data.type === '2fa_required') {
                        authCompleted = true;
                        // 2FA is required for this account
                        ws.close();
                        // Temporarily store password for 2FA verification (will be cleared after use)
                        // Note: This is a security trade-off - password is needed for the next auth step
                        // but storing in sessionStorage is vulnerable to XSS. Alternative would be
                        // to require password re-entry, which degrades UX.
                        sessionStorage.setItem('pending2FAPassword', password);
                        // Show 2FA mode
                        switchTo2FAMode(username);
                        const baseMessage = data.message || '2FA required';
                        const extraMessage = 'Please enter your authenticator code or backup code.';
                        const fullMessage = /[.!?]$/.test(baseMessage)
                            ? baseMessage + ' ' + extraMessage
                            : baseMessage + '. ' + extraMessage;
                        showError(fullMessage);
                        resolve(); // Resolve successfully since we're switching to 2FA mode
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
        errorMessage.classList.remove('success');
        errorMessage.classList.add('error-message');
    }
    
    function showSuccess(message) {
        errorMessage.textContent = message;
        errorMessage.classList.remove('hidden');
        errorMessage.classList.remove('error-message');
        errorMessage.classList.add('success');
    }
    
    function hideError() {
        errorMessage.classList.add('hidden');
    }
})();

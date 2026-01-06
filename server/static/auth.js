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
            
            // Store credentials for WebSocket authentication
            sessionStorage.setItem('username', pendingUsername);
            sessionStorage.setItem('authMode', 'verify_email');
            sessionStorage.setItem('verificationCode', verificationCode);
            sessionStorage.removeItem('pendingUsername');
            
            // Redirect to chat page
            window.location.href = '/static/chat.html';
        } else if (isSignupMode) {
            // Handle signup
            if (!username || !password || !email) {
                showError('Username, password, and email are required');
                return;
            }
            
            // Store credentials for WebSocket authentication
            sessionStorage.setItem('username', username);
            sessionStorage.setItem('email', email);
            sessionStorage.setItem('authMode', 'signup');
            sessionStorage.setItem('inviteCode', inviteCode);
            
            // Redirect to chat page
            window.location.href = '/static/chat.html';
        } else {
            // Handle login
            if (!username || !password) {
                showError('Username and password are required');
                return;
            }
            
            // Store credentials for WebSocket authentication
            sessionStorage.setItem('username', username);
            sessionStorage.setItem('authMode', 'login');
            sessionStorage.setItem('inviteCode', inviteCode);
            
            // Redirect to chat page
            window.location.href = '/static/chat.html';
        }
    });
    
    function showError(message) {
        errorMessage.textContent = message;
        errorMessage.classList.remove('hidden');
    }
    
    function hideError() {
        errorMessage.classList.add('hidden');
    }
})();

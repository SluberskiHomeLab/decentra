// Authentication page JavaScript
(function() {
    const form = document.getElementById('auth-form');
    const loginBtn = document.getElementById('login-btn');
    const signupBtn = document.getElementById('signup-btn');
    const inviteGroup = document.getElementById('invite-group');
    const errorMessage = document.getElementById('error-message');
    
    let isSignupMode = false;
    
    // Toggle between login and signup
    signupBtn.addEventListener('click', () => {
        isSignupMode = !isSignupMode;
        
        if (isSignupMode) {
            signupBtn.textContent = 'Switch to Login';
            signupBtn.classList.remove('btn-secondary');
            signupBtn.classList.add('btn-primary');
            loginBtn.textContent = 'Create Account';
            inviteGroup.style.display = 'block';
        } else {
            signupBtn.textContent = 'Sign Up';
            signupBtn.classList.add('btn-secondary');
            signupBtn.classList.remove('btn-primary');
            loginBtn.textContent = 'Login';
            inviteGroup.style.display = 'none';
        }
        
        hideError();
    });
    
    // Handle form submission
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const username = document.getElementById('username').value.trim();
        const password = document.getElementById('password').value;
        const inviteCode = document.getElementById('invite-code').value.trim();
        
        if (!username || !password) {
            showError('Username and password are required');
            return;
        }
        
        try {
            // Store credentials for WebSocket authentication
            sessionStorage.setItem('username', username);
            sessionStorage.setItem('password', password);
            sessionStorage.setItem('authMode', isSignupMode ? 'signup' : 'login');
            sessionStorage.setItem('inviteCode', inviteCode);
            
            // Redirect to chat page
            window.location.href = '/static/chat.html';
        } catch (error) {
            showError('An error occurred. Please try again.');
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

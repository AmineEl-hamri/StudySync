const API_URL = 'https://studysync-backend-195370304491.europe-west2.run.app';

function getCurrentUser() {
    try {
        const raw = localStorage.getItem('currentUser');
        return raw ? JSON.parse(raw) : null;
    } catch (e) {
        // localStorage is corrupted clear it and force re-login
        console.warn('Corrupt currentUser in localStorage');
        localStorage.removeItem('currentUser');
        return null;
    }
}

function checkLoginStatus() {
    const currentUser = getCurrentUser();
    if (currentUser) {
        showUserMenu(currentUser.name);
        // Check tutorial completion from the server
        fetch(`${API_URL}/api/users/${currentUser.id}`)
            .then(r => r.json())
            .then(data => {
                if (data.success && !data.user.tutorial_complete) {
                    startTutorial();
                }
            })
            .catch(() => {
                // If the API is unreachable, don't block the UI
                console.warn('Could not check tutorial status.');
            });
    }
}

function register(event) {
    event.preventDefault();

    const name = document.getElementById('registerName').value;
    const email = document.getElementById('registerEmail').value;
    const password = document.getElementById('registerPassword').value;
    
    const errorDiv = document.getElementById('registerError');
    const successDiv = document.getElementById('registerSuccess');
    
    errorDiv.textContent = '';
    successDiv.textContent = '';

    // Frontend validation
    if (name.length < 2) {
        errorDiv.textContent = 'Name must be at least 2 characters.';
        return;
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) {
        errorDiv.textContent = 'Please enter a valid email address.';
        return;
    }
    if (password.length < 8) {
        errorDiv.textContent = 'Password must be at least 8 characters.';
        return;
    }
    
    fetch(`${API_URL}/api/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({name, email, password })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            successDiv.textContent = 'Account created successfully! Logging in...';
            localStorage.setItem('currentUser', JSON.stringify(data.user));
            setTimeout(() => {
                closeRegisterModal();
                showUserMenu(data.user.name);
                showDashboard();
                startTutorial();
            }, 1500);
        } else {
            errorDiv.textContent = data.error || 'Registration failed';
        }
    })
    .catch(error => {
        console.error('Registration error:', error);
        errorDiv.textContent = 'Network error. Please try again.';
    });
}

function login(event) {
    event.preventDefault();
    
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    const errorDiv = document.getElementById('loginError');
    errorDiv.textContent = '';

    if (!email || !password) {
        errorDiv.textContent = 'Please enter your email and password.';
        return;
    }

    fetch(`${API_URL}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({email, password})
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            localStorage.setItem('currentUser', JSON.stringify(data.user));
            closeLoginModal();
            showUserMenu(data.user.name);
            showDashboard();
        } else {
            errorDiv.textContent = data.error || 'Invalid credentials';
        }
    })
    .catch(error => {
        console.error('Login error:', error);
        errorDiv.textContent = 'Network error. Please try again.';
    });
}

function logout() {
    localStorage.removeItem('currentUser');
    document.getElementById('userMenu').style.display = 'none';
    document.getElementById('authButtons').style.display = 'flex';
    document.getElementById('dashboardLink').style.display = 'none';
    document.getElementById('meetingsLink').style.display = 'none'
    document.getElementById('locationSettingsBtn').style.display = 'none';
    location.reload();
}

function showUserMenu(userName) {                    
    document.getElementById('authButtons').style.display = 'none';
    document.getElementById('userMenu').style.display = 'block';
    document.getElementById('userName').textContent = userName;
    document.getElementById('dashboardLink').style.display = 'block';
    document.getElementById('meetingsLink').style.display = 'block';
    document.getElementById('locationSettingsBtn').style.display = 'block';
}

function toggleDropdown() {
    document.getElementById('dropdown').classList.toggle('active');
}

function openLoginModal() {
    document.getElementById('loginModal').classList.add('active');
    document.getElementById('loginError').textContent = '';
}

function closeLoginModal() {
    document.getElementById('loginModal').classList.remove('active');
}

function openRegisterModal() {
    document.getElementById('registerModal').classList.add('active');
    document.getElementById('registerError').textContent = '';
    document.getElementById('registerSuccess').textContent = '';
}

function closeRegisterModal() {
    document.getElementById('registerModal').classList.remove('active');
}

function switchToRegister() {
    closeLoginModal();
    openRegisterModal();
}

function switchToLogin() {
    closeRegisterModal();
    openLoginModal();
}
          }

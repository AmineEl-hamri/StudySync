// auth.js: Authentication and session management.
//  Handles login, register, logout, session persistence,
//          user menu visibility, and modal open/close.
// Depends on API_URL, getCurrentUser() is used throughout all other JS modules.

const API_URL = 'https://studysync-backend-195370304491.europe-west2.run.app';

//Safe localStorage parser, returns null and clears storage if the stored
// value is corrupter rather than crashing.
// Called  by every function that needs the logged-in user's data.
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

// Called by main.js window.onload on every page load.
// Checks if the tutorial has been completed, if not it shows.
// UI still loads normally during a Cloud Run cold start.
function checkLoginStatus() {
    const currentUser = getCurrentUser();
    if (currentUser) {
        showUserMenu(currentUser.name);
        // Check tutorial completion from the server
        fetch(`${API_URL}/api/users/${currentUser.id}`)
            .then(r => r.json())
            .then(data => {
                if (data.success && !data.user.tutorial_complete) {
                    startTutorial(); // Defined in tutorial.js
                }
            })
            .catch(() => {
                // If the API is unreachable, don't block the UI
                console.warn('Could not check tutorial status.');
            });
    }
}

// Handles the register form submission.
// Validates name, email, and password on the frontend before posting to 
// POST /api/register. If successful, it stores the user object in localStorage, updates 
// the navigation bar, and starts the onboarding tutorial for new users.
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
            // Persist user to localStorage so session survives page refresh.
            localStorage.setItem('currentUser', JSON.stringify(data.user));
            setTimeout(() => {
                closeRegisterModal();
                showUserMenu(data.user.name);
                showDashboard(); // Defined in main.js
                startTutorial(); // Defined in tutorial.js
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

// Handles the login form submission.
// Posts credentials to POST /api/login. The backend verifies the password
// against the bcrypt hash. On success, stores the returned user object in localStorage
// and restores the session.
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
            showDashboard(); // Defined in main.js
        } else {
            errorDiv.textContent = data.error || 'Invalid credentials';
        }
    })
    .catch(error => {
        console.error('Login error:', error);
        errorDiv.textContent = 'Network error. Please try again.';
    });
}

// Clears the session from localStorage and reloads the page.
// Reloading ensures all in-memory state is wiped and the UI returns 
// cleanly to the logged-out state.
function logout() {
    localStorage.removeItem('currentUser');
    document.getElementById('userMenu').style.display = 'none';
    document.getElementById('authButtons').style.display = 'flex';
    document.getElementById('dashboardLink').style.display = 'none';
    document.getElementById('meetingsLink').style.display = 'none'
    document.getElementById('locationSettingsBtn').style.display = 'none';
    location.reload();
}

// Shows the logged-in navi state, hides login/register buttons, shows
// the username dropdown, dashboard, My Meetings, and My Locations links.
// Called on login and on page load if a session exists in localStorage.
function showUserMenu(userName) {                    
    document.getElementById('authButtons').style.display = 'none';
    document.getElementById('userMenu').style.display = 'block';
    document.getElementById('userName').textContent = userName;
    document.getElementById('dashboardLink').style.display = 'block';
    document.getElementById('meetingsLink').style.display = 'block';
    document.getElementById('locationSettingsBtn').style.display = 'block';
}

// Toggles the user dropdown menu (Dashboard, Profile, Logout).
function toggleDropdown() {
    document.getElementById('dropdown').classList.toggle('active');
}

// Open/Close Modals
function openLoginModal() {
    document.getElementById('loginModal').classList.add('active');
    document.getElementById('loginError').textContent = ''; // Clears any previous errors.
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

// Switch between modals without closing and reopening the backdrop.
function switchToRegister() {
    closeLoginModal();
    openRegisterModal();
}

function switchToLogin() {
    closeRegisterModal();
    openLoginModal();
}

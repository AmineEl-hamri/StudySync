
const API_URL = 'http://localhost:5000';

window.onload = function() {
          checkLoginStatus();
}
function checkLoginStatus() {
          const currentUser = localStorage.getItem('currentUser');
               if (currentUser) {
                    const user = JSON.parse(currentUser);
                    showUserMenu(user.name);
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

          fetch(`${API_URL}/api/register`, {
                    method: 'POST',
                    headers: {
                              'Content-Type': 'application/json',
                    },
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

          fetch(`${API_URL}/api/login`, {
                    method: 'POST',
                    headers: {
                              'Content-Type': 'application/json',
                    },
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
               location.reload();
          }
          function showUserMenu(userName) {
               document.getElementById('authButtons').style.display = 'none';
               document.getElementById('userMenu').style.display = 'block';
               document.getElementById('userName').textContent = userName;
          }
          function toggleDropdown() {
               const dropdown = document.getElementById('dropdown');
               dropdown.classList.toggle('active');
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

          window.onclick = function(event) {
               if (event.target.classList.contains('modal')) {
                    event.target.classList.remove('active');
               }
          }

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
               const pw = document.getElementById('registerPassword').value;

               let users = JSON.parse(localStorage.getItem('users')) || [];

               if (users.find(user => user.email === email)) {
                    document.getElementById('registerError').textContent = 'Email already registered!';
                    return;
               }
               const newUser = {
                    name: name,
                    email: email,
                    password: pw,
                    createdAt: new Date().toISOString()
               };
               users.push(newUser);
               localStorage.setItem('users', JSON.stringify(users));

               document.getElementById('registerError').textContent = '';
               document.getElementById('registerSuccess').textContent = 'Account Created! Signing in...';

               setTimeout(() => {
                    localStorage.setItem('currentUser', JSON.stringify(newUser));
                    closeRegisterModal();
                    showUserMenu(newUser.name);
                    location.reload();
               }, 1500);
          }

          function login(event) {
               event.preventDefault();

               const email = document.getElementById('loginEmail').value;
               const pw = document.getElementById('loginPassword').value;

               const users = JSON.parse(localStorage.getItem('users')) || [];

               const user = users.find(usr => usr.email === email && usr.password === pw);

               if (user) {
                    localStorage.setItem('currentUser', JSON.stringify(user));
                    closeLoginModal();
                    showUserMenu(user.name);
                    location.reload();
               } else {
                    document.getElementById('loginError').textContent = 'Invalid email or password!';
               }
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

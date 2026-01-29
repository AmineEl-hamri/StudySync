window.onload = function() {
    checkLoginStatus();
    setupEventListeners();
}

function setupEventListeners() {
    // Close modals when clicking outside
    window.onclick = function(event) {
        if (event.target.classList.contains('modal')) {
            event.target.classList.remove('active');
        }
    }
}

function showHome() {
    document.getElementById('home').style.display = 'block';
    document.getElementById('dashboard').classList.remove('active');
}

function showDashboard() {
    const currentUser = localStorage.getItem('currentUser');

  if (!currentUser) {
          openLoginModal();
          return;
      }

  document.getElementById('home').style.display = 'none';
  document.getElementById('dashboard').classList.add('active');

  loadGroups();

}

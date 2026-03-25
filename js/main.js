window.onload = function() {
    checkLoginStatus();
    setupEventListeners();
}

function setupEventListeners() {
    // Close modals when clicking outside
    window.onclick = function(event) {
        if (event.target.classList.contains('modal')) {
            event.target.style.display = 'none';
        }
    }
}

function hideAllSections() {
    document.getElementById('home').style.display = 'none';
    document.getElementById('dashboard').style.display = 'none';
    document.getElementById('myMeetings').style.display = 'none';
    document.getElementById('groupDetails').style.display = 'none';
}

function showHome() {
    hideAllSections();
    document.getElementById('home').style.display = 'block';
}

function showDashboard() {
    const currentUser = localStorage.getItem('currentUser');

  if (!currentUser) {
          openLoginModal();
          return;
      }

  hideAllSections();
  document.getElementById('dashboard').style.display = 'block';

  loadGroups();

}

function showMyMeetings() {
    const currentUser = localStorage.getItem('currentUser');
    if (!currentUser) {
        openLoginModal();
        return;
    }
    hideAllSections();
    document.getElementById('myMeetings').style.display = 'block';
    loadAllUserMeetings();
}

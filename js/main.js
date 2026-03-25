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
    document.getElementById('about').style.display = 'none';
    document.getElementById('contact').style.display = 'none';
    document.getElementById('profile').style.display = 'none';
}

function showAbout() {
    hideAllSections();
    document.getElementById('about').style.display = 'block';
}
function showContact() {
    hideAllSections();
    document.getElementById('contact').style.display = 'block';
}

function showProfile() {
    const currentUser = JSON.parse(localStorage.getItem('currentUser'));
    if (!currentUser) { 
        openLoginModal(); 
        return;
    }
    hideAllSections();
    document.getElementById('profile').style.display = 'block';
    document.getElementById('profileName').value = currentUser.name || '';
    document.getElementById('profileEmail').value = currentUser.email || '';
    document.getElementById('profileDisplayName').textContent = currentUser.name || 'User';
    document.getElementById('profileDisplayEmail').textContent = currentUser.email || '';
    document.getElementById('profileAvatar').textContent = (currentUser.name || 'U')[0].toUpperCase();
}

function updateProfile() {
    const name = document.getElementById('profileName').value.trim();
    const email = document.getElementById('profileEmail').value.trim();
    const successEl = document.getElementById('profileUpdateSuccess');
    const errorEl = document.getElementById('profileUpdateError');

    if (!name || !email) {
        errorEl.textContent = 'Please fill in all fields.';
        return;
    }

    const currentUser = JSON.parse(localstorage.getItem('currentUser'));
    currentUser.name = name;
    currentUser.email = email;
    localStorage.setItem('currentUser', JSON.stringify(currentUser));
    // change soon to update database instead of local storage

    document.getElementById('profileDisplayName').textContent = name;
    document.getElementById('profileDisplayEmail').textContent = email;
    document.getElementById('profileAvatar').textContent = name[0].toUpperCase();
    document.getElementById('userName').textContent = name;

    successEl.textContent = '✅ Profile updated successfully!';
    errorEl.textContent = '';
    seetTimeout(() => successEl.textContent = '', 3000);
}

function changePassword() {
    const current = document.getElementById('currentPassword').value;
    const newPass = document.getElementById('newPassword').value;
    const confirm = document.getElementById('confirmPassword').value;
    const successEl = document.getElementById('passwordSuccess');
    const errorEl = document.getElementById('passwordError');

    if (!current || !newPass || !confirm) {
        errorEl.textContent = 'Please fill in all password fields.';
        return;
    }
    if (newPass.length < 8) {
        errorEl.textContent = 'New password must be at least 8 characters.';
        return;
    }
    if (newPass !== confirm) {
        errorEl.textContent = 'New passwords do not match.';
        return;
    }

    // change this to update backend after it works
    successEl.textContent = '✅ Password updated successfully!';
    errorEl.textContent = '';
    document.getElementById('currentPassword').value = '';
    document.getElementById('newPassword').value = '';
    document.getElementById('confirmPassword').value = '';
    setTimeout(() => successEl.textContent = '', 3000);
}

function previewAvatar(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        const avatar = document.getElementById('profileAvatar');
        avatar.innerHTML = `<img src="${e.target.result}" alt="Avatar">`;
    };
    reader.readAsDataURL(file);
}

function submitContactForm(event) {
    event.preventDefault();
    document.getElementById('contactSuccess').textContent = '✅ Message sent! We\'ll get back to you soon.';
    document.getElementById('contactError').textContent = '';
    document.getElementById('contactName').value = '';
    document.getElementById('contactEmail').value = '';
    document.getElementById('contactSubject').value = '';
    document.getElementById('contactMessage').value = '';
    setTimeout(() => document.getElementById('contactSuccess').textContent = '', 4000);
}

function toggleFaq(element) {
    const answer = element.nextElementSibling;
    const arrow = element.querySelector('.faq-arrow');
    const isOpen = answer.style.display === 'block';
    answer.style.display = isOpen ? 'none' : 'block';
    arrow.style.transform = isOpen ? 'rotate(0deg)' : 'rotate(180deg)';
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

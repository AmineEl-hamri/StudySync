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

    fetch(`${API_URL}/api/users/${currentUser.id}`)
        .then(r => r.json())
        .then(data => {
            if (data.success) {
                const user = data.user;
                document.getElementById('profileName').value = user.name || '';
                document.getElementById('profileEmail').value = user.email || '';
                document.getElementById('profileDisplayName').textContent = user.name || 'User';
                document.getElementById('profileDisplayEmail').textContent = user.email || '';
                const avatar = document.getElementById('profileAvatar');
                if (user.profile_picture) {
                    avatar.innerHTML = `<img src="${user.profile_picture}" alt="Avatar">`;
                } else {
                    avatar.textContent = (user.name || 'U')[0].toUpperCase();
                }
            }
        });
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

    fetch(`${API_URL}/api/users/${currentUser.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email })
    })
    .then(r => r.json())
    .then(data => {
        if (data.success) {
            // update localStorage
            currentUser.name = data.user.name;
            currentUser.email = data.user.email;
            localStorage.setItem('currentUser', JSON.stringify(currentUser));
            document.getElementById('profileDisplayName').textContent = data.user.name;
            document.getElementById('profileDisplayEmail').textContent = data.user.email;
            document.getElementById('profileAvatar').textContent = data.user.name[0].toUpperCase();
            document.getElementById('userName').textContent = data.user.name;
            successEl.textContent = '✅ Profile updated successfully!';
            errorEl.textContent = '';
            setTimeout(() => successEl.textContent = '', 3000);
        } else {
            errorEl.textContent = data.error || 'Update failed';
        }
    })
    .catch(() => errorEl.textContent = 'Network error. Please try again.');
}

function changePassword() {
    const currentUser = JSON.parse(localStorage.getItem('currentUser'));
    const current = document.getElementById('currentPassword').value;
    const newPass = document.getElementById('newPassword').value;
    const confirm = document.getElementById('confirmPassword').value;
    const successEl = document.getElementById('passwordSuccess');
    const errorEl = document.getElementById('passwordError');

    if (!currentUser) {
        openLoginModal();
        return;
    }

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

    fetch(`${API_URL}/api/users/${currentUser.id}/password`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_password: current, new_password: newPass })
    })
    .then(r => r.json())
    .then(data => {
        if (data.success) {
            successEl.textContent = '✅ Password updated successfully!';
            errorEl.textContent = '';
            document.getElementById('currentPassword').value = '';
            document.getElementById('newPassword').value = '';
            document.getElementById('confirmPassword').value = '';
            setTimeout(() => successEl.textContent = '', 3000);
        } else {
            errorEl.textContent = data.error || 'Failed to update password';
        }
    })
    .catch(() => errorEl.textContent = 'Network error. Please try again.');
}

function previewAvatar(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        const avatar = document.getElementById('profileAvatar');
        avatar.innerHTML = `<img src="${e.target.result}" alt="Avatar">`;

        uploadProfilePicture(e.target.result, file.type);
    };
    reader.readAsDataURL(file);
}

function uploadProfilePicture(base64Data, contentType) {
    const currentUser = JSON.parse(localStorage.getItem('currentUser'));
    fetch(`${API_URL}/api/users/${currentUser.id}/picture`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_data: base64Data, content_type: contentType })
    })
    .then(r => r.json())
    .then(data => {
        if (data.success) {
            currentUser.profile_picture = data.picture_url;
            localStorage.setItem('currentUser', JSON.stringify(currentUser));
            document.getElementById('profileUpdateSuccess').textContent = '✅ Profile picture updated!';
            setTimeout(() => document.getElementById('profileUpdateSuccess').textContent = '', 3000);
        } else {
            alert('Failed to upload picture: ' + data.error);
        }
    })
    .catch(() => alert('Network error uploading picture.'));
}

function submitContactForm(event) {
    event.preventDefault();
    const name = document.getElementById('contactName').value.trim();
    const email = document.getElementById('contactEmail').value.trim();
    const subject = document.getElementById('contactSubject').value.trim();
    const message = document.getElementById('contactMessage').value.trim();
    const successEl = document.getElementById('contactSuccess');
    const errorEl = document.getElementById('contactError');

    fetch(`${API_URL}/api/contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, subject, message })
    })
    .then(r => r.json())
    .then(data => {
        if (data.success) {
            successEl.textContent = '✅ Message sent! We\'ll get back to you soon.';
            errorEl.textContent = '';
            document.getElementById('contactName').value = '';
            document.getElementById('contactEmail').value = '';
            document.getElementById('contactSubject').value = '';
            document.getElementById('contactMessage').value = '';
            setTimeout(() => successEl.textContent = '', 4000);
        } else {
            errorEl.textContent = data.error || 'Failed to send message.';
        }
    })
    .catch(() => errorEl.textContent = 'Network error. Please try again.');
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

function toggleMobileMenu() {
    document.getElementById('navLinks').classList.toggle('open');
}

function closeMobileMenu() {
    document.getElementById('navLinks').classList.remove('open');
}

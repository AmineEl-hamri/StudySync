window.onload = function() {
    checkLoginStatus();
    setupEventListeners();
    showLoadingState(); 
    // Initialise Places autocomplete after Google Maps script loads
    setTimeout(() => {
        initAutocomplete('homeAddress');
        initAutocomplete('workAddress');
        initAutocomplete('meetingLocation');
    }, 1000);
}

function showLoadingState() {
    // If API doesn't respond within 8s, show a helpful message
    const timer = setTimeout(() => {
        const home = document.getElementById('home');
        if (home && home.style.display !== 'none') {
            const existing = document.getElementById('apiLoadingNote');
            if (!existing) {
                const note = document.createElement('p');
                note.id = 'apiLoadingNote';
                note.style.cssText = 'color:#6B7280; font-size:0.85rem; margin-top:1rem;';
                note.textContent = '⏳ Server is starting up, this may take a few seconds on first load...';
                const cta = home.querySelector('.cta-buttons');
                if (cta) cta.after(note);
            }
        }
    }, 4000);
 
    // Cancel note if API responds quickly
    fetch(`${API_URL}/api/test`)
        .then(() => clearTimeout(timer))
        .catch(() => {}); // silent, the note will appear if needed
}

function setupEventListeners() {
    // Close modals when clicking outside
    window.onclick = function(event) {
        if (event.target.classList.contains('modal')) {
            event.target.classList.remove('active');
            event.target.style.display = 'none';
        }
    };
}

function hideAllSections() {
    const sections = ['home', 'dashboard', 'myMeetings', 'groupDetails', 'about',
                      'contact', 'profile', 'privacyPolicy', 'defaultAvailability'];
    sections.forEach(id => {
        const element = document.getElementById(id);
        if (element) {
            element.style.display = 'none';
        }
    });
}

function showHome() {
    hideAllSections();
    document.getElementById('home').style.display = 'block';
}

function showAbout() {
    hideAllSections();
    document.getElementById('about').style.display = 'block';
}
function showContact() {
    hideAllSections();
    document.getElementById('contact').style.display = 'block';
}

function showPrivacyPolicy() {
    hideAllSections();
    document.getElementById('privacyPolicy').style.display = 'block';
    window.scrollTo(0, 0);
}

function showDashboard() {
    const currentUser = getCurrentUser();
    if (!currentUser) { openLoginModal(); return; }
    hideAllSections();
    document.getElementById('dashboard').style.display = 'block';
    loadGroups();
}

function showMyMeetings() {
    const currentUser = getCurrentUser();
    if (!currentUser) { openLoginModal(); return; }
    hideAllSections();
    document.getElementById('myMeetings').style.display = 'block';
    loadAllUserMeetings();
}

function showProfile() {
    const currentUser = getCurrentUser();
    if (!currentUser) { openLoginModal(); return; }
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
                    avatar.innerHTML = `<img src="${user.profile_picture}" alt="Avatar" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
                } else {
                    avatar.textContent = (user.name || 'U')[0].toUpperCase();
                }
            }
        })
        .catch(() => {
            document.getElementById('profileUpdateError').textContent = 'Could not load profile. Please refresh.';
        });
 
    loadPreferences();
    loadTransportMode();
}

function updateProfile() {
    const currentUser = getCurrentUser();
    if (!currentUser) { openLoginModal(); return; }
    
    const name = document.getElementById('profileName').value.trim();
    const email = document.getElementById('profileEmail').value.trim();
    const successEl = document.getElementById('profileUpdateSuccess');
    const errorEl = document.getElementById('profileUpdateError');

    successEl.textContent = '';
    errorEl.textContent = '';

    if (!name || !email) {
        errorEl.textContent = 'Please fill in all fields.';
        return;
    }
    if (name.length < 2) {
        errorEl.textContent = 'Name must be at least 2 characters.';
        return;
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) {
        errorEl.textContent = 'Please enter a valid email address.';
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
            const updated = { ...currentUser, name: data.user.name, email: data.user.email };
            localStorage.setItem('currentUser', JSON.stringify(updated));
            document.getElementById('profileDisplayName').textContent = data.user.name;
            document.getElementById('profileDisplayEmail').textContent = data.user.email;
            document.getElementById('userName').textContent = data.user.name;
            // Update avatar initial if no profile picture
            const avatar = document.getElementById('profileAvatar');
            if (!data.user.profile_picture) {
                avatar.textContent = data.user.name[0].toUpperCase();
            }
            successEl.textContent = '✅ Profile updated successfully!';
            setTimeout(() => successEl.textContent = '', 3000);
        } else {
            errorEl.textContent = data.error || 'Update failed';
        }
    })
    .catch(() => errorEl.textContent = 'Network error. Please try again.');
}

function changePassword() {
    const currentUser = getCurrentUser();
    if (!currentUser) { openLoginModal(); return; }
    
    const current = document.getElementById('currentPassword').value;
    const newPass = document.getElementById('newPassword').value;
    const confirm = document.getElementById('confirmPassword').value;
    const successEl = document.getElementById('passwordSuccess');
    const errorEl = document.getElementById('passwordError');

    successEl.textContent = '';
    errorEl.textContent = ''
    
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
    
    // Frontend file size check with 5MB limit.
    if (file.size > 5 * 1024 * 1024) {
        alert('Image must be smaller than 5MB. Please choose a smaller file.');
        event.target.value = '';
        return;
    }
    
    // Frontend file type check.
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowed.includes(file.type)) {
        alert('Only JPEG, PNG, GIF and WebP images are allowed.');
        event.target.value = '';
        return;
    }
    
    const reader = new FileReader();
    reader.onload = function(e) {
        const avatar = document.getElementById('profileAvatar');
        avatar.innerHTML = `<img src="${e.target.result}" alt="Avatar" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
        uploadProfilePicture(e.target.result, file.type);
    };
    reader.readAsDataURL(file);
}

function uploadProfilePicture(base64Data, contentType) {
    const currentUser = getCurrentUser();
    if (!currentUser) return;
    
    fetch(`${API_URL}/api/users/${currentUser.id}/picture`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_data: base64Data, content_type: contentType })
    })
    .then(r => r.json())
    .then(data => {
        if (data.success) {
            const updated = { ...currentUser, profile_picture: data.picture_url };
            localStorage.setItem('currentUser', JSON.stringify(updated));
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

    successEl.textContent = '';
    errorEl.textContent = '';

    if (!name || !email || !message) {
        errorEl.textContent = 'Please fill in name, email, and message.';
        return;
    }

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

function toggleMobileMenu() {
    document.getElementById('navLinks').classList.toggle('open');
}

function closeMobileMenu() {
    document.getElementById('navLinks').classList.remove('open');
}

function deleteAccount() {
    const currentUser = getCurrentUser();
    if (!currentUser) { openLoginModal(); return; }
    
    if (!confirm('Are you sure you want to permanently delete your account? All your groups, availability, and meetings will be removed. This cannot be undone.')) return;
    if (!confirm('This is your final warning, your account will be permanently deleted. Continue?')) return;

    fetch(`${API_URL}/api/users/${currentUser.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' }
    })
    .then(r => r.json())
    .then(data => {
        if (data.success) {
            localStorage.removeItem('currentUser');
            alert('Your account has been permanently deleted.');
            location.reload();
        } else {
            alert('Failed to delete account: ' + (data.error || 'Unknown error'));
        }
    })
    .catch(() => alert('Network error. Please try again.'));
}

function initAutocomplete(inputId) {
    const input = document.getElementById(inputId);
    if (!input || typeof google === 'undefined') return;

    const autocompleteElement = new google.maps.places.PlaceAutocompleteElement({
        types: ['geocode', 'establishment'],
        componentRestrictions: { country: 'gb' }
    });

    autocompleteElement.style.width = '100%';

    input.parentNode.replaceChild(autocompleteElement, input);
    autocompleteElement.id = inputId;

    autocompleteElement.addEventListener('gmp-placeselect', (event) => {
        const place = event.place;
        place.fetchFields({ fields: ['formattedAddress'] }).then(() => {
            autocompleteElement.value = place.formattedAddress;
        });
    });
}

function showDefaultAvailability() {
    const currentUser = getCurrentUser();
    if (!currentUser) { openLoginModal(); return; }
    hideAllSections();
    document.getElementById('defaultAvailability').style.display = 'block';
    generateGlobalAvailabilityGrid();
    loadGlobalAvailability();
}

function loadTransportMode() {
    const currentUser = getCurrentUser();
    if (!currentUser) return;

    fetch(`${API_URL}/api/users/${currentUser.id}`)
        .then(r => r.json())
        .then(data => {
            if (data.success) {
                const mode = data.user.transport_mode || 'transit';
                const radio = document.querySelector(`input[name="transportMode"][value="${mode}"]`);
                if (radio) radio.checked = true;
            }
        })
        .catch(() => console.error('Failed to load transport mode'));
}

function saveTransportMode() {
    const currentUser = getCurrentUser();
    if (!currentUser) { openLoginModal(); return; }

    const selected = document.querySelector('input[name="transportMode"]:checked');
    const successEl = document.getElementById('transportSuccess');
    const errorEl = document.getElementById('transportError');
    successEl.textContent = '';
    errorEl.textContent = '';

    if (!selected) {
        errorEl.textContent = 'Please select a transport mode.';
        return;
    }

    fetch(`${API_URL}/api/users/${currentUser.id}/transport`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transport_mode: selected.value })
    })
    .then(r => r.json())
    .then(data => {
        if (data.success) {
            successEl.textContent = '✅ Transport preference saved!';
            setTimeout(() => successEl.textContent = '', 3000);
        } else {
            errorEl.textContent = data.error || 'Failed to save';
        }
    })
    .catch(() => errorEl.textContent = 'Network error. Please try again.');
}

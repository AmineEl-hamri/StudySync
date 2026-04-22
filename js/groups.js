// groups.js handles group creation, member management, and dashboard rendering.
// It depends on auth.js for the function getCurrentUser() and the variable API_URL

// Temp list of members emails while the create group modal is open.
// Cleard when the modal is closed or the group is created.
let tempMembers = [];

// Retries a fetch up to maxAttempts times with increasing delays
// Handles Cloud Run cold starts which can take 5-10 seconds
async function fetchWithRetry(url, options, maxAttempts = 5) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const response = await fetch(url, options);
            return response;
        } catch (err) {
            if (attempt === maxAttempts) throw err;
            const waitMs = attempt * 2000; // 2s, 4s, 6s, 8s
            console.log(`Attempt ${attempt} failed, retrying in ${waitMs}ms...`);
            await new Promise(resolve => setTimeout(resolve, waitMs));
        }
    }
}

// Submits the Create Group form. Inputs are validated then sent to the backend with
// fetchWithRetry (to absorb cold starts), and on success reloads the dashboard and 
// opens the new group.
async function createGroup(event) {
    event.preventDefault();
 
    const currentUser = getCurrentUser();
    if (!currentUser) { openLoginModal(); return; }
 
    const groupName = document.getElementById('groupName').value.trim();
    const groupDescription = document.getElementById('groupDescription').value.trim();
    const errorDiv = document.getElementById('createGroupError');
    const successDiv = document.getElementById('createGroupSuccess');
 
    errorDiv.textContent = '';
    successDiv.textContent = '';

    // Frontend validation, mirrors the backend check for faster feedback.
    if (groupName.length < 2) {
        errorDiv.textContent = 'Group name must be at least 2 characters!';
        return;
    }
    
    if (tempMembers.length === 0) {
        errorDiv.textContent = 'Please add at least one other member to your group.';
        return;
    }
 
    // Lock the submit button while the request is processing to prevent double submissions.
    const submitBtn = document.querySelector('#createGroupModal .btn-submit');
    submitBtn.disabled = true;
    submitBtn.textContent = '⏳ Creating...';
 
    try {
        const response = await fetchWithRetry(`${API_URL}/api/groups`, {
            method: 'POST', // POST /api/groups, backend handles duplicate name checks 
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: groupName,
                description: groupDescription,
                owner_id: currentUser.id,
                members: tempMembers
            })
        });
 
        const data = await response.json();
 
        if (data.success) {
            // Backend returns skipped_emails for members whose accounts don't exist.
            // Its shown to the user rather.
            let message = 'Group created successfully!';
            if (data.skipped_emails && data.skipped_emails.length > 0) {
                message += ` Note: ${data.skipped_emails.join(', ')} could not be added (account not found).`;
            }
            successDiv.textContent = message;
            tempMembers = [];

            // Small delay so the user can read the success message.
            // Reload the dashboard and show the new group.
            const newGroupId = data.group_id;
            setTimeout(() => {
                closeCreateGroupModal();
                fetch(`${API_URL}/api/groups?user_id=${currentUser.id}`)
                    .then(response => response.json())
                    .then(groupsData => {
                        if (groupsData.success) {
                            displayGroups(groupsData.groups);
                            viewGroup(newGroupId);
                        }
                    });
            }, 1500);
        } else {
            errorDiv.textContent = data.error || 'Failed to create group';
        }
    } catch (err) {
        // Only reached if all retry attempts fail. This means the server is currently unreachable.
        errorDiv.textContent = 'Server is unavailable after several attempts. Please refresh and try again.';
    } finally {
        // Always restore the button state to allow users to retry.
        submitBtn.disabled = false;
        submitBtn.textContent = 'Create Group';
    }
}

// Adds a member email to the temp list 
// Actual group membership is created server-side only when the form is submitted.
function addMember() {
  const memberEmail = document.getElementById('memberEmail').value.trim();

  if (!memberEmail) {
    alert('Please enter an email address.');
    return;
  }

  // Basic email format check, also performed in the backend.  
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(memberEmail)) {
    alert('Please enter a valid email address.');
    return;
  }

  // Prevent users from adding their own email. they're added automatically as owner
  const currentUser = getCurrentUser();
  if (currentUser && memberEmail === currentUser.email.toLowerCase()) {
    alert('You don\'t need to add yourself, you\'re automatically a member as the group owner.');
    return;
  
  }
  if (tempMembers.includes(memberEmail)) {
    alert('Member already addedd.');
    return;
  }
  
  tempMembers.push(memberEmail);
  document.getElementById('memberEmail').value = '';
  renderMembersList();

}

// Removes a member from the temp list. Called through the 'Remove' button.
function removeMember(email) {
  tempMembers = tempMembers.filter(m => m !== email);
  renderMembersList();
}

// Re-renders the member tag list inside the Create Group modal.
// Called whenever tempMembers changes.
function renderMembersList() {
  const membersList = document.getElementById('membersList');
  membersList.innerHTML = '';

  tempMembers.forEach(email => {
    const memberItem = document.createElement('div');
    memberItem.className = 'member-item';
    memberItem.innerHTML = `
    <span>${email}</span>
    <button class="btn-remove-member" onclick="removeMember('${email}')">Remove</button>`;
    membersList.appendChild(memberItem);
  });
}

// Fetches the current user's groups from the backend and hands them off to displayGroups()
// for rendering. Also called when the dashboard is shown.
function loadGroups() {
    const currentUser = getCurrentUser();
    if (!currentUser) return;
 
    const groupsGrid = document.getElementById('groupsGrid');
    groupsGrid.innerHTML = '<p>Loading groups...</p>';
 
    fetch(`${API_URL}/api/groups?user_id=${currentUser.id}`)
        .then(r => r.json())
        .then(data => {
            if (data.success) {
                displayGroups(data.groups);
            } else {
                groupsGrid.innerHTML = '<p style="color:#EF4444;">Failed to load groups. Please refresh.</p>';
            }
        })
        .catch(() => {
            groupsGrid.innerHTML = '<p style="color:#EF4444;">Network error. Please check your connection and refresh.</p>';
        });
}

// Builds the group cards on the dashboard. Each card shows the group's name, description 
// owner, a preview of members, and a coloured indication of how many members have submitted availability.
function displayGroups(groups) {
    const groupsGrid = document.getElementById('groupsGrid');

    // Empty state, shown only for brand-new users.
    if (groups.length === 0) {
        groupsGrid.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">📚</div>
                <h3>No study groups yet</h3>
                <p>Create your first group to get started!</p>
                <button class="btn-primary" style="margin-top:1rem;" onclick="openCreateGroupModal()">Create a Group</button>
            </div>
        `;
        return;
    }
 
    groupsGrid.innerHTML = '';
    groups.forEach(group => {
        const groupCard = document.createElement('div');
        groupCard.className = 'group-card';
        // Whole card is clickable, takes the user into group detail view.
        groupCard.onclick = () => viewGroup(group.id);

        // Show up to 3 member badges, then a '+N more' for more members.
        const membersHtml = group.members.slice(0, 3).map(email =>
            `<span class="member-badge">${email.split('@')[0]}</span>`
        ).join('');
        const moreMembers = group.members.length > 3
            ? `<span class="member-badge">+${group.members.length - 3} more</span>` : '';

        // Availability progress indicator, colours reflect how many members have submitted.
        // Green when all submitted, amber when partial, and grey when none.
        const totalMembers = group.members.length;
        const submitted = group.submittedCount || 0;
        const allSubmitted = submitted === totalMembers;
        const noneSubmitted = submitted === 0;

        const availabilityColour = allSubmitted ? '#065F46' : noneSubmitted ? '#9CA3AF' : '#92400E';
        const availabilityBg = allSubmitted ? '#D1FAE5' : noneSubmitted ? '#F3F4F6' : '#FEF3C7';
        const availabilityText = allSubmitted
            ? `✓ All ${totalMembers} submitted`
            : noneSubmitted
            ? 'No availability yet'
            : `${submitted} of ${totalMembers} submitted`;

        groupCard.innerHTML = `
            <h3>${group.name}</h3>
            <p>${group.description || 'No description'}</p>
            <p><strong>Created by:</strong> ${group.ownerName}</p>
            <div class="group-members">${membersHtml}${moreMembers}</div>
            <div class="group-availability-bar">
                <span class="availability-pill" style="background:${availabilityBg}; color:${availabilityColour};">
                    📋 ${availabilityText}
                </span>
            </div>
        `;
        groupsGrid.appendChild(groupCard);
    });
}

// Opens the Create Group modal and resets all its state so it starts fresh.
function openCreateGroupModal() {
  tempMembers = []; // Reset temporary members
  document.getElementById('createGroupModal').classList.add('active');
  document.getElementById('groupName').value = '';
  document.getElementById('groupDescription').value = '';
  document.getElementById('memberEmail').value = '';
  document.getElementById('membersList').innerHTML = '';
  document.getElementById('createGroupError').textContent = '';
  document.getElementById('createGroupSuccess').textContent = '';
}

// Closes the Create Group modal. The state is reset when it's next opened, not on close, so
// interrupted sessions don't lose input immediately.
function closeCreateGroupModal() {
  document.getElementById('createGroupModal').classList.remove('active');
}

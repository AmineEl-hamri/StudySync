let tempMembers = [];

function createGroup(event) {
  event.preventDefault();

  const currentUser = getCurrentUser();
  if (!currentUser) { openLoginModal(); return; }
  
  const groupName = document.getElementById('groupName').value.trim();
  const groupDescription = document.getElementById('groupDescription').value.trim();
  
  const errorDiv = document.getElementById('createGroupError');
  const successDiv = document.getElementById('createGroupSuccess');

  errorDiv.textContent = '';
  successDiv.textContent = '';

  if (groupName.length < 2) {
    errorDiv.textContent = 'Group name must be at least 2 characters!';
    return;
  }

  // Abort controller with a 15 second timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  fetch(`${API_URL}/api/groups`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        name: groupName,
        description: groupDescription,
        owner_id: currentUser.id,
        members: tempMembers
    }),
    signal: controller.signal
  })
    .then(response => { 
      clearTimeout(timeoutId);
      return response.json();
    })
    .then(data => {
        if (data.success) {
          let message = 'Group created successfully!';
          if (data.skipped_emails && data.skipped_emails.length > 0) {
            msg += ` Note: ${data.skipped_emails.join(', ')} could not be added (account not found).`;
          }
          successDiv.textContent = msg;
          tempMembers = [];

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
    })
    .catch(error => {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        errorDiv.textContent = 'Request timed out, the group may have been created. Please refresh before trying again.';
      } else {
        errorDiv.textContent = 'Network error. Please refresh the page before trying again to avoid duplicates.';
    });
}

function addMember() {
  const memberEmail = document.getElementById('memberEmail').value.trim();

  if (!memberEmail) {
    alert('Please enter an email address.');
    return;
  }
  
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(memberEmail)) {
    alert('Please enter a valid email address.');
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

function removeMember(email) {
  tempMembers = tempMembers.filter(m => m !== email);
  renderMembersList();
}

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

function displayGroups(groups) {
    const groupsGrid = document.getElementById('groupsGrid');
 
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
        groupCard.onclick = () => viewGroup(group.id);

        const membersHtml = group.members.slice(0, 3).map(email =>
            `<span class="member-badge">${email.split('@')[0]}</span>`
        ).join('');
        const moreMembers = group.members.length > 3
            ? `<span class="member-badge">+${group.members.length - 3} more</span>` : '';

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

function closeCreateGroupModal() {
  document.getElementById('createGroupModal').classList.remove('active');
}

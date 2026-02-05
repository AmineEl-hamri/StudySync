
const API_URL = 'http://localhost:5000';;
let tempMembers = [];

function createGroup(event) {
  event.preventDefault();

  const currentUser = JSON.parse(localStorage.getItem('currentUser'));
  const groupName = document.getElementById('groupName').value;
  const groupDescription = document.getElementById('groupDescription').value;

  const errorDiv = document.getElementById('createGroupError');
  const successDiv = document.getElementById('createGroupSuccess');

  errorDiv.textContent = '';
  successDiv.textContent = '';

  fetch(`${API_URL}/api/groups`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            name: groupName,
            description: groupDescription,
            owner_id: currentUser.id,
            members: tempMembers
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            successDiv.textContent = 'Group created successfully!';
            tempMembers = [];
            
            setTimeout(() => {
                closeCreateGroupModal();
                loadGroups();
            }, 1500);
        } else {
            errorDiv.textContent = data.error || 'Failed to create group';
        }
    })
    .catch(error => {
        console.error('Create group error:', error);
        errorDiv.textContent = 'Network error. Please try again.';
    });
  
}

function addMember() {
  const memberEmail = document.getElementById('memberEmail').value.trim();

  if (!memberEmail) {
    alert('Please enter an email address.');
    return;
  }
  
  if (!memberEmail.includes('@')) {
    alert('Please enter a valid email address.')
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
    const currentUser = JSON.parse(localStorage.getItem('currentUser'));
    const groupsGrid = document.getElementById('groupsGrid');
    
    groupsGrid.innerHTML = '<p>Loading groups...</p>';
    
    fetch(`${API_URL}/api/groups?user_id=${currentUser.id}`)
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                const groups = data.groups;
                
                if (groups.length === 0) {
                    groupsGrid.innerHTML = `
                        <div class="empty-state">
                            <div class="empty-state-icon"> X </div>
                            <h3>No study groups yet</h3>
                            <p>Create your first group to get started!</p>
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
                    
                    const moreMembers = group.members.length > 3 ?
                        `<span class="member-badge">+${group.members.length - 3} more</span>` : '';
                    
                    groupCard.innerHTML = `
                        <h3>${group.name}</h3>
                        <p>${group.description || 'No description'}</p>
                        <p><strong>Created by:</strong> ${group.ownerName}</p>
                        <div class="group-members">
                            ${membersHtml}
                            ${moreMembers}
                        </div>
                    `;
                    
                    groupsGrid.appendChild(groupCard);
                });
            } else {
                groupsGrid.innerHTML = '<p>Failed to load groups</p>';
            }
        })
        .catch(error => {
            console.error('Load groups error:', error);
            groupsGrid.innerHTML = '<p>Network error. Please try again.</p>';
        });
}


function viewGroup(groupId) {

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

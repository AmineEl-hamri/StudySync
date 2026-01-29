
let tempMembers = [];

function createGroup(event) {
  event.preventDefault();

  const currentUser = JSON.parse(localStorage.getItem('currentUser'));
  const groupName = document.getElementById('groupName').value;
  const groupDescription = document.getElementById('groupDescription').value;

  const newGroup = {
    id: Date.now(),
    name: groupName,
    description: groupDescription,
    ownerId: currentUser.id,
    ownerName: currentUser.name,
    members: [currentUser.email, ...tempMembers],
    createdAt: new Date().toISOString(),
    meetings: []
  };

  let groups = JSON.parse(localStorage.getItem('groups')) || [];
  groups.push(newGroup);
  localStorage.setItem('groups', JSON.stringify(groups));

  document.getElementById('createGroupSuccess').textContent = "Success!";
  tempMembers = [];

  setTimeout(() => {
    closeCreateGroupModal();
    loadGroups();
  }, 1500);
  
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
  const groups = JSON.parse(localStorage.getItem('groups')) || [];
  const groupsGrid = document.getElementById('groupsGrid');

  const userGroups = groups.filter(group => 
      group.members.includes(currentUser.email)
  );

  if (userGroups.length === 0) {
      groupsGrid.innerHTML = `
          <div class="empty-state">
              <div class="empty-state-icon">  </div>
              <h3>No study groups yet</h3>
              <p>Create your first group to get started!</p>
          </div>
          `;
          return;
      }
  groupsGrid.innerHTML = '';
  userGroups.forEach(group => {
    const groupCard = document.createElement('div');
    groupCard.className = 'group-card';
    groupCard.onclick = () => viewGroup(group.id);

    const membersHtml = group.members.slice(0, 3).map(email => `<span class="member-badge">${email.split('@')[0]}</span>`).join('');

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

    groupsGrid.appendChild(groupCard);
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

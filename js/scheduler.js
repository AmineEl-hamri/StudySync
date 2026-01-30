let currentGroupId = null;
let selectedSlots = new Set();

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const TIME_SLOTS = ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00'];

function viewGroup(groupId) {
  currentGroupId = groupId;

  const groups = JSON.parse(localStorage.getItem('groups')) || [];
  const group = groups.find(g => g.id === groupId);
    
  if (!group) {
      alert('Group not found!');
      return;
  }

  document.getElementById('dashboard').classList.remove('active');
  document.getElementById('groupDetails').classList.add('active');
}

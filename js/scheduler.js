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

  document.getElementById('groupDetailsName').textContent = group.name;
  document.getElementById('groupDetailsDescription').textContent = group.description || 'No description.';
  document.getElementById('groupDetailsMemberCount').textContent = group.members.length;

  generateAvailabilityGrid();

  loadUserAvailability(groupId);

  showAvailabilityStatus(group);
}

function backToDashboard() {
  document.getElementById('groupDetails').classList.remove('active');
  document.getElementById('dashboard').classList.add('active');
  selectedSlots.clear();
}

function generateAvailabilityGrid() {
  const grid = document.getElementById('availabilityGrid');

  let html = '<table class="availability-table"><thead><tr><th>Time</th>';

  DAYS.forEach(day => {
    html += `<th>${day}</th>`;
  });
  html += '</tr></thead><tbody>';

  TIME_SLOTS.forEach(time => {
    html += `<tr><td class="time-label">${time}</td>`;
    
    DAYS.forEach((day, dayIndex) => {
      const slotId = `${dayIndex}-${time}`;
      html += `<td><div class="time-slot" data-slot="${slotId}" onclick="toggleSlot('${slotId}')"></div></td>`;
    });
     
    html += '</tr>';
  });
  html += '</tbody></table>';
  grid.innerHTML = html;
}

function toggleSlot(slotId) {
  const slotElement = document.querySelector(`[data-slot="${slotId}"]`);

  if (selectedSlots.has(slotId)) {
    selectedSlots.delete(slotId);
    slotElement.classList.remove('selected');
  } else {
    selectedSlots.add(slotId);
    slotElement.classList.add('selected');
  }
}

function saveAvailability() {
  if (selectedSlots.size === 0) {
    alert('Please select at least one slot!');

  return;
  }

  const currentUser = JSON.parse(localStorage.getItem('currentUser'));

  let availabilityData = JSON.parse(localStorage.getItem('availability')) || {};

  if (!availabilityData[currentGroupId]) {
    availabilityData[currentGroupId] = {};
  }

  availabilityData[currentGroupId][currentUser.email] = {
    slots: Array.from(selectedSlots), savedAt: new Date().toISOString()
  };

  localStorage.setItem('availability', JSON.stringify(availabilityData));

  alert('Availability saved successfully!');

  const groups = JSON.parse(localStorage.getItem('groups')) || [];
  const group = groups.find(g => g.id === currentGroupId);
  showAvailabilityStatus(group);
}

function clearAvailability() {
  selectedSlots.clear();
  document.querySelectorAll('.time-slot.selected').forEach(slot => {
    slot.classList.remove('selected');
  });
}

function loadUserAvailability(groupId) {
  const currentUser = JSON.parse(localStorage.getItem('currentUser'));
  const availabilityData = JSON.parse(localStorage.getItem('availability')) || {};

  if (availabilityData[groupId] && availabilityData[groupId][currentUser.email]) {
    const userAvailability = availabilityData[groupId][currentUser.email];
    selectedSlots = new Set(userAvailability.slots);

    selectedSlots.forEach(slotId => {
      const slotElement = document.querySelector(`[data-slot="${slotId}"]`);
      if (slotElement) {
        slotElement.classList.add('selected');
      }
    });
  }
}

function showAvailabilityStatus(group) {
  const statusDiv = document.getElementById('availabilityStatus');
  const availabilityData = JSON.parse(localStorage.getItem('availability')) || {};
  const groupAvailability = availabilityData[currentGroupId] || {};
    
    let html = '';
    
    group.members.forEach(memberEmail => {
        const hasSubmitted = groupAvailability[memberEmail] !== undefined;
        const statusClass = hasSubmitted ? 'submitted' : 'pending';
        const statusText = hasSubmitted ? '✓ Submitted' : '⏳ Pending';
        
        html += `
            <div class="member-status">
                <span class="status-indicator ${statusClass}"></span>
                <span><strong>${memberEmail.split('@')[0]}</strong></span>
                <span style="margin-left: auto; color: ${hasSubmitted ? '#10B981' : '#F59E0B'};">
                    ${statusText}
                </span>
            </div>
        `;
    });
    
    statusDiv.innerHTML = html;
}
                                                      
function findMeetingTimes() {
  const availabilityData = JSON.parse(localStorage.getItem('availability')) || {};
  const groupAvailability = availabilityData[currentGroupId] || {};

  const submissionCount = Object.keys(groupAvailability).length;

  if (submissionCount < 2) {
    alert('Need at least 2 members to submit availability!');
    return;
  }

  const optimalTimes = runCSPAlgorithm(groupAvailability);

  displayScheduleResults(optimalTimes, groupAvailability);
}

function runCSPAlgorithm(groupAvailability) {
  const slotCounts = {};

  Object.values(groupAvailability).forEach(userAvail => {
    userAvail.slots.forEach(slot => {
      if (!slotCounts[slot]) {
        slotCounts[slot] = {
          count: 0, members: []
        };
      }
      slotCounts[slot].count++;

      const email = Object.keys(groupAvailability).find(
        key => groupAvailability[key] === userAvail);
      slotCounts[slot].members.push(email);
    });
  });

  const sortedSlots = Object.entries(slotCounts)
  .sort((a, b) => b[1].count - a[1].count)
  .slice(0, 5);

  return sortedSlots.map(([slotId, data]) => {
    const [dayIndex, time] = slotId.split('-');
    return {
      day: DAYS[parseInt(dayIndex)],
      time: time,
      availableCount: data.count,
      totalMembers: Object.keys(groupAvailability).length,
      members: data.members,
      score: (data.count / Object.keys(groupAvailability).length * 100).toFixed(0)
    };
  });
}

function displayScheduleResults(optimalTimes, groupAvailability) {
  const resultsDiv = document.getElementById('scheduleResults');
  const timesDiv = document.getElementById('recommendedTimes');

  if (optimalTimes.length === 0) {
    timesDiv.innerHTML = '<p>No times found. Try selecting more availability!</p>';
    resultsDiv.style.display = 'block';
    return;
  }
  
  let html = '';

  optimalTimes.forEach((option, index) => {
    html += `
        <div class="time-option">
            <h3>Option ${index + 1}: ${option.day} at ${option.time}</h3>
            <p>
                <span class="time-option-score">${option.score}% Match</span>
                ${option.availableCount} of ${option.totalMembers} members available
            </p>
            <p><strong>Available members:</strong></p>
            <div class="available-members">
                ${option.members.map(email => 
                    `<span class="member-badge">${email.split('@')[0]}</span>`
                ).join('')}
            </div>
        </div>
    `;
  });

  timesDiv.innerHTML = html;
  resultsDiv.style.display = 'block';

  resultsDiv.scrollIntoView({behavior: 'smooth', block: 'start' });
}

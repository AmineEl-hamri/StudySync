let currentGroupId = null;
let selectedSlots = new Set();

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const TIME_SLOTS = ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00'];

function viewGroup(groupId) {
  currentGroupId = groupId;    
  fetch(`${API_URL}/api/groups?user_id=${currentUser.id}`)
      .then(response => response.json())
      .then(data => {
          if (data.success) {
              const group = data.groups.find(g => g.id === groupId);
              
              if (!group) {
                  alert('Group not found!');
                  return;
              }
                
              document.getElementById('dashboard').classList.remove('active');
              document.getElementById('groupDetails').classList.add('active');
                
              document.getElementById('groupDetailsName').textContent = group.name;
              document.getElementById('groupDetailsDescription').textContent = group.description || 'No description';
              document.getElementById('groupDetailsMemberCount').textContent = group.members.length;
                
              generateAvailabilityGrid();
                
              loadAvailability(groupId);
          }
      })
        .catch(error => {
            console.error('View group error:', error);
            alert('Failed to load group details');
        });
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
        alert('Please select at least one time slot!');
        return;
    }
    
    const currentUser = JSON.parse(localStorage.getItem('currentUser'));
    
    fetch(`${API_URL}/api/availability`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            group_id: currentGroupId,
            user_id: currentUser.id,
            slots: Array.from(selectedSlots)
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            alert(' Availability saved successfully!');
            loadAvailability(currentGroupId);
        } else {
            alert('Failed to save availability: ' + (data.error || 'Unknown error'));
        }
    })
    .catch(error => {
        console.error('Save availability error:', error);
        alert('Network error. Please try again.');
    });
}

function clearAvailability() {
  selectedSlots.clear();
  document.querySelectorAll('.time-slot.selected').forEach(slot => {
    slot.classList.remove('selected');
  });
}

function loadAvailability(groupId) {
    const currentUser = JSON.parse(localStorage.getItem('currentUser'));
    
    fetch(`${API_URL}/api/availability/${groupId}`)
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                const availability = data.availability;
                
                if (availability[currentUser.email]) {
                    selectedSlots = new Set(availability[currentUser.email].slots);
                    
                    selectedSlots.forEach(slotId => {
                        const slotElement = document.querySelector(`[data-slot="${slotId}"]`);
                        if (slotElement) {
                            slotElement.classList.add('selected');
                        }
                    });
                }
                
                showAvailabilityStatus(availability);
            }
        })
        .catch(error => {
            console.error('Load availability error:', error);
        });
}


function showAvailabilityStatus(availability) {
    const statusDiv = document.getElementById('availabilityStatus');
    
    const currentUser = JSON.parse(localStorage.getItem('currentUser'));
    
    fetch(`${API_URL}/api/groups?user_id=${currentUser.id}`)
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                const group = data.groups.find(g => g.id === currentGroupId);
                if (!group) return;
                
                let html = '';
                
                group.members.forEach(memberEmail => {
                    const hasSubmitted = availability[memberEmail] !== undefined;
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
        });
}
                                                      
function findMeetingTimes() {
    // Call API to run CSP algorithm
    fetch(`${API_URL}/api/schedule/${currentGroupId}`)
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                displayScheduleResults(data.optimal_times);
            } else {
                alert(data.error || 'Failed to find optimal times');
            }
        })
        .catch(error => {
            console.error('Find times error:', error);
            alert('Network error. Please try again.');
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

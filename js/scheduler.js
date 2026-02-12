let currentGroupId = null;
let selectedSlots = new Set();

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const TIME_SLOTS = ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00'];

function viewGroup(groupId) {
  currentGroupId = groupId;    

  const currentUser = JSON.parse(localStorage.getItem('currentUser'));

  if (!currentUser) {
    alert('Please log in first!');
    openLoginModal();
    return;
  }
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
    let travelInfoHtml = '';

    if (option.travel_info && Object.keys(option.travel_info).length > 0) {
      travelInfoHtml = '<div class="travel_info"><p><strong>Travel times:</strong></p>';
      for (const [member, minutes] of Object.entries(option.travel_info)) {
        travelInfoHtml += `<span class="travel-badge">${member.split('@')[0]}: ${minutes} min </span>`;
      }
      travelInfoHtml += '</div>';
    }
    
    html += `
        <div class="time-option">
            <h3>Option ${index + 1}: ${option.day} at ${option.time}</h3>
            <p>
                <span class="time-option-score">${option.score}% Match</span>
                ${option.available_count} of ${option.total_members} members available
            </p>
            <p><strong>Available members:</strong></p>
            <div class="available-members">
                ${option.members.map(email => 
                    `<span class="member-badge">${email.split('@')[0]}</span>`
                ).join('')}
            </div>
            ${travelInfoHtml}
        </div>
    `;
  });

  timesDiv.innerHTML = html;
  resultsDiv.style.display = 'block';

  resultsDiv.scrollIntoView({behavior: 'smooth', block: 'start' });
}

function importGoogleCalendar() {
    const currentUser = JSON.parse(localStorage.getItem('currentUser'));
    
    if (!currentUser) {
        alert('Please login first!');
        return;
    }
    
    // Show loading
    const importBtn = document.getElementById('importCalendarBtn');
    importBtn.disabled = true;
    importBtn.textContent = '🔄 Connecting...';

  fetch(`${API_URL}/api/oauth/status/${currentUser.id}`)
  .then(response => response.json())
  .then(data => {
    if (data.success && data.google_connected) {
      importCalendarEvents();
    } else {
      startOAuthFlow(currentUser.id, importBtn);
    }
  })
  .catch(error => { 
    console.error('OAuth status check error:', error);
    importBtn.disabled = false;
    importBtn.textContent = '📅 Import from Google Calendar';
  });
}

function startOAuthFlow(userId, importBtn) {
  importBtn.textContent = '🔄 Connecting...';
  
    // Initiate OAuth flow
    fetch(`${API_URL}/api/oauth/google/initiate?user_id=${userId}`, {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
        }
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            // Open OAuth popup
            const popup = window.open(
                data.authorization_url,
                'Google Calendar Authorization',
                'width=600,height=700'
            );
            
            // Listen for OAuth success message
            window.addEventListener('message', function(event) {
                if (event.data.type === 'oauth_success' && event.data.provider === 'google') {
                    importBtn.textContent = '📅 Import from Google Calendar';
                    importBtn.disabled = false;
                    
                    // Now import calendar events
                    importCalendarEvents();
                }
            });
        } else {
            alert('Failed to initiate calendar connection');
            importBtn.disabled = false;
            importBtn.textContent = '📅 Import from Google Calendar';
        }
    })
    .catch(error => {
        console.error('OAuth initiate error:', error);
        alert('Network error. Please try again.');
        importBtn.disabled = false;
        importBtn.textContent = '📅 Import from Google Calendar';
    });
}
function importCalendarEvents() {
    const currentUser = JSON.parse(localStorage.getItem('currentUser'));
    
    // Calculate current week
    const today = new Date();
    const dayOfWeek = today.getDay();

    const monday = new Date(today);
    const daysToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  monday.setDate(today.getDate() + daysToMonday);
  monday.setHours(0,0,0,0);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  
    const importBtn = document.getElementById('importCalendarBtn');
    importBtn.textContent = '⏳ Importing this week...';
    
    // Call import endpoint
    fetch(`${API_URL}/api/calendar/import/${currentGroupId}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            user_id: currentUser.id,
            start_date: monday.toISOString(),
            end_date: sunday.toISOString()
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
          const weekStr = `${monday.toLocaleDateString()} - ${sunday.toLocaleDateString()}`;
            alert(`✅ Success! Imported this week (${weekStr})\n${data.slots_count} available time slots found!`);
            
            // Reload availability to show imported data
            loadAvailability(currentGroupId);
            
            importBtn.textContent = '✅ Imported!';
            setTimeout(() => {
                importBtn.textContent = '📅 Import from Google Calendar';
            }, 3000);
        } else {
            alert('Failed to import calendar: ' + (data.error || 'Unknown error'));
            importBtn.textContent = '📅 Import from Google Calendar';
        }
    })
    .catch(error => {
        console.error('Calendar import error:', error);
        alert('Network error. Please try again.');
        importBtn.textContent = '📅 Import from Google Calendar';
    });
}

function openLocationSettings() {
  const currentUser = JSON.parse(localStorage.getItem('currentUser'));

  if (!currentUser) {
    alert('Please log in first!');
    return;
  }

  loadUserLocations(currentUser.id);

  document.getElementById('locationModal').style.display = 'block';
}

function closeLocationModal() {
  document.getElementById('locationModal').style.display = 'none';
}

function loadUserLocations(userId) {
  fetch(`${API_URL}/api/locations/${userId}`)
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                // Populate input fields with saved locations
                data.locations.forEach(loc => {
                    if (loc.type === 'home') {
                        document.getElementById('homeAddress').value = loc.address;
                    } else if (loc.type === 'work') {
                        document.getElementById('workAddress').value = loc.address;
                    }
                });
                
                displaySavedLocations(data.locations);
            }
        })
        .catch(error => {
            console.error('Load locations error:', error);
        });
}

function displaySavedLocations(locations) {
    const container = document.getElementById('savedLocations');
    
    if (locations.length === 0) {
        container.innerHTML = '<p style="color: #9CA3AF;">No locations saved yet.</p>';
        return;
    }
    
    let html = '<h3 style="margin-bottom: 10px;">Saved Locations:</h3>';
    
    locations.forEach(loc => {
        const icon = loc.type === 'home' ? '🏠' : '🏢';
        const label = loc.type === 'home' ? 'Home' : 'Work';
        const defaultBadge = loc.is_default ? '<span style="background: #10B981; color: white; padding: 2px 8px; border-radius: 4px; font-size: 12px; margin-left: 8px;">Default</span>' : '';
        
        html += `
            <div style="background: #F3F4F6; padding: 12px; border-radius: 8px; margin-bottom: 8px;">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <strong>${icon} ${label}</strong> ${defaultBadge}
                        <p style="margin: 4px 0 0 0; color: #6B7280; font-size: 13px;">${loc.address}</p>
                    </div>
                </div>
            </div>
        `;
    });
    
    container.innerHTML = html;
}

function saveLocation(locationType) {
    const currentUser = JSON.parse(localStorage.getItem('currentUser'));
    
    const address = locationType === 'home' 
        ? document.getElementById('homeAddress').value.trim()
        : document.getElementById('workAddress').value.trim();
    
    if (!address) {
        alert('Please enter an address!');
        return;
    }
    
    fetch(`${API_URL}/api/locations`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            user_id: currentUser.id,
            location_type: locationType,
            address: address
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            alert(`✅ ${locationType === 'home' ? 'Home' : 'Work'} location saved!`);
            loadUserLocations(currentUser.id); // Reload to show updated list
        } else {
            alert('Failed to save location: ' + (data.error || 'Unknown error'));
        }
    })
    .catch(error => {
        console.error('Save location error:', error);
        alert('Network error. Please try again.');
    });
}

function loadMeetingLocation() {
    if (!currentGroupId) return;
    
    fetch(`${API_URL}/api/groups/${currentGroupId}/location`)
        .then(response => response.json())
        .then(data => {
            if (data.success && data.meeting_location) {
                document.getElementById('meetingLocation').value = data.meeting_location;
                document.getElementById('currentMeetingLocation').innerHTML = 
                    `<strong>Current:</strong> ${data.meeting_location}`;
            } else {
                document.getElementById('currentMeetingLocation').innerHTML = 
                    '<em style="color: #9CA3AF;">No meeting location set</em>';
            }
        })
        .catch(error => {
            console.error('Load meeting location error:', error);
        });
}

function saveMeetingLocation() {
    const location = document.getElementById('meetingLocation').value.trim();
    
    if (!location) {
        alert('Please enter a meeting location!');
        return;
    }
    
    fetch(`${API_URL}/api/groups/${currentGroupId}/location`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            location: location
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            alert('✅ Meeting location saved!');
            document.getElementById('currentMeetingLocation').innerHTML = 
                `<strong>Current:</strong> ${location}`;
        } else {
            alert('Failed to save location: ' + (data.error || 'Unknown error'));
        }
    })
    .catch(error => {
        console.error('Save meeting location error:', error);
        alert('Network error. Please try again.');
    });
}

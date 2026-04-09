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
                
              hideAllSections();
              document.getElementById('groupDetails').style.display = 'block';
                
              document.getElementById('groupDetailsName').textContent = group.name;
              document.getElementById('groupDetailsDescription').textContent = group.description || 'No description';
              document.getElementById('groupDetailsMemberCount').textContent = group.members.length;

            const isOwner = group.ownerId === currentUser.id;
            const locationSection = document.querySelector('.location-section');
            const locationInput = document.getElementById('meetingLocation');
            const locationButton = locationSection.querySelector('button');
            const locationLabel = locationSection.querySelector('label');

            if (isOwner) {
                    locationInput.disabled = false;
                    locationButton.style.display = 'inline-block';
                    locationLabel.innerHTML = '📍 Meeting Location <span style="color: #10B981; font-size: 12px; font-weight: normal;">(You are the owner)</span>';
                } else {
                    locationInput.disabled = true;
                    locationButton.style.display = 'none';
                    locationLabel.innerHTML = '📍 Meeting Location <span style="color: #6B7280; font-size: 12px; font-weight: normal;">(View Only - only owner can edit)</span>';
                }
              generateAvailabilityGrid();
                
              loadAvailability(groupId);
            loadMeetingLocation();
            loadGroupMeetings();
            offerToApplyPreferences(groupId);
          }
      })
        .catch(error => {
            console.error('View group error:', error);
            alert('Failed to load group details');
        });
}

function backToDashboard() {
  hideAllSections();
  document.getElementById('dashboard').style.display = 'block';
  selectedSlots.clear();
}
let isDragging = false;
let dragMode = null;

function generateAvailabilityGrid() {
    const grid = document.getElementById('availabilityGrid');

    let html = '<table class="availability-table"><thead><tr><th>Time</th>';
    DAYS.forEach((day, dayIndex) => {
        html += `<th class="day-header" onclick="selectEntireDay(${dayIndex})" style="cursor:pointer;" title="Click to select all ${day}">${day}</th>`;
    });
    html += '</tr></thead><tbody>';

    TIME_SLOTS.forEach((time, timeIndex) => {
        html += `<tr>
            <td class="time-label" onclick="selectEntireRow('${time}')" style="cursor:pointer;" title="Click to select all ${time}">
                ${time}
            </td>`;
        DAYS.forEach((day, dayIndex) => {
            const slotId = `${dayIndex}-${time}`;
            html += `<td>
                <div class="time-slot"
                    data-slot="${slotId}"
                    onmousedown="startDrag('${slotId}', event)"
                    onmouseenter="continueDrag('${slotId}')"
                    onmouseup="endDrag()"
                    onclick="toggleSlot('${slotId}')">
                </div>
            </td>`;
        });
        html += '</tr>';
    });

    html += '</tbody></table>';
    grid.innerHTML = html;

    // Prevent text selection while dragging
    grid.addEventListener('mouseleave', endDrag);
    document.addEventListener('mouseup', endDrag);
}

function toggleSlot(slotId) {
    if (isDragging) return; // handled by drag
    const slotElement = document.querySelector(`[data-slot="${slotId}"]`);
    if (selectedSlots.has(slotId)) {
        selectedSlots.delete(slotId);
        slotElement.classList.remove('selected');
    } else {
        selectedSlots.add(slotId);
        slotElement.classList.add('selected');
    }
}
function continueDrag(slotId) {
    if (dragMode === null) return;
    isDragging = true;
    applyDragToSlot(slotId);
}

function endDrag() {
    isDragging = false;
    dragMode = null;
}

function applyDragToSlot(slotId) {
    const slotElement = document.querySelector(`[data-slot="${slotId}"]`);
    if (!slotElement) return;
    if (dragMode === 'select') {
        selectedSlots.add(slotId);
        slotElement.classList.add('selected');
    } else {
        selectedSlots.delete(slotId);
        slotElement.classList.remove('selected');
    }
}

function selectEntireDay(dayIndex) {
    const daySlots = TIME_SLOTS.map(time => `${dayIndex}-${time}`);
    const allSelected = daySlots.every(slot => selectedSlots.has(slot));

    daySlots.forEach(slotId => {
        const el = document.querySelector(`[data-slot="${slotId}"]`);
        if (!el) return;
        if (allSelected) {
            selectedSlots.delete(slotId);
            el.classList.remove('selected');
        } else {
            selectedSlots.add(slotId);
            el.classList.add('selected');
        }
    });
}

function selectEntireRow(time) {
    const rowSlots = DAYS.map((_, dayIndex) => `${dayIndex}-${time}`);
    const allSelected = rowSlots.every(slot => selectedSlots.has(slot));

    rowSlots.forEach(slotId => {
        const el = document.querySelector(`[data-slot="${slotId}"]`);
        if (!el) return;
        if (allSelected) {
            selectedSlots.delete(slotId);
            el.classList.remove('selected');
        } else {
            selectedSlots.add(slotId);
            el.classList.add('selected');
        }
    });
}

function selectAllAvailability() {
    DAYS.forEach((_, dayIndex) => {
        TIME_SLOTS.forEach(time => {
            const slotId = `${dayIndex}-${time}`;
            const el = document.querySelector(`[data-slot="${slotId}"]`);
            if (el) {
                selectedSlots.add(slotId);
                el.classList.add('selected');
            }
        });
    });
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

function displayScheduleResults(optimalTimes) {
    const currentUser = JSON.parse(localStorage.getItem('currentUser'));
    
    // check if user is the group owner
    fetch(`${API_URL}/api/groups?user_id=${currentUser.id}`)
        .then(r => r.json())
        .then(data => {
            const group = data.groups.find(g => g.id === currentGroupId);
            const isOwner = group && group.ownerId === currentUser.id;

            const resultsDiv = document.getElementById('scheduleResults');
            const timesDiv = document.getElementById('recommendedTimes');

            if (optimalTimes.length === 0) {
                timesDiv.innerHTML = '<p>No times found. Try selecting more availability!</p>';
                resultsDiv.style.display = 'block';
                return;
            }

            let html = '';
            optimalTimes.forEach(function(option, index) {
                let travelInfoHtml = '';
                if (option.travel_info && Object.keys(option.travel_info).length > 0) {
                    travelInfoHtml = '<div class="travel-info">';
                    travelInfoHtml += '<p><strong>🚗 Travel Times & Departure Schedule:</strong></p>';
                    for (const email in option.travel_info) {
                        const travel = option.travel_info[email];
                        const memberName = email.split('@')[0];
                        let trafficIcon = '🟢';
                        let trafficText = 'Light traffic';
                        if (travel.duration_minutes > 45) { trafficIcon = '🔴'; trafficText = 'Heavy traffic'; }
                        else if (travel.duration_minutes > 25) { trafficIcon = '🟡'; trafficText = 'Moderate traffic'; }
                        travelInfoHtml += '<div class="travel-timeline">';
                        travelInfoHtml += '<div class="travel-member-name">' + memberName + '</div>';
                        travelInfoHtml += '<div class="timeline-row">';
                        travelInfoHtml += '<span class="timeline-step departure">🏠 Leave: <strong>' + travel.departure_time + '</strong></span>';
                        travelInfoHtml += '<span class="timeline-arrow">→</span>';
                        travelInfoHtml += '<span class="timeline-step travel">' + trafficIcon + ' ' + travel.duration_text + ' <small>(' + trafficText + ')</small></span>';
                        travelInfoHtml += '<span class="timeline-arrow">→</span>';
                        travelInfoHtml += '<span class="timeline-step arrival">📍 Arrive: <strong>' + travel.arrival_time + '</strong></span>';
                        travelInfoHtml += '</div></div>';
                    }
                    travelInfoHtml += '</div>';
                }

                html += '<div class="time-option">';
                html += '<h3>Option ' + (index + 1) + ': ' + option.day + ' at ' + option.time + '</h3>';
                html += '<p><span class="time-option-score">' + option.score + '% Match</span> ';
                html += option.available_count + ' of ' + option.total_members + ' members available</p>';
                html += '<p><strong>Available members:</strong></p>';
                html += '<div class="available-members">';
                option.members.forEach(m => html += '<span class="member-badge">' + m.split('@')[0] + '</span>');
                html += '</div>';
                html += travelInfoHtml;

                // ← Only show schedule button to owner
                if (isOwner) {
                    html += '<div style="margin-top: 15px;">';
                    html += '<button class="btn-schedule-meeting" onclick="scheduleMeeting(\'' + option.day + '\', \'' + option.time + '\')">📅 Schedule This Meeting</button>';
                    html += '</div>';
                } else {
                    html += '<p style="margin-top:15px; color:#6B7280; font-size:0.9rem;">⚠️ Only the group owner can schedule meetings.</p>';
                }

                html += '</div>';
            });

            timesDiv.innerHTML = html;
            resultsDiv.style.display = 'block';
            resultsDiv.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
}
function checkTrafficAlerts(optimalTimes) {
    let alerts = [];
    
    optimalTimes.forEach(function(option) {
        if (option.travel_info) {
            for (const email in option.travel_info) {
                const travel = option.travel_info[email];
                if (travel.duration_minutes > 45) {
                    alerts.push(email.split('@')[0] + ' has heavy traffic (' + travel.duration_text + ')');
                }
            }
        }
    });
    
    if (alerts.length > 0) {
        return '<div class="traffic-alert">⚠️ <strong>Traffic Alert:</strong> ' + alerts.join(', ') + '</div>';
    }
    return '';
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
      let badgeHtml = '';
      if (loc.is_default) {
        badgeHtml = '<span style="background: #10B981; color: white; padding: 2px 8px; border-radius: 4px; font-size: 12px; margin-left: 8px;">Default</span>';
      }
        html += '<div style="background: #F3F4F6; padding: 12px; border-radius: 8px; margin-bottom: 8px;">';
        html += '<div style="display: flex; justify-content: space-between; align-items: center;">';
        html += '<div>';
        html += '<strong>' + icon + ' ' + label + '</strong> ' + badgeHtml;
        html += '<p style="margin: 4px 0 0 0; color: #6B7280; font-size: 13px;">' + loc.address + '</p>';
        html += '</div>';
        html += '</div>';
        html += '</div>';
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
  const currentUser = JSON.parse(localStorage.getItem('currentUser'));
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
            location: location,
          user_id: currentUser.id
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

function scheduleMeeting(dayOfWeek, meetingTime) {
    const currentUser = JSON.parse(localStorage.getItem('currentUser'));
    
    if (!currentUser) {
        alert('Please log in to schedule meetings');
        return;
    }
    
    // Calculate next occurrence of this day
    const today = new Date();
    const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const targetDay = daysOfWeek.indexOf(dayOfWeek);
    const currentDay = today.getDay();
    
    let daysUntilMeeting = targetDay - currentDay;
    if (daysUntilMeeting <= 0) {
        daysUntilMeeting += 7; // Next week
    }
    
    const meetingDate = new Date(today);
    meetingDate.setDate(today.getDate() + daysUntilMeeting);
    const meetingDateStr = meetingDate.toISOString().split('T')[0]; // YYYY-MM-DD
    
    if (!confirm(`Schedule meeting for ${dayOfWeek}, ${meetingDateStr} at ${meetingTime}?`)) {
        return;
    }
    
    fetch(`${API_URL}/api/meetings`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            group_id: currentGroupId,
            day_of_week: dayOfWeek,
            meeting_time: meetingTime,
            meeting_date: meetingDateStr,
            created_by: currentUser.id
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            let message = '✅ Meeting scheduled successfully!';
            if (data.email_sent) {
                message += '\n📧 Email notifications sent to all members.';
            }
            alert(message);
            loadGroupMeetings(); // Refresh meetings display
        } else {
            alert('Failed to schedule meeting: ' + (data.error || 'Unknown error'));
    }
})
    .catch(error => {
        console.error('Schedule meeting error:', error);
        alert('Network error. Please try again.');
    });
}

function loadGroupMeetings() {
    if (!currentGroupId) return;
    
    fetch(`${API_URL}/api/meetings/${currentGroupId}`)
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                displayGroupMeetings(data.meetings);
            }
        })
        .catch(error => {
            console.error('Load meetings error:', error);
        });
}

function displayGroupMeetings(meetings) {
    const container = document.getElementById('scheduledMeetings');
    
    if (meetings.length === 0) {
        container.innerHTML = '<p style="color: #666;">No meetings scheduled yet.</p>';
        return;
    }
    
    let html = '';
    
    meetings.forEach(function(meeting) {
        // Format date nicely
        const date = new Date(meeting.meeting_date);
        const formattedDate = date.toLocaleDateString('en-GB', { 
            weekday: 'long', 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric' 
        });
        
        html += '<div class="meeting-card">';
        html += '<div class="meeting-date">📅 ' + meeting.day_of_week + ', ' + meeting.meeting_time + '</div>';
        html += '<p><strong>Date:</strong> ' + formattedDate + '</p>';
        html += '<p><strong>Location:</strong> ' + (meeting.location || 'TBD') + '</p>';
        html += '<p><strong>Scheduled by:</strong> ' + meeting.created_by_name + '</p>';
        html += '<button class="btn-delete-meeting" onclick="deleteMeeting(' + meeting.id + ')">🗑️ Cancel Meeting</button>';
        html += '</div>';
    });
    
    container.innerHTML = html;
}

function deleteMeeting(meetingId) {
    if (!confirm('Are you sure you want to cancel this meeting?')) {
        return;
    }
    
    fetch(`${API_URL}/api/meetings/${meetingId}`, {
        method: 'DELETE'
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            alert('Meeting cancelled');
            loadGroupMeetings(); // Refresh the list
        } else {
            alert('Failed to cancel meeting');
        }
    })
    .catch(error => {
        console.error('Delete meeting error:', error);
        alert('Network error');
    });
}

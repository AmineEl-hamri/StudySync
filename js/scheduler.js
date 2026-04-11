let currentGroupId = null;
let selectedSlots = new Set();
let currentGroupOwnerIdCache = null; // cached owner ID to avoid double fetches. 

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const TIME_SLOTS = ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00'];

function viewGroup(groupId) {
    currentGroupId = groupId;
    currentGroupOwnerIdCache = null; // reset cache on new group
 
    const currentUser = getCurrentUser();
    if (!currentUser) { openLoginModal(); return; }
 
    fetch(`${API_URL}/api/groups?user_id=${currentUser.id}`)
        .then(r => r.json())
        .then(data => {
            if (!data.success) { alert('Failed to load group.'); return; }
 
            const group = data.groups.find(g => g.id === groupId);
            if (!group) { alert('Group not found!'); return; }
 
            // Cache owner ID so displayScheduleResults doesn't need to re-fetch
            currentGroupOwnerIdCache = group.ownerId;
 
            hideAllSections();
            document.getElementById('groupDetails').style.display = 'block';
 
            document.getElementById('groupDetailsName').textContent = group.name;
            document.getElementById('groupDetailsDescription').textContent = group.description || 'No description';
            document.getElementById('groupDetailsMemberCount').textContent = group.members.length;
 
            const isOwner = Number(currentUser.id) === Number(group.ownerId);
            const locationSection = document.querySelector('.location-section');
            const locationInput = document.getElementById('meetingLocation');
            const locationButton = locationSection.querySelector('button');
            const locationLabel = locationSection.querySelector('label');
 
            if (isOwner) {
                locationInput.disabled = false;
                locationButton.style.display = 'inline-block';
                locationLabel.innerHTML = '📍 Meeting Location <span style="color:#10B981;font-size:12px;font-weight:normal;">(You are the owner)</span>';
            } else {
                locationInput.disabled = true;
                locationButton.style.display = 'none';
                locationLabel.innerHTML = '📍 Meeting Location <span style="color:#6B7280;font-size:12px;font-weight:normal;">(View Only — only the owner can edit)</span>';
            }
 
            generateAvailabilityGrid();
            loadAvailability(groupId);
            loadMeetingLocation();
            loadGroupMeetings();
            offerToApplyPreferences(groupId);
        })
        .catch(() => alert('Network error loading group. Please try again.'));
}

function backToDashboard() {
  hideAllSections();
  document.getElementById('dashboard').style.display = 'block';
  selectedSlots.clear();
  currentGroupOwnerIdCache = null;
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

    TIME_SLOTS.forEach((time) => {
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
                    ontouchstart="handleTouchStart('${slotId}', event)"
                    ontouchmove="handleTouchMove(event)"
                    ontouchend="endDrag()">
                </div>
            </td>`;
        });
        html += '</tr>';
    });

    html += '</tbody></table>';
    grid.innerHTML = html;

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

function startDrag(slotId, event) {
    event.preventDefault();
    isDragging = false;
    dragMode = selectedSlots.has(slotId) ? 'deselect' : 'select';
    applyDragToSlot(slotId);
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

function handleTouchStart(slotId, event) {
    event.preventDefault(); // prevents scroll while selecting
    isDragging = false;
    dragMode = selectedSlots.has(slotId) ? 'deselect' : 'select';
    applyDragToSlot(slotId);
}

function handleTouchMove(event) {
    event.preventDefault();
    const touch = event.touches[0];
    // Find which element is under the finger
    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    if (el && el.classList.contains('time-slot')) {
        const slotId = el.getAttribute('data-slot');
        if (slotId) {
            isDragging = true;
            applyDragToSlot(slotId);
        }
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

let isSaving = false;
let isScheduling = false;

function saveAvailability() {
    if (isSaving) return;
    if (selectedSlots.size === 0) {
        alert('Please select at least one time slot!');
        return;
    }

    const currentUser = getCurrentUser();
    if (!currentUser) { openLoginModal(); return; }
  
    isSaving = true;
    const btn = document.querySelector('.availability-actions .btn-primary');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Saving...'; }

    fetch(`${API_URL}/api/availability`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            group_id: currentGroupId,
            user_id: currentUser.id,
            slots: Array.from(selectedSlots)
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            loadAvailability(currentGroupId);
            showSavedTimestamp();
        } else {
            alert('Failed to save availability: ' + (data.error || 'Unknown error'));
        }
    })
    .catch(error => {
        console.error('Save availability error:', error);
        alert('Network error. Please try again.');
    })
    .finally(() => {
        isSaving = false;
        btn.disabled = false;
        btn.textContent = 'Save My Availability';
    });
}

function showSavedTimestamp() {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    const dateStr = now.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

    let stamp = document.getElementById('availabilitySavedStamp');
    if (!stamp) {
        stamp = document.createElement('div');
        stamp.id = 'availabilitySavedStamp';
        stamp.className = 'saved-stamp';
        const actions = document.querySelector('.availability-actions');
        if (actions) actions.after(stamp);
    }
    stamp.innerHTML = `✅ Availability saved — ${dateStr} at ${timeStr}`;
    stamp.style.opacity = '1';

    // Fades out after 8 seconds but keeps the text
    setTimeout(() => { stamp.style.opacity = '0.5'; }, 8000);
}

function clearAvailability() {
    if (selectedSlots.size === 0) return; // nothing to clear
    if (!confirm('Clear all selected time slots? This cannot be undone.')) return;
    selectedSlots.clear();
    document.querySelectorAll('.time-slot.selected').forEach(slot => {
        slot.classList.remove('selected');
    });
}

function loadAvailability(groupId) {
    const currentUser = getCurrentUser();
    if (!currentUser) return;
    
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
                if (availability[currentUser.email] && availability[currentUser.email].slots.length > 0) {
                    let stamp = document.getElementById('availabilitySavedStamp');
                    if (!stamp) {
                        stamp = document.createElement('div');
                        stamp.id = 'availabilitySavedStamp';
                        stamp.className = 'saved-stamp';
                        const actions = document.querySelector('.availability-actions');
                        if (actions) actions.after(stamp);
                    }
                    stamp.innerHTML = `📋 Availability previously saved, select slots and save to update`;
                    stamp.style.opacity = '0.6';
                }
                updateFindTimesButton(availability);
            }
        })
        .catch(error => {
            console.error('Load availability error:', error);
        });
}

function updateFindTimesButton(availability) {
    const currentUser = getCurrentUser();
    if (!currentUser) return;

    fetch(`${API_URL}/api/groups?user_id=${currentUser.id}`)
        .then(r => r.json())
        .then(data => {
            if (!data.success) return;
            const group = data.groups.find(g => g.id === currentGroupId);
            if (!group) return;

            const totalMembers = group.members.length;
            const submittedCount = Object.keys(availability).length;
            const btn = document.querySelector('.schedule-section .btn-create');
            if (!btn) return;

            if (submittedCount === 0) {
                // Nobody has submitted yet
                btn.textContent = 'Find Optimal Meeting Times';
                btn.style.background = '';
                btn.title = 'No members have submitted availability yet';
            } else if (submittedCount < totalMembers) {
                // Some but not all submitted
                const missing = totalMembers - submittedCount;
                btn.textContent = `Find Times (${submittedCount}/${totalMembers} ready)`;
                btn.style.background = '#D97706'; // amber
                btn.title = `${missing} member${missing > 1 ? 's have' : ' has'} not submitted availability yet — results may be incomplete`;
            } else {
                // Everyone submitted
                btn.textContent = `Find Times (${submittedCount}/${totalMembers} ready ✓)`;
                btn.style.background = '#059669'; // green
                btn.title = 'All members have submitted — click to find the best times';
            }
        });
}


function showAvailabilityStatus(availability) {
    const statusDiv = document.getElementById('availabilityStatus');
    
    const currentUser = getCurrentUser();
    if (!currentUser) return;
    
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
    if (isScheduling) return; // prevent double-click
    isScheduling = true;
    const btn = document.querySelector('.schedule-section .btn-create');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Finding times...'; }

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
        })
        .finally(() => {
            isScheduling = false;
            if (btn) { btn.disabled = false; btn.textContent = 'Find Optimal Meeting Times'; }
        });
}

function displayScheduleResults(optimalTimes) {
    const currentUser = getCurrentUser();
    if (!currentUser) return;
 
    const resultsDiv = document.getElementById('scheduleResults');
    const timesDiv = document.getElementById('recommendedTimes');
 
    if (optimalTimes.length === 0) {
        timesDiv.innerHTML = '<p>No times found where members overlap. Try selecting more availability!</p>';
        resultsDiv.style.display = 'block';
        return;
    }
 
    // Use cached owner ID, avoids a second API call on every schedule result
    const isOwner = currentGroupOwnerIdCache !== null
        ? Number(currentUser.id) === Number(currentGroupOwnerIdCache)
        : false;
 
    let html = '';
    optimalTimes.forEach(function(option, index) {

        const allMemberEmails = option.members_all || [];
        const unavailableMembers = allMemberEmails.filter(m => !option.members.includes(m));
        
        let travelInfoHtml = '';
        if (option.travel_info && Object.keys(option.travel_info).length > 0) {
            travelInfoHtml = '<div class="travel-info"><p><strong>🚗 Travel Times & Departure Schedule:</strong></p>';
            for (const email in option.travel_info) {
                const travel = option.travel_info[email];
                const memberName = email.split('@')[0];
                
                let trafficIcon = '🟢';
                let trafficText = 'Light traffic';
                if (travel.duration_minutes > 45) { trafficIcon = '🔴'; trafficText = 'Heavy traffic'; }
                else if (travel.duration_minutes > 25) { trafficIcon = '🟡'; trafficText = 'Moderate traffic'; }
                travelInfoHtml += `
                    <div class="travel-timeline">
                        <div class="travel-member-name">${memberName}</div>
                        <div class="timeline-row">
                            <span class="timeline-step departure">🏠 Leave: <strong>${travel.departure_time}</strong></span>
                            <span class="timeline-arrow">→</span>
                            <span class="timeline-step travel">${trafficIcon} ${travel.duration_text} <small>(${trafficText})</small></span>
                            <span class="timeline-arrow">→</span>
                            <span class="timeline-step arrival">📍 Arrive: <strong>${travel.arrival_time}</strong></span>
                        </div>
                    </div>`;
            }
            travelInfoHtml += '</div>';
        }
 
        html += `<div class="time-option">
            <h3>Option ${index + 1}: ${option.day} at ${option.time}</h3>
            <p><span class="time-option-score">${option.score}% Match</span> ${option.available_count} of ${option.total_members} members available</p>
            <p><strong>Available members:</strong></p>
            <div class="available-members">${option.members.map(m => `<span class="member-badge">${m.split('@')[0]}</span>`).join('')}</div>
            ${travelInfoHtml}`;
        
        if (unavailableMembers.length > 0) {
            html += '<p style="margin-top:0.5rem;"><strong>Unavailable:</strong></p>';
            html += '<div class="available-members">';
            unavailableMembers.forEach(m => html += `<span class="member-badge unavailable-badge">✗ ${m.split('@')[0]}</span>`);
            html += '</div>';
        }
 
        if (isOwner) {
            html += `<div style="margin-top:15px;">
                <button class="btn-schedule-meeting" onclick="scheduleMeeting('${option.day}', '${option.time}')">📅 Schedule This Meeting</button>
            </div>`;
        } else {
            html += `<p style="margin-top:15px;color:#6B7280;font-size:0.9rem;">⚠️ Only the group owner can schedule meetings.</p>`;
        }
        html += '</div>';
    });
 
    timesDiv.innerHTML = html;
    resultsDiv.style.display = 'block';
    resultsDiv.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function importGoogleCalendar() {
    const currentUser = getCurrentUser();
    if (!currentUser) { alert('Please login first!'); return; }
 
    const importBtn = document.getElementById('importCalendarBtn');
    importBtn.disabled = true;
    importBtn.textContent = '🔄 Connecting...';
 
    fetch(`${API_URL}/api/oauth/status/${currentUser.id}`)
        .then(r => r.json())
        .then(data => {
            if (data.success && data.google_connected) {
                importCalendarEvents();
            } else {
                startOAuthFlow(currentUser.id, importBtn);
            }
        })
        .catch(() => {
            importBtn.disabled = false;
            importBtn.textContent = '📅 Import from Google Calendar';
            alert('Network error. Please try again.');
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

function startOAuthFlow(userId, importBtn) {
    importBtn.textContent = '🔄 Connecting...';
    fetch(`${API_URL}/api/oauth/google/initiate?user_id=${userId}`)
        .then(r => r.json())
        .then(data => {
            if (data.success) {
                window.open(data.authorization_url, 'Google Calendar Authorization', 'width=600,height=700');
                window.addEventListener('message', function handler(event) {
                    if (event.data.type === 'oauth_success' && event.data.provider === 'google') {
                        window.removeEventListener('message', handler);
                        importBtn.textContent = '📅 Import from Google Calendar';
                        importBtn.disabled = false;
                        importCalendarEvents();
                    }
                });
            } else {
                alert('Failed to initiate calendar connection');
                importBtn.disabled = false;
                importBtn.textContent = '📅 Import from Google Calendar';
            }
        })
        .catch(() => {
            alert('Network error. Please try again.');
            importBtn.disabled = false;
            importBtn.textContent = '📅 Import from Google Calendar';
        });
}

function importCalendarEvents() {
    const currentUser = getCurrentUser();
    if (!currentUser) return;
 
    const today = new Date();
    const dayOfWeek = today.getDay();
    const monday = new Date(today);
    monday.setDate(today.getDate() + (dayOfWeek === 0 ? -6 : 1 - dayOfWeek));
    monday.setHours(0, 0, 0, 0);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);
 
    const importBtn = document.getElementById('importCalendarBtn');
    importBtn.textContent = '⏳ Importing this week...';
 
    fetch(`${API_URL}/api/calendar/import/${currentGroupId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            user_id: currentUser.id,
            start_date: monday.toISOString(),
            end_date: sunday.toISOString()
        })
    })
    .then(r => r.json())
    .then(data => {
        if (data.success) {
            const weekStr = `${monday.toLocaleDateString()} - ${sunday.toLocaleDateString()}`;
            alert(`✅ Imported this week (${weekStr})\n${data.slots_count} available slots found!`);
            loadAvailability(currentGroupId);
            importBtn.textContent = '✅ Imported!';
            setTimeout(() => { importBtn.textContent = '📅 Import from Google Calendar'; }, 3000);
        } else {
            alert('Failed to import calendar: ' + (data.error || 'Unknown error'));
            importBtn.textContent = '📅 Import from Google Calendar';
        }
    })
    .catch(() => {
        alert('Network error. Please try again.');
        importBtn.textContent = '📅 Import from Google Calendar';
    })
    .finally(() => {
        importBtn.disabled = false;
    });
}

function openLocationSettings() {
  const currentUser = getCurrentUser();
  if (!currentUser) { openLoginModal(); return; }

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
    const currentUser = getCurrentUser();
    if (!currentUser) { openLoginModal(); return; }
    
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
  const currentUser = getCurrentUser();
  if (!currentUser) { openLoginModal(); return; }
  
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
    const currentUser = getCurrentUser();
    if (!currentUser) { openLoginModal(); return; }
  
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
            created_by: parseInt(currentUser.id)
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
    const currentUser = getCurrentUser();
    const isOwner = currentGroupOwnerIdCache !== null
        ? Number(currentUser?.id) === Number(currentGroupOwnerIdCache)
        : false;
 
    if (meetings.length === 0) {
        container.innerHTML = '<p style="color:#666;">No meetings scheduled yet.</p>';
        return;
    }
 
    let html = '';
    meetings.forEach(function(meeting) {
        const date = new Date(meeting.meeting_date);
        const formattedDate = date.toLocaleDateString('en-GB', {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
        });
    
        // Determine if meeting is in the past
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const isPast = date < today;
    
        // Build status badges
        let badges = '';
        if (isPast) {
            badges += '<span class="meeting-badge badge-past">Past</span>';
        } else {
            badges += '<span class="meeting-badge badge-upcoming">Upcoming</span>';
        }
        if (meeting.email_sent) {
            badges += '<span class="meeting-badge badge-notified">📧 Notified</span>';
        }
        if (!meeting.location) {
            badges += '<span class="meeting-badge badge-warning">📍 No location set</span>';
        }
    
        html += `
            <div class="meeting-card ${isPast ? 'meeting-card-past' : ''}">
                <div class="meeting-card-header">
                    <div class="meeting-date">📅 ${meeting.day_of_week}, ${meeting.meeting_time}</div>
                    <div class="meeting-badges">${badges}</div>
                </div>
                <p><strong>Date:</strong> ${formattedDate}</p>
                <p><strong>Location:</strong> ${meeting.location || '<em style="color:#9CA3AF;">Not set</em>'}</p>
                <p><strong>Scheduled by:</strong> ${meeting.created_by_name}</p>
                ${isOwner ? `<button class="btn-delete-meeting" onclick="deleteMeeting(${meeting.id})">🗑️ Cancel Meeting</button>` : ''}
            </div>
        `;
    });
    container.innerHTML = html;
}

function deleteMeeting(meetingId) {
    if (!confirm('Are you sure you want to cancel this meeting?')) return;
    const currentUser = getCurrentUser();
    if (!currentUser) { openLoginModal(); return; }
 
    fetch(`${API_URL}/api/meetings/${meetingId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: parseInt(currentUser.id) })
    })
    .then(r => r.json())
    .then(data => {
        if (data.success) {
            alert('Meeting cancelled');
            loadGroupMeetings();
        } else {
            alert('Failed to cancel meeting: ' + (data.error || 'Unknown error'));
        }
    })
    .catch(() => alert('Network error. Please try again.'));
}

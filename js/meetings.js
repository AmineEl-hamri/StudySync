let currentMeetingsFilter = 'all';

function showMyMeetings() {
    // Hide other sections
    document.getElementById('home').classList.remove('active');
    document.getElementById('dashboard').classList.remove('active');
    document.getElementById('groupDetails').classList.remove('active');
    
    // show my meetings
    document.getElementById('myMeetings').classList.add('active');
    
    // load all meetings
    loadAllMeetings();
}

function loadAllMeetings() {
    const currentUser = JSON.parse(localStorage.getItem('currentUser'));
    
    if (!currentUser) {
        alert('Please log in first');
        return;
    }
    
    fetch(`${API_URL}/api/users/${currentUser.id}/meetings`)
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                displayAllMeetings(data.meetings);
            }
        })
        .catch(error => {
            console.error('Load meetings error:', error);
        });
}

function displayAllMeetings(meetings) {
    const container = document.getElementById('allMeetingsGrid');
    
    if (meetings.length === 0) {
        container.innerHTML = `
            <div class="empty-meetings">
                <div class="empty-meetings-icon">📅</div>
                <h3>No meetings scheduled</h3>
                <p>Schedule your first meeting by finding optimal times in your study groups!</p>
            </div>
        `;
        return;
    }
    
    // Filter meetings based on current filter
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    let filteredMeetings = meetings;
    if (currentMeetingsFilter === 'upcoming') {
        filteredMeetings = meetings.filter(m => new Date(m.meeting_date) >= today);
    } else if (currentMeetingsFilter === 'past') {
        filteredMeetings = meetings.filter(m => new Date(m.meeting_date) < today);
    }
    
    if (filteredMeetings.length === 0) {
        container.innerHTML = `
            <div class="empty-meetings">
                <p>No ${currentMeetingsFilter} meetings found</p>
            </div>
        `;
        return;
    }
    
    let html = '';
    
    filteredMeetings.forEach(meeting => {
        const meetingDate = new Date(meeting.meeting_date);
        const formattedDate = meetingDate.toLocaleDateString('en-GB', { 
            weekday: 'long', 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric' 
        });
        
        // Determine badge
        let badge = '';
        const dateOnly = new Date(meetingDate);
        dateOnly.setHours(0, 0, 0, 0);
        
        if (dateOnly.getTime() === today.getTime()) {
            badge = '<span class="meeting-badge badge-today">Today</span>';
        } else if (dateOnly > today) {
            badge = '<span class="meeting-badge badge-upcoming">Upcoming</span>';
        } else {
            badge = '<span class="meeting-badge badge-past">Past</span>';
        }
        
        html += `
            <div class="meeting-card-full">
                <div class="meeting-header">
                    <div>
                        <div class="group-name">${meeting.group_name}</div>
                        ${badge}
                    </div>
                </div>
                
                <div class="meeting-datetime">
                    📅 ${meeting.day_of_week}, ${meeting.meeting_time}
                </div>
                
                <div class="meeting-detail">
                    <span class="meeting-detail-icon">📆</span>
                    <span>${formattedDate}</span>
                </div>
                
                <div class="meeting-detail">
                    <span class="meeting-detail-icon">📍</span>
                    <span>${meeting.location || 'Location TBD'}</span>
                </div>
                
                <div class="meeting-detail">
                    <span class="meeting-detail-icon">👤</span>
                    <span>Organized by ${meeting.created_by_name}</span>
                </div>
                
                <div class="meeting-actions">
                    <button class="btn-view-group" onclick="viewGroup(${meeting.group_id})">
                        View Group
                    </button>
                    <button class="btn-cancel-meeting" onclick="deleteMeetingFromDashboard(${meeting.id})">
                        Cancel
                    </button>
                </div>
            </div>
        `;
    });
    
    container.innerHTML = html;
}

function filterMeetings(filter) {
    currentMeetingsFilter = filter;
    
    // Update active button
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    event.target.classList.add('active');
    
    // Reload with filter
    loadAllMeetings();
}

function deleteMeetingFromDashboard(meetingId) {
    if (!confirm('Are you sure you want to cancel this meeting?')) {
        return;
    }
    
    fetch(`${API_URL}/api/meetings/${meetingId}`, {
        method: 'DELETE'
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            alert('✅ Meeting cancelled');
            loadAllMeetings(); // Refresh
        } else {
            alert('Failed to cancel meeting');
        }
    })
    .catch(error => {
        console.error('Delete meeting error:', error);
        alert('Network error');
    });
}

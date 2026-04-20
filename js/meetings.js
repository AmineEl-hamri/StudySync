// meetings.js powers the "My Meetings" page, a cross-group view of every meeting 
// the user is a member of. Includes filters such as all, upcoming, and past.
// It also handles cancellation.

// Initial filter state, always starts by showing all meetings.
// Stored at module level so filterMeetings() and loadAllMeetings() share
// the same variables across user interactions.
let currentMeetingsFilter = 'all';

// Shows the My Meetings page. Authentication gated: Users who aren't logged in
// are redirected to the login modal rather than seeing an empty page.
function showMyMeetings() {
    const currentUser = localStorage.getItem('currentUser');
    if (!currentUser) {
        openLoginModal();
        return;
    }

    hideAllSections();
    document.getElementById('myMeetings').style.display = 'block';
    
    // load all meetings
    loadAllMeetings();
}

// Fetches every meeting the user belongs to across all their groups.
// THe backend endpoint joins groups, group_members, and meetings so a
// single request returns the full set with group context attached,
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

// Renders the filtered meeting list. Handles empty states, applies the current filter
// (all, upcoming, past), and builds the detailed card for each meeitng with badges
// indicating whether it's today, upcoming, or past.
function displayAllMeetings(meetings) {
    const container = document.getElementById('allMeetingsGrid');

    // Empty state for users who don't have any meetings.
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
    
    // Normalise 'today' to midnight so date comparsions ignore the time component,
    // a meeting 'today' should always count as today regardless of the hour.
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Apply the active filter. 'All' is the default and needs no filtering.
    let filteredMeetings = meetings;
    if (currentMeetingsFilter === 'upcoming') {
        filteredMeetings = meetings.filter(m => new Date(m.meeting_date) >= today);
    } else if (currentMeetingsFilter === 'past') {
        filteredMeetings = meetings.filter(m => new Date(m.meeting_date) < today);
    }

    // Separate empty state when the user has meetings but none match the current filter.
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
        
        // Today, Upcoming, Past badge based on the meeting's calendar date.
        // Using a separate dateOnly clone avoids mutating meetingDate when zeroing the time.
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

        // Each card shows the group name, when and where, who scheduled it, plus quick
        // actions to jump into the group or cancel the meeting.
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
                    <span>Organised by ${meeting.created_by_name}</span>
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

// Handles the filter tab buttons. Updates the active tab visually, stores the new filter, and
// re-renders the list.
// It relies on 'event' being globally available, which is set automatically when this 
// is invoked from an inline onclick handler in the HTML.
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

// Cancels a meeting directly from this page without having to navigate into the group first.
// Backend enforces owner-only cancellation, non-owners will receive a 403 error which surfaces 
// as a generic "Failed to cancel" alert.
function deleteMeetingFromDashboard(meetingId) {
    if (!confirm('Are you sure you want to cancel this meeting?')) {
        return;
    }

    const currentUser = getCurrentUser();
    if (!currentUser) { openLoginModal(); return; }
    
    fetch(`${API_URL}/api/meetings/${meetingId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: parseInt(currentUser.id) })
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

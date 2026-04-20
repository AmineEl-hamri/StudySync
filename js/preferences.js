// preferences.js manages availability preferences (work hours, focus time, custom blocked periods) 
// set on the profile page, and the "apply preferences" flow that subtracts those blocked times from a 
// user's availability within a group.

// Monotonic counter used to give each custom block row a unique DOM id.
// Incremented on every addCustomBlock() call so removed rows don't clash with new ones.
let customBlockCount = 0;

// Shows or hides the body of a preference block based on its toggle switch.
// The three blocks (work, focus, custom) all share thus helper and are keyed by a
// type string so we can build the element ids dynamically.
function togglePrefBlock(type) {
    const enabled = document.getElementById(`pref${capitalize(type)}Enabled`).checked;
    const body    = document.getElementById(`pref${capitalize(type)}Body`);
    if (body) body.style.display = enabled ? 'block' : 'none';
}

// Utility: capitalises the first letter of a string. Used only for building element
// ids like prefWorkEnabled, prefFocusBody, etc.
function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

// Appends a new custom blocked-period row (day + start + end + remove button)
// to the custom blocks list. If 'data' is provided (when loading saved prefs),
// the selects are pre-populated with those values.
function addCustomBlock(data = {}) {
    customBlockCount++;
    const id = customBlockCount;
    const container = document.getElementById('customBlocksList');

    // Build the option lists dynamically, from the shared DAYS and TIME_SLOTS arrays
    // found in scheduler.js so the values always match the grid.
    const dayOptions = DAYS.map((d, i) =>
        `<option value="${i}" ${data.day == i ? 'selected' : ''}>${d}</option>`
    ).join('');

    const startOptions = TIME_SLOTS.map(t =>
        `<option ${data.start === t ? 'selected' : ''}>${t}</option>`
    ).join('');

    const endOptions = TIME_SLOTS.map(t =>
        `<option ${data.end === t ? 'selected' : ''}>${t}</option>`
    ).join('');

    const row = document.createElement('div');
    row.className = 'custom-block-row';
    row.id = `customBlock_${id}`;
    row.innerHTML = `
        <select class="custom-day">${dayOptions}</select>
        <select class="custom-start">${startOptions}</select>
        <select class="custom-end">${endOptions}</select>
        <button class="btn-remove-block" onclick="removeCustomBlock(${id})">✕</button>
    `;
    container.appendChild(row);
}

// Removes a custom block row from the DOM. Called by the 'X' button on each row.
function removeCustomBlock(id) {
    const el = document.getElementById(`customBlock_${id}`);
    if (el) el.remove();
}

// Persists the current preferences UI state to the backend. The preferences are built into
// a JSON object and saved against the user's record in the availability_preferences JSONB column.
function savePreferences() {
    const currentUser = JSON.parse(localStorage.getItem('currentUser'));
    const successEl = document.getElementById('prefSaveSuccess');
    const errorEl   = document.getElementById('prefSaveError');

    const preferences = buildPreferencesObject();

    fetch(`${API_URL}/api/users/${currentUser.id}/preferences`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences })
    })
    .then(r => r.json())
    .then(data => {
        if (data.success) {
            successEl.textContent = '✅ Preferences saved!';
            errorEl.textContent = '';
            setTimeout(() => successEl.textContent = '', 3000);
        } else {
            errorEl.textContent = data.error || 'Failed to save';
        }
    })
    .catch(() => errorEl.textContent = 'Network error.');
}

// Reads the current state of the three perference blocks and returns a single object that can be
// sent to the API. Disabled blocks are omitted entirely so the saved JSON stays compact.
function buildPreferencesObject() {
    const prefs = {};

    // Work / Uni block, recurring weekly hours.
    if (document.getElementById('prefWorkEnabled').checked) {
        prefs.work = {
            enabled: true,
            days: [...document.querySelectorAll('.work-day:checked')].map(el => parseInt(el.value)),
            start: document.getElementById('prefWorkStart').value,
            end:   document.getElementById('prefWorkEnd').value
        };
    }
    
    // Focus / Personal time block, same shape as work.
    if (document.getElementById('prefFocusEnabled').checked) {
        prefs.focus = {
            enabled: true,
            days: [...document.querySelectorAll('.focus-day:checked')].map(el => parseInt(el.value)),
            start: document.getElementById('prefFocusStart').value,
            end:   document.getElementById('prefFocusEnd').value
        };
    }

    // Custom blocks, an arbitrary list of day/time ranges, one per UI row.
    if (document.getElementById('prefCustomEnabled').checked) {
        const blocks = [];
        document.querySelectorAll('[id^="customBlock_"]').forEach(row => {
            blocks.push({
                day:   parseInt(row.querySelector('.custom-day').value),
                start: row.querySelector('.custom-start').value,
                end:   row.querySelector('.custom-end').value
            });
        });
        prefs.custom = { enabled: true, blocks };
    }

    return prefs;
}

// Fetches saved preferences and populates the profile page UI to match.
// Called from showProfile() in main.js.
function loadPreferences() {
    const currentUser = JSON.parse(localStorage.getItem('currentUser'));
    if (!currentUser) return;

    fetch(`${API_URL}/api/users/${currentUser.id}/preferences`)
        .then(r => r.json())
        .then(data => {
            if (!data.success || !data.preferences) return;
            const prefs = data.preferences;

            // Rehydrate the work block: flip the toggle, reveal the body, tick
            // the saved dats, and populate start/end selects.
            if (prefs.work) {
                document.getElementById('prefWorkEnabled').checked = true;
                togglePrefBlock('work');
                prefs.work.days.forEach(d => {
                    const cb = document.querySelector(`.work-day[value="${d}"]`);
                    if (cb) cb.checked = true;
                });
                document.getElementById('prefWorkStart').value = prefs.work.start;
                document.getElementById('prefWorkEnd').value   = prefs.work.end;
            }

            // Same pattern for focus.
            if (prefs.focus) {
                document.getElementById('prefFocusEnabled').checked = true;
                togglePrefBlock('focus');
                prefs.focus.days.forEach(d => {
                    const cb = document.querySelector(`.focus-day[value="${d}"]`);
                    if (cb) cb.checked = true;
                });
                document.getElementById('prefFocusStart').value = prefs.focus.start;
                document.getElementById('prefFocusEnd').value   = prefs.focus.end;
            }

            // Custom blocks need a row added for each saved entry.
            if (prefs.custom && prefs.custom.blocks) {
                document.getElementById('prefCustomEnabled').checked = true;
                togglePrefBlock('custom');
                prefs.custom.blocks.forEach(b => addCustomBlock(b));
            }
        });
}

// Expands a preferences object into the concrete set of day-time slot ids that should
// be blocked. Used when applying preferences agains't the user's availability to compute 
// which slots to remove.
function getSlotsBlockedByPreferences(preferences) {
    const blocked = new Set();

    // Inner helper: expands a tuple into individual slot ids.
    // End is exclusive, a 9-11 block blocks 9:00 and 10:00 but not 11:00.
    function blockRange(days, start, end) {
        const startIdx = TIME_SLOTS.indexOf(start);
        const endIdx   = TIME_SLOTS.indexOf(end);
        if (startIdx === -1 || endIdx === -1) return;
        days.forEach(day => {
            for (let i = startIdx; i < endIdx; i++) {
                blocked.add(`${day}-${TIME_SLOTS[i]}`);
            }
        });
    }

    // Apply each enabled preference block to the blocked set.
    if (preferences.work?.enabled) {
        blockRange(preferences.work.days, preferences.work.start, preferences.work.end);
    }
    if (preferences.focus?.enabled) {
        blockRange(preferences.focus.days, preferences.focus.start, preferences.focus.end);
    }
    if (preferences.custom?.enabled) {
        preferences.custom.blocks.forEach(b => blockRange([b.day], b.start, b.end));
    }

    return blocked;
}

// Called when a user visits the My Availabilty page. If they have saved preferences, show a 
// toast offering to apply them. Shown at most once per user, tracked via a localStorage key.
function offerToApplyPreferences() {
    const currentUser = getCurrentUser();
    if (!currentUser) return;

    // Don't re-pester users who've already seen the offer
    const storageKey = `prefsOffered_${currentUser.id}`;
    if (localStorage.getItem(storageKey)) return;

    fetch(`${API_URL}/api/users/${currentUser.id}/preferences`)
        .then(r => r.json())
        .then(data => {
            // Skip if the user has no preferences to offer
            if (!data.success || !data.preferences || Object.keys(data.preferences).length === 0) return;
            const prefs = data.preferences;

            // Build a human-readable preview of what will be blocked,
            // shown in the toast body so users know what they're agreeing to
            let preview = '';
            if (prefs.work?.enabled) {
                const days = prefs.work.days.map(d => DAYS[d]).join(', ');
                preview += `<p>🎓 <strong>Work/Uni:</strong> ${days} ${prefs.work.start}–${prefs.work.end}</p>`;
            }
            if (prefs.focus?.enabled) {
                const days = prefs.focus.days.map(d => DAYS[d]).join(', ');
                preview += `<p>🧘 <strong>Focus Time:</strong> ${days} ${prefs.focus.start}–${prefs.focus.end}</p>`;
            }
            if (prefs.custom?.enabled && prefs.custom.blocks.length > 0) {
                prefs.custom.blocks.forEach(b => {
                    preview += `<p>🚫 <strong>Blocked:</strong> ${DAYS[b.day]} ${b.start}–${b.end}</p>`;
                });
            }
            document.getElementById('prefPreviewList').innerHTML = preview;

            // Mark as offered immediately on show, so the toast won't reappear
            // regardless of whether the user applies or dismisses
            localStorage.setItem(storageKey, 'true');
            document.getElementById('prefToast').style.display = 'block';
        });
}

// User dismissed the toast without applying. Also records the offered-flag as a safety net
// in case offerToApplyPreferences() didn't manage to set it.
function dismissPrefsToast() {
    document.getElementById('prefToast').style.display = 'none';
    const currentUser = getCurrentUser();
    if (currentUser) {
        localStorage.setItem(`prefsOffered_${currentUser.id}`, 'true');
    }
}
function closeApplyPreferencesModal() {
    document.getElementById('applyPreferencesModal').classList.remove('active');
    pendingGroupIdForPrefs = null;
}

function applyPreferencesToAvailability() {
    const currentUser = getCurrentUser();
    if (!currentUser) return;

    // Step 1: fetch preferences to work out which slots should be blocked
    fetch(`${API_URL}/api/users/${currentUser.id}/preferences`)
        .then(r => r.json())
        .then(data => {
            if (!data.success) return;

            const blockedSlots = getSlotsBlockedByPreferences(data.preferences);

            // Step 2: fetch the user's current global availability
            fetch(`${API_URL}/api/users/${currentUser.id}/availability`)
                .then(r => r.json())
                .then(avData => {
                    let currentSlots = new Set();
                    if (avData.success && avData.slots) {
                        currentSlots = new Set(avData.slots);
                    }

                    // Step 3: subtract the blocked slots from the current availability
                    blockedSlots.forEach(slot => currentSlots.delete(slot));

                    // Step 4: save the reduced set back. The backend propagates
                    // this across every group the user is a member of.
                    fetch(`${API_URL}/api/users/${currentUser.id}/availability`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ slots: Array.from(currentSlots) })
                    })
                    .then(r => r.json())
                    .then(saveData => {
                        if (saveData.success) {
                            // Hide the toast if it's still open
                            const toast = document.getElementById('prefToast');
                            if (toast) toast.style.display = 'none';

                            // If the user is currently on the My Availability page,
                            // refresh the grid so the change is visible immediately.
                            // globalSelectedSlots is defined in scheduler.js.
                            if (typeof globalSelectedSlots !== 'undefined') {
                                globalSelectedSlots = new Set(
                                    Array.from(currentSlots).map(s => `global-${s}`)
                                );
                                document.querySelectorAll('#globalAvailabilityGrid .time-slot').forEach(el => {
                                    el.classList.remove('selected');
                                });
                                globalSelectedSlots.forEach(slotId => {
                                    const el = document.querySelector(`[data-slot="${slotId}"]`);
                                    if (el) el.classList.add('selected');
                                });
                            }

                            alert('✅ Preferences applied! Blocked times have been removed from your availability.');
                        }
                    });
                });
        });
}

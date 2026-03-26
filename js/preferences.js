let customBlockCount = 0;
let pendingGroupIdForPrefs = null;

function togglePrefBlock(type) {
    const enabled = document.getElementById(`pref${capitalize(type)}Enabled`).checked;
    const body    = document.getElementById(`pref${capitalize(type)}Body`);
    if (body) body.style.display = enabled ? 'block' : 'none';
}

function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

function addCustomBlock(data = {}) {
    customBlockCount++;
    const id = customBlockCount;
    const container = document.getElementById('customBlocksList');

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

function removeCustomBlock(id) {
    const el = document.getElementById(`customBlock_${id}`);
    if (el) el.remove();
}

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

function buildPreferencesObject() {
    const prefs = {};

    if (document.getElementById('prefWorkEnabled').checked) {
        prefs.work = {
            enabled: true,
            days: [...document.querySelectorAll('.work-day:checked')].map(el => parseInt(el.value)),
            start: document.getElementById('prefWorkStart').value,
            end:   document.getElementById('prefWorkEnd').value
        };
    }

    if (document.getElementById('prefFocusEnabled').checked) {
        prefs.focus = {
            enabled: true,
            days: [...document.querySelectorAll('.focus-day:checked')].map(el => parseInt(el.value)),
            start: document.getElementById('prefFocusStart').value,
            end:   document.getElementById('prefFocusEnd').value
        };
    }

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

function loadPreferences() {
    const currentUser = JSON.parse(localStorage.getItem('currentUser'));
    if (!currentUser) return;

    fetch(`${API_URL}/api/users/${currentUser.id}/preferences`)
        .then(r => r.json())
        .then(data => {
            if (!data.success || !data.preferences) return;
            const prefs = data.preferences;

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

            if (prefs.custom && prefs.custom.blocks) {
                document.getElementById('prefCustomEnabled').checked = true;
                togglePrefBlock('custom');
                prefs.custom.blocks.forEach(b => addCustomBlock(b));
            }
        });
}

function getSlotsBlockedByPreferences(preferences) {
    const blocked = new Set();

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

function offerToApplyPreferences(groupId) {
    const currentUser = JSON.parse(localStorage.getItem('currentUser'));
    if (!currentUser) return;

    fetch(`${API_URL}/api/users/${currentUser.id}/preferences`)
        .then(r => r.json())
        .then(data => {
            if (!data.success || !data.preferences || Object.keys(data.preferences).length === 0) return;

            const prefs = data.preferences;
            pendingGroupIdForPrefs = groupId;

            
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
            document.getElementById('applyPreferencesModal').classList.add('active');
        });
}

function closeApplyPreferencesModal() {
    document.getElementById('applyPreferencesModal').classList.remove('active');
    pendingGroupIdForPrefs = null;
}

function applyPreferencesToGroup() {
    const currentUser = JSON.parse(localStorage.getItem('currentUser'));
    if (!currentUser || !pendingGroupIdForPrefs) return;

    fetch(`${API_URL}/api/users/${currentUser.id}/preferences`)
        .then(r => r.json())
        .then(data => {
            if (!data.success) return;

            const blockedSlots = getSlotsBlockedByPreferences(data.preferences);

            // Get current availability and remove blocked slots
            fetch(`${API_URL}/api/availability/${pendingGroupIdForPrefs}`)
                .then(r => r.json())
                .then(avData => {
                    let currentSlots = new Set();
                    if (avData.success && avData.availability[currentUser.email]) {
                        currentSlots = new Set(avData.availability[currentUser.email].slots);
                    }

                    // Remove blocked slots from current availability
                    blockedSlots.forEach(slot => currentSlots.delete(slot));

                    // Save updated availability
                    fetch(`${API_URL}/api/availability`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            group_id: pendingGroupIdForPrefs,
                            user_id: currentUser.id,
                            slots: Array.from(currentSlots)
                        })
                    })
                    .then(r => r.json())
                    .then(saveData => {
                        if (saveData.success) {
                            closeApplyPreferencesModal();
                            // Reload availability grid
                            selectedSlots = currentSlots;
                            generateAvailabilityGrid();
                            loadAvailability(pendingGroupIdForPrefs);
                            alert('✅ Preferences applied! Blocked times have been removed from your availability.');
                        }
                    });
                });
        });
}

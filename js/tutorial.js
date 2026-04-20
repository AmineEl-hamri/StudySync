// tutorial.js handles the onboarding tutorial. An overlay appears on first login to
// walk new users through the core features, from setting their location all the way to
// scheduling a meeting. Users can skip at any point, and the "Play Tutorial" option in the 
// user dropdwon lets them repaly it later.

// This section contains the tutorial content itself. Each step has an icon, a title, a main 
// description, and an optional tip. Changing the order here changes the order in the UI. The 
// progress bar and the Back/Next logic both derive their state from the length and index 
// of this array.
const TUTORIAL_STEPS = [
    {
        icon: '👋',
        title: 'Welcome to StudySync!',
        description: 'Let\'s take a quick tour so you can get the most out of StudySync. We\'ll show you everything you need to start scheduling smarter with your study group.',
        tip: null
    },
    {
        icon: '📍',
        title: 'Set Your Location',
        description: 'Before creating a group, set your preferred location. StudySync uses this to calculate real travel times to meeting locations for everyone in your group.',
        tip: '💡 Click "My Locations" in the navbar to add your home or work address.'
    },
    {
        icon: '🚗',
        title: 'Set Your Transport Mode',
        description: 'In your Profile, choose how you typically travel to meetings: driving, public transport, walking, or cycling. StudySync uses this to calculate accurate travel times for each member based on how they\'re getting there.',
        tip: '💡 Default is public transport. You can change it any time from your Profile page.'
    },
    {
        icon: '👥',
        title: 'Create a Study Group',
        description: 'Head to your Dashboard and click "Create New Group". Give your group a name, add a description, and invite members by their email address.',
        tip: '💡 Members need a StudySync account to join. They\'ll appear once they sign up with that email.'
    },
    {
        icon: '📅',
        title: 'Import Google Calendar',
        description: 'Head to "My Availability", you can connect your Google Calendar in the navbar. StudySync will automatically read your busy times and mark you as available for all your free slots - no manual input needed.',
        tip: '💡 Click "Import from Google Calendar" on the My Availability page. You\'ll only need to authorise once.'
    },
    {
        icon: '🟩',
        title: 'Set Your Availability',
        description: 'Prefer to do it manually? Go to "My Availability" in the navbar and click on the time grid to mark when you\'re free. Green means available. Each member of your group does this independently.',
        tip: '💡 Make sure to click "Save My Availability" after selecting your slots - it won\'t save automatically.'
    },
    {
        icon: '🧠',
        title: 'Find Optimal Times',
        description: 'Once your group members have submitted their availability, click "Find Optimal Meeting Times". StudySync\'s algorithm finds the best slots where the most people are free.',
        tip: '💡 Travel times are shown for each option so everyone knows when to leave and how long the journey takes.'
    },
    {
        icon: '🗓️',
        title: 'Schedule a Meeting',
        description: 'As the group owner, you can click "Schedule This Meeting" on any suggested time. All group members will receive an email notification with the meeting details automatically.',
        tip: '💡 Only the group owner can schedule meetings to keep things organised.'
    },
    {
        icon: '🚀',
        title: 'You\'re all set!',
        description: 'That\'s everything you need to know. You can always find your upcoming sessions in "My Meetings" and revisit settings in your Profile. Happy studying!',
        tip: null
    }
];

// Index of the step currently being shown. Reset to 0 by startTutorial().
let currentTutorialStep = 0;

// Shows the tutorial overlay and renders the first step. Called either automatically on
// first login or manually from the user dropdown's "Show Tutorial" option.
function startTutorial() {
    currentTutorialStep = 0;
    document.getElementById('tutorialOverlay').style.display = 'block';
    renderTutorialStep();
}

// Hides the overlay and records completion. Used both by the explicit Skip button and by
// tutorialNext() when the user reaches the final step.
function skipTutorial() {
    document.getElementById('tutorialOverlay').style.display = 'none';
    markTutorialComplete();
}

// Advances to the next step, or completes the tutorial if the final step is already shwoing.
function tutorialNext() {
    if (currentTutorialStep < TUTORIAL_STEPS.length - 1) {
        currentTutorialStep++;
        renderTutorialStep();
    } else {
        skipTutorial();
    }
}

// MOves back one step. DOes nothing on the first step (the Back button is hidden there anyway, 
// but the bounds check is defensive).
function tutorialBack() {
    if (currentTutorialStep > 0) {
        currentTutorialStep--;
        renderTutorialStep();
    }
}

// Renders the current step into the overlay. Called after every navigation action. Handles the #
// progress bar, step indicator, icon, title, description, optional tip, and the visibility of 
// Back / Skip / Next buttons.
function renderTutorialStep() {
    const step = TUTORIAL_STEPS[currentTutorialStep];
    const total = TUTORIAL_STEPS.length;
    const progress = ((currentTutorialStep + 1) / total) * 100;

    document.getElementById('tutorialProgressBar').style.width = progress + '%';
    document.getElementById('tutorialStepIndicator').textContent = `Step ${currentTutorialStep + 1} of ${total}`;
    document.getElementById('tutorialIcon').textContent = step.icon;
    document.getElementById('tutorialTitle').textContent = step.title;
    document.getElementById('tutorialDescription').textContent = step.description;

    // Tips are optional, hide the element entirely when there isn't one so
    // the card doesn't leave empty whitespace.
    const tipEl = document.getElementById('tutorialTip');
    if (step.tip) {
        tipEl.textContent = step.tip;
        tipEl.style.display = 'block';
    } else {
        tipEl.style.display = 'none';
    }

    // Back button hidden on the first step.
    document.getElementById('tutorialBack').style.display =
        currentTutorialStep === 0 ? 'none' : 'inline-block';

    // Next button doubles as the finish button on the last step.
    const isLast = currentTutorialStep === TUTORIAL_STEPS.length - 1;
    document.getElementById('tutorialNext').textContent = isLast ? '🚀 Get Started!' : 'Next →';

    // Skip button hidden on last step.
    document.getElementById('tutorialSkip').style.display =
        isLast ? 'none' : 'inline-block';
}

// Records that the user has finished or skipped the tutorial, both locally for immediate 
// future loads and server-side so a different device or browser doens't replay it.
function markTutorialComplete() {
    localStorage.setItem('studysync_tutorial_done', 'true');
    const currentUser = JSON.parse(localStorage.getItem('currentUser'));
    if (currentUser) {
        fetch(`${API_URL}/api/users/${currentUser.id}/tutorial`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

// Checked on page load by auth.js to decide whether to auto-show the tutorial. Returns false
// once the user has seen or skipped it.
function shouldShowTutorial() {
    return localStorage.getItem('studysync_tutorial_done') !== 'true';
}

// Replays the tutorial from the "Show Tutorial" option in the user dropdown.
// Clears the local completion flag so the full flow runs as if first-time,
// and closes the dropdown so it doesn't obscure the overlay.
// Note: this doesn't reset the server-side tutorial_complete flag, that
// flag is only used to trigger the initial auto-popup, so re-playing on
// demand shouldn't count as resetting first-time-user state.
function restartTutorial() {
    // Clear completion flag so the tutorial shows fully
    localStorage.removeItem('studysync_tutorial_done');
    // Close the user dropdown if it's open
    const dropdown = document.getElementById('dropdown');
    if (dropdown) dropdown.classList.remove('active');
    startTutorial();
}

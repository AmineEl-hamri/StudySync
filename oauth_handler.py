from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build
from datetime import datetime, timedelta
import os
import re

# OAuth Configuration
# All sensitive credentials are loaded from environmnet variables (never hardcoded) so
# they are not exposed in the repository or container image.

GOOGLE_CLIENT_ID     = os.environ.get('GOOGLE_CLIENT_ID', '')
GOOGLE_CLIENT_SECRET = os.environ.get('GOOGLE_CLIENT_SECRET', '')

# The redirect URI must exactly match one of the URIs in the Google Cloud Console.
# On Cloud Run this is the production URL. It can be overridden locally via the
# environment variable to point to localhost.
GOOGLE_REDIRECT_URI  = os.environ.get('GOOGLE_REDIRECT_URI', 'https://studysync-backend-195370304491.europe-west2.run.app/api/oauth/google/callback')

# Request read-only access to the user's calendar.
# Requesting the minimum necessary scope follows the principle of least privilege.
SCOPES = ['https://www.googleapis.com/auth/calendar.readonly']


# OAuth Flow Helpers

def create_oauth_flow():
    # The flow is constructed from a client config dictionary rather than a
    # client_secrets.json file, so credentials can be injected via environment
    # variables at runtime.

    flow = Flow.from_client_config(
        {
            "web": {
                "client_id": GOOGLE_CLIENT_ID,
                "client_secret": GOOGLE_CLIENT_SECRET,
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
                "redirect_uris": [GOOGLE_REDIRECT_URI]
            }
        },
        scopes=SCOPES,
        redirect_uri=GOOGLE_REDIRECT_URI
    )
    return flow

def get_authorization_url(user_id):
    # Get Google OAuth authorization URL
    # user_id is embedded in the OAuth 'state' parameter so that when Google redirects
    # back to the callback endpoint, the application can identify which user completed
    # the consent flow without relying on session state.
    flow = create_oauth_flow()
    authorization_url, state = flow.authorization_url(
        
        # Request a refresh token so access can be renewed without re-prompting.
        access_type='offline',
        
        # Preserve any scopes the user has already granted in prior sessions.
        include_granted_scopes='true',
        
        # Force the consent screen every time to ensure a refresh token is issued.
        prompt='consent',
        
        # Carry the user ID through the redirect for identification at callback.
        state=str(user_id)
    )
    return authorization_url


def exchange_code_for_token(code):
    # Exchange authorization code for access token
    # The code is valid for a single use and expires quickly, so this exchange
    # should happen immediately on receipt.
    flow = create_oauth_flow()
    flow.fetch_token(code=code)
    credentials = flow.credentials
    return {
        'access_token': credentials.token,
        'refresh_token': credentials.refresh_token,

        # Store exipry as an ISO string so it can be persisted in the database
        # and compared on the next API call to decide whether to refresh.
        'expires_at': credentials.expiry.isoformat() if credentials.expiry else None
    }

# Calendar Data Fetching
def get_calendar_events(access_token, start_date, end_date, refresh_token=None):
    # Fetch all calendar events within a date range.

    # Build a Credentials object from the stored tokens and client config.
    # Supplying all 4 fields enables automatic token refresh without user interaction.
    credentials = Credentials(
        token=access_token,
        refresh_token=refresh_token,
        token_uri="https://oauth2.googleapis.com/token",
        client_id=GOOGLE_CLIENT_ID,
        client_secret=GOOGLE_CLIENT_SECRET
    )
    # Build the Google Calendar API v3 client using the authenticated credentials.
    service = build('calendar', 'v3', credentials=credentials)

    # Strip timezone info before converting to UTC ISO format without a trailing 'Z'.
    # The Google Calendar API expects naive datetimes formatted as UTC strings.
    # Leaving tzinfo attach would produce offset strings that the API does not accept here.
    if start_date.tzinfo:
        start_date = start_date.replace(tzinfo=None)
    if end_date.tzinfo:
        end_date = end_date.replace(tzinfo=None)
        
    time_min = start_date.isoformat() + 'Z'
    time_max = end_date.isoformat() + 'Z'
    
    # Fetch all single event instances within the range.
    # singleEvents=True expands recurring events into individual occurences,
    # which is necessary for accurate per-slot availability checking.
    # orderBy='startTime' requires singleEvents=True to be set.
    events_result = service.events().list(
        calendarId='primary',
        timeMin=time_min,
        timeMax=time_max,
        singleEvents=True,
        orderBy='startTime'
    ).execute()
    
    events = events_result.get('items', []) # Default to empty list if no events key.

    # Extract only the fields needed for availability calculation.
    # All-day events use a 'date' key instead of 'dateTime'
    
    busy_times = []
    for event in events:
        start = event['start'].get('dateTime', event['start'].get('date'))
        end = event['end'].get('dateTime', event['end'].get('date'))
        busy_times.append({
            'start': start,
            'end': end,
            'summary': event.get('summary', 'Busy') # Use 'Busy' for private/untitled events.
        })
    
    return busy_times

# Availability Conversion

def convert_busy_to_availability(busy_times, start_date, end_date):
    # Convert busy times to available time slots.
    # Returns array of available slots in format "dayIndex-time"

    # The fixed hourly slots used across the scheduling algorithm.
    # Slots outside this range are not considered.
    TIME_SLOTS = ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', 
                  '16:00', '17:00', '18:00', '19:00', '20:00', '21:00']

    # Normalise to  naive datetimes for consistent comparison with the stripped
    # busy period datetimes.
    if start_date.tzinfo:
        start_date = start_date.replace(tzinfo=None)
    if end_date.tzinfo:
        end_date = end_date.replace(tzinfo=None)
    
    available_slots = []
    current_date = start_date

    while current_date <= end_date:
        # weekday() returns 0 for Monday through 6 for Sunday
        day_index = current_date.weekday()
        
        for time_slot in TIME_SLOTS:
            slot_hour = int(time_slot.split(':')[0])
            slot_datetime = current_date.replace(hour=slot_hour, minute=0, second=0, microsecond=0)
            slot_end = slot_datetime + timedelta(hours=1)
            
            is_free = True
            for busy in busy_times:
                busy_start_str = busy['start']
                busy_end_str = busy['end']
                
                if 'T' in busy_start_str:
                    busy_start_str = re.sub(r'(Z|[+-]\d{2}:\d{2})$', '', busy_start_str)
                    busy_end_str = re.sub(r'(Z|[+-]\d{2}:\d{2})$', '', busy_end_str)
                    busy_start = datetime.fromisoformat(busy_start_str)
                    busy_end = datetime.fromisoformat(busy_end_str)
                else:
                    # All-day event, skip because it cannot be mapped to a specific hourly slot.
                    continue
                
                if slot_datetime < busy_end and slot_end > busy_start:
                    is_free = False
                    break
            
            if is_free:
                # Append in 'dayIndex-HH:MM' format as expected by the CSP
                available_slots.append(f"{day_index}-{time_slot}")

        # Advance to the next day.
        current_date += timedelta(days=1)
    
    return available_slots

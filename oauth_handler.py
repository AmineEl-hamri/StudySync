from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build
from datetime import datetime, timedelta
import os
import re

GOOGLE_CLIENT_ID     = os.environ.get('GOOGLE_CLIENT_ID', '')
GOOGLE_CLIENT_SECRET = os.environ.get('GOOGLE_CLIENT_SECRET', '')
GOOGLE_REDIRECT_URI  = os.environ.get('GOOGLE_REDIRECT_URI', 'http://localhost:5000/api/oauth/google/callback')

SCOPES = ['https://www.googleapis.com/auth/calendar.readonly']

def create_oauth_flow():
    """Create Google OAuth flow"""
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
    """Get Google OAuth authorization URL"""
    flow = create_oauth_flow()
    authorization_url, state = flow.authorization_url(
        access_type='offline',
        include_granted_scopes='true',
        prompt='consent',
        state=str(user_id)
    )
    return authorization_url

def exchange_code_for_token(code):
    """Exchange authorization code for access token"""
    flow = create_oauth_flow()
    flow.fetch_token(code=code)
    credentials = flow.credentials
    return {
        'access_token': credentials.token,
        'refresh_token': credentials.refresh_token,
        'expires_at': credentials.expiry.isoformat() if credentials.expiry else None
    }

def get_calendar_events(access_token, start_date, end_date, refresh_token=None):
    """
    Fetch calendar events from Google Calendar
    Returns list of busy time slots
    """
    credentials = Credentials(
        token=access_token,
        refresh_token=refresh_token,
        token_uri="https://oauth2.googleapis.com/token",
        client_id=GOOGLE_CLIENT_ID,
        client_secret=GOOGLE_CLIENT_SECRET
    )
    service = build('calendar', 'v3', credentials=credentials)
    
    if start_date.tzinfo:
        start_date = start_date.replace(tzinfo=None)
    if end_date.tzinfo:
        end_date = end_date.replace(tzinfo=None)
        
    time_min = start_date.isoformat() + 'Z'
    time_max = end_date.isoformat() + 'Z'
    
    events_result = service.events().list(
        calendarId='primary',
        timeMin=time_min,
        timeMax=time_max,
        singleEvents=True,
        orderBy='startTime'
    ).execute()
    
    events = events_result.get('items', [])
    
    busy_times = []
    for event in events:
        start = event['start'].get('dateTime', event['start'].get('date'))
        end = event['end'].get('dateTime', event['end'].get('date'))
        busy_times.append({
            'start': start,
            'end': end,
            'summary': event.get('summary', 'Busy')
        })
    
    return busy_times

def convert_busy_to_availability(busy_times, start_date, end_date):
    """
    Convert busy times to available time slots.
    Returns array of available slots in format "dayIndex-time"
    """
    TIME_SLOTS = ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', 
                  '16:00', '17:00', '18:00', '19:00', '20:00', '21:00']
    
    if start_date.tzinfo:
        start_date = start_date.replace(tzinfo=None)
    if end_date.tzinfo:
        end_date = end_date.replace(tzinfo=None)
    
    available_slots = []
    current_date = start_date

    while current_date <= end_date:
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
                    continue
                
                if slot_datetime < busy_end and slot_end > busy_start:
                    is_free = False
                    break
            
            if is_free:
                available_slots.append(f"{day_index}-{time_slot}")
        
        current_date += timedelta(days=1)
    
    return available_slots

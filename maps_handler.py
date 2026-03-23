import requests
import os

GOOGLE_MAPS_API_KEY = os.environ.get('GOOGLE_MAPS_API_KEY', '')

def calculate_travel_time(origin, destination, mode='driving'):
    """
    Calculate travel time using Google Maps Distance Matrix API

    Arguments:
        origin: Starting address (string)
        destination: Meeting location (string)
        mode: 'driving', 'transit', 'walking', 'bicycling'

    Returns:
        dict with duration_minutes, distance_km, duration_text, distance_text
    """
    url = 'https://maps.googleapis.com/maps/api/distancematrix/json'
    params = {
        'origins': origin,
        'destinations': destination,
        'mode': mode,
        'departure_time': 'now',
        'key': GOOGLE_MAPS_API_KEY
    }
    
    response = requests.get(url, params=params)
    data = response.json()
    
    if data['status'] == 'OK':
        element = data['rows'][0]['elements'][0]
        
        if element['status'] == 'OK':
            if 'duration_in_traffic' in element:
                duration_seconds = element['duration_in_traffic']['value']
            else:
                duration_seconds = element['duration']['value']
            
            distance_meters = element['distance']['value']
            
            return {
                'duration_minutes': round(duration_seconds / 60),
                'distance_km': round(distance_meters / 1000, 1),
                'duration_text': element.get('duration_in_traffic', element['duration'])['text'],
                'distance_text': element['distance']['text']
            }
    
    return None

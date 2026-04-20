import requests
import os

# Load the Google Maps API key from environment variables.
# Falls back to an empty string if not set, which is caught below.
GOOGLE_MAPS_API_KEY = os.environ.get('GOOGLE_MAPS_API_KEY', '')

def calculate_travel_time(origin, destination, mode='driving'):
    
    # Calculate travel time and distance between two locations using the Google Maps
    # Distance Matric API

    # Safety net: refuse to proceed if no API key is configured.
    if not GOOGLE_MAPS_API_KEY:
        print("[MAPS] ERROR: GOOGLE_MAPS_API_KEY env var is empty or missing", flush=True)
        return None

    print(f"[MAPS] Calculating: {origin!r} -> {destination!r} (mode={mode})", flush=True)


    # Distance Matrix API endpoint.
    url = 'https://maps.googleapis.com/maps/api/distancematrix/json'

    # Builds query parameters for the API request. 'departure_time' 'now' enables live
    # traffic data for driving and transit modes.
    params = {
        'origins': origin,
        'destinations': destination,
        'mode': mode,
        'departure_time': 'now',
        'key': GOOGLE_MAPS_API_KEY
    }

    # Make the HTTP GET request to the Distance Matrix API.
    # A 10-second timeout prevents the application hanging on a slow or unresponsive API.
    try:
        response = requests.get(url, params=params, timeout=10)
    except requests.RequestException as e:
        # Catches connection errors, timeouts, and other network-level fails.
        print(f"[MAPS] ERROR: HTTP request failed: {e}", flush=True)
        return None

    # Parse the JSON response body.
    try:
        data = response.json()
    except ValueError:
        # The API returned a non-JSON response, which means its likely a server error.
        print(f"[MAPS] ERROR: non-JSON response (status {response.status_code}): {response.text[:300]}", flush=True)
        return None

    # Check the top-level API status.
    # Common failure values: 'REQUEST_DENIED' (bad key), 'OVER_QUERY_LIMIT', 'INVALID_REQUEST'
    top_status = data.get('status')
    if top_status != 'OK':
        print(f"[MAPS] ERROR: top-level status={top_status}, error_message={data.get('error_message')}", flush=True)
        return None

    # Extract the first (and only) result element from the response matrix.
    # The API returns a rows x columns matrix; since we pass one origin and one destination,
    # we always expect rows[0].elements[0].
    try:
        element = data['rows'][0]['elements'][0]
    except (KeyError, IndexError):
        print(f"[MAPS] ERROR: unexpected response shape: {data}", flush=True)
        return None

    # Element-level status (e.g. NOT_FOUND, ZERO_RESULTS)
    el_status = element.get('status')
    if el_status != 'OK':
        print(f"[MAPS] ERROR: element status={el_status} for {origin!r} -> {destination!r}", flush=True)
        return None

    # Prefer real-time traffic duration when available (driving/transit).
    if 'duration_in_traffic' in element:
        duration_seconds = element['duration_in_traffic']['value']
    else:
        duration_seconds = element['duration']['value']

    # Extract the raw distance value in metres.
    distance_meters = element['distance']['value']
    # Use the traffic-aware text label.
    duration_text = element.get('duration_in_traffic', element['duration'])['text']

    print(f"[MAPS] SUCCESS: {duration_text}, {element['distance']['text']}", flush=True)

    # Return a clean, unit-normalised result dictionary.
    return {
        'duration_minutes': round(duration_seconds / 60), # Convert seconds to minutes.
        'distance_km': round(distance_meters / 1000, 1), # COnvert metres to kilometres.
        'duration_text': duration_text,
        'distance_text': element['distance']['text']
    }

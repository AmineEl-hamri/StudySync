from flask import Flask, request, jsonify
from flask_cors import CORS
import psycopg2
import bcrypt
from datetime import datetime
from oauth_handler import (
    get_authorization_url, 
    exchange_code_for_token, 
    get_calendar_events,
    convert_busy_to_availability
)
from datetime import datetime, timedelta
import math
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from dotenv import load_dotenv
import os

load_dotenv()  # loads values from .env into environment variables

CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID")
CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET")

app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": "*"}})

# Database config
DB_CONFIG = {
    'host':     os.environ['DB_HOST'],     
    'database': os.environ['DB_NAME'],      
    'user':     os.environ['DB_USER'],      
    'password': os.environ['DB_PASSWORD'],  
}

# Email config
EMAIL_HOST     = 'smtp.gmail.com'
EMAIL_PORT     = 587
EMAIL_USERNAME = os.environ.get('EMAIL_USERNAME', '')
EMAIL_PASSWORD = os.environ.get('EMAIL_PASSWORD', '')
EMAIL_FROM     = f'StudySync <{EMAIL_USERNAME}>'

def get_db_connection():
    """Create database connection"""
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        return conn
    except Exception as e:
        print(f"Database connection error: {e}")
        return None

def send_meeting_notification(group_id, meeting_id, day_of_week, meeting_time, meeting_date):
    """Send email notification to all group members"""
    conn = get_db_connection()
    if not conn:
        return False
    
    cur = conn.cursor()
    
    try:
        cur.execute("""
            SELECT g.name, g.description, g.meeting_location
            FROM groups g
            WHERE g.id = %s
        """, (group_id,))
        
        group_result = cur.fetchone()
        if not group_result:
            return False
        
        group_name = group_result[0]
        group_description = group_result[1] or 'No description'
        location = group_result[2] or 'Location TBD'
        
        cur.execute("""
            SELECT u.name, u.email
            FROM group_members gm
            JOIN users u ON gm.user_id = u.id
            WHERE gm.group_id = %s
        """, (group_id,))
        
        members = cur.fetchall()
        
        if not members:
            return False
        
        subject = f"📅 New Meeting Scheduled: {group_name}"
        
        html_body = f"""
        <html>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
            <div style="max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9fafb; border-radius: 8px;">
                <h2 style="color: #4F46E5;">🎉 Meeting Scheduled!</h2>
                <p>A new study session has been scheduled for <strong>{group_name}</strong>.</p>
                <div style="background: white; padding: 20px; border-radius: 8px; border-left: 4px solid #4F46E5; margin: 20px 0;">
                    <h3 style="margin-top: 0; color: #4F46E5;">Meeting Details</h3>
                    <p><strong>📅 Date:</strong> {day_of_week}, {meeting_date}</p>
                    <p><strong>🕐 Time:</strong> {meeting_time}</p>
                    <p><strong>📍 Location:</strong> {location}</p>
                    <p><strong>👥 Group:</strong> {group_name}</p>
                    <p><strong>📝 Description:</strong> {group_description}</p>
                </div>
                <p><strong>Attendees:</strong></p>
                <ul>
                    {''.join([f'<li>{name}</li>' for name, email in members])}
                </ul>
                <p style="color: #666; font-size: 14px; margin-top: 30px;">
                    See you there! 📚<br>
                    - StudySync Team
                </p>
            </div>
        </body>
        </html>
        """
        
        for name, email in members:
            try:
                msg = MIMEMultipart('alternative')
                msg['Subject'] = subject
                msg['From'] = EMAIL_FROM
                msg['To'] = email
                html_part = MIMEText(html_body, 'html')
                msg.attach(html_part)
                with smtplib.SMTP(EMAIL_HOST, EMAIL_PORT) as server:
                    server.starttls()
                    server.login(EMAIL_USERNAME, EMAIL_PASSWORD)
                    server.send_message(msg)
                print(f"✅ Email sent to {email}")
            except Exception as e:
                print(f"❌ Failed to send email to {email}: {e}")
        
        return True
        
    except Exception as e:
        print(f"Email notification error: {e}")
        return False
    finally:
        cur.close()
        conn.close()


@app.route('/api/test', methods=['GET'])
def test():
    return jsonify({
        'success': True,
        'message': 'StudySync API is working!',
        'timestamp': datetime.now().isoformat()
        })

@app.route('/api/test-db', methods=['GET'])
def test_db():
    conn = get_db_connection()
    if conn:
        cur = conn.cursor()
        cur.execute('SELECT COUNT(*) FROM users')
        count = cur.fetchone()[0]
        cur.close()
        conn.close()
        return jsonify({'success': True, 'message': 'Database connected!', 'user_count': count})
    else:
        return jsonify({'success': False, 'message': 'Database connection failed!'}), 500


@app.route('/api/register', methods=['POST'])
def register():
    data = request.json
    name = data.get('name')
    email = data.get('email')
    password = data.get('password')

    if not all([name, email, password]):
        return jsonify({'success': False, 'error': 'Missing fields'}), 400

    password_hash = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt())

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Database error'}), 500

    cur = conn.cursor()

    try:
        cur.execute(
            "INSERT INTO users (name, email, password_hash) VALUES (%s, %s, %s) RETURNING id, name, email, created_at",
            (name, email, password_hash.decode('utf-8'))
            )
        user = cur.fetchone()
        conn.commit()
        return jsonify({
            'success': True,
            'user': {
                'id': user[0],
                'name': user[1],
                'email': user[2],
                'created_at': user[3].isoformat()
                }
            }), 201
    except psycopg2.IntegrityError:
        return jsonify({'success': False, 'error': 'Email already exists'}), 400
    except Exception as e:
        print(f"Registration error: {e}")
        return jsonify({'success': False, 'error': 'Registration failed!'}), 500
    finally:
        cur.close()
        conn.close()


@app.route('/api/login', methods=['POST'])
def login():
    data = request.json
    email = data.get('email')
    password = data.get('password')
    
    if not all([email, password]):
        return jsonify({'success': False, 'error': 'Missing email or password'}), 400
    
    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Database error'}), 500
    
    cur = conn.cursor()
    
    try:
        cur.execute("SELECT id, name, email, password_hash FROM users WHERE email = %s", (email,))
        user = cur.fetchone()
        
        if user and bcrypt.checkpw(password.encode('utf-8'), user[3].encode('utf-8')):
            return jsonify({                          
                'success': True,                      
                'user': {'id': user[0], 'name': user[1], 'email': user[2]}
            })                                        
        else:
            return jsonify({'success': False, 'error': 'Invalid credentials'}), 401
    except Exception as e:
        print(f"Login error: {e}")
        return jsonify({'success': False, 'error': 'Login failed'}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/groups', methods=['GET'])
def get_groups():
    user_id = request.args.get('user_id')
    
    if not user_id:
        return jsonify({'success': False, 'error': 'Missing user_id'}), 400
    
    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Database error'}), 500
    
    cur = conn.cursor()

    try:
        cur.execute("""
            SELECT g.id, g.name, g.description, g.owner_id, u.name as owner_name, g.created_at
            FROM groups g
            JOIN users u ON g.owner_id = u.id
            JOIN group_members gm ON g.id = gm.group_id
            WHERE gm.user_id = %s
            ORDER BY g.created_at DESC
        """, (user_id,))
        
        groups = []
        for row in cur.fetchall():
            cur.execute("""
                SELECT u.email FROM users u
                JOIN group_members gm ON u.id = gm.user_id
                WHERE gm.group_id = %s
            """, (row[0],))
            members = [m[0] for m in cur.fetchall()]
            groups.append({
                'id': row[0],
                'name': row[1],
                'description': row[2],
                'ownerId': row[3],
                'ownerName': row[4],
                'members': members,
                'createdAt': row[5].isoformat()
            })
        
        return jsonify({'success': True, 'groups': groups})
    except Exception as e:
        print(f"Get groups error: {e}")
        return jsonify({'success': False, 'error': 'Failed to get groups'}), 500
    finally:
        cur.close()
        conn.close()

        
@app.route('/api/groups', methods=['POST'])
def create_group():
    data = request.json
    name = data.get('name')
    description = data.get('description')
    owner_id = data.get('owner_id')
    member_emails = data.get('members', [])
    
    if not all([name, owner_id]):
        return jsonify({'success': False, 'error': 'Missing required fields'}), 400
    
    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Database error'}), 500
    
    cur = conn.cursor()
    
    try:
        cur.execute(
            "INSERT INTO groups (name, description, owner_id) VALUES (%s, %s, %s) RETURNING id",
            (name, description, owner_id)
        )
        group_id = cur.fetchone()[0]
        cur.execute("INSERT INTO group_members (group_id, user_id) VALUES (%s, %s)", (group_id, owner_id))
        
        for email in member_emails:
            cur.execute("SELECT id FROM users WHERE email = %s", (email,))
            user = cur.fetchone()
            if user:
                cur.execute(
                    "INSERT INTO group_members (group_id, user_id) VALUES (%s, %s) ON CONFLICT DO NOTHING",
                    (group_id, user[0])
                )
        
        conn.commit()
        return jsonify({'success': True, 'group_id': group_id}), 201
    except Exception as e:
        print(f"Create group error: {e}")
        conn.rollback()
        return jsonify({'success': False, 'error': 'Failed to create group'}), 500
    finally:
        cur.close()
        conn.close()


@app.route('/api/availability', methods=['POST'])
def save_availability():
    data = request.json
    group_id = data.get('group_id')
    user_id = data.get('user_id')
    slots = data.get('slots', [])

    if not all([group_id, user_id]):
        return jsonify({'success': False, 'error': 'Missing required fields'}), 400

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Database error'}), 500
    
    cur = conn.cursor()

    try:
        cur.execute("DELETE FROM availability WHERE group_id = %s AND user_id = %s", (group_id, user_id))
        for slot in slots:
            day_index, time_slot = slot.split('-')
            cur.execute(
                "INSERT INTO availability (group_id, user_id, day_index, time_slot) VALUES (%s, %s, %s, %s)",
                (group_id, user_id, int(day_index), time_slot)
                )
        conn.commit()
        return jsonify({'success': True, 'message': 'Availability saved successfully'})
    except Exception as e:
        print(f"Save availability error: {e}")
        conn.rollback()
        return jsonify({'success': False, 'error': 'Failed to save availability'}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/availability/<int:group_id>', methods=['GET'])
def get_availability(group_id):
    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Database error'}), 500
    
    cur = conn.cursor()
    
    try:
        cur.execute("""
            SELECT a.user_id, u.email, a.day_index, a.time_slot
            FROM availability a
            JOIN users u ON a.user_id = u.id
            WHERE a.group_id = %s
        """, (group_id,))

        availability_data = {}
        for row in cur.fetchall():
            user_id = row[0]
            email = row[1]
            slot = f"{row[2]}-{row[3]}"
            if email not in availability_data:
                availability_data[email] = {'user_id': user_id, 'slots': []}
            availability_data[email]['slots'].append(slot)
        
        return jsonify({'success': True, 'availability': availability_data})
    except Exception as e:
        print(f"Get availability error: {e}")
        return jsonify({'success': False, 'error': 'Failed to get availability'}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/schedule/<int:group_id>', methods=['GET'])
def find_optimal_times(group_id):
    from maps_handler import calculate_travel_time
    
    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Database error'}), 500
    
    cur = conn.cursor()
    
    try:
        cur.execute("SELECT meeting_location FROM groups WHERE id = %s", (group_id,))
        group_result = cur.fetchone()
        meeting_location = group_result[0] if group_result else None

        cur.execute("""
            SELECT a.user_id, u.email, a.day_index, a.time_slot
            FROM availability a
            JOIN users u ON a.user_id = u.id
            WHERE a.group_id = %s
        """, (group_id,))
        
        availability_data = {}
        for row in cur.fetchall():
            user_id = row[0]
            email = row[1]
            slot = f"{row[2]}-{row[3]}"
            if email not in availability_data:
                availability_data[email] = {'user_id': user_id, 'slots': []}
            availability_data[email]['slots'].append(slot)
        
        if len(availability_data) < 2:
            return jsonify({'success': False, 'error': 'Need at least 2 members to submit availability'}), 400

        travel_times = {}
        if meeting_location:
            for email, data in availability_data.items():
                user_id = data['user_id']
                cur.execute("""
                    SELECT address FROM user_locations
                    WHERE user_id = %s AND is_default = true
                    LIMIT 1
                    """, (user_id,))
                location_result = cur.fetchone()
                if location_result:
                    user_location = location_result[0]
                    travel_info = calculate_travel_time(user_location, meeting_location)
                    if travel_info:
                        travel_times[email] = {
                            'duration_minutes': travel_info['duration_minutes'],
                            'buffer_slots': calculate_buffer_slots(travel_info['duration_minutes'])
                            }
        
        optimal_times = run_csp_with_travel(availability_data, travel_times)
        
        return jsonify({
            'success': True,
            'optimal_times': optimal_times,
            'submission_count': len(availability_data),
            'travel_times_calculated': len(travel_times) > 0
        })
    except Exception as e:
        print(f"Schedule error: {e}")
        return jsonify({'success': False, 'error': 'Failed to find optimal times'}), 500
    finally:
        cur.close()
        conn.close()

def calculate_buffer_slots(travel_minutes):
    return math.ceil(travel_minutes / 60)

def run_csp_with_travel(availability_data, travel_times):
    DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
    TIME_SLOTS = ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', 
                  '16:00', '17:00', '18:00', '19:00', '20:00', '21:00']
    slot_counts = {}
    
    for email, data in availability_data.items():
        user_travel_buffer = travel_times.get(email, {}).get('buffer_slots', 0)
                                                             
        for slot in data['slots']:
            day_index, time = slot.split('-')
            if user_travel_buffer > 0:
                slot_index = TIME_SLOTS.index(time)
                if slot_index >= user_travel_buffer:
                    if slot not in slot_counts:
                        slot_counts[slot] = {'count': 0, 'members': [], 'travel_info': {}}
                    slot_counts[slot]['count'] += 1
                    slot_counts[slot]['members'].append(email)
                    if email in travel_times:
                        slot_counts[slot]['travel_info'][email] = {
                            'duration_minutes': travel_times[email]['duration_minutes'],
                            'duration_text': travel_times[email].get('duration_text', ''),
                            'distance_text': travel_times[email].get('distance_text', '')
                        }
            else:
                if slot not in slot_counts:
                    slot_counts[slot] = {'count': 0, 'members': [], 'travel_info': {}}
                slot_counts[slot]['count'] += 1
                slot_counts[slot]['members'].append(email)            
    
    sorted_slots = sorted(slot_counts.items(), key=lambda x: x[1]['count'], reverse=True)[:5]
    
    optimal_times = []
    total_members = len(availability_data)
    
    for slot_id, data in sorted_slots:
        day_index, time = slot_id.split('-')
        travel_details = {}
        for email, travel_data in data['travel_info'].items():
            duration_minutes = travel_data['duration_minutes']
            meeting_hour = int(time.split(':')[0])
            meeting_minute = int(time.split(':')[1]) if ':' in time else 0
            departure_minutes = (meeting_hour * 60 + meeting_minute) - duration_minutes
            departure_hour = departure_minutes // 60
            departure_min = departure_minutes % 60
            departure_time = f"{departure_hour:02d}:{departure_min:02d}"
            travel_details[email] = {
                'duration_minutes': duration_minutes,
                'duration_text': travel_data['duration_text'],
                'distance_text': travel_data['distance_text'],
                'departure_time': departure_time,
                'arrival_time': time
            }
        
        optimal_times.append({
            'day': DAYS[int(day_index)],
            'time': time,
            'available_count': data['count'],
            'total_members': total_members,
            'members': data['members'],
            'score': round((data['count'] / total_members) * 100),
            'travel_info': travel_details
        })
    
    return optimal_times

@app.route('/api/oauth/google/initiate', methods=['GET'])
def start_google_oauth():
    user_id = request.args.get('user_id')
    if not user_id:
        return jsonify({'success': False, 'error': 'Missing user_id'}), 400
    try:
        authorization_url = get_authorization_url(user_id)
        return jsonify({'success': True, 'authorization_url': authorization_url})
    except Exception as e:
        print(f"OAuth start error: {e}")
        return jsonify({'success': False, 'error': 'Failed to start OAuth'}), 500

@app.route('/api/oauth/google/callback', methods=['GET'])
def google_oauth_callback():
    code = request.args.get('code')
    state = request.args.get('state')
    
    if not code or not state:
        return jsonify({'success': False, 'error': 'Missing parameters'}), 400
    
    try:
        user_id = int(state)
        tokens = exchange_code_for_token(code)
        conn = get_db_connection()
        if not conn:
            return jsonify({'success': False, 'error': 'Database error'}), 500
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO oauth_tokens (user_id, provider, access_token, refresh_token, expires_at)
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (user_id, provider) 
            DO UPDATE SET 
                access_token = EXCLUDED.access_token,
                refresh_token = EXCLUDED.refresh_token,
                expires_at = EXCLUDED.expires_at,
                created_at = CURRENT_TIMESTAMP
        """, (user_id, 'google', tokens['access_token'], tokens['refresh_token'], tokens['expires_at']))
        conn.commit()
        cur.close()
        conn.close()
        return """
        <html>
        <body>
            <h2>✅ Google Calendar Connected!</h2>
            <p>You can close this window and return to StudySync.</p>
            <script>
                window.opener.postMessage({type: 'oauth_success', provider: 'google'}, '*');
                setTimeout(() => window.close(), 2000);
            </script>
        </body>
        </html>
        """
    except Exception as e:
        print(f"OAuth callback error: {e}")
        return jsonify({'success': False, 'error': 'OAuth failed'}), 500

@app.route('/api/calendar/import/<int:group_id>', methods=['POST'])
def import_calendar_availability(group_id):
    data = request.json
    user_id = data.get('user_id')
    start_date_str = data.get('start_date')
    end_date_str = data.get('end_date')
    
    if not all([user_id, start_date_str, end_date_str]):
        return jsonify({'success': False, 'error': 'Missing required fields'}), 400
    
    try:
        start_date = datetime.fromisoformat(start_date_str.replace('Z', '+00:00'))
        end_date = datetime.fromisoformat(end_date_str.replace('Z', '+00:00'))
        conn = get_db_connection()
        if not conn:
            return jsonify({'success': False, 'error': 'Database error'}), 500
        cur = conn.cursor()
        cur.execute("""
            SELECT access_token, refresh_token FROM oauth_tokens 
            WHERE user_id = %s AND provider = 'google'
        """, (user_id,))
        result = cur.fetchone()
        if not result:
            return jsonify({'success': False, 'error': 'Google Calendar not connected. Please connect first.'}), 400
        
        access_token = result[0]
        refresh_token = result[1]
        busy_times = get_calendar_events(access_token, start_date, end_date, refresh_token)
        available_slots = convert_busy_to_availability(busy_times, start_date, end_date)
        cur.execute("DELETE FROM availability WHERE group_id = %s AND user_id = %s", (group_id, user_id))
        unique_slots = list(set(available_slots))
        for slot in unique_slots:
            day_index, time_slot = slot.split('-')
            cur.execute(
                "INSERT INTO availability (group_id, user_id, day_index, time_slot) VALUES (%s, %s, %s, %s)",
                (group_id, user_id, int(day_index), time_slot)
            )
        conn.commit()
        cur.close()
        conn.close()
        return jsonify({
            'success': True,
            'message': f'Imported {len(available_slots)} available time slots',
            'slots_count': len(available_slots),
            'available_slots': available_slots
        })
    except Exception as e:
        print(f"Calendar import error: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/oauth/status/<int:user_id>', methods=['GET'])
def check_oauth_status(user_id):
    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Database error'}), 500
    cur = conn.cursor()
    cur.execute("SELECT provider, created_at FROM oauth_tokens WHERE user_id = %s", (user_id,))
    tokens = cur.fetchall()
    cur.close()
    conn.close()
    connected = {}
    for token in tokens:
        connected[token[0]] = True
    return jsonify({
        'success': True,
        'google_connected': connected.get('google', False),
        'microsoft_connected': connected.get('microsoft', False)
    })

@app.route('/api/locations/<int:user_id>', methods=['GET'])
def get_user_locations(user_id):
    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Database error'}), 500
    cur = conn.cursor()
    try:
        cur.execute("""
            SELECT id, location_type, address, latitude, longitude, is_default
            FROM user_locations WHERE user_id = %s
            """, (user_id,))
        locations = []
        for row in cur.fetchall():
            locations.append({
                'id': row[0], 'type': row[1], 'address': row[2],
                'latitude': float(row[3]) if row[3] else None,
                'longitude': float(row[4]) if row[4] else None,
                'is_default': row[5]
                })
        return jsonify({'success': True, 'locations': locations})
    except Exception as e:
        print(f"Get locations error: {e}")
        return jsonify({'success': False, 'error': 'Failed to get locations'}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/locations', methods=['POST'])
def save_location():
    data = request.json
    user_id = data.get('user_id')
    location_type = data.get('location_type')
    address = data.get('address')
    if not all([user_id, location_type, address]):
        return jsonify({'success': False, 'error': 'Missing fields!'}), 400
    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Database error'}), 500
    cur = conn.cursor()
    try:
        cur.execute("""
            INSERT INTO user_locations (user_id, location_type, address, is_default)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (user_id, location_type)
            DO UPDATE SET address = EXCLUDED.address
            RETURNING id
            """, (user_id, location_type, address, location_type == 'home'))
        location_id = cur.fetchone()[0]
        conn.commit()
        return jsonify({'success': True, 'location_id': location_id})
    except Exception as e:
        print(f"Save location error: {e}")
        conn.rollback()
        return jsonify({'success': False, 'error': 'Failed to save location'}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/travel/calculate', methods=['POST'])
def calculate_travel():
    from maps_handler import calculate_travel_time
    data = request.json
    origin = data.get('origin')
    destination = data.get('destination')
    mode = data.get('mode', 'driving')
    if not all([origin, destination]):
        return jsonify({'success': False, 'error': 'Missing Fields'}), 400
    try:
        travel_info = calculate_travel_time(origin, destination, mode)
        if travel_info:
            return jsonify({'success': True, 'travel_time': travel_info})
        else:
            return jsonify({'success': False, 'error': 'Could not calculate travel time'}), 400
    except Exception as e:
        print(f"Travel calculation error: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/groups/<int:group_id>/location', methods=['PUT'])
def update_group_location(group_id):
    data = request.json
    location = data.get('location')
    if not location:
        return jsonify({'success': False, 'error': 'Missing location'}), 400
    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Database error'}), 500
    cur = conn.cursor()
    try:
        cur.execute("UPDATE groups SET meeting_location = %s WHERE id = %s", (location, group_id))
        conn.commit()
        return jsonify({'success': True})
    except Exception as e:
        print(f"Update location error: {e}")
        conn.rollback()
        return jsonify({'success': False, 'error': 'Failed to update location'}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/groups/<int:group_id>/location', methods=['GET'])
def get_group_location(group_id):
    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Database error'}), 500
    cur = conn.cursor()
    try:
        cur.execute("SELECT meeting_location FROM groups WHERE id = %s", (group_id,))
        result = cur.fetchone()
        if result:
            return jsonify({'success': True, 'meeting_location': result[0]})
        else:
            return jsonify({'success': False, 'error': 'Group not found'}), 404
    except Exception as e:
        print(f"Get group location error: {e}")
        return jsonify({'success': False, 'error': 'Failed to get location'}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/meetings', methods=['POST'])
def create_meeting():
    data = request.json
    group_id = data.get('group_id')
    day_of_week = data.get('day_of_week')
    meeting_time = data.get('meeting_time')
    meeting_date = data.get('meeting_date')
    created_by = data.get('created_by')
    if not all([group_id, day_of_week, meeting_time, created_by]):
        return jsonify({'success': False, 'error': 'Missing required fields'}), 400
    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Database error'}), 500
    cur = conn.cursor()
    try:
        cur.execute("SELECT name, meeting_location FROM groups WHERE id = %s", (group_id,))
        group_result = cur.fetchone()
        if not group_result:
            return jsonify({'success': False, 'error': 'Group not found'}), 404
        location = group_result[1]
        cur.execute("""
            INSERT INTO meetings (group_id, day_of_week, meeting_time, meeting_date, location, created_by)
            VALUES (%s, %s, %s, %s, %s, %s) RETURNING id
        """, (group_id, day_of_week, meeting_time, meeting_date, location, created_by))
        meeting_id = cur.fetchone()[0]
        conn.commit()
        try:
            send_meeting_notification(group_id, meeting_id, day_of_week, meeting_time, meeting_date)
            email_sent = True
        except Exception as e:
            print(f"Email notification failed: {e}")
            email_sent = False
        return jsonify({
            'success': True,
            'meeting_id': meeting_id,
            'message': f'Meeting scheduled for {day_of_week} at {meeting_time}',
            'email_sent': email_sent
        }), 201
    except Exception as e:
        print(f"Create meeting error: {e}")
        conn.rollback()
        return jsonify({'success': False, 'error': 'Failed to create meeting'}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/meetings/<int:group_id>', methods=['GET'])
def get_group_meetings(group_id):
    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Database error'}), 500
    cur = conn.cursor()
    try:
        cur.execute("""
            SELECT m.id, m.day_of_week, m.meeting_time, m.meeting_date,
                   m.location, m.created_at, u.name as created_by_name
            FROM meetings m
            JOIN users u ON m.created_by = u.id
            WHERE m.group_id = %s
            ORDER BY m.meeting_date DESC, m.meeting_time
        """, (group_id,))
        meetings = []
        for row in cur.fetchall():
            meetings.append({
                'id': row[0], 'day_of_week': row[1],
                'meeting_time': str(row[2]),
                'meeting_date': row[3].isoformat() if row[3] else None,
                'location': row[4], 'created_at': row[5].isoformat(),
                'created_by_name': row[6]
            })
        return jsonify({'success': True, 'meetings': meetings})
    except Exception as e:
        print(f"Get meetings error: {e}")
        return jsonify({'success': False, 'error': 'Failed to get meetings'}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/meetings/<int:meeting_id>', methods=['DELETE'])
def delete_meeting(meeting_id):
    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Database error'}), 500
    cur = conn.cursor()
    try:
        cur.execute("DELETE FROM meetings WHERE id = %s", (meeting_id,))
        conn.commit()
        return jsonify({'success': True, 'message': 'Meeting deleted'})
    except Exception as e:
        print(f"Delete meeting error: {e}")
        conn.rollback()
        return jsonify({'success': False, 'error': 'Failed to delete meeting'}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/users/<int:user_id>/meetings', methods=['GET'])
def get_user_meetings(user_id):
    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Database error'}), 500
    cur = conn.cursor()
    try:
        cur.execute("""
            SELECT m.id, m.day_of_week, m.meeting_time, m.meeting_date,
                   m.location, m.created_at, g.id as group_id,
                   g.name as group_name, u.name as created_by_name
            FROM meetings m
            JOIN groups g ON m.group_id = g.id
            JOIN group_members gm ON g.id = gm.group_id
            JOIN users u ON m.created_by = u.id
            WHERE gm.user_id = %s
            ORDER BY m.meeting_date DESC, m.meeting_time
        """, (user_id,))
        meetings = []
        for row in cur.fetchall():
            meetings.append({
                'id': row[0], 'day_of_week': row[1],
                'meeting_time': str(row[2]),
                'meeting_date': row[3].isoformat() if row[3] else None,
                'location': row[4], 'created_at': row[5].isoformat(),
                'group_id': row[6], 'group_name': row[7],
                'created_by_name': row[8]
            })
        return jsonify({'success': True, 'meetings': meetings})
    except Exception as e:
        print(f"Get user meetings error: {e}")
        return jsonify({'success': False, 'error': 'Failed to get meetings'}), 500
    finally:
        cur.close()
        conn.close()

if __name__ == '__main__':
    print("=" * 50)
    print("StudySync Backend Starting...")
    print("=" * 50)
    app.run(debug=False, host='0.0.0.0', port=int(os.environ.get('PORT', 5000)))

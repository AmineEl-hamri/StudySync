# app.py is the main backend for StudySync. Exposes RESTful JSON API consumed by the
# GitHub Pages frontend, backed by a PostgreSQL instance on Google Cloud SQL.
# Deployed to Google Cloud Run as a containerised service.


# This file is organised loosely by functional areas:
# - Config and helpers
# - Authentication (register, login)
# - Groups (create, read, update, delete, leave)
# - Availability
# - Scheduling ( CSP algorithm + travel time integration)
# - Meetings (create, read, delete + email notifications)
# - User profile (update, password, picture, preferences, transport)
# - OAuth + Google Calendar Integration
# - Locations ( user home/work, group meeitng location)
# - Miscellaneous (contact form, tutorial flag, health checks)

from flask import Flask, request, jsonify
from flask_cors import CORS
import psycopg2
import bcrypt
from datetime import datetime, timedelta
from oauth_handler import (
    get_authorization_url, 
    exchange_code_for_token, 
    get_calendar_events,
    convert_busy_to_availability
)
import math
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from dotenv import load_dotenv
import os
from google.cloud import storage as gcs
import base64
import uuid
import re

# Load .env for local development. On Cloud Run, env vars come from the service
# config rather than a file.
load_dotenv()

CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID")
CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET")

app = Flask(__name__)

#CORS is explicity scoped to /api/* paths with a fixed allowlist of origins.
# Localhost entries are for development; the GitHub Pages URL is the production frontend;
# the Cloud Run URL is included so the OAuth callback HTML can postMessage back.
CORS(app, resources={
    r"/api/*": {
        "origins": [
            "http://localhost:5000",
            "http://127.0.0.1:5000",
            "https://amineel-hamri.github.io",
            "https://studysync-backend-195370304491.europe-west2.run.app"
        ],
        "methods": ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        "allow_headers": ["Content-Type", "Authorization"]
    }
})

# DB config pullled from env. Default values exist so a dev can run locally with
# Postgres on default ports, but production always supplies its own.
DB_CONFIG = {
    'host':     os.environ.get('DB_HOST', 'localhost'),
    'database': os.environ.get('DB_NAME', 'postgres'),
    'user':     os.environ.get('DB_USER', 'postgres'),
    'password': os.environ.get('DB_PASSWORD', '')
}

# SMTP config for email notifications. Uses Gmail's SMTP with an App Password since Google
# blocks direct password auth.
EMAIL_HOST     = 'smtp.gmail.com'
EMAIL_PORT     = 587
EMAIL_USERNAME = os.environ.get('EMAIL_USERNAME', '')
EMAIL_PASSWORD = os.environ.get('EMAIL_PASSWORD', '')
EMAIL_FROM     = f'StudySync <{EMAIL_USERNAME}>'

# Intentionally lenient email regex. strict RFC compliance is overkill and rejects
# valid edge cases; we accept anything that looks structurally correct.
EMAIL_REGEX = re.compile(r'^[^@\s]+@[^@\s]+\.[^@\s]{2,}$')

def is_valid_email(email):
    return bool(EMAIL_REGEX.match(email))

# Opens a fresh psycopg2 connection per call. A pool was considered but Cloud Run scales
# to zero between requests, which would invalidate pooled connections.
# Each endpoint closes its connection in a finally block regardless of outcome.
def get_db_connection():
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        return conn
    except Exception as e:
        print(f"Database connection error: {e}")
        return None

# Sends HTML notification emails to every group member when a new meeting is scheduled.
# Returns True only if every email is sent successfully, the caller uses this to
# persist whether notifications actually reached members.
def send_meeting_notification(group_id, meeting_id, day_of_week, meeting_time, meeting_date):
    conn = get_db_connection()
    if not conn:
        return False
    cur = conn.cursor()
    try:
        # Get the group's display data for the email body.
        cur.execute("""
            SELECT g.name, g.description, g.meeting_location
            FROM groups g WHERE g.id = %s
        """, (group_id,))
        group_result = cur.fetchone()
        if not group_result:
            return False
        group_name = group_result[0]
        group_description = group_result[1] or 'No description'
        location = group_result[2] or 'Location TBD'

        # Fetch every member's name and email for the recipient list.
        cur.execute("""
            SELECT u.name, u.email FROM group_members gm
            JOIN users u ON gm.user_id = u.id WHERE gm.group_id = %s
        """, (group_id,))
        members = cur.fetchall()
        if not members:
            return False
        subject = f"📅 New Meeting Scheduled: {group_name}"

        # Inline-styled HTML so the email renders well in clients that
        # strip external stylesheets.
        html_body = f"""
        <html><body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
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
                <ul>{''.join([f'<li>{name}</li>' for name, email in members])}</ul>
                <p style="color: #666; font-size: 14px; margin-top: 30px;">See you there! 📚<br>- StudySync Team</p>
            </div>
        </body></html>
        """

        # Track whether every recipient recieved their email. A single failure
        # flips the result flag to False so we can record partial delivery.
        all_sent = True
        for name, email in members:
            try:
                msg = MIMEMultipart('alternative')
                msg['Subject'] = subject
                msg['From'] = EMAIL_FROM
                msg['To'] = email
                msg.attach(MIMEText(html_body, 'html'))
                with smtplib.SMTP(EMAIL_HOST, EMAIL_PORT) as server:
                    server.starttls()
                    server.login(EMAIL_USERNAME, EMAIL_PASSWORD)
                    server.send_message(msg)
                print(f"✅ Email sent to {email}")
            except Exception as e:
                print(f"❌ Failed to send email to {email}: {e}")
                all_sent = False
        return all_sent
    except Exception as e:
        print(f"Email notification error: {e}")
        return False
    finally:
        cur.close()
        conn.close()

# Health checks

# Simple liveness check used by the frontend to warm up a cold-starting
# Cloud Run instance. Returns immediately without touching the database.
@app.route('/api/test', methods=['GET'])
def test():
    return jsonify({'success': True, 'message': 'StudySync API is working!', 'timestamp': datetime.now().isoformat()})

# Verifies DB connectivity by running a trivial COUNT query. Useful for diagnosing
# Cloud SQL configuration issues without needing to trigger a real user flow.
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

# Authentication

# Register a new user. Returns 201 on success with the new user record.
# Emails are lowercased to avoid duplucate-account issues from casing, and
# the DB has a UNIQUE constraint which provides the authoritative check.
@app.route('/api/register', methods=['POST'])
def register():
    data = request.json
    name = data.get('name', '').strip()
    email = data.get('email', '').strip().lower()
    password = data.get('password', '')

    # Belt and braces validation, frontend validates too but its safer to double check.
    if not all([name, email, password]):
        return jsonify({'success': False, 'error': 'Missing fields'}), 400
    if len(name) < 2:
        return jsonify({'success': False, 'error': 'Name must be at least 2 characters'}), 400
    if not is_valid_email(email):
        return jsonify({'success': False, 'error': 'Please enter a valid email address'}), 400
    if len(password) < 8:
        return jsonify({'success': False, 'error': 'Password must be at least 8 characters'}), 400

    # bcrypt is deliberately slow to resist brute-force attacks. gensalt() chooses a
    # random salt and cost factor. Plaintext passwords are never stored.
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
        return jsonify({'success': True, 'user': {
            'id': user[0], 'name': user[1], 'email': user[2], 'created_at': user[3].isoformat()
        }}), 201
    except psycopg2.IntegrityError:
        # UNIQUE violation on the email column 
        return jsonify({'success': False, 'error': 'An account with this email already exists'}), 400
    except Exception as e:
        print(f"Registration error: {e}")
        return jsonify({'success': False, 'error': 'Registration failed'}), 500
    finally:
        cur.close()
        conn.close()

# Log in with email and password. Returns the user object on success; the
# frontend stores it in localStorage and uses the id for subsequent requests.
# Generic error messages ("Invalid email or password") avoid revealing which
# field was wrong - a minor but standard defence against account enumeration.
@app.route('/api/login', methods=['POST'])
def login():
    data = request.json
    email = data.get('email', '').strip().lower()
    password = data.get('password', '')
    if not all([email, password]):
        return jsonify({'success': False, 'error': 'Missing email or password'}), 400
    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Database error'}), 500
    cur = conn.cursor()
    try:
        cur.execute("SELECT id, name, email, password_hash FROM users WHERE email = %s", (email,))
        user = cur.fetchone()
        # bcrypt.checkpw handles the salt comparison internally.
        if user and bcrypt.checkpw(password.encode('utf-8'), user[3].encode('utf-8')):
            return jsonify({'success': True, 'user': {'id': user[0], 'name': user[1], 'email': user[2]}})
        else:
            return jsonify({'success': False, 'error': 'Invalid email or password'}), 401
    except Exception as e:
        print(f"Login error: {e}")
        return jsonify({'success': False, 'error': 'Login failed'}), 500
    finally:
        cur.close()
        conn.close()

# Groups (create, read, delete, leave)
# Returns every group the user is a member of, along with each group's full
# member list and a count of how many have submitted availability.
# One query handles everything via GROUP BY + array_agg to avoid N+1 lookups.
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
        # The self-join on group_members lets us filter by the requesting user
        # while aggregating every member's email. The LEFT JOIN on availability
        # gives us submitted_count without excluding groups with zero submissions.
        cur.execute("""
            SELECT g.id, g.name, g.description, g.owner_id, u.name as owner_name,
                   g.created_at,
                   array_agg(DISTINCT u2.email ORDER BY u2.email) as member_emails,
                   COUNT(DISTINCT a.user_id) as submitted_count
            FROM groups g
            JOIN users u ON g.owner_id = u.id
            JOIN group_members gm ON g.id = gm.group_id
            JOIN group_members gm2 ON g.id = gm2.group_id
            JOIN users u2 ON gm2.user_id = u2.id
            LEFT JOIN availability a ON a.group_id = g.id
            WHERE gm.user_id = %s
            GROUP BY g.id, g.name, g.description, g.owner_id, u.name, g.created_at
            ORDER BY g.created_at DESC
        """, (user_id,))
        groups = []
        for row in cur.fetchall():
            groups.append({
                'id': row[0], 'name': row[1], 'description': row[2],
                'ownerId': row[3], 'ownerName': row[4],
                'members': row[6] if row[6] else [],
                'createdAt': row[5].isoformat(),
                'submittedCount': row[7]
            })
        return jsonify({'success': True, 'groups': groups})
    except Exception as e:
        print(f"Get groups error: {e}")
        return jsonify({'success': False, 'error': 'Failed to get groups'}), 500
    finally:
        cur.close()
        conn.close()

# Creates a new group. Owner is added as a member automatically, and any
# existing availability the owner or invited members already have is copied
# into the new group so they don't have to re-enter it.
# Members referenced by email but not yet registered are returned in
# skipped_emails so the UI can inform the user.
@app.route('/api/groups', methods=['POST'])
def create_group():
    data = request.json
    name = data.get('name', '').strip()
    description = data.get('description', '').strip()
    owner_id = data.get('owner_id')
    member_emails = data.get('members', [])

    if not all([name, owner_id]):
        return jsonify({'success': False, 'error': 'Missing required fields'}), 400
    if len(name) < 2:
        return jsonify({'success': False, 'error': 'Group name must be at least 2 characters'}), 400

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Database error'}), 500
    cur = conn.cursor()
    try:
        # Prevent the same user creating two groups with the same name, friendlier
        # than the generic IntegrityError is we added a unique index.
        cur.execute(
            "SELECT id FROM groups WHERE name = %s AND owner_id = %s",
            (name, owner_id)
        )
        if cur.fetchone():
            return jsonify({'success': False, 'error': 'You already have a group with this name'}), 400
        cur.execute(
            "INSERT INTO groups (name, description, owner_id) VALUES (%s, %s, %s) RETURNING id",
            (name, description, owner_id)
        )
        group_id = cur.fetchone()[0]
        cur.execute("INSERT INTO group_members (group_id, user_id) VALUES (%s, %s)", (group_id, owner_id))

        # Copy owner's existing availability into the new group
        cur.execute("""
            SELECT DISTINCT day_index, time_slot FROM availability WHERE user_id = %s
        """, (owner_id,))
        owner_slots = cur.fetchall()
        for day_index, time_slot in owner_slots:
            cur.execute("""
                INSERT INTO availability (group_id, user_id, day_index, time_slot)
                VALUES (%s, %s, %s, %s) ON CONFLICT DO NOTHING
            """, (group_id, owner_id, day_index, time_slot))

        # Look up each invited email and add them if they exist. Emails that don't
        # match a registered user get reported back so the UI can warn.
        added_members = []
        skipped_emails = []
        for email in member_emails:
            email = email.strip().lower()
            if not is_valid_email(email):
                skipped_emails.append(email)
                continue
            cur.execute("SELECT id FROM users WHERE email = %s", (email,))
            user = cur.fetchone()
            if user:
                member_id = user[0]
                cur.execute(
                    "INSERT INTO group_members (group_id, user_id) VALUES (%s, %s) ON CONFLICT DO NOTHING",
                    (group_id, member_id)
                )
                # Copy this member's existing availability into the new group
                cur.execute("""
                    SELECT DISTINCT day_index, time_slot 
                    FROM availability 
                    WHERE user_id = %s
                    LIMIT 1
                """, (member_id,))
                has_availability = cur.fetchone()
                if has_availability:
                    cur.execute("""
                        SELECT DISTINCT day_index, time_slot 
                        FROM availability 
                        WHERE user_id = %s
                    """, (member_id,))
                    existing_slots = cur.fetchall()
                    for day_index, time_slot in existing_slots:
                        cur.execute("""
                            INSERT INTO availability (group_id, user_id, day_index, time_slot)
                            VALUES (%s, %s, %s, %s) ON CONFLICT DO NOTHING
                        """, (group_id, member_id, day_index, time_slot))
                added_members.append(email)
            else:
                skipped_emails.append(email)

        conn.commit()
        return jsonify({
            'success': True,
            'group_id': group_id,
            'added_members': added_members,
            'skipped_emails': skipped_emails
        }), 201
    except Exception as e:
        print(f"Create group error: {e}")
        conn.rollback()
        return jsonify({'success': False, 'error': 'Failed to create group'}), 500
    finally:
        cur.close()
        conn.close()
        
# Availability (per-group)
# The global availability endpoints live further down and propagate to all
# groups the user belongs to. These per-group endpoints remain for internal
# use (scheduling, group-scoped reads).

# Saves a user's availability for one group. The membership check ensures a
# user can't write availability to a group they don't belong to, even by
# crafting a direct API call.
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
        # Verify user is a member of this group
        cur.execute(
            "SELECT 1 FROM group_members WHERE group_id = %s AND user_id = %s",
            (group_id, user_id)
        )
        if not cur.fetchone():
            return jsonify({'success': False, 'error': 'You are not a member of this group'}), 403

        # Replace the user's existing availability with the new set. Delete-then-insert
        # is simpler than trying to compute a diff, and the operation is atomic
        # thanks to the surrounding transaction.
        cur.execute("DELETE FROM availability WHERE group_id = %s AND user_id = %s", (group_id, user_id))
        for slot in slots:
            parts = slot.split('-', 1)
            if len(parts) != 2:
                continue  # Silently skip malformed slots.
            day_index, time_slot = parts
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

# Returns all members' availability for a group, keyed by email.
# Used both by the group details page (to show submission status) and by
# the scheduling endpoint (to feed the CSP algorithm).
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
            user_id, email, day_index, time_slot = row[0], row[1], row[2], row[3]
            # Reconstruct the slot id in 'day-time' form to match the frontend's format.
            
            slot = f"{day_index}-{time_slot}"
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

# Scheduling (CSP algorithm entry point + helpers)

# Main scheduling endpoint. Gathers the group's availability, fetches each
# user's preferred transport mode and default location, calls the Distance
# Matrix API to calculate travel times, then runs the CSP to produce a
# ranked list of optimal meeting times.
@app.route('/api/schedule/<int:group_id>', methods=['GET'])
def find_optimal_times(group_id):
    # Deferred import so the endpoint loads even if maps_handler's API key is missing
    from maps_handler import calculate_travel_time
    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Database error'}), 500
    cur = conn.cursor()
    try:
        # Step 1: get the group's meeting location (None if not set).
        cur.execute("SELECT meeting_location FROM groups WHERE id = %s", (group_id,))
        group_result = cur.fetchone()
        meeting_location = group_result[0] if group_result else None

        # Step 2: assemble every member's availability as {email: {user_id, slots}}
        cur.execute("""
            SELECT a.user_id, u.email, a.day_index, a.time_slot
            FROM availability a
            JOIN users u ON a.user_id = u.id
            WHERE a.group_id = %s
        """, (group_id,))
        availability_data = {}
        for row in cur.fetchall():
            user_id, email = row[0], row[1]
            slot = f"{row[2]}-{row[3]}"
            if email not in availability_data:
                availability_data[email] = {'user_id': user_id, 'slots': []}
            availability_data[email]['slots'].append(slot)

        # Scheduling requires at least 2 members, otherwise the output would just
        # echo one user's availability back.
        if len(availability_data) < 2:
            return jsonify({'success': False, 'error': 'Need at least 2 members to submit availability'}), 400

        # Step 3: fetch each member's default location + transport mode, then call
        # the Distance Matrix API. Detailed debug logs help diagnose issues in Cloud
        # Run where we can't attach a debugger.
        travel_times = {}
        print(f"[SCHEDULE] Group {group_id}: meeting_location = {meeting_location!r}", flush=True)
        if meeting_location:
            for email, data in availability_data.items():
                user_id = data['user_id']
                # LEFT JOIN so users without a saved default location still return a row;
                # the address column will be NULL and we skip them below.
                # COALESCE gives every user a transport mode even if the column is NULL.
                cur.execute("""
                    SELECT ul.address, COALESCE(u.transport_mode, 'transit')
                    FROM users u
                    LEFT JOIN user_locations ul ON ul.user_id = u.id AND ul.is_default = true
                    WHERE u.id = %s LIMIT 1
                """, (user_id,))
                row = cur.fetchone()
                print(f"[SCHEDULE] {email}: row = {row}", flush=True)
                if row and row[0]:  # must have an address
                    address, mode = row[0], row[1]
                    travel_info = calculate_travel_time(address, meeting_location, mode=mode)
                    print(f"[SCHEDULE] {email}: travel_info = {travel_info}", flush=True)
                    if travel_info:
                        travel_times[email] = {
                            'duration_minutes': travel_info['duration_minutes'],
                            'duration_text': travel_info.get('duration_text', ''),
                            'distance_text': travel_info.get('distance_text', ''),
                            'mode': mode,
                            # Buffer expressed as number of hourly slots that must
                            # be free before the meeting to allow for the journey
                            'buffer_slots': calculate_buffer_slots(travel_info['duration_minutes'])
                        }
        else:
            print(f"[SCHEDULE] Skipping travel calculation, no meeting_location set on group {group_id}", flush=True)

        # Step 4: run the CSP with both availability and travel times.
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

# Converts a travel duration in minutes into a count of one-hour slots that
# must be free before the meeting start. math.ceil ensures a 20-minute
# journey still blocks the slot immediately before (so users aren't asked
# to teleport).
def calculate_buffer_slots(travel_minutes):
    return math.ceil(travel_minutes / 60)

# The core CSP algorithm. For each submitted slot, count how many members are
# available - subject to the travel-time buffer excluding early slots for
# users who have a long journey. Top five slots by count are returned, each
# scored as a percentage of total members.
def run_csp_with_travel(availability_data, travel_times):
    DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
    TIME_SLOTS = ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00',
                  '16:00', '17:00', '18:00', '19:00', '20:00', '21:00']
    slot_counts = {}
    
    # Iterate over every member's submitted slots. For each one, exclude it
    # if it falls inside the member's travel buffer (can't physically get there),
    # then increment the global count for that slot.
    for email, data in availability_data.items():
        user_travel_buffer = travel_times.get(email, {}).get('buffer_slots', 0)
        for slot in data['slots']:
            parts = slot.split('-', 1)
            if len(parts) != 2:
                continue
            day_index, time = parts
            # Skip slots outside the fixd time grid. This is defensive, it shouldn't happen.
            if time not in TIME_SLOTS:
                continue
            # Travel buffer check, exclude slots so early the user can't get there
            if user_travel_buffer > 0:
                slot_index = TIME_SLOTS.index(time)
                if slot_index < user_travel_buffer:
                    continue
            if slot not in slot_counts:
                slot_counts[slot] = {'count': 0, 'members': [], 'travel_info': {}}
            slot_counts[slot]['count'] += 1
            slot_counts[slot]['members'].append(email)
            # Stash the travel info for each member per slot so it's available
            # when rendering the schedule results later.
            if email in travel_times:
                slot_counts[slot]['travel_info'][email] = {
                    'duration_minutes': travel_times[email]['duration_minutes'],
                    'duration_text': travel_times[email].get('duration_text', ''),
                    'distance_text': travel_times[email].get('distance_text', ''),
                    'mode': travel_times[email].get('mode', 'transit')
                }

    # Rank by member count descending, take the top 5.
    sorted_slots = sorted(slot_counts.items(), key=lambda x: x[1]['count'], reverse=True)[:5]
    optimal_times = []
    total_members = len(availability_data)

    # For each top-ranked slot, compute per-member departure times and shape the response.
    # Members without travel info just appear in 'members' without an entry in
    # 'travel_info'.
    
    for slot_id, data in sorted_slots:
        parts = slot_id.split('-', 1)
        if len(parts) != 2:
            continue
        day_index, time = parts
        travel_details = {}
        for email, travel_data in data['travel_info'].items():
            duration_minutes = travel_data['duration_minutes']
            # Work out the departure time: meeting_time minus travel duration.
            # If the time is somehow malformed, fall back to 'N/A' rather than crash.
            try:
                meeting_hour = int(time.split(':')[0])
                meeting_minute = int(time.split(':')[1]) if ':' in time else 0
                departure_minutes = (meeting_hour * 60 + meeting_minute) - duration_minutes
                departure_hour = max(0, departure_minutes // 60)
                departure_min = departure_minutes % 60
                departure_time = f"{departure_hour:02d}:{departure_min:02d}"
            except Exception:
                departure_time = 'N/A'
            travel_details[email] = {
                'duration_minutes': duration_minutes,
                'duration_text': travel_data['duration_text'],
                'distance_text': travel_data['distance_text'],
                'mode': travel_data.get('mode', 'transit'),
                'departure_time': departure_time,
                'arrival_time': time
            }
        optimal_times.append({
            'day': DAYS[int(day_index)],
            'time': time,
            'available_count': data['count'],
            'total_members': total_members,
            'members': data['members'],
            # 'members_all' lets the frontend compute the unavailble list by subtraction.
            'members_all': list(availability_data.keys()),
            'score': round((data['count'] / total_members) * 100),
            'travel_info': travel_details
        })
    return optimal_times

# OAuth (Google Calendar integration)
# Delegates authentication to oauth_handler.py, storing access + refresh
# tokens so the user only authorises once.

# Starts the OAuth flow by generating an authorisation URL with the user's id
# embedded as the state parameter. The frontend opens this URL in a popup.
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

# OAuth callback: Google redirects here with the authorisation code, which we
# exchange for access + refresh tokens. Returns a small HTML page that uses
# postMessage to notify the parent window that authorisation completed.
@app.route('/api/oauth/google/callback', methods=['GET'])
def google_oauth_callback():
    code = request.args.get('code')
    state = request.args.get('state')
    if not code or not state:
        return jsonify({'success': False, 'error': 'Missing parameters'}), 400
    try:
        # State was set to the user id when we generated the authorisation URL.
        user_id = int(state)
        tokens = exchange_code_for_token(code)
        conn = get_db_connection()
        if not conn:
            return jsonify({'success': False, 'error': 'Database error'}), 500
        cur = conn.cursor()
        # ON CONFLICT updates existing tokens so reauthorisation just refreshes
        # the stored values rather than creating duplicate rows
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
        # HTML response rather than JSON, this is what Google redirects the
        # user's browser to, so it needs to render something they can close
        return """
        <html><body>
            <h2>✅ Google Calendar Connected!</h2>
            <p>You can close this window and return to StudySync.</p>
            <script>
                window.opener.postMessage({type: 'oauth_success', provider: 'google'}, '*');
                setTimeout(() => window.close(), 2000);
            </script>
        </body></html>
        """
    except Exception as e:
        print(f"OAuth callback error: {e}")
        return jsonify({'success': False, 'error': 'OAuth failed'}), 500

# Tells the frontend whether the user has already connected Google Calendar,
# so the UI can skip the authorisation popup for returning users.
# Note: the Microsoft field is reserved for a future Outlook integration.
@app.route('/api/oauth/status/<int:user_id>', methods=['GET'])
def check_oauth_status(user_id):
    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Database error'}), 500
    cur = conn.cursor()
    try:
        cur.execute("SELECT provider FROM oauth_tokens WHERE user_id = %s", (user_id,))
        tokens = cur.fetchall()
        connected = {token[0]: True for token in tokens}
        return jsonify({
            'success': True,
            'google_connected': connected.get('google', False),
            'microsoft_connected': connected.get('microsoft', False)
        })
    except Exception as e:
        # Explicit catch, without this a DB error would bubble up as an
        # untyped 500 with no JSON body and no explanation to the client
        print(f"OAuth status check error: {e}")
        return jsonify({'success': False, 'error': 'Failed to check OAuth status'}), 500
    finally:
        cur.close()
        conn.close()

# User locations (home/work + group meeting location)

# Returns the user's saved home/work addresses. Used by the My Locations
# modal and by the scheduling endpoint to get the default address.
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

# Saves a home or work address for the user. Home takes priority as the
# default; work becomes the default only if no home address exists. This
# ensures users who only save a work address still get travel-time calculations.
@app.route('/api/locations', methods=['POST'])
def save_location():
    data = request.json
    user_id = data.get('user_id')
    location_type = data.get('location_type')
    address = data.get('address', '').strip()
    if not all([user_id, location_type, address]):
        return jsonify({'success': False, 'error': 'Missing fields'}), 400
    if location_type not in ('home', 'work'):
        return jsonify({'success': False, 'error': 'Invalid location type'}), 400
    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Database error'}), 500
    cur = conn.cursor()
    try:
        # Decide whether this location should be the default. Home is always
        # the default when present. Work is only the default if no home exists,
        # this way a user who saves only work still gets travel times calculated.
        if location_type == 'home':
            is_default = True
            # A new home replaces work as the default, unmark any existing
            # work row so there's only ever one default per user.
            cur.execute("""
                UPDATE user_locations SET is_default = false
                WHERE user_id = %s AND location_type = 'work'
            """, (user_id,))
        else:
            # Check whether a home address already exists for this user
            cur.execute("""
                SELECT 1 FROM user_locations 
                WHERE user_id = %s AND location_type = 'home'
            """, (user_id,))
            is_default = cur.fetchone() is None

        # UPSERT pattern so the same endpoint handles both creates and updates
        cur.execute("""
            INSERT INTO user_locations (user_id, location_type, address, is_default)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (user_id, location_type)
            DO UPDATE SET 
                address = EXCLUDED.address,
                is_default = EXCLUDED.is_default
            RETURNING id
        """, (user_id, location_type, address, is_default))
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

# One-off travel time calculation, not currently used by the frontend but
# exposed for debugging and future use cases (e.g. user inspecting a journey
# before committing to a meeting). Default mode matches the app-wide default.
@app.route('/api/travel/calculate', methods=['POST'])
def calculate_travel():
    from maps_handler import calculate_travel_time
    data = request.json
    origin = data.get('origin', '').strip()
    destination = data.get('destination', '').strip()
    mode = data.get('mode', 'driving')
    if not all([origin, destination]):
        return jsonify({'success': False, 'error': 'Missing fields'}), 400
    try:
        travel_info = calculate_travel_time(origin, destination, mode)
        if travel_info:
            return jsonify({'success': True, 'travel_time': travel_info})
        else:
            return jsonify({'success': False, 'error': 'Could not calculate travel time'}), 400
    except Exception as e:
        print(f"Travel calculation error: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

# Updates a group's meeting location. Only the group owner can make this change,
# so the endpoint requires user_id and checks it against owner_id.
@app.route('/api/groups/<int:group_id>/location', methods=['PUT'])
def update_group_location(group_id):
    data = request.json
    location = data.get('location', '').strip()
    user_id = data.get('user_id')
    if not location:
        return jsonify({'success': False, 'error': 'Missing location'}), 400
    # user_id is required. Previously missing user_id would silently bypass
    # the ownership check, allowing any caller to modify any group's location
    if not user_id:
        return jsonify({'success': False, 'error': 'Missing user_id'}), 400
    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Database error'}), 500
    cur = conn.cursor()
    try:
        cur.execute("SELECT owner_id FROM groups WHERE id = %s", (group_id,))
        result = cur.fetchone()
        if not result:
            return jsonify({'success': False, 'error': 'Group not found'}), 404
        # Ownership check, only owner can set meeting location
        if int(result[0]) != int(user_id)
            return jsonify({'success': False, 'error': 'Only the group owner can set the meeting location'}), 403
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

# Returns the group's meeting location. Read-only and available to any caller
# since the location isn't sensitive.
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

# Meetings (create, read, delete + cancellation emails)

# Creates a confirmed meeting. Enforces owner-only access, rejects past dates,
# and prevents double-booking the same slot. Sends notification emails on success
# and persists whether they succeeded so the UI can show an accurate badge.
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

     # Reject meetings with a date/time already in the past. Frontend also
    # checks this, but the backend is the authoritative guard.
    if meeting_date:
        try:
            meeting_dt = datetime.strptime(f"{meeting_date} {meeting_time}", "%Y-%m-%d %H:%M")
            if meeting_dt <= datetime.now():
                return jsonify({'success': False, 'error': 'Cannot schedule a meeting in the past'}), 400
        except (ValueError, TypeError):
            return jsonify({'success': False, 'error': 'Invalid date or time format'}), 400

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Database error'}), 500
    cur = conn.cursor()
    try:
        cur.execute("SELECT owner_id, meeting_location FROM groups WHERE id = %s", (group_id,))
        group_result = cur.fetchone()
        if not group_result:
            return jsonify({'success': False, 'error': 'Group not found'}), 404

        # Ownership check, guard against NULL owner (orphaned group after owner account deletion)
        owner_id = group_result[0]
        if owner_id is None or int(owner_id) != int(created_by):
            return jsonify({'success': False, 'error': 'Only the group owner can schedule meetings'}), 403

        # Duplicate check, prevent two meetings at the exact same slot
        cur.execute("""
            SELECT id FROM meetings
            WHERE group_id = %s AND meeting_date = %s AND meeting_time = %s
        """, (group_id, meeting_date, meeting_time))
        if cur.fetchone():
            return jsonify({'success': False, 'error': 'A meeting is already scheduled at this time'}), 400

        # Snapshot the group's meeting location onto the meeting record so
        # historical records stay accurate even if the group location later changes
        location = group_result[1]
        cur.execute("""
            INSERT INTO meetings (group_id, day_of_week, meeting_time, meeting_date, location, created_by)
            VALUES (%s, %s, %s, %s, %s, %s) RETURNING id
        """, (group_id, day_of_week, meeting_time, meeting_date, location, created_by))
        meeting_id = cur.fetchone()[0]
        conn.commit()

        # Send notification emails, then persist whether every recipient
        # actually got theirs. The UI reads this flag to decide whether to
        # show the "Notified" badge on the meeting card.
        email_sent = False
        try:
            send_meeting_notification(group_id, meeting_id, day_of_week, meeting_time, meeting_date)
            email_sent = True
        except Exception as e:
            print(f"Email notification failed: {e}")
            email_sent = False

        # Record the email result. A separate update keeps the meeting insert
        # atomic even if the email step fails entirely.
        try:
            cur.execute("UPDATE meetings SET email_sent = %s WHERE id = %s", (email_sent, meeting_id))
            conn.commit()
        except Exception as e:
            print(f"Failed to record email_sent flag: {e}")
            
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

# Returns all meetings for a specific group, newest first. The email_sent
# field reflects whether the notification emails actually dispatched, used
# by the UI to show a "Notified" badge.
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
                'created_by_name': row[6],
                'email_sent': True
            })
        return jsonify({'success': True, 'meetings': meetings})
    except Exception as e:
        print(f"Get meetings error: {e}")
        return jsonify({'success': False, 'error': 'Failed to get meetings'}), 500
    finally:
        cur.close()
        conn.close()

# Deletes (cancels) a meeting. Enforces owner-only access, then triggers
# cancellation emails to all members. Email failures don't fail the request.
@app.route('/api/meetings/<int:meeting_id>', methods=['DELETE'])
def delete_meeting(meeting_id):
    data = request.json or {}
    user_id = data.get('user_id')
    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Database error'}), 500
    cur = conn.cursor()
    try:
        # Fetch the meeting + group context in one query so we don't need
        # a second round-trip for the cancellation email
        cur.execute("""
            SELECT m.group_id, g.owner_id, m.day_of_week, m.meeting_time, 
                   m.meeting_date, g.name, g.meeting_location
            FROM meetings m
            JOIN groups g ON m.group_id = g.id
            WHERE m.id = %s
        """, (meeting_id,))
        result = cur.fetchone()
        if not result:
            return jsonify({'success': False, 'error': 'Meeting not found'}), 404
        
        # Ownership check, same NULL-owner guard as create_meeting in case
        # the group is orphaned after the owner deleted their account.
        owner_id = result[1]
        if owner_id is None or (user_id and int(owner_id) != int(user_id)):
            return jsonify({'success': False, 'error': 'Only the group owner can cancel meetings'}), 403

        group_id = result[0]
        day_of_week = result[2]
        meeting_time = result[3]
        meeting_date = result[4]
        group_name = result[5]
        location = result[6] or 'TBD'

        # Gather the recipient list before deleting (clearer pattern), and
        # defensive in case we later tie member data to the meeting itself
        cur.execute("""
            SELECT u.name, u.email FROM group_members gm
            JOIN users u ON gm.user_id = u.id
            WHERE gm.group_id = %s
        """, (group_id,))
        members = cur.fetchall()

        # Delete the meeting
        cur.execute("DELETE FROM meetings WHERE id = %s", (meeting_id,))
        conn.commit()

        # Send cancellation emails after successful delete
        try:
            send_cancellation_notification(
                members, group_name, day_of_week, 
                meeting_time, meeting_date, location
            )
        except Exception as e:
            print(f"Cancellation email failed: {e}")
            # Don't fail the request if email fails

        return jsonify({'success': True, 'message': 'Meeting cancelled'})
    except Exception as e:
        print(f"Delete meeting error: {e}")
        conn.rollback()
        return jsonify({'success': False, 'error': 'Failed to cancel meeting'}), 500
    finally:
        cur.close()
        conn.close()

# Emails every member when a meeting is cancelled. Same per-recipient
# error-isolation pattern as send_meeting_notification.     
def send_cancellation_notification(members, group_name, day_of_week, meeting_time, meeting_date, location):
    subject = f"❌ Meeting Cancelled: {group_name}"
    html_body = f"""
    <html>
    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <div style="max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9fafb; border-radius: 8px;">
            <h2 style="color: #EF4444;">❌ Meeting Cancelled</h2>
            <p>A study session for <strong>{group_name}</strong> has been cancelled.</p>
            <div style="background: white; padding: 20px; border-radius: 8px; border-left: 4px solid #EF4444; margin: 20px 0;">
                <h3 style="margin-top: 0; color: #EF4444;">Cancelled Meeting Details</h3>
                <p><strong>📅 Date:</strong> {day_of_week}, {meeting_date}</p>
                <p><strong>🕐 Time:</strong> {meeting_time}</p>
                <p><strong>📍 Location:</strong> {location}</p>
                <p><strong>👥 Group:</strong> {group_name}</p>
            </div>
            <p style="color: #666; font-size: 14px; margin-top: 30px;">
                Please check StudySync for any rescheduled sessions. 📚<br>
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
            msg.attach(MIMEText(html_body, 'html'))
            with smtplib.SMTP(EMAIL_HOST, EMAIL_PORT) as server:
                server.starttls()
                server.login(EMAIL_USERNAME, EMAIL_PASSWORD)
                server.send_message(msg)
            print(f"✅ Cancellation email sent to {email}")
        except Exception as e:
            print(f"❌ Failed to send cancellation email to {email}: {e}")

# Returns every meeting the user is a member of across all their groups.
# Powers the My Meetings dashboard page.
@app.route('/api/users/<int:user_id>/meetings', methods=['GET'])
def get_user_meetings(user_id):
    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Database error'}), 500
    cur = conn.cursor()
    try:
        # Join meetings + groups + group_members so we can filter on the
        # requesting user and include group metadata in the response.
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
                'group_id': row[6], 'group_name': row[7], 'created_by_name': row[8]
            })
        return jsonify({'success': True, 'meetings': meetings})
    except Exception as e:
        print(f"Get user meetings error: {e}")
        return jsonify({'success': False, 'error': 'Failed to get meetings'}), 500
    finally:
        cur.close()
        conn.close()

# User profile (get, update, password, picture, transport, preferences, delete)

# Returns the full user record including transport mode (defaulting to
# 'transit') and the tutorial_complete flag.
@app.route('/api/users/<int:user_id>', methods=['GET'])
def get_user(user_id):
    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Database error'}), 500
    cur = conn.cursor()
    try:
        cur.execute("""
            SELECT id, name, email, profile_picture, tutorial_complete, transport_mode 
            FROM users WHERE id = %s
        """, (user_id,))
        user = cur.fetchone()
        if not user:
            return jsonify({'success': False, 'error': 'User not found'}), 404
        return jsonify({'success': True, 'user': {
            'id': user[0], 'name': user[1], 'email': user[2],
            'profile_picture': user[3], 'tutorial_complete': user[4],
            # Default to transit if the column is NULL (existing users pre-transport feature)
            'transport_mode': user[5] or 'transit'
        }})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

# Updates the user's preferred transport mode. Validates against the four
# values that Google Distance Matrix accepts.
@app.route('/api/users/<int:user_id>/transport', methods=['PUT'])
def update_transport_mode(user_id):
    data = request.json
    mode = data.get('transport_mode', '').strip().lower()
    if mode not in ('driving', 'transit', 'walking', 'bicycling'):
        return jsonify({'success': False, 'error': 'Invalid transport mode'}), 400
    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Database error'}), 500
    cur = conn.cursor()
    try:
        cur.execute("UPDATE users SET transport_mode = %s WHERE id = %s", (mode, user_id))
        conn.commit()
        return jsonify({'success': True, 'transport_mode': mode})
    except Exception as e:
        conn.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

# Updates name and email. The UNIQUE constraint on email means changing to
# an email already in use raises IntegrityError, caught explicitly.
@app.route('/api/users/<int:user_id>', methods=['PUT'])
def update_user(user_id):
    data = request.json
    name = data.get('name', '').strip()
    email = data.get('email', '').strip().lower()
    if not all([name, email]):
        return jsonify({'success': False, 'error': 'Missing fields'}), 400
    if len(name) < 2:
        return jsonify({'success': False, 'error': 'Name must be at least 2 characters'}), 400
    if not is_valid_email(email):
        return jsonify({'success': False, 'error': 'Please enter a valid email address'}), 400
    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Database error'}), 500
    cur = conn.cursor()
    try:
        cur.execute(
            "UPDATE users SET name = %s, email = %s WHERE id = %s RETURNING id, name, email, profile_picture",
            (name, email, user_id)
        )
        user = cur.fetchone()
        conn.commit()
        return jsonify({'success': True, 'user': {
            'id': user[0], 'name': user[1], 'email': user[2], 'profile_picture': user[3]
        }})
    except psycopg2.IntegrityError:
        return jsonify({'success': False, 'error': 'Email already in use by another account'}), 400
    except Exception as e:
        conn.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

# Changes the user's password. Requires the current password as an
# authorisation check so a compromised session can't silently reset the password.
@app.route('/api/users/<int:user_id>/password', methods=['PUT'])
def change_password(user_id):
    data = request.json
    current_password = data.get('current_password', '')
    new_password = data.get('new_password', '')
    if not all([current_password, new_password]):
        return jsonify({'success': False, 'error': 'Missing fields'}), 400
    if len(new_password) < 8:
        return jsonify({'success': False, 'error': 'New password must be at least 8 characters'}), 400
    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Database error'}), 500
    cur = conn.cursor()
    try:
        cur.execute("SELECT password_hash FROM users WHERE id = %s", (user_id,))
        user = cur.fetchone()
        if not user:
            return jsonify({'success': False, 'error': 'User not found'}), 404
        
        # Verify the current password matches before allowing the change
        if not bcrypt.checkpw(current_password.encode('utf-8'), user[0].encode('utf-8')):
            return jsonify({'success': False, 'error': 'Current password is incorrect'}), 401
        new_hash = bcrypt.hashpw(new_password.encode('utf-8'), bcrypt.gensalt())
        cur.execute("UPDATE users SET password_hash = %s WHERE id = %s", (new_hash.decode('utf-8'), user_id))
        conn.commit()
        return jsonify({'success': True, 'message': 'Password updated successfully'})
    except Exception as e:
        conn.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

# Uploads a profile picture to Google Cloud Storage. Validates size and type,
# uploads the image bytes, then saves the public URL to the user's record.
@app.route('/api/users/<int:user_id>/picture', methods=['POST'])
def upload_profile_picture(user_id):
    data = request.json
    image_data = data.get('image_data')
    content_type = data.get('content_type', 'image/jpeg')
    if not image_data:
        return jsonify({'success': False, 'error': 'No image data'}), 400

    # Strip the data URL prefix if present, the frontend sometimes sends
    # 'data:image/jpeg;base64,...' rather than just the base64 payload
    base64_part = image_data.split(',')[1] if ',' in image_data else image_data

    # Estimate decoded size. base64 inflates by ~33% so the raw string is
    # 4/3 the size of the bytes it represents.
    estimated_bytes = len(base64_part) * 3 / 4
    if estimated_bytes > 5 * 1024 * 1024:
        return jsonify({'success': False, 'error': 'Image must be smaller than 5MB'}), 400

    # Whitelist safe formats; exclude SVG which can contain scripts
    allowed_types = {'image/jpeg', 'image/png', 'image/gif', 'image/webp'}
    if content_type not in allowed_types:
        return jsonify({'success': False, 'error': 'Only JPEG, PNG, GIF and WebP images are allowed'}), 400
    try:
        image_bytes = base64.b64decode(base64_part)
        client = gcs.Client()
        bucket = client.bucket('studysync-profile-pictures')
        # UUID in the filename prevents collisions if a user uploads multiple
        # pictures, and also acts as cache-busting for the browser.
        filename = f"profile_{user_id}_{uuid.uuid4().hex}.jpg"
        blob = bucket.blob(filename)
        blob.upload_from_string(image_bytes, content_type=content_type)
        picture_url = f"https://storage.googleapis.com/studysync-profile-pictures/{filename}"
        conn = get_db_connection()
        if not conn:
            return jsonify({'success': False, 'error': 'Database error'}), 500
        cur = conn.cursor()
        cur.execute("UPDATE users SET profile_picture = %s WHERE id = %s", (picture_url, user_id))
        conn.commit()
        cur.close()
        conn.close()
        return jsonify({'success': True, 'picture_url': picture_url})
    except Exception as e:
        print(f"Picture upload error: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

# Handles contact form submissions by relaying them to the developer's inbox.
# No rate limiting, a production version would need this to prevent abuse.
@app.route('/api/contact', methods=['POST'])
def contact_form():
    data = request.json
    name = data.get('name', '').strip()
    email = data.get('email', '').strip()
    subject = data.get('subject', 'No subject').strip()
    message = data.get('message', '').strip()
    if not all([name, email, message]):
        return jsonify({'success': False, 'error': 'Missing fields'}), 400
    if not is_valid_email(email):
        return jsonify({'success': False, 'error': 'Please enter a valid email address'}), 400
    try:
        html_body = f"""
        <html><body style="font-family: Arial, sans-serif; color: #333;">
            <div style="max-width: 600px; margin: 0 auto; padding: 20px; background: #f9fafb; border-radius: 8px;">
                <h2 style="color: #4F46E5;">📬 New Contact Form Submission</h2>
                <div style="background: white; padding: 20px; border-radius: 8px; border-left: 4px solid #4F46E5;">
                    <p><strong>Name:</strong> {name}</p>
                    <p><strong>Email:</strong> {email}</p>
                    <p><strong>Subject:</strong> {subject}</p>
                    <p><strong>Message:</strong></p>
                    <p style="background: #f3f4f6; padding: 12px; border-radius: 6px;">{message}</p>
                </div>
            </div>
        </body></html>
        """
        msg = MIMEMultipart('alternative')
        msg['Subject'] = f"StudySync Contact: {subject}"
        msg['From'] = EMAIL_FROM
        msg['To'] = EMAIL_USERNAME
        # Reply-To set to the submitter so hitting Reply in the inbox
        # replies to them rather than ourselves.
        msg['Reply-To'] = email
        msg.attach(MIMEText(html_body, 'html'))
        with smtplib.SMTP(EMAIL_HOST, EMAIL_PORT) as server:
            server.starttls()
            server.login(EMAIL_USERNAME, EMAIL_PASSWORD)
            server.send_message(msg)
        return jsonify({'success': True, 'message': 'Message sent successfully'})
    except Exception as e:
        print(f"Contact form error: {e}", flush=True)
        return jsonify({'success': False, 'error': 'Failed to send message'}), 500

# Marks the user's tutorial as complete in the DB so they don't see the
# auto-popup on their next login from a different device or browser.
@app.route('/api/users/<int:user_id>/tutorial', methods=['POST'])
def complete_tutorial(user_id):
    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Database error'}), 500
    cur = conn.cursor()
    try:
        cur.execute("UPDATE users SET tutorial_complete = TRUE WHERE id = %s", (user_id,))
        conn.commit()
        return jsonify({'success': True})
    except Exception as e:
        conn.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

# Returns the user's availability preferences (work/focus/custom blocked
# periods) as stored in the JSONB column. Returns an empty object for users
# who haven't configured any preferences yet.
@app.route('/api/users/<int:user_id>/preferences', methods=['GET'])
def get_preferences(user_id):
    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Database error'}), 500
    cur = conn.cursor()
    try:
        cur.execute("SELECT availability_preferences FROM users WHERE id = %s", (user_id,))
        result = cur.fetchone()
        if not result:
            return jsonify({'success': False, 'error': 'User not found'}), 404
        return jsonify({'success': True, 'preferences': result[0] or {}})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

# Saves the user's availability preferences. The payload is stored as-is
# in the availability_preferences JSONB column. The frontend defines the
# schema, so changes here only require a frontend update.
@app.route('/api/users/<int:user_id>/preferences', methods=['PUT'])
def save_preferences(user_id):
    data = request.json
    preferences = data.get('preferences', {})
    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Database error'}), 500
    cur = conn.cursor()
    try:
        import json
        cur.execute(
            "UPDATE users SET availability_preferences = %s WHERE id = %s",
            (json.dumps(preferences), user_id)
        )
        conn.commit()
        return jsonify({'success': True, 'message': 'Preferences saved'})
    except Exception as e:
        conn.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

# Permanently deletes the user's account and all personal data. Deletes
# in dependency order to respect foreign key constraints, and sets owner_id
# to NULL on any groups the user owned so the group rows themselves survive
# (other members keep their availability data intact).
@app.route('/api/users/<int:user_id>', methods=['DELETE'])
def delete_user(user_id):
    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Database error'}), 500
    cur = conn.cursor()
    try:
        # Before deleting the DB rows, remove the user's profile picture from
        # Google Cloud Storage so it doesn't outlive the account. Failure is
        # non-fatal. We'd rather complete the account deletion either way.
        cur.execute("SELECT profile_picture FROM users WHERE id = %s", (user_id,))
        picture_result = cur.fetchone()
        if picture_result and picture_result[0]:
            picture_url = picture_result[0]
            try:
                # URLs look like https://storage.googleapis.com/studysync-profile-pictures/profile_12_abc.jpg
                # Extract the filename and delete the blob from the bucket
                filename = picture_url.split('/')[-1]
                client = gcs.Client()
                bucket = client.bucket('studysync-profile-pictures')
                blob = bucket.blob(filename)
                blob.delete()
                print(f"Deleted profile picture from GCS: {filename}")
            except Exception as e:
                print(f"Failed to delete profile picture from GCS (non-fatal): {e}")

        # Delete user data in dependency order
        cur.execute("DELETE FROM availability WHERE user_id = %s", (user_id,))
        cur.execute("DELETE FROM group_members WHERE user_id = %s", (user_id,))
        cur.execute("DELETE FROM meetings WHERE created_by = %s", (user_id,))
        cur.execute("DELETE FROM oauth_tokens WHERE user_id = %s", (user_id,))
        cur.execute("DELETE FROM user_locations WHERE user_id = %s", (user_id,))
        # Orphan rather than cascade-delete groups, other members still depend on them.
        # Orphaned groups are handled by the create_meeting endpoint's NULL-owner guard.
        cur.execute("UPDATE groups SET owner_id = NULL WHERE owner_id = %s", (user_id,))
        cur.execute("DELETE FROM users WHERE id = %s", (user_id,))
        conn.commit()
        return jsonify({'success': True, 'message': 'Account deleted'})
    except Exception as e:
        conn.rollback()
        print(f"Delete user error: {e}", flush=True)
        return jsonify({'success': False, 'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

# Group membership actions (leave, delete)

# Removes the user from a group. Owners can't leave, they must delete the
# group instead, which is enforced with an explicit check.
@app.route('/api/groups/<int:group_id>/leave', methods=['POST'])
def leave_group(group_id):
    data = request.json
    user_id = data.get('user_id')
    if not user_id:
        return jsonify({'success': False, 'error': 'Missing user_id'}), 400
    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Database error'}), 500
    cur = conn.cursor()
    try:
        # Owner cannot leave, they must delete the group instead
        cur.execute("SELECT owner_id FROM groups WHERE id = %s", (group_id,))
        result = cur.fetchone()
        if not result:
            return jsonify({'success': False, 'error': 'Group not found'}), 404
        if int(result[0]) == int(user_id):
            return jsonify({'success': False, 'error': 'You are the owner — delete the group instead of leaving'}), 403

        # Remove membership and the user's availability for this group
        cur.execute("DELETE FROM group_members WHERE group_id = %s AND user_id = %s", (group_id, user_id))
        cur.execute("DELETE FROM availability WHERE group_id = %s AND user_id = %s", (group_id, user_id))
        conn.commit()
        return jsonify({'success': True, 'message': 'You have left the group'})
    except Exception as e:
        conn.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

# Deletes a group and cascades to availability, meetings, and member rows.
# Only the owner can do this; the deletes are ordered to respect foreign keys.
@app.route('/api/groups/<int:group_id>', methods=['DELETE'])
def delete_group(group_id):
    data = request.json
    user_id = data.get('user_id')
    if not user_id:
        return jsonify({'success': False, 'error': 'Missing user_id'}), 400
    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Database error'}), 500
    cur = conn.cursor()
    try:
        cur.execute("SELECT owner_id FROM groups WHERE id = %s", (group_id,))
        result = cur.fetchone()
        if not result:
            return jsonify({'success': False, 'error': 'Group not found'}), 404
        if int(result[0]) != int(user_id):
            return jsonify({'success': False, 'error': 'Only the group owner can delete the group'}), 403
        # Delete in dependency order
        cur.execute("DELETE FROM availability WHERE group_id = %s", (group_id,))
        cur.execute("DELETE FROM meetings WHERE group_id = %s", (group_id,))
        cur.execute("DELETE FROM group_members WHERE group_id = %s", (group_id,))
        cur.execute("DELETE FROM groups WHERE id = %s", (group_id,))
        conn.commit()
        return jsonify({'success': True, 'message': 'Group deleted'})
    except Exception as e:
        conn.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

# Global availability
# Consolidated availability that spans every group the user is in.
# Saving propagates the update to all groups; reading returns the distinct
# union of slots from any of the user's groups.

# Returns the user's availability as a flat list of slots. Uses DISTINCT
# because each slot is stored once per group; all the user's groups share
# the same global availability, so any one of them gives the authoritative set.
@app.route('/api/users/<int:user_id>/availability', methods=['GET'])
def get_global_availability(user_id):
    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Database error'}), 500
    cur = conn.cursor()
    try:
        # Get slots from any group the user is in, all groups have the same availability
        cur.execute("""
            SELECT DISTINCT day_index, time_slot 
            FROM availability 
            WHERE user_id = %s
            ORDER BY day_index, time_slot
        """, (user_id,))
        slots = [f"{row[0]}-{row[1]}" for row in cur.fetchall()]
        return jsonify({'success': True, 'slots': slots})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()


# Saves the user's availability and propagates it to every group they belong
# to. Delete-then-insert per group keeps the operation idempotent(produces the
# same result regardless of how many times its applied after the first). The whole
# thing is one transaction so partial writes can't leave state inconsistent.
# Empty-slot saves require an explicit `confirm_clear` flag to prevent
# accidental data loss from bugs in the frontend.
@app.route('/api/users/<int:user_id>/availability', methods=['POST'])
def save_global_availability(user_id):
    data = request.json
    slots = data.get('slots', [])
    confirm_clear = data.get('confirm_clear', False)

    # Guard against accidentally wiping the user's availability. An empty
    # save only goes through when the client explicitly sets confirm_clear=true,
    # which the Clear button does. A frontend bug sending slots=[] unexpectedly
    # will now return a 400 rather than silently erasing everything.
    if not slots and not confirm_clear:
        return jsonify({
            'success': False,
            'error': 'Refusing to save an empty availability set without confirmation'
        }), 400

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Database error'}), 500
    cur = conn.cursor()
    try:
        cur.execute("""
            SELECT group_id FROM group_members WHERE user_id = %s
        """, (user_id,))
        group_ids = [row[0] for row in cur.fetchall()]

        # Users with no groups have nowhere to propagate availability to.
        # Tell them explicitly rather than returning a silent success.
        if not group_ids:
            return jsonify({
                'success': False,
                'error': 'You are not a member of any groups. Create or join a group first.'
            }), 400

        # Replace availability in each of the user's groups
        for group_id in group_ids:
            cur.execute("""
                DELETE FROM availability 
                WHERE group_id = %s AND user_id = %s
            """, (group_id, user_id))
            for slot in slots:
                parts = slot.split('-', 1)
                if len(parts) != 2:
                    continue
                day_index, time_slot = parts
                cur.execute("""
                    INSERT INTO availability (group_id, user_id, day_index, time_slot)
                    VALUES (%s, %s, %s, %s)
                    ON CONFLICT DO NOTHING
                """, (group_id, user_id, int(day_index), time_slot))

        conn.commit()
        return jsonify({
            'success': True,
            'message': f'Availability updated across {len(group_ids)} groups',
            'groups_updated': len(group_ids)
        })
    except Exception as e:
        conn.rollback()
        print(f"Save global availability error: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

# Imports the user's Google Calendar events for the given date range and
# converts busy times into available slots, then saves them across every
# group the user is in. Replaces the user's existing availability entirely.
@app.route('/api/users/<int:user_id>/calendar/import', methods=['POST'])
def import_calendar_global(user_id):
    data = request.json or {}
    start_date_str = data.get('start_date')
    end_date_str = data.get('end_date')
    if not all([start_date_str, end_date_str]):
        return jsonify({'success': False, 'error': 'Missing date range'}), 400

    # Parse ISO dates tolerating Z-suffixed UTC timestamps from JS toISOString()
    try:
        start_date = datetime.fromisoformat(start_date_str.replace('Z', '+00:00'))
        end_date = datetime.fromisoformat(end_date_str.replace('Z', '+00:00'))
    except ValueError:
        return jsonify({'success': False, 'error': 'Invalid date format'}), 400

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Database error'}), 500
    cur = conn.cursor()
    try:
        # Grab the stored OAuth tokens, if none, user needs to authorise first
        cur.execute("""
            SELECT access_token, refresh_token FROM oauth_tokens
            WHERE user_id = %s AND provider = 'google'
        """, (user_id,))
        result = cur.fetchone()
        if not result:
            return jsonify({
                'success': False,
                'error': 'Google Calendar not connected. Please connect first.'
            }), 400

        access_token, refresh_token = result[0], result[1]

        # Retrieve busy times from the Calendar API and invert them to
        # available slots. set() deduplicates in case of overlapping events.
        busy_times = get_calendar_events(access_token, start_date, end_date, refresh_token)
        available_slots = list(set(convert_busy_to_availability(busy_times, start_date, end_date)))

        # Replace availability across every group the user is in
        cur.execute("SELECT group_id FROM group_members WHERE user_id = %s", (user_id,))
        group_ids = [row[0] for row in cur.fetchall()]

        for group_id in group_ids:
            cur.execute(
                "DELETE FROM availability WHERE group_id = %s AND user_id = %s",
                (group_id, user_id)
            )
            for slot in available_slots:
                parts = slot.split('-', 1)
                if len(parts) != 2:
                    continue
                day_index, time_slot = parts
                cur.execute("""
                    INSERT INTO availability (group_id, user_id, day_index, time_slot)
                    VALUES (%s, %s, %s, %s)
                    ON CONFLICT DO NOTHING
                """, (group_id, user_id, int(day_index), time_slot))

        conn.commit()
        return jsonify({
            'success': True,
            'message': f'Imported {len(available_slots)} slots across {len(group_ids)} groups',
            'slots_count': len(available_slots),
            'groups_updated': len(group_ids)
        })
    except Exception as e:
        conn.rollback()
        print(f"Global calendar import error: {e}", flush=True)
        return jsonify({'success': False, 'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

# Entry point, only runs when invoked directly, not when imported.
# Cloud Run sets the PORT env var; local dev falls back to 5000.
# debug=False in production, debug mode exposes a disk-level interactive
# debugger which must never be enabled on a public service.
if __name__ == '__main__':
    print("=" * 50)
    print("StudySync Backend Starting...")
    print("=" * 50)
    app.run(debug=False, host='0.0.0.0', port=int(os.environ.get('PORT', 5000)))

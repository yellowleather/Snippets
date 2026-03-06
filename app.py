import os
import json
import requests as http_requests
from datetime import datetime, timedelta
from flask import Flask, render_template, request, jsonify, session, redirect, url_for
from functools import wraps
from werkzeug.security import generate_password_hash, check_password_hash

try:
    import anthropic as anthropic_sdk
except ImportError:
    anthropic_sdk = None

# Firestore import
try:
    from google.cloud import firestore
    db = firestore.Client()
    FIRESTORE_AVAILABLE = True
except Exception:
    # For local development without credentials
    db = None
    FIRESTORE_AVAILABLE = False

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', 'change-this-to-a-random-secret-key')

# Configuration
USERNAME = os.environ.get('SNIPPET_USERNAME', 'admin')
PASSWORD_HASH = generate_password_hash(os.environ.get('SNIPPET_PASSWORD', 'changeme'), method='pbkdf2:sha256')

# Feature Flags
GOALS_ENABLED = os.environ.get('GOALS_ENABLED', 'true').lower() == 'true'
REFLECTIONS_ENABLED = os.environ.get('REFLECTIONS_ENABLED', 'true').lower() == 'true'
DAILY_SCORES_ENABLED = os.environ.get('DAILY_SCORES_ENABLED', 'true').lower() == 'true'
FITNESS_ENABLED = os.environ.get('FITNESS_ENABLED', 'true').lower() == 'true'

# GitHub Autofill Configuration
GITHUB_TOKEN = os.environ.get('GITHUB_TOKEN', '')
GITHUB_USERNAME = os.environ.get('GITHUB_USERNAME', '')
ANTHROPIC_API_KEY = os.environ.get('ANTHROPIC_API_KEY', '')
# The endeavor name for which the GitHub autofill button is shown (empty = disabled)
GITHUB_AUTOFILL_ENDEAVOR = os.environ.get('GITHUB_AUTOFILL_ENDEAVOR', '')

def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'logged_in' not in session:
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    return decorated_function

def get_week_dates(date):
    """Get Monday and Sunday of the week containing the given date"""
    # Get the weekday (0 = Monday, 6 = Sunday)
    weekday = date.weekday()
    # Calculate Monday of this week
    monday = date - timedelta(days=weekday)
    # Calculate Sunday of this week
    sunday = monday + timedelta(days=6)
    return monday, sunday

def get_week_number(date):
    """Get ISO week number"""
    return date.isocalendar()[1]

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        data = request.get_json()
        username = data.get('username')
        password = data.get('password')
        
        if username == USERNAME and check_password_hash(PASSWORD_HASH, password):
            session['logged_in'] = True
            return jsonify({'success': True})
        return jsonify({'success': False, 'error': 'Invalid credentials'}), 401
    
    return render_template('login.html')

@app.route('/logout')
def logout():
    session.pop('logged_in', None)
    return redirect(url_for('login'))

@app.route('/')
@login_required
def index():
    return render_template('index.html')

@app.route('/api/config', methods=['GET'])
@login_required
def get_config():
    """Return feature flags and configuration"""
    github_autofill_configured = bool(GITHUB_TOKEN and GITHUB_USERNAME and ANTHROPIC_API_KEY)
    return jsonify({
        'goals_enabled': GOALS_ENABLED,
        'reflections_enabled': REFLECTIONS_ENABLED,
        'daily_scores_enabled': DAILY_SCORES_ENABLED,
        'fitness_enabled': FITNESS_ENABLED,
        'github_autofill_endeavor': GITHUB_AUTOFILL_ENDEAVOR if github_autofill_configured else '',
    })

@app.route('/api/snippets', methods=['GET'])
@login_required
def get_snippets():
    if not FIRESTORE_AVAILABLE:
        return jsonify({'error': 'Firestore not available'}), 500

    start_date = request.args.get('start_date')
    end_date = request.args.get('end_date')
    endeavor = request.args.get('endeavor', 'pet project')

    snippets_ref = db.collection('snippets')

    if start_date and end_date:
        # Query all snippets ordered by week_start
        # Filter client-side for overlapping weeks and endeavor
        # week overlaps with range if week_start <= end_date AND week_end >= start_date
        query = snippets_ref.order_by('week_start', direction=firestore.Query.DESCENDING)

        snippets = []
        for doc in query.stream():
            snippet = doc.to_dict()
            snippet['id'] = doc.id
            # Filter: week overlaps if week_start <= end_date AND week_end >= start_date
            # Also filter by endeavor, defaulting to 'pet project' for old records
            snippet_endeavor = snippet.get('endeavor', 'pet project')
            if snippet['week_start'] <= end_date and snippet['week_end'] >= start_date and snippet_endeavor == endeavor:
                snippets.append(snippet)
    else:
        query = snippets_ref.order_by('week_start', direction=firestore.Query.DESCENDING).limit(10)
        snippets = []
        for doc in query.stream():
            snippet = doc.to_dict()
            snippet['id'] = doc.id
            # Filter by endeavor, defaulting to 'pet project' for old records
            snippet_endeavor = snippet.get('endeavor', 'pet project')
            if snippet_endeavor == endeavor:
                snippets.append(snippet)

    return jsonify(snippets)

@app.route('/api/snippets/<snippet_id>', methods=['GET'])
@login_required
def get_snippet(snippet_id):
    if not FIRESTORE_AVAILABLE:
        return jsonify({'error': 'Firestore not available'}), 500

    doc_ref = db.collection('snippets').document(snippet_id)
    doc = doc_ref.get()

    if doc.exists:
        snippet = doc.to_dict()
        snippet['id'] = doc.id
        return jsonify(snippet)
    return jsonify({'error': 'Snippet not found'}), 404

@app.route('/api/snippets', methods=['POST'])
@login_required
def create_snippet():
    if not FIRESTORE_AVAILABLE:
        return jsonify({'error': 'Firestore not available'}), 500

    data = request.get_json()
    week_start = data.get('week_start')
    week_end = data.get('week_end')
    content = data.get('content')
    endeavor = data.get('endeavor', 'pet project')

    if not all([week_start, week_end, content]):
        return jsonify({'error': 'Missing required fields'}), 400

    doc_ref = db.collection('snippets').document()
    doc_ref.set({
        'week_start': week_start,
        'week_end': week_end,
        'content': content,
        'endeavor': endeavor,
        'created_at': firestore.SERVER_TIMESTAMP,
        'updated_at': firestore.SERVER_TIMESTAMP
    })

    return jsonify({'id': doc_ref.id, 'success': True})

@app.route('/api/snippets/<snippet_id>', methods=['PUT'])
@login_required
def update_snippet(snippet_id):
    if not FIRESTORE_AVAILABLE:
        return jsonify({'error': 'Firestore not available'}), 500

    data = request.get_json()
    content = data.get('content')

    if not content:
        return jsonify({'error': 'Content is required'}), 400

    doc_ref = db.collection('snippets').document(snippet_id)
    doc_ref.update({
        'content': content,
        'updated_at': firestore.SERVER_TIMESTAMP
    })

    return jsonify({'success': True})

@app.route('/api/snippets/<snippet_id>', methods=['DELETE'])
@login_required
def delete_snippet(snippet_id):
    if not FIRESTORE_AVAILABLE:
        return jsonify({'error': 'Firestore not available'}), 500

    db.collection('snippets').document(snippet_id).delete()

    return jsonify({'success': True})

@app.route('/api/week/<date_str>', methods=['GET'])
@login_required
def get_week_info(date_str):
    """Get week information for a specific date"""
    try:
        date = datetime.strptime(date_str, '%Y-%m-%d')
        monday, sunday = get_week_dates(date)
        week_num = get_week_number(date)

        return jsonify({
            'week_number': week_num,
            'week_start': monday.strftime('%Y-%m-%d'),
            'week_end': sunday.strftime('%Y-%m-%d'),
            'week_start_formatted': monday.strftime('%b %d, %Y'),
            'week_end_formatted': sunday.strftime('%b %d, %Y')
        })
    except ValueError:
        return jsonify({'error': 'Invalid date format'}), 400


# Goals API endpoints
@app.route('/api/goals', methods=['GET'])
@login_required
def get_goals():
    if not GOALS_ENABLED:
        return jsonify({'error': 'Goals feature is disabled'}), 404

    if not FIRESTORE_AVAILABLE:
        return jsonify({'error': 'Firestore not available'}), 500

    start_date = request.args.get('start_date')
    end_date = request.args.get('end_date')
    endeavor = request.args.get('endeavor', 'pet project')

    goals_ref = db.collection('goals')

    if start_date and end_date:
        query = goals_ref.order_by('week_start', direction=firestore.Query.DESCENDING)

        goals = []
        for doc in query.stream():
            goal = doc.to_dict()
            goal['id'] = doc.id
            # Filter by endeavor, defaulting to 'pet project' for old records
            goal_endeavor = goal.get('endeavor', 'pet project')
            if goal['week_start'] <= end_date and goal['week_end'] >= start_date and goal_endeavor == endeavor:
                goals.append(goal)
    else:
        query = goals_ref.order_by('week_start', direction=firestore.Query.DESCENDING).limit(10)
        goals = []
        for doc in query.stream():
            goal = doc.to_dict()
            goal['id'] = doc.id
            # Filter by endeavor, defaulting to 'pet project' for old records
            goal_endeavor = goal.get('endeavor', 'pet project')
            if goal_endeavor == endeavor:
                goals.append(goal)

    return jsonify(goals)


@app.route('/api/goals/<goal_id>', methods=['GET'])
@login_required
def get_goal(goal_id):
    if not GOALS_ENABLED:
        return jsonify({'error': 'Goals feature is disabled'}), 404

    if not FIRESTORE_AVAILABLE:
        return jsonify({'error': 'Firestore not available'}), 500

    doc_ref = db.collection('goals').document(goal_id)
    doc = doc_ref.get()

    if doc.exists:
        goal = doc.to_dict()
        goal['id'] = doc.id
        return jsonify(goal)
    return jsonify({'error': 'Goal not found'}), 404


@app.route('/api/goals', methods=['POST'])
@login_required
def create_goal():
    if not GOALS_ENABLED:
        return jsonify({'error': 'Goals feature is disabled'}), 404

    if not FIRESTORE_AVAILABLE:
        return jsonify({'error': 'Firestore not available'}), 500

    data = request.get_json()
    week_start = data.get('week_start')
    week_end = data.get('week_end')
    content = data.get('content')
    endeavor = data.get('endeavor', 'pet project')

    if not all([week_start, week_end, content]):
        return jsonify({'error': 'Missing required fields'}), 400

    doc_ref = db.collection('goals').document()
    doc_ref.set({
        'week_start': week_start,
        'week_end': week_end,
        'content': content,
        'endeavor': endeavor,
        'created_at': firestore.SERVER_TIMESTAMP,
        'updated_at': firestore.SERVER_TIMESTAMP
    })

    return jsonify({'id': doc_ref.id, 'success': True})


@app.route('/api/goals/<goal_id>', methods=['PUT'])
@login_required
def update_goal(goal_id):
    if not GOALS_ENABLED:
        return jsonify({'error': 'Goals feature is disabled'}), 404

    if not FIRESTORE_AVAILABLE:
        return jsonify({'error': 'Firestore not available'}), 500

    data = request.get_json()
    content = data.get('content')

    if not content:
        return jsonify({'error': 'Content is required'}), 400

    doc_ref = db.collection('goals').document(goal_id)
    doc_ref.update({
        'content': content,
        'updated_at': firestore.SERVER_TIMESTAMP
    })

    return jsonify({'success': True})


@app.route('/api/goals/<goal_id>', methods=['DELETE'])
@login_required
def delete_goal(goal_id):
    if not GOALS_ENABLED:
        return jsonify({'error': 'Goals feature is disabled'}), 404

    if not FIRESTORE_AVAILABLE:
        return jsonify({'error': 'Firestore not available'}), 500

    db.collection('goals').document(goal_id).delete()

    return jsonify({'success': True})


# Reflections API endpoints
@app.route('/api/reflections', methods=['GET'])
@login_required
def get_reflections():
    if not REFLECTIONS_ENABLED:
        return jsonify({'error': 'Reflections feature is disabled'}), 404

    if not FIRESTORE_AVAILABLE:
        return jsonify({'error': 'Firestore not available'}), 500

    start_date = request.args.get('start_date')
    end_date = request.args.get('end_date')
    endeavor = request.args.get('endeavor', 'pet project')

    reflections_ref = db.collection('reflections')

    if start_date and end_date:
        query = reflections_ref.order_by('week_start', direction=firestore.Query.DESCENDING)

        reflections = []
        for doc in query.stream():
            reflection = doc.to_dict()
            reflection['id'] = doc.id
            # Filter by endeavor, defaulting to 'pet project' for old records
            reflection_endeavor = reflection.get('endeavor', 'pet project')
            if reflection['week_start'] <= end_date and reflection['week_end'] >= start_date and reflection_endeavor == endeavor:
                reflections.append(reflection)
    else:
        query = reflections_ref.order_by('week_start', direction=firestore.Query.DESCENDING).limit(10)
        reflections = []
        for doc in query.stream():
            reflection = doc.to_dict()
            reflection['id'] = doc.id
            # Filter by endeavor, defaulting to 'pet project' for old records
            reflection_endeavor = reflection.get('endeavor', 'pet project')
            if reflection_endeavor == endeavor:
                reflections.append(reflection)

    return jsonify(reflections)


@app.route('/api/reflections/<reflection_id>', methods=['GET'])
@login_required
def get_reflection(reflection_id):
    if not REFLECTIONS_ENABLED:
        return jsonify({'error': 'Reflections feature is disabled'}), 404

    if not FIRESTORE_AVAILABLE:
        return jsonify({'error': 'Firestore not available'}), 500

    doc_ref = db.collection('reflections').document(reflection_id)
    doc = doc_ref.get()

    if doc.exists:
        reflection = doc.to_dict()
        reflection['id'] = doc.id
        return jsonify(reflection)
    return jsonify({'error': 'Reflection not found'}), 404


@app.route('/api/reflections', methods=['POST'])
@login_required
def create_reflection():
    if not REFLECTIONS_ENABLED:
        return jsonify({'error': 'Reflections feature is disabled'}), 404

    if not FIRESTORE_AVAILABLE:
        return jsonify({'error': 'Firestore not available'}), 500

    data = request.get_json()
    week_start = data.get('week_start')
    week_end = data.get('week_end')
    content = data.get('content')
    endeavor = data.get('endeavor', 'pet project')

    if not all([week_start, week_end, content]):
        return jsonify({'error': 'Missing required fields'}), 400

    doc_ref = db.collection('reflections').document()
    doc_ref.set({
        'week_start': week_start,
        'week_end': week_end,
        'content': content,
        'endeavor': endeavor,
        'created_at': firestore.SERVER_TIMESTAMP,
        'updated_at': firestore.SERVER_TIMESTAMP
    })

    return jsonify({'id': doc_ref.id, 'success': True})


@app.route('/api/reflections/<reflection_id>', methods=['PUT'])
@login_required
def update_reflection(reflection_id):
    if not REFLECTIONS_ENABLED:
        return jsonify({'error': 'Reflections feature is disabled'}), 404

    if not FIRESTORE_AVAILABLE:
        return jsonify({'error': 'Firestore not available'}), 500

    data = request.get_json()
    content = data.get('content')

    if not content:
        return jsonify({'error': 'Content is required'}), 400

    doc_ref = db.collection('reflections').document(reflection_id)
    doc_ref.update({
        'content': content,
        'updated_at': firestore.SERVER_TIMESTAMP
    })

    return jsonify({'success': True})


@app.route('/api/reflections/<reflection_id>', methods=['DELETE'])
@login_required
def delete_reflection(reflection_id):
    if not REFLECTIONS_ENABLED:
        return jsonify({'error': 'Reflections feature is disabled'}), 404

    if not FIRESTORE_AVAILABLE:
        return jsonify({'error': 'Firestore not available'}), 500

    db.collection('reflections').document(reflection_id).delete()

    return jsonify({'success': True})


# Daily Movement Scores API endpoints
@app.route('/api/daily_scores', methods=['GET'])
@login_required
def get_daily_scores():
    if not DAILY_SCORES_ENABLED:
        return jsonify({'error': 'Daily scores feature is disabled'}), 404

    if not FIRESTORE_AVAILABLE:
        return jsonify({'error': 'Firestore not available'}), 500

    start_date = request.args.get('start_date')
    end_date = request.args.get('end_date')
    endeavor = request.args.get('endeavor', 'pet project')

    scores_ref = db.collection('daily_scores')

    if start_date and end_date:
        # Query all scores and filter by date range and endeavor
        query = scores_ref.order_by('date')

        scores = []
        for doc in query.stream():
            score = doc.to_dict()
            score['id'] = doc.id
            # Filter by endeavor, defaulting to 'pet project' for old records
            score_endeavor = score.get('endeavor', 'pet project')
            if score['date'] >= start_date and score['date'] <= end_date and score_endeavor == endeavor:
                scores.append(score)
    else:
        # Get recent scores
        query = scores_ref.order_by('date', direction=firestore.Query.DESCENDING).limit(30)
        scores = []
        for doc in query.stream():
            score = doc.to_dict()
            score['id'] = doc.id
            # Filter by endeavor, defaulting to 'pet project' for old records
            score_endeavor = score.get('endeavor', 'pet project')
            if score_endeavor == endeavor:
                scores.append(score)

    return jsonify(scores)


@app.route('/api/daily_scores/toggle', methods=['POST'])
@login_required
def toggle_daily_score():
    if not DAILY_SCORES_ENABLED:
        return jsonify({'error': 'Daily scores feature is disabled'}), 404

    if not FIRESTORE_AVAILABLE:
        return jsonify({'error': 'Firestore not available'}), 500

    data = request.get_json()
    date = data.get('date')
    endeavor = data.get('endeavor', 'pet project')

    if not date:
        return jsonify({'error': 'Date is required'}), 400

    # Check if score already exists for this date and endeavor
    scores_ref = db.collection('daily_scores')
    query = scores_ref.where('date', '==', date).where('endeavor', '==', endeavor).limit(1)

    existing_docs = list(query.stream())

    if existing_docs:
        # Score exists (is 1), delete it to set to 0
        existing_docs[0].reference.delete()
        return jsonify({'success': True, 'score': 0})
    else:
        # Score doesn't exist (is 0), create it to set to 1
        doc_ref = scores_ref.document()
        doc_ref.set({
            'date': date,
            'score': 1,
            'endeavor': endeavor,
            'created_at': firestore.SERVER_TIMESTAMP,
            'updated_at': firestore.SERVER_TIMESTAMP
        })
        return jsonify({'success': True, 'score': 1, 'id': doc_ref.id})


# Endeavors API endpoints
@app.route('/api/endeavors', methods=['GET'])
@login_required
def get_endeavors():
    """Get list of all unique endeavors across all collections"""
    if not FIRESTORE_AVAILABLE:
        return jsonify({'error': 'Firestore not available'}), 500

    endeavors = set()

    # Get endeavors from snippets
    snippets_ref = db.collection('snippets')
    for doc in snippets_ref.stream():
        snippet = doc.to_dict()
        endeavor = snippet.get('endeavor', 'pet project')
        endeavors.add(endeavor)

    # Get endeavors from goals (if enabled)
    if GOALS_ENABLED:
        goals_ref = db.collection('goals')
        for doc in goals_ref.stream():
            goal = doc.to_dict()
            endeavor = goal.get('endeavor', 'pet project')
            endeavors.add(endeavor)

    # Get endeavors from reflections (if enabled)
    if REFLECTIONS_ENABLED:
        reflections_ref = db.collection('reflections')
        for doc in reflections_ref.stream():
            reflection = doc.to_dict()
            endeavor = reflection.get('endeavor', 'pet project')
            endeavors.add(endeavor)

    # Get endeavors from daily_scores (if enabled)
    if DAILY_SCORES_ENABLED:
        scores_ref = db.collection('daily_scores')
        for doc in scores_ref.stream():
            score = doc.to_dict()
            endeavor = score.get('endeavor', 'pet project')
            endeavors.add(endeavor)

    # Convert set to sorted list
    endeavors_list = sorted(list(endeavors))

    return jsonify(endeavors_list)


@app.route('/api/endeavors/rename', methods=['POST'])
@login_required
def rename_endeavor():
    """Rename an endeavor across all collections"""
    if not FIRESTORE_AVAILABLE:
        return jsonify({'error': 'Firestore not available'}), 500

    data = request.get_json()
    old_name = data.get('old_name')
    new_name = data.get('new_name')

    if not old_name or not new_name:
        return jsonify({'error': 'Both old_name and new_name are required'}), 400

    if not new_name.strip():
        return jsonify({'error': 'New endeavor name cannot be empty'}), 400

    updated_count = 0

    # Update snippets
    snippets_ref = db.collection('snippets')
    for doc in snippets_ref.stream():
        snippet = doc.to_dict()
        endeavor = snippet.get('endeavor', 'pet project')
        if endeavor == old_name:
            doc.reference.update({
                'endeavor': new_name,
                'updated_at': firestore.SERVER_TIMESTAMP
            })
            updated_count += 1

    # Update goals (if enabled)
    if GOALS_ENABLED:
        goals_ref = db.collection('goals')
        for doc in goals_ref.stream():
            goal = doc.to_dict()
            endeavor = goal.get('endeavor', 'pet project')
            if endeavor == old_name:
                doc.reference.update({
                    'endeavor': new_name,
                    'updated_at': firestore.SERVER_TIMESTAMP
                })
                updated_count += 1

    # Update reflections (if enabled)
    if REFLECTIONS_ENABLED:
        reflections_ref = db.collection('reflections')
        for doc in reflections_ref.stream():
            reflection = doc.to_dict()
            endeavor = reflection.get('endeavor', 'pet project')
            if endeavor == old_name:
                doc.reference.update({
                    'endeavor': new_name,
                    'updated_at': firestore.SERVER_TIMESTAMP
                })
                updated_count += 1

    # Update daily_scores (if enabled)
    if DAILY_SCORES_ENABLED:
        scores_ref = db.collection('daily_scores')
        for doc in scores_ref.stream():
            score = doc.to_dict()
            endeavor = score.get('endeavor', 'pet project')
            if endeavor == old_name:
                doc.reference.update({
                    'endeavor': new_name,
                    'updated_at': firestore.SERVER_TIMESTAMP
                })
                updated_count += 1

    return jsonify({'success': True, 'updated_count': updated_count})


# Fitness API endpoints

@app.route('/api/fitness/habits', methods=['GET'])
@login_required
def get_fitness_habits():
    """Get all fitness habits"""
    if not FITNESS_ENABLED:
        return jsonify({'error': 'Fitness feature is disabled'}), 404

    if not FIRESTORE_AVAILABLE:
        return jsonify({'error': 'Firestore not available'}), 500

    try:
        habits_ref = db.collection('fitness_habits')
        query = habits_ref.order_by('order')

        habits = []
        for doc in query.stream():
            habit = doc.to_dict()
            habit['id'] = doc.id
            habits.append(habit)

        return jsonify(habits)
    except Exception as e:
        print('Error loading habits:', e)
        return jsonify({'error': str(e)}), 500


@app.route('/api/fitness/habits', methods=['POST'])
@login_required
def create_fitness_habit():
    """Create a new fitness habit"""
    if not FITNESS_ENABLED:
        return jsonify({'error': 'Fitness feature is disabled'}), 404

    if not FIRESTORE_AVAILABLE:
        return jsonify({'error': 'Firestore not available'}), 500

    data = request.get_json()
    name = data.get('name')
    frequency_per_week = data.get('frequency_per_week')
    category = data.get('category', 'general')
    order = data.get('order', 0)

    if not all([name, frequency_per_week is not None]):
        return jsonify({'error': 'Missing required fields'}), 400

    doc_ref = db.collection('fitness_habits').document()
    doc_ref.set({
        'name': name,
        'frequency_per_week': frequency_per_week,
        'category': category,
        'order': order,
        'created_at': firestore.SERVER_TIMESTAMP,
        'updated_at': firestore.SERVER_TIMESTAMP
    })

    return jsonify({'id': doc_ref.id, 'success': True})


@app.route('/api/fitness/habits/<habit_id>', methods=['PUT'])
@login_required
def update_fitness_habit(habit_id):
    """Update a fitness habit"""
    if not FITNESS_ENABLED:
        return jsonify({'error': 'Fitness feature is disabled'}), 404

    if not FIRESTORE_AVAILABLE:
        return jsonify({'error': 'Firestore not available'}), 500

    data = request.get_json()

    update_data = {'updated_at': firestore.SERVER_TIMESTAMP}
    if 'name' in data:
        update_data['name'] = data['name']
    if 'frequency_per_week' in data:
        update_data['frequency_per_week'] = data['frequency_per_week']
    if 'category' in data:
        update_data['category'] = data['category']
    if 'order' in data:
        update_data['order'] = data['order']

    doc_ref = db.collection('fitness_habits').document(habit_id)
    doc_ref.update(update_data)

    return jsonify({'success': True})


@app.route('/api/fitness/habits/<habit_id>', methods=['DELETE'])
@login_required
def delete_fitness_habit(habit_id):
    """Delete a fitness habit"""
    if not FITNESS_ENABLED:
        return jsonify({'error': 'Fitness feature is disabled'}), 404

    if not FIRESTORE_AVAILABLE:
        return jsonify({'error': 'Firestore not available'}), 500

    # Delete the habit
    db.collection('fitness_habits').document(habit_id).delete()

    # Delete all tracking records for this habit
    tracking_ref = db.collection('fitness_tracking')
    query = tracking_ref.where('habit_id', '==', habit_id)
    for doc in query.stream():
        doc.reference.delete()

    return jsonify({'success': True})


@app.route('/api/fitness/tracking', methods=['GET'])
@login_required
def get_fitness_tracking():
    """Get fitness tracking records for a date range"""
    if not FITNESS_ENABLED:
        return jsonify({'error': 'Fitness feature is disabled'}), 404

    if not FIRESTORE_AVAILABLE:
        return jsonify({'error': 'Firestore not available'}), 500

    start_date = request.args.get('start_date')
    end_date = request.args.get('end_date')

    tracking_ref = db.collection('fitness_tracking')

    if start_date and end_date:
        query = tracking_ref.where('date', '>=', start_date).where('date', '<=', end_date)
    else:
        query = tracking_ref.limit(100)

    tracking = []
    for doc in query.stream():
        record = doc.to_dict()
        record['id'] = doc.id
        tracking.append(record)

    return jsonify(tracking)


@app.route('/api/fitness/tracking/toggle', methods=['POST'])
@login_required
def toggle_fitness_tracking():
    """Toggle fitness tracking for a specific habit on a specific date"""
    if not FITNESS_ENABLED:
        return jsonify({'error': 'Fitness feature is disabled'}), 404

    if not FIRESTORE_AVAILABLE:
        return jsonify({'error': 'Firestore not available'}), 500

    data = request.get_json()
    date = data.get('date')
    habit_id = data.get('habit_id')

    if not all([date, habit_id]):
        return jsonify({'error': 'Missing required fields'}), 400

    # Check if tracking record exists
    tracking_ref = db.collection('fitness_tracking')
    query = tracking_ref.where('date', '==', date).where('habit_id', '==', habit_id).limit(1)

    existing_docs = list(query.stream())

    if existing_docs:
        # Record exists, delete it (toggle off)
        existing_docs[0].reference.delete()
        return jsonify({'success': True, 'completed': False})
    else:
        # Record doesn't exist, create it (toggle on)
        doc_ref = tracking_ref.document()
        doc_ref.set({
            'date': date,
            'habit_id': habit_id,
            'completed': True,
            'created_at': firestore.SERVER_TIMESTAMP,
            'updated_at': firestore.SERVER_TIMESTAMP
        })
        return jsonify({'success': True, 'completed': True, 'id': doc_ref.id})


@app.route('/api/fitness/init-default-habits', methods=['POST'])
@login_required
def init_default_habits():
    """Initialize default fitness habits (admin endpoint)"""
    if not FITNESS_ENABLED:
        return jsonify({'error': 'Fitness feature is disabled'}), 404

    if not FIRESTORE_AVAILABLE:
        return jsonify({'error': 'Firestore not available'}), 500

    # Default habits
    default_habits = [
        {'name': 'Protein intake in the morning', 'frequency_per_week': 7, 'category': 'nutrition', 'order': 0},
        {'name': 'Walk in the evening', 'frequency_per_week': 4, 'category': 'cardio', 'order': 1},
        {'name': 'Running/Sprinting', 'frequency_per_week': 2, 'category': 'cardio', 'order': 2},
        {'name': 'Legs day', 'frequency_per_week': 1, 'category': 'strength', 'order': 3},
        {'name': 'Push day', 'frequency_per_week': 1, 'category': 'strength', 'order': 4},
        {'name': 'Pull day', 'frequency_per_week': 1, 'category': 'strength', 'order': 5},
        {'name': 'No food after 6 pm', 'frequency_per_week': 7, 'category': 'nutrition', 'order': 6}
    ]

    habits_ref = db.collection('fitness_habits')

    # Check if habits already exist
    existing = list(habits_ref.stream())
    if existing:
        return jsonify({'error': f'Habits already exist ({len(existing)} found). Delete them first if you want to reinitialize.'}), 400

    # Create habits
    created_ids = []
    for habit in default_habits:
        doc_ref = habits_ref.document()
        doc_ref.set({
            **habit,
            'created_at': firestore.SERVER_TIMESTAMP,
            'updated_at': firestore.SERVER_TIMESTAMP
        })
        created_ids.append(doc_ref.id)

    return jsonify({
        'success': True,
        'message': f'Successfully created {len(created_ids)} default habits',
        'habit_ids': created_ids
    })


def _fetch_github_commits_for_week(week_start: str, week_end: str) -> list[dict]:
    """Fetch all commits by the configured user across all their repos for a given week."""
    headers = {
        'Authorization': f'token {GITHUB_TOKEN}',
        'Accept': 'application/vnd.github.v3+json',
    }

    # List all repos owned by the user (up to 100)
    repos_resp = http_requests.get(
        'https://api.github.com/user/repos',
        headers=headers,
        params={'per_page': 100, 'type': 'owner', 'sort': 'pushed'},
        timeout=15,
    )
    repos_resp.raise_for_status()
    repos = repos_resp.json()

    since = f'{week_start}T00:00:00Z'
    until = f'{week_end}T23:59:59Z'

    all_commits = []
    for repo in repos:
        repo_name = repo['name']
        commits_resp = http_requests.get(
            f'https://api.github.com/repos/{GITHUB_USERNAME}/{repo_name}/commits',
            headers=headers,
            params={'author': GITHUB_USERNAME, 'since': since, 'until': until, 'per_page': 100},
            timeout=15,
        )
        if commits_resp.status_code == 409:
            # Empty repo
            continue
        commits_resp.raise_for_status()
        commits = commits_resp.json()
        for c in commits:
            all_commits.append({
                'repo': repo_name,
                'message': c['commit']['message'].split('\n')[0],  # first line only
                'date': c['commit']['author']['date'][:10],
            })

    return all_commits


def _summarize_commits_with_claude(commits: list[dict], week_start: str, week_end: str) -> str:
    """Use Claude to turn raw commit list into a concise weekly snippet."""
    if not anthropic_sdk:
        return '\n'.join(f"- [{c['repo']}] {c['message']}" for c in commits)

    commits_text = ''
    by_repo: dict[str, list[str]] = {}
    for c in commits:
        by_repo.setdefault(c['repo'], []).append(c['message'])

    for repo, messages in by_repo.items():
        commits_text += f'\n**{repo}**\n'
        for m in messages:
            commits_text += f'  - {m}\n'

    client = anthropic_sdk.Anthropic(api_key=ANTHROPIC_API_KEY)
    response = client.messages.create(
        model='claude-haiku-4-5-20251001',
        max_tokens=600,
        messages=[{
            'role': 'user',
            'content': (
                f'Below are my GitHub commits for the week of {week_start} to {week_end}, grouped by repository.\n'
                'Write a concise weekly work summary in this exact markdown format:\n\n'
                '- RepoName\n'
                '  - summary of work done\n'
                '  - another summary\n\n'
                'Rules:\n'
                '- Top-level bullet is the repo name (plain text, no bold, no heading)\n'
                '- 1-3 indented sub-bullets per repo, summarising the work theme — not listing each commit verbatim\n'
                '- Keep each sub-bullet short (one line)\n'
                '- Skip trivial commits (merge, version bumps, typos)\n'
                '- If a repo has only trivial commits, omit it entirely\n'
                '- No title or heading at the top\n\n'
                f'Commits:\n{commits_text}'
            ),
        }],
    )
    return response.content[0].text


@app.route('/api/github/autofill-week', methods=['POST'])
@login_required
def github_autofill_week():
    """Fetch GitHub commits for a week, return a Claude-generated snippet summary,
    and create daily scores for days that have commits."""
    if not GITHUB_TOKEN or not GITHUB_USERNAME or not ANTHROPIC_API_KEY:
        return jsonify({'error': 'GitHub autofill is not configured'}), 503

    data = request.get_json()
    week_start = data.get('week_start')
    week_end = data.get('week_end')
    endeavor = data.get('endeavor', 'pet project')

    if not week_start or not week_end:
        return jsonify({'error': 'week_start and week_end are required'}), 400

    try:
        commits = _fetch_github_commits_for_week(week_start, week_end)
    except Exception as e:
        return jsonify({'error': f'GitHub API error: {str(e)}'}), 502

    if not commits:
        return jsonify({'error': 'No commits found for this week'}), 404

    try:
        content = _summarize_commits_with_claude(commits, week_start, week_end)
    except Exception as e:
        return jsonify({'error': f'Summarization error: {str(e)}'}), 502

    # Populate daily scores for days that have commits (skip days already scored)
    dates_scored = 0
    if FIRESTORE_AVAILABLE and DAILY_SCORES_ENABLED:
        commit_dates = {c['date'] for c in commits}
        scores_ref = db.collection('daily_scores')
        for date in commit_dates:
            existing = list(scores_ref.where('date', '==', date).where('endeavor', '==', endeavor).limit(1).stream())
            if not existing:
                scores_ref.document().set({
                    'date': date,
                    'score': 1,
                    'endeavor': endeavor,
                    'created_at': firestore.SERVER_TIMESTAMP,
                    'updated_at': firestore.SERVER_TIMESTAMP,
                })
                dates_scored += 1

    return jsonify({'content': content, 'commit_count': len(commits), 'dates_scored': dates_scored})


if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5001)

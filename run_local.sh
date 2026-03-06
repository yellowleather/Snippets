#!/bin/bash
# Local development server for Snippets application
# Runs Flask app locally with hot-reload for rapid development

set -e

echo "Starting Snippets Local Development Server..."
echo ""

# Check if .env.production exists
if [ ! -f .env.production ]; then
    echo "Warning: .env.production not found!"
    echo "Creating .env.production with default values..."
    cat > .env.production << 'EOF'
SECRET_KEY=local-dev-secret-key-not-for-production
SNIPPET_USERNAME=admin
SNIPPET_PASSWORD=changeme
EOF
    echo "Created .env.production with default credentials (admin/changeme)"
    echo ""
fi

# Load environment variables from .env.production
source .env.production

# Check if venv exists and is valid
if [ -d "venv" ]; then
    if ! ./venv/bin/python --version &>/dev/null; then
        echo "Warning: Existing venv is broken, recreating..."
        rm -rf venv
    fi
fi

# Create venv if needed
if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
    if [ $? -ne 0 ]; then
        echo "Error: Failed to create virtual environment"
        exit 1
    fi
fi

# Install/update dependencies
echo "Installing dependencies..."
./venv/bin/pip install -q -r requirements.txt

echo ""
echo "Starting Flask development server..."
echo ""
echo "Application will be available at:"
echo "  http://localhost:5001"
echo ""
echo "Login credentials:"
echo "  Username: $SNIPPET_USERNAME"
echo "  Password: $SNIPPET_PASSWORD"
echo ""
echo "Press Ctrl+C to stop the server"
echo ""

# Set default for GOALS_ENABLED if not in .env.production
if [ -z "$GOALS_ENABLED" ]; then
    GOALS_ENABLED="true"
fi

# Set default for REFLECTIONS_ENABLED if not in .env.production
if [ -z "$REFLECTIONS_ENABLED" ]; then
    REFLECTIONS_ENABLED="true"
fi

# Set default for DAILY_SCORES_ENABLED if not in .env.production
if [ -z "$DAILY_SCORES_ENABLED" ]; then
    DAILY_SCORES_ENABLED="true"
fi

# Export environment variables for Flask
export SECRET_KEY="$SECRET_KEY"
export SNIPPET_USERNAME="$SNIPPET_USERNAME"
export SNIPPET_PASSWORD="$SNIPPET_PASSWORD"
export GOALS_ENABLED="$GOALS_ENABLED"
export REFLECTIONS_ENABLED="$REFLECTIONS_ENABLED"
export DAILY_SCORES_ENABLED="$DAILY_SCORES_ENABLED"
export GITHUB_TOKEN="$GITHUB_TOKEN"
export GITHUB_USERNAME="$GITHUB_USERNAME"
export ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY"
export GITHUB_AUTOFILL_ENDEAVOR="$GITHUB_AUTOFILL_ENDEAVOR"
export FLASK_ENV=development
export FLASK_DEBUG=1

# Run Flask with auto-reload
./venv/bin/python app.py

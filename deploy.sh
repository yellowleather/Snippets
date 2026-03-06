#!/bin/bash
# Deployment script for Google App Engine
# Loads secrets from .env.production (gitignored)

set -e  # Exit on error

echo "Pre-deployment checks..."
echo ""

# Run tests first
echo "Running tests..."
./run_tests.sh
if [ $? -ne 0 ]; then
    echo ""
    echo "Error: Tests failed. Deployment aborted."
    exit 1
fi

echo ""
echo "Tests passed! Proceeding with deployment..."
echo ""

# Check if .env.production exists
if [ ! -f .env.production ]; then
    echo "Error: .env.production not found!"
    echo "Create it with your secrets first."
    exit 1
fi

# Load environment variables from .env.production
source .env.production

# Validate required variables
if [ -z "$SECRET_KEY" ] || [ -z "$SNIPPET_PASSWORD" ]; then
    echo "Error: SECRET_KEY or SNIPPET_PASSWORD not set in .env.production"
    exit 1
fi

# Set default for GOALS_ENABLED if not provided
if [ -z "$GOALS_ENABLED" ]; then
    GOALS_ENABLED="true"
fi

# Set default for REFLECTIONS_ENABLED if not provided
if [ -z "$REFLECTIONS_ENABLED" ]; then
    REFLECTIONS_ENABLED="true"
fi

# Set default for DAILY_SCORES_ENABLED if not provided
if [ -z "$DAILY_SCORES_ENABLED" ]; then
    DAILY_SCORES_ENABLED="true"
fi

# Set default for FITNESS_ENABLED if not provided
if [ -z "$FITNESS_ENABLED" ]; then
    FITNESS_ENABLED="true"
fi

echo "Loaded secrets from .env.production"
echo "Generating app.yaml from template..."

# Create app.yaml from template with secrets
sed -e "s|__SNIPPET_USERNAME__|$SNIPPET_USERNAME|g" \
    -e "s|__SNIPPET_PASSWORD__|$SNIPPET_PASSWORD|g" \
    -e "s|__SECRET_KEY__|$SECRET_KEY|g" \
    -e "s|__GOALS_ENABLED__|$GOALS_ENABLED|g" \
    -e "s|__REFLECTIONS_ENABLED__|$REFLECTIONS_ENABLED|g" \
    -e "s|__DAILY_SCORES_ENABLED__|$DAILY_SCORES_ENABLED|g" \
    -e "s|__FITNESS_ENABLED__|$FITNESS_ENABLED|g" \
    -e "s|__GITHUB_TOKEN__|$GITHUB_TOKEN|g" \
    -e "s|__GITHUB_USERNAME__|$GITHUB_USERNAME|g" \
    -e "s|__ANTHROPIC_API_KEY__|$ANTHROPIC_API_KEY|g" \
    -e "s|__GITHUB_AUTOFILL_ENDEAVOR__|$GITHUB_AUTOFILL_ENDEAVOR|g" \
    app.yaml.template > app.yaml

echo "Deploying to App Engine..."

# Deploy
gcloud app deploy --quiet

# Clean up app.yaml (remove secrets)
rm -f app.yaml

echo ""
echo "Deployment complete!"
echo ""
echo "Your app is live at:"
gcloud app browse --no-launch-browser 2>&1 | grep "https://" || echo "   Run: gcloud app browse"
echo ""
echo "Login credentials:"
echo "   Username: $SNIPPET_USERNAME"
echo "   Password: [hidden for security]"
echo ""

#!/bin/bash

# Configuration
REPO_NAME="belka.io"
GITHUB_USER="PasDeNom2"
COLLAB_USER="byfect"

# Initialize Git
echo "Initializing Git repository..."
git init

# Add all files
echo "Adding files..."
git add .

# Commit
echo "Committing initial files..."
git commit -m "Initial commit for belka.io project"

# Create GitHub repository using GitHub CLI
echo "Creating GitHub repository $REPO_NAME on account $GITHUB_USER..."
# Ensure login explicitly or assume GH CLI is authenticated as PasDeNom2
gh repo create $REPO_NAME --public --source=. --remote=origin

# Push to main branch
echo "Pushing code to main branch..."
git push -u origin main

# Add collaborator
echo "Adding collaborator $COLLAB_USER..."
gh repo collaborator add $COLLAB_USER

echo "Deployment complete! Application available for evaluation."
echo "To run locally via Docker:"
echo "  docker-compose up -d --build"
echo "  Access at http://localhost:6278"

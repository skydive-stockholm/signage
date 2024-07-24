#!/bin/bash

# Exit immediately if a command exits with a non-zero status.
set -e

# Function to print error messages
error() {
    echo "Error: $1" >&2
    exit 1
}

sf_echo() {
  command printf %s\\n "$*" 2>/dev/null
}

# Function to check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

{ sf_echo >&2 "$(cat)" ; } << EOF
@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
@    INSTALLING SF-SIGNAGE SYSTEM     @
@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
EOF

# Update package list
echo "Updating package list..."
sudo apt-get update || error "Failed to update package list"

# Install necessary packages
echo "Installing necessary packages..."
sudo apt-get install -y git curl nodejs npm || error "Failed to install necessary packages"

# Install NVM (Node Version Manager)
echo "Installing NVM..."
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash || error "Failed to install NVM"

# Load NVM
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

# Install version 21 of Node.js
echo "Installing latest LTS version of Node.js..."
nvm install 21 || error "Failed to install Node.js"

# Install PM2 globally
echo "Installing PM2..."
npm install -g pm2 || error "Failed to install PM2"

# Clone your project repository
echo "Cloning project repository..."
git clone https://github.com/skydive-stockholm/signage.git sf-signage || error "Failed to clone repository"

# Navigate to project directory
cd sf-signage || error "Failed to navigate to project directory"

# Install project dependencies
echo "Installing project dependencies..."
npm install || error "Failed to install project dependencies"

# Start the application with PM2
echo "Starting the application with PM2..."
pm2 start player/index.js || error "Failed to start application with PM2"

# Set up PM2 to start on boot
echo "Setting up PM2 to start on system boot..."
pm2 startup || error "Failed to set up PM2 startup script"

# Save the current PM2 process list
echo "Saving the PM2 process list..."
pm2 save || error "Failed to save PM2 process list"

echo "Installation completed successfully!"

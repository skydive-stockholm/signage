#!/bin/bash

# Exit immediately if a command exits with a non-zero status.
set -e

# Function to print error messages
error() {
    echo "Error: $1" >&2
    exit 1
}

echo "=========================================="
echo "   Installing URL Player for Raspberry Pi"
echo "=========================================="

# Make sure we're running as root
if [ "$(id -u)" -ne 0 ]; then
    error "This script must be run as root. Try 'sudo $0'"
fi

# Update package list
echo "Updating package list..."
apt-get update -qq || error "Failed to update package list"

# Install minimal necessary packages as per tutorial
echo "Installing minimal necessary packages..."
apt-get install --no-install-recommends -y \
  xserver-xorg-video-all \
  xserver-xorg-input-all \
  xserver-xorg-core \
  xinit \
  x11-xserver-utils \
  chromium-browser \
  unclutter \
  python3 \
  python3-requests \
  cec-utils \
  fonts-noto-color-emoji \
  || error "Failed to install necessary packages"

# Check if cec-client is available
echo "Checking CEC availability..."
if command -v cec-client > /dev/null; then
    echo "CEC client is available - screen power control enabled"
else
    echo "WARNING: cec-client not available despite installation. Screen power control may not work."
fi

# Download player.py from https://raw.githubusercontent.com/skydive-stockholm/signage/refs/heads/main/player/index.js
wget https://raw.githubusercontent.com/skydive-stockholm/signage/refs/heads/main/player/player.py -O /home/pi/player.py

# Create destination directory
echo "Setting up player..."
touch /home/pi/player.log || error "Failed to create log file"
chown pi:pi /home/pi/player.log || error "Failed to set ownership on log file"
chown pi:pi /home/pi/player.py || error "Failed to set ownership on player script"
chmod +x "/home/pi/player.py" || error "Failed to set executable permissions"

# Create .bash_profile for autologin -> startx
echo "Setting up auto-start configuration..."
cat << 'EOF' > /home/pi/.bash_profile
if [ -z $DISPLAY ] && [ $(tty) = /dev/tty1 ]
then
  startx
fi
EOF
chown pi:pi /home/pi/.bash_profile

# Create .xinitrc for browser kiosk setup
echo "Creating X initialization script..."
cat << 'EOF' > /home/pi/.xinitrc
#!/usr/bin/env sh
xset -dpms
xset s off
xset s noblank

# Start the URL player in the background
unclutter & /home/pi/player.py
EOF
chmod +x /home/pi/.xinitrc
chown pi:pi /home/pi/.xinitrc

# Configure raspi-config for console autologin
echo "Configuring system for console autologin..."
raspi-config nonint do_boot_behaviour B2

# Set up daily reboot at 4am for maintenance
echo "Setting up daily reboot..."
cat << EOF > /etc/cron.d/reboot-player
0 4 * * * root reboot
EOF

# Get hostname for display in output
HOSTNAME=$(hostname)

echo "================================================"
echo "Installation completed successfully!"
echo ""
echo "The URL player is now running and will:"
echo "- Check http://192.168.55.52:3030/player/$HOSTNAME every minute for URLs"
echo "- Automatically display URLs in a fullscreen browser"
echo "- Restart daily at 4:00 AM for maintenance"
echo ""
echo "- To exit the browser manually, press Alt+F4"
echo "- To restart the browser manually, type 'startx'"
echo "- Logs are available at: /home/pi/url-player.log"
echo ""
echo "The system will reboot in 10 seconds to apply all changes..."
echo "================================================"

# Reboot the system
sleep 10
reboot

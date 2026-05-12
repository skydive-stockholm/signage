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

# Set timezone so cron reboots and player auto-update fire at the right local hour
echo "Setting timezone to Europe/Stockholm..."
timedatectl set-timezone Europe/Stockholm || error "Failed to set timezone"

# Detect old Pi up-front — model strings on Pi 1 A/B/A+/B+ omit a digit
# ("Raspberry Pi Model B Plus"), so match modern Pis positively and treat
# everything else as old. Affects:
#  - Chromium choice: Pi 1 / Zero (ARMv6) lacks NEON; current Chromium builds
#    require NEON and segfault. Install legacy Buster Chromium 92 instead.
#  - Xorg Glamor: VC4 V3D 2.1 (Pi 1/2) renders to an offscreen buffer with
#    Glamor enabled, causing a black screen — disable it.
PI_MODEL=$(cat /proc/device-tree/model 2>/dev/null || true)
case "$PI_MODEL" in
    *"Raspberry Pi 3"*|*"Raspberry Pi 4"*|*"Raspberry Pi 5"*|*"Raspberry Pi 400"*|*"Raspberry Pi Zero 2"*|*"Raspberry Pi Compute Module 3"*|*"Raspberry Pi Compute Module 4"*|*"Raspberry Pi Compute Module 5"*)
        OLD_PI=0 ;;
    *)
        OLD_PI=1 ;;
esac

# Update package list
echo "Updating package list..."
apt-get update -qq || error "Failed to update package list"

# Install minimal necessary packages. Modern Pis get the current Chromium
# from the system repos; old Pis get legacy Chromium installed separately
# below (the current build won't run on their CPUs).
COMMON_PKGS="xserver-xorg-video-all xserver-xorg-input-all xserver-xorg-core xinit x11-xserver-utils unclutter python3 python3-requests cec-utils fonts-noto-color-emoji"
echo "Installing minimal necessary packages..."
if [ "$OLD_PI" = "1" ]; then
    apt-get install --no-install-recommends -y $COMMON_PKGS \
        || error "Failed to install necessary packages"
else
    apt-get install --no-install-recommends -y $COMMON_PKGS chromium \
        || error "Failed to install necessary packages"
fi

# On old Pi, install legacy Chromium 92 from Raspbian Buster archive. Current
# Chromium needs NEON which ARMv6 (Pi 1 / original Zero) lacks; even Bullseye's
# Chromium 106 segfaults on the original Pi 1's BCM2835. v92 is the newest one
# known to actually launch on these boards. Held to block apt upgrades.
if [ "$OLD_PI" = "1" ]; then
    echo "Old Raspberry Pi detected — installing legacy Chromium 92 from Buster..."
    CHROMIUM_VER="92.0.4515.98~buster-rpt2"
    BASE="http://archive.raspberrypi.org/debian/pool/main/c/chromium-browser"
    cd /tmp
    wget -q "$BASE/chromium-browser_${CHROMIUM_VER}_armhf.deb" \
        || error "Failed to download legacy chromium-browser"
    wget -q "$BASE/chromium-codecs-ffmpeg-extra_${CHROMIUM_VER}_armhf.deb" \
        || error "Failed to download legacy chromium codecs"
    apt-get install -y \
        "./chromium-codecs-ffmpeg-extra_${CHROMIUM_VER}_armhf.deb" \
        "./chromium-browser_${CHROMIUM_VER}_armhf.deb" \
        || error "Failed to install legacy chromium"
    apt-mark hold chromium-browser chromium-codecs-ffmpeg-extra
fi

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

# On old Pis (VC4 V3D 2.1: Pi 1/2/original Zero), disable Glamor — without
# this, Xorg renders to an offscreen buffer and the screen stays black.
if [ "$OLD_PI" = "1" ]; then
    echo "Disabling Glamor in Xorg for old Pi..."
    mkdir -p /etc/X11/xorg.conf.d
    cat > /etc/X11/xorg.conf.d/20-noglamor.conf << 'XEOF'
Section "Device"
    Identifier "modesetting"
    Driver "modesetting"
    Option "AccelMethod" "none"
EndSection
XEOF
fi

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

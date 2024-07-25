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
@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
@     ▶ INSTALLING SF-SIGNAGE PLAYER ▶    @
@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
EOF

# Function to prompt for input if arguments are not provided
prompt_input() {
    if [ -z "$ip_address" ]; then
        read -p "Enter server IP address: " ip_address
    fi
    if [ -z "$player_name" ]; then
        read -p "Enter player name: " player_name
    fi
}

# Parse command-line arguments
while [[ "$#" -gt 0 ]]; do
    case $1 in
        --ipaddress) ip_address="$2"; shift ;;
        --playername) player_name="$2"; shift ;;
        *) echo "Unknown parameter: $1"; exit 1 ;;
    esac
    shift
done

# Prompt for input if arguments are not provided
prompt_input

# Update package list
echo "Updating package list..."
apt-get update || error "Failed to update package list"

# Install necessary packages
echo "Installing necessary packages..."
apt-get install -y xserver-xorg xinit x11-xserver-utils unclutter matchbox-window-manager cec-utils git curl nodejs npm fonts-noto-color-emoji || error "Failed to install necessary packages"

# Install chrome
echo "Installing Chrome..."
apt-get install chromium-browser chromium-codecs-ffmpeg

# Install NVM (Node Version Manager)
echo "Installing NVM..."
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash || error "Failed to install NVM"

# Load NVM
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

# Install version 21 of Node.js
echo "Installing latest LTS version of Node.js..."
nvm install 21 || error "Failed to install Node.js"

# Clone your project repository
echo "Cloning project repository..."
git clone https://github.com/skydive-stockholm/signage.git sf-signage || error "Failed to clone repository"

# Navigate to project directory
cd sf-signage || error "Failed to navigate to project directory"

# Check if config.json exists, if not create it with an empty JSON object
if [ ! -f player/config.json ]; then
    echo '{}' > player/config.json
fi

content="{
    \"server_ip\": \"$ip_address\",
    \"player_name\": \"$player_name\"
}"

# Write updated content back to file
echo "$content" > player/config.json

# Install project dependencies
echo "Installing project dependencies..."
npm install || error "Failed to install project dependencies"

# Create .xinitrc file
cat << EOF > /home/pi/player
#!/bin/bash

# Hide the cursor
unclutter -idle 0 &

# Start the application
xset s off
xset -dpms
xset s noblank

# Start the Node.js application and restart if it crashes
while true; do
    matchbox-window-manager -use_titlebar no & unclutter & node /home/pi/sf-signage/player/index.js
    sleep 1
done
EOF

chmod +x /home/pi/player

cat << EOF >> /home/pi/.bashrc
xinit /home/pi/player -- vt$(fgconsole)
EOF

# Enable auto-login for user "pi"
sudo raspi-config nonint do_boot_behaviour B2

echo "Installation completed successfully!"

# Reboot the machine every morning.
cat << EOF > /etc/cron.d/reboot
30 07 * * * reboot
EOF

sudo reboot

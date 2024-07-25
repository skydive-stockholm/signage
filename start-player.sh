#!/bin/bash

# Navigate to the project directory
cd /home/pi/sf-signage

xset s off
xset -dpms
xset s noblank

# Start the Node.js application and restart if it crashes
while true; do
    matchbox-window-manager -use_titlebar no & unclutter & node player/index.js
    sleep 1
done

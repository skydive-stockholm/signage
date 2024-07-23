#!/bin/bash

git clone https://github.com/skydive-stockholm/signage.git sf-signage

cd sf-signage

npm install

# Create system service for sf-signage-server
sudo cp sf-signage-server.service /etc/systemd/system/sf-signage-server.service
sudo systemctl enable sf-signage-server.service
sudo systemctl start sf-signage-server.service

# Wait for server to start
wait 5

# Create system service for sf-signage-player
sudo cp sf-signage-player.service /etc/systemd/system/sf-signage-player.service
sudo systemctl enable sf-signage-player.service
sudo systemctl start sf-signage-player.service

sudo systemctl daemon-reload

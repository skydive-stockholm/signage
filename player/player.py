#!/usr/bin/env python3
"""
Minimal URL Player for Raspberry Pi
- Pings API endpoint every minute
- Updates browser when URL changes
- Controls screen power via CEC
"""

import json
import time
import os
import signal
import socket
import subprocess
import sys
import requests
import logging
import shutil
from datetime import datetime

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler(os.path.expanduser("~/player.log")),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger("url-player")

# Constants
CHECK_INTERVAL = 60  # Check for new content every 60 seconds (1 minute)
BASE_URL = "http://192.168.55.52:3030"
HOSTNAME = socket.gethostname()
BROWSER_PID_FILE = os.path.expanduser("~/browser.pid")

# Check if CEC is available
CEC_AVAILABLE = shutil.which('cec-client') is not None

# Detect chromium binary name (Raspberry Pi OS Bookworm+ uses 'chromium', older used 'chromium-browser')
CHROMIUM_BIN = shutil.which('chromium') or shutil.which('chromium-browser') or 'chromium'

# RPi 1 and 2 use VideoCore IV which doesn't support GLES 3.0 — needs software rendering
def _pi_has_gpu():
    try:
        with open('/proc/device-tree/model') as f:
            model = f.read()
        return 'Raspberry Pi 1' not in model and 'Raspberry Pi 2' not in model
    except Exception:
        return True

GPU_ACCELERATION = _pi_has_gpu()
if not GPU_ACCELERATION:
    logger.info("RPi 1/2 detected — GPU acceleration disabled, using software rendering")

if CEC_AVAILABLE:
    logger.info("CEC client is available - screen power control enabled")
else:
    logger.warning("CEC client not available - screen power control disabled")

def get_hdmi_output():
    """Return the connected xrandr output name, or None if not found"""
    try:
        result = subprocess.run(['xrandr'], capture_output=True, text=True, check=True)
        for line in result.stdout.splitlines():
            if ' connected' in line:
                return line.split()[0]
    except Exception:
        pass
    return None

def turn_screen_on():
    """Turn the connected HDMI display on using CEC and xrandr"""
    if not CEC_AVAILABLE:
        logger.warning("Attempted to turn screen on, but CEC client is not available")
        return False

    try:
        output = get_hdmi_output()
        if output:
            subprocess.run(['xrandr', '--output', output, '--auto'], check=True)
        subprocess.run('echo "on 0" | cec-client -s -d 1', shell=True, check=True)
        logger.info("Screen turned ON via CEC")
        return True
    except subprocess.CalledProcessError as e:
        logger.error(f"Error turning screen on: {e}")
        return False

def turn_screen_off():
    """Turn the connected HDMI display off using CEC and xrandr"""
    if not CEC_AVAILABLE:
        logger.warning("Attempted to turn screen off, but CEC client is not available")
        return False

    try:
        subprocess.run('echo "standby 0" | cec-client -s -d 1', shell=True, check=True)
        output = get_hdmi_output()
        if output:
            subprocess.run(['xrandr', '--output', output, '--off'], check=True)
        logger.info("Screen turned OFF via CEC")
        return True
    except subprocess.CalledProcessError as e:
        logger.error(f"Error turning screen off: {e}")
        return False

def get_current_url():
    """Get the current URL from the endpoint using hostname"""
    try:
        endpoint = f"{BASE_URL}/player/{HOSTNAME}"
        logger.info(f"Checking endpoint: {endpoint}")
        response = requests.get(endpoint, timeout=10)
        response.raise_for_status()
        data = response.json()
        logger.info(f"Received data: {data}")
        return data.get('url')
    except requests.RequestException as e:
        logger.error(f"Error fetching URL: {e}")
        return None

def launch_browser(url):
    """Launch Chromium browser with the specified URL"""
    try:
        # Close any existing browser first
        close_browser()

        # Launch chromium with kiosk settings
        browser_cmd = [
            CHROMIUM_BIN, url,
            "--window-size=1920,1080",
            "--window-position=0,0",
            "--start-fullscreen",
            "--kiosk",
            "--noerrdialogs",
            "--disable-translate",
            "--no-first-run",
            "--fast",
            "--fast-start",
            "--disable-infobars",
            "--disable-features=TranslateUI",
            "--disk-cache-dir=/dev/null",
            "--overscroll-history-navigation=0",
            "--disable-pinch"
        ]
        if not GPU_ACCELERATION:
            browser_cmd.append("--disable-gpu")

        # Launch browser as a subprocess and save the PID
        process = subprocess.Popen(browser_cmd)
        with open(BROWSER_PID_FILE, 'w') as f:
            f.write(str(process.pid))

        logger.info(f"Launched browser with URL: {url} (PID: {process.pid})")
        return True
    except Exception as e:
        logger.error(f"Error launching browser: {e}")
        return False

def close_browser():
    """Close any running browser instances"""
    try:
        # Try to kill by PID file first
        if os.path.exists(BROWSER_PID_FILE):
            with open(BROWSER_PID_FILE, 'r') as f:
                pid = int(f.read().strip())
            try:
                os.kill(pid, signal.SIGTERM)
                logger.info(f"Closed browser with PID: {pid}")
            except ProcessLookupError:
                logger.info(f"Browser process {pid} not found")

        # As a fallback, kill all chromium processes
        subprocess.run("pkill -o chromium", shell=True)

        if os.path.exists(BROWSER_PID_FILE):
            os.remove(BROWSER_PID_FILE)

        return True
    except Exception as e:
        logger.error(f"Error closing browser: {e}")
        return False

def main():
    """Main function of the player"""
    try:
        logger.info(f"Starting Minimal URL Player with hostname: {HOSTNAME}")

        current_url = None
        screen_on = None  # unknown at startup; first poll always syncs state

        while True:
            new_url = get_current_url()

            if new_url:
                # URL found - turn on screen if needed and display
                if not screen_on and CEC_AVAILABLE:
                    screen_on = turn_screen_on()

                # If URL changed, update the browser
                if new_url != current_url:
                    logger.info(f"New URL detected: {new_url}")
                    launch_browser(new_url)
                    current_url = new_url
            else:
                # No URL - turn off screen and close browser
                if screen_on is not False and CEC_AVAILABLE:
                    close_browser()
                    screen_on = not turn_screen_off()
                    current_url = None
                elif current_url is not None:
                    # No screen control but browser is open - close it
                    close_browser()
                    current_url = None

                logger.warning("No URL received from endpoint - screen turned off")

            # Wait before checking again
            time.sleep(CHECK_INTERVAL)

    except KeyboardInterrupt:
        logger.info("Player stopped by user")
        close_browser()
        if CEC_AVAILABLE and screen_on:
            turn_screen_off()
    except Exception as e:
        logger.error(f"Unexpected error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()

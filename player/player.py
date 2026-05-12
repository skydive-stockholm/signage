#!/usr/bin/env python3
"""
Minimal URL Player for Raspberry Pi
- Pings API endpoint every minute
- Updates browser when URL changes
- Controls screen power via CEC
- Auto-updates itself nightly at 04:00 or when admin pushes an update
"""

import hashlib
import time
import os
import signal
import socket
import subprocess
import sys
import requests
import logging
import shutil
from datetime import datetime, date

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

CHECK_INTERVAL = 60
UPDATE_HOUR = 4  # Check for updates nightly at 04:00
BASE_URL = "http://192.168.55.52:3030"
HOSTNAME = socket.gethostname()
BROWSER_PID_FILE = os.path.expanduser("~/browser.pid")

CEC_AVAILABLE = shutil.which('cec-client') is not None
CHROMIUM_BIN = shutil.which('chromium') or shutil.which('chromium-browser') or 'chromium'

# Pi 1 / Pi 2 / original Pi Zero have VC4 V3D 2.1, which renders to an offscreen
# buffer instead of the display framebuffer — causing a black screen under Xorg
# with Glamor or Chromium with GPU acceleration. Their model strings often omit
# a digit ("Raspberry Pi Model B Plus", "Raspberry Pi Zero W"), so match modern
# Pis positively rather than trying to enumerate the old ones.
_MODERN_PI_MARKERS = (
    'Raspberry Pi 3',
    'Raspberry Pi 4',
    'Raspberry Pi 5',
    'Raspberry Pi 400',
    'Raspberry Pi Zero 2',
    'Raspberry Pi Compute Module 3',
    'Raspberry Pi Compute Module 4',
    'Raspberry Pi Compute Module 5',
)

def _pi_has_gpu():
    try:
        with open('/proc/device-tree/model') as f:
            model = f.read()
        return any(m in model for m in _MODERN_PI_MARKERS)
    except Exception:
        return True

GPU_ACCELERATION = _pi_has_gpu()
if not GPU_ACCELERATION:
    logger.info("Old Raspberry Pi detected — GPU acceleration disabled, using software rendering")

if CEC_AVAILABLE:
    logger.info("CEC client is available - screen power control enabled")
else:
    logger.warning("CEC client not available - screen power control disabled")

def self_hash():
    try:
        with open(os.path.abspath(__file__), 'rb') as f:
            return hashlib.sha256(f.read()).hexdigest()[:16]
    except Exception:
        return None

def check_and_apply_update(current_hash, last_check_date):
    """Check server for a newer player script and apply if available.

    Triggers when the server has force=true (admin push) or at UPDATE_HOUR daily.
    Returns (current_hash, last_check_date) — updated on a successful check.
    """
    try:
        resp = requests.get(f"{BASE_URL}/system/player-version", timeout=10)
        resp.raise_for_status()
        data = resp.json()
        server_hash = data.get('hash')
        force = data.get('force', False)

        now = datetime.now()
        today = now.date()
        is_update_hour = now.hour == UPDATE_HOUR and last_check_date != today

        if not force and not is_update_hour:
            return current_hash, last_check_date

        if not server_hash or server_hash == current_hash:
            return current_hash, today

        logger.info(f"Update available ({current_hash} → {server_hash}), reason: {'forced' if force else 'nightly'}. Downloading...")
        script_resp = requests.get(f"{BASE_URL}/system/player-script", timeout=30)
        script_resp.raise_for_status()

        script_path = os.path.abspath(__file__)
        tmp_path = script_path + '.new'
        with open(tmp_path, 'w') as f:
            f.write(script_resp.text)
        os.chmod(tmp_path, 0o755)
        os.replace(tmp_path, script_path)

        logger.info("Update applied — restarting...")
        close_browser()
        os.execv(sys.executable, [sys.executable] + sys.argv)
    except Exception as e:
        logger.warning(f"Update check failed: {e}")
    return current_hash, last_check_date

def get_hdmi_output():
    try:
        result = subprocess.run(['xrandr'], capture_output=True, text=True, check=True)
        for line in result.stdout.splitlines():
            if ' connected' in line:
                return line.split()[0]
    except Exception:
        pass
    return None

def turn_screen_on():
    if not CEC_AVAILABLE:
        logger.warning("Attempted to turn screen on, but CEC client is not available")
        return False
    try:
        output = get_hdmi_output()
        if output:
            subprocess.run(['xrandr', '--output', output, '--auto'], check=True)
        subprocess.run('echo "on 0" | cec-client -s -d 1', shell=True, check=True)
        time.sleep(2)
        subprocess.run('echo "as" | cec-client -s -d 1', shell=True, check=True)
        logger.info("Screen turned ON via CEC")
        return True
    except subprocess.CalledProcessError as e:
        logger.error(f"Error turning screen on: {e}")
        return False

def turn_screen_off():
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
    try:
        close_browser()
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
            browser_cmd += ["--disable-gpu", "--no-gl-override"]
        process = subprocess.Popen(browser_cmd)
        with open(BROWSER_PID_FILE, 'w') as f:
            f.write(str(process.pid))
        logger.info(f"Launched browser with URL: {url} (PID: {process.pid})")
        return True
    except Exception as e:
        logger.error(f"Error launching browser: {e}")
        return False

def close_browser():
    try:
        if os.path.exists(BROWSER_PID_FILE):
            with open(BROWSER_PID_FILE, 'r') as f:
                pid = int(f.read().strip())
            try:
                os.kill(pid, signal.SIGTERM)
                logger.info(f"Closed browser with PID: {pid}")
            except ProcessLookupError:
                logger.info(f"Browser process {pid} not found")
        subprocess.run("pkill -o chromium", shell=True)
        if os.path.exists(BROWSER_PID_FILE):
            os.remove(BROWSER_PID_FILE)
        return True
    except Exception as e:
        logger.error(f"Error closing browser: {e}")
        return False

def main():
    try:
        logger.info(f"Starting Minimal URL Player with hostname: {HOSTNAME}")

        current_url = None
        screen_on = None
        current_hash = self_hash()
        last_update_check_date = None

        while True:
            current_hash, last_update_check_date = check_and_apply_update(current_hash, last_update_check_date)

            new_url = get_current_url()

            if new_url:
                if not screen_on and CEC_AVAILABLE:
                    screen_on = turn_screen_on()
                if new_url != current_url:
                    logger.info(f"New URL detected: {new_url}")
                    launch_browser(new_url)
                    current_url = new_url
            else:
                if screen_on is not False and CEC_AVAILABLE:
                    close_browser()
                    screen_on = not turn_screen_off()
                    current_url = None
                elif current_url is not None:
                    close_browser()
                    current_url = None
                logger.warning("No URL received from endpoint - screen turned off")

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

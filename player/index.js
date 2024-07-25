// Signage Player index.js

const axios = require('axios');
const puppeteer = require('puppeteer');
const { exec, execSync } = require('node:child_process');
const fs = require('node:fs').promises;
const path = require('node:path');

let config;
let browser;
let page;
let isScreenOn = false;
let hasCEC = false;

try {
    config = require('./config.json');
} catch (error) {
    console.error('No config file found');
}

const SERVER_URL = config.server_ip;
const SERVER_PORT = 3030;
const PLAYER_ID = config.player_name;
const MAX_LOG_SIZE = 50 * 1024 * 1024; // 50MB in bytes
const TIMEOUT = 60 * 1000; // Wait 60 seconds before checking for new content
const LOG_FILE = path.join(__dirname, 'errors.log');

async function logError(error) {
    const timestamp = new Date().toISOString();
    const logMessage = `${timestamp}: ${error.stack || error}\n`;

    try {
        // Check if file exists and its size
        const stats = await fs.stat(LOG_FILE).catch(() => ({ size: 0 }));

        if (stats.size > MAX_LOG_SIZE) {
            // If file is too large, rename it and start a new one
            await fs.rename(LOG_FILE, `${LOG_FILE}.old`);
        }

        // Append to the log file
        await fs.appendFile(LOG_FILE, logMessage);
    } catch (err) {
        console.error('Failed to write to log file:', err);
    }
}

if (!SERVER_URL) {
    console.error('Missing server URL in config file');
    process.exit(1);
}

if (!PLAYER_ID) {
    console.error('Missing player ID in config file');
    process.exit(1);
}

async function initBrowser() {
    browser = await puppeteer.launch({
        headless: false,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--start-fullscreen',
            '--kiosk',
            '--disable-infobars',
            '--autoplay-policy=no-user-gesture-required',
        ],
        executablePath: '/usr/bin/chromium-browser',
        defaultViewport: null,
        ignoreDefaultArgs: ['--enable-automation'],
    });
    page = await browser.newPage();
}

async function getCurrentUrl() {
    try {
        const url = `http://${SERVER_URL}:${SERVER_PORT}/player/${PLAYER_ID}`;
        const response = await axios.get(url);
        console.log('Fetched URL:', response.data.url)
        console.log('From:', url)
        return response.data.url;
    } catch (error) {
        console.error('Error fetching URL:', error);
        return null;
    }
}

async function openUrlInChrome(url) {
    if (!page) {
        await initBrowser();
    }
    await page.goto(url, { waitUntil: 'load', timeout: 0});
}

// Check if cec-client is available
function checkCECAvailability() {
    try {
        execSync('which cec-client');
        console.log('CEC client is available');
        hasCEC = true;
    } catch (error) {
        console.warn('CEC client is not available. Screen power control will be disabled.');
        hasCEC = false;
    }
}

function turnScreenOn() {
    return new Promise((resolve, reject) => {
        exec('echo "on 0" | cec-client -s -d 1', (error, stdout, stderr) => {
            if (error) {
                console.error(`Error turning screen on: ${error}`);
                reject(error);
            } else {
                console.log('Screen turned on');
                isScreenOn = true;
                resolve();
            }
        });
    });
}

function turnScreenOff() {
    return new Promise((resolve, reject) => {
        exec('echo "standby 0" | cec-client -s -d 1', (error, stdout, stderr) => {
            if (error) {
                console.error(`Error turning screen off: ${error}`);
                reject(error);
            } else {
                console.log('Screen turned off');
                isScreenOn = false;
                resolve();
            }
        });
    });
}


async function main() {
    try {
        checkCECAvailability();
        let currentUrl = null;

        while (true) {
            const newUrl = await getCurrentUrl();

            if (newUrl && newUrl !== currentUrl) {
                console.log(`Switching to ${newUrl}`);
                if (!isScreenOn && hasCEC) {
                    await turnScreenOn();
                }
                await openUrlInChrome(newUrl);
                currentUrl = newUrl;
            } else if (!newUrl && isScreenOn && hasCEC) {
                console.log('No scheduled content, turning off screen');
                await turnScreenOff();
                currentUrl = null;
            }

            await new Promise(resolve => setTimeout(resolve, TIMEOUT)); // Wait for 1 minute
        }
    } catch (error) {
        await logError(error);
    }
}

main().catch(console.error);

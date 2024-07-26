const fs = require('node:fs').promises;
const path = require('node:path');

const MAX_LOG_SIZE = 50 * 1024 * 1024; // 50MB in bytes
const LOG_FILE = path.join(__dirname, '../errors.log');

async function logError(error) {
    const timestamp = new Date().toISOString();
    const logMessage = `${timestamp}: ${error.stack || error}\n`;

    // Check if log file exists, or create it
    try {
        await fs.access(LOG_FILE);
    } catch (err) {
        await fs.writeFile(LOG_FILE, '');
    }

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

module.exports = {
    logError
}

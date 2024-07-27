const express = require('express');
const path = require('path');
const { getDb } = require('./database');
const moment = require("moment/moment");
const {schedulesForPlayer, getPlayerByName} = require("./repository");
const {PlayerScheduleResolver} = require("./schedule");

const router = express.Router();

router.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

router.get('/player/:player_name', async (req, res) => {
    const playerName = req.params.player_name;
    const player = await getPlayerByName(playerName);

    if (!player) {
        res.status(404).json({error: 'Player not found'});
        return;
    }

    const schedules = await schedulesForPlayer(player.id);
    const url = PlayerScheduleResolver.get(schedules);

    if (!url) {
        res.status(404).json({error: 'Nothing is scheduled for player'});
    } else {
        res.json({url});
    }
});

router.get('/players', async (req, res) => {
    const db = getDb();
    const players = await db.all('SELECT * FROM players');

    for (const player of players) {
        const schedules = await db.all('SELECT * FROM schedules WHERE player_id = ?', player.id);
        player['schedules'] = schedules.map(s => ({
            ...s,
            days: JSON.parse(s.days)
        }));
    }

    res.json(players);
});

router.post('/player', async (req, res) => {
    const db = getDb();
    const { name } = req.body;

    // Validate the name to be in kebab-case
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
        return res.status(400).json({ error: 'Invalid player name. It should be in kebab-case' });
    }

    try {
        const result = await db.run('INSERT INTO players (name) VALUES (?)', name);
        const id = result.lastID;
        const row = await db.get('SELECT * FROM players WHERE id = ?', id);
        res.json(row);
    } catch (error) {
        console.error('Error creating player:', error);
        res.status(500).json({ error: 'An error occurred while creating the player' });
    }
});

router.delete('/player/:playerId', async (req, res) => {
    const db = getDb();
    const { playerId } = req.params;
    await db.run('DELETE FROM schedules WHERE player_id = ?', playerId);
    await db.run('DELETE FROM players WHERE id = ?', playerId);
    res.json({ message: 'Player deleted successfully' });
});

router.post('/player/:playerId/schedule', async (req, res) => {
    const db = getDb();
    const { playerId } = req.params;
    const { url, start_time, end_time, days } = req.body;

    try {
        await db.run(
            'INSERT INTO schedules (player_id, url, start_time, end_time, days) VALUES (?, ?, ?, ?, ?)',
            playerId, url, start_time, end_time, JSON.stringify(days)
        );
        res.json({ message: 'Schedule added successfully' });
    } catch (error) {
        res.status(400).json({ error: 'Invalid data or player not found' });
    }
});

router.post('/schedule/:scheduleId', async (req, res) => {
    const db = getDb();
    const { scheduleId } = req.params;
    const { url, start_time, end_time, days } = req.body;

    try {
        await db.run(
            'UPDATE schedules SET url = ?, start_time = ?, end_time = ?, days = ? WHERE id = ?',
            url, start_time, end_time, JSON.stringify(days), scheduleId
        );
        res.json({ message: 'Schedule updated successfully' });
    } catch (error) {
        res.status(400).json({ error: 'Invalid data or schedule not found' });
    }
});

router.delete('/schedule/:scheduleId', async (req, res) => {
    const db = getDb();
    const { scheduleId } = req.params;
    await db.run('DELETE FROM schedules WHERE id = ?', scheduleId);
    res.json({ message: 'Schedule deleted successfully' });
});

module.exports = router;

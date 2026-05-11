const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { getDb } = require('./database');
const moment = require("moment/moment");
const axios = require('axios');
const {schedulesForPlayer, getPlayerByName} = require("./repository");
const {PlayerScheduleResolver} = require("./PlayerScheduleResolver.js");

const router = express.Router();
const PLAYER_SCRIPT_PATH = path.join(__dirname, '..', 'player', 'player.py');

// ── Audit helper ──────────────────────────────────────────────────────────────
async function audit(db, action, playerId, playerName, details) {
    try {
        await db.run(
            'INSERT INTO audit_log (timestamp, action, player_id, player_name, details) VALUES (?, ?, ?, ?, ?)',
            new Date().toISOString(), action, playerId ?? null, playerName ?? null,
            details ? JSON.stringify(details) : null
        );
    } catch {}
}

// ── Admin UI ──────────────────────────────────────────────────────────────────
router.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ── Player poll (used by player.py) ──────────────────────────────────────────
router.get('/player/:player_name', async (req, res) => {
    const player = await getPlayerByName(req.params.player_name);
    if (!player) return res.status(404).json({error: 'Player not found'});

    const db = getDb();
    const now = moment();
    let url = null;

    if (player.override_url && (!player.override_until || moment(player.override_until).isAfter(now))) {
        url = player.override_url;
    } else {
        const schedules = await schedulesForPlayer(player.id);
        url = PlayerScheduleResolver.get(schedules);
    }

    await db.run(
        'UPDATE players SET last_seen = ?, current_url = ? WHERE id = ?',
        now.toISOString(), url || null, player.id
    );

    if (!url) return res.status(404).json({error: 'Nothing is scheduled for player'});
    res.json({url});
});

// ── Players list ──────────────────────────────────────────────────────────────
router.get('/players', async (req, res) => {
    const db = getDb();
    const players = await db.all('SELECT * FROM players ORDER BY group_name NULLS FIRST, name');
    for (const player of players) {
        const rows = await db.all('SELECT * FROM schedules WHERE player_id = ? ORDER BY priority DESC, id ASC', player.id);
        player.schedules = rows.map(s => ({...s, days: JSON.parse(s.days)}));
    }
    res.json(players);
});

// ── Create player ─────────────────────────────────────────────────────────────
router.post('/player', async (req, res) => {
    const db = getDb();
    const { name } = req.body;
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name))
        return res.status(400).json({error: 'Invalid player name. It should be in kebab-case'});
    try {
        const result = await db.run('INSERT INTO players (name) VALUES (?)', name);
        const row = await db.get('SELECT * FROM players WHERE id = ?', result.lastID);
        await audit(db, 'player_created', result.lastID, name, null);
        res.json(row);
    } catch (e) {
        res.status(500).json({error: 'Failed to create player'});
    }
});

// ── Current URL (no heartbeat side-effect) ────────────────────────────────────
router.get('/player/:playerId/current', async (req, res) => {
    const db = getDb();
    const player = await db.get('SELECT * FROM players WHERE id = ?', req.params.playerId);
    if (!player) return res.status(404).json({error: 'Player not found'});

    const now = moment();
    let url = null, source = 'schedule';
    if (player.override_url && (!player.override_until || moment(player.override_until).isAfter(now))) {
        url = player.override_url; source = 'override';
    } else {
        const schedules = await schedulesForPlayer(player.id);
        url = PlayerScheduleResolver.get(schedules);
    }
    res.json({url: url || null, source});
});

// ── Override ──────────────────────────────────────────────────────────────────
router.post('/player/:playerId/override', async (req, res) => {
    const db = getDb();
    const { url, until } = req.body;
    const player = await db.get('SELECT * FROM players WHERE id = ?', req.params.playerId);
    if (!player) return res.status(404).json({error: 'Not found'});
    await db.run('UPDATE players SET override_url = ?, override_until = ? WHERE id = ?', url, until || null, player.id);
    await audit(db, 'override_set', player.id, player.name, {url, until: until || null});
    res.json({message: 'Override set'});
});

router.delete('/player/:playerId/override', async (req, res) => {
    const db = getDb();
    const player = await db.get('SELECT * FROM players WHERE id = ?', req.params.playerId);
    await db.run('UPDATE players SET override_url = NULL, override_until = NULL WHERE id = ?', req.params.playerId);
    if (player) await audit(db, 'override_cleared', player.id, player.name, null);
    res.json({message: 'Override cleared'});
});

// ── Update player group ───────────────────────────────────────────────────────
router.patch('/player/:playerId/group', async (req, res) => {
    const db = getDb();
    const { group_name } = req.body;
    const player = await db.get('SELECT * FROM players WHERE id = ?', req.params.playerId);
    if (!player) return res.status(404).json({error: 'Not found'});
    await db.run('UPDATE players SET group_name = ? WHERE id = ?', group_name || null, player.id);
    await audit(db, 'group_changed', player.id, player.name, {group_name: group_name || null});
    res.json({message: 'Group updated'});
});

// ── Copy schedules ────────────────────────────────────────────────────────────
router.post('/player/:targetId/copy-schedules-from/:sourceId', async (req, res) => {
    const db = getDb();
    const [source, target] = await Promise.all([
        db.get('SELECT * FROM players WHERE id = ?', req.params.sourceId),
        db.get('SELECT * FROM players WHERE id = ?', req.params.targetId),
    ]);
    if (!source || !target) return res.status(404).json({error: 'Player not found'});
    const schedules = await schedulesForPlayer(source.id);
    for (const s of schedules) {
        await db.run(
            'INSERT INTO schedules (player_id, url, start_time, end_time, days, priority) VALUES (?, ?, ?, ?, ?, ?)',
            target.id, s.url, s.start_time, s.end_time, s.days, s.priority || 0
        );
    }
    await audit(db, 'schedules_copied_from', target.id, target.name, {source: source.name, count: schedules.length});
    res.json({message: `Copied ${schedules.length} schedules from ${source.name}`});
});

// ── Reorder schedules ─────────────────────────────────────────────────────────
router.post('/player/:playerId/reorder-schedules', async (req, res) => {
    const db = getDb();
    const { orderedIds } = req.body;
    for (let i = 0; i < orderedIds.length; i++)
        await db.run('UPDATE schedules SET priority = ? WHERE id = ?', orderedIds.length - i, orderedIds[i]);
    res.json({message: 'Order updated'});
});

// ── Audit log ─────────────────────────────────────────────────────────────────
router.get('/player/:playerId/audit', async (req, res) => {
    const db = getDb();
    const entries = await db.all(
        'SELECT * FROM audit_log WHERE player_id = ? ORDER BY timestamp DESC LIMIT 50',
        req.params.playerId
    );
    res.json(entries.map(e => ({...e, details: e.details ? JSON.parse(e.details) : null})));
});

// ── Group override ────────────────────────────────────────────────────────────
router.post('/group/:groupName/override', async (req, res) => {
    const db = getDb();
    const { url, until } = req.body;
    const players = await db.all('SELECT * FROM players WHERE group_name = ?', req.params.groupName);
    for (const p of players) {
        await db.run('UPDATE players SET override_url = ?, override_until = ? WHERE id = ?', url, until || null, p.id);
        await audit(db, 'override_set', p.id, p.name, {url, until: until || null, via_group: req.params.groupName});
    }
    res.json({message: `Override set for ${players.length} players`});
});

router.delete('/group/:groupName/override', async (req, res) => {
    const db = getDb();
    const players = await db.all('SELECT * FROM players WHERE group_name = ?', req.params.groupName);
    for (const p of players) {
        await db.run('UPDATE players SET override_url = NULL, override_until = NULL WHERE id = ?', p.id);
        await audit(db, 'override_cleared', p.id, p.name, {via_group: req.params.groupName});
    }
    res.json({message: `Override cleared for ${players.length} players`});
});

// ── Delete player ─────────────────────────────────────────────────────────────
router.delete('/player/:playerId', async (req, res) => {
    const db = getDb();
    const player = await db.get('SELECT * FROM players WHERE id = ?', req.params.playerId);
    await db.run('DELETE FROM schedules WHERE player_id = ?', req.params.playerId);
    await db.run('DELETE FROM players WHERE id = ?', req.params.playerId);
    if (player) await audit(db, 'player_deleted', player.id, player.name, null);
    res.json({message: 'Player deleted'});
});

// ── Schedule CRUD ─────────────────────────────────────────────────────────────
router.post('/player/:playerId/schedule', async (req, res) => {
    const db = getDb();
    const { url, start_time, end_time, days, priority } = req.body;
    const player = await db.get('SELECT name FROM players WHERE id = ?', req.params.playerId);
    try {
        await db.run(
            'INSERT INTO schedules (player_id, url, start_time, end_time, days, priority) VALUES (?, ?, ?, ?, ?, ?)',
            req.params.playerId, url, start_time, end_time, JSON.stringify(days), priority || 0
        );
        if (player) await audit(db, 'schedule_added', Number(req.params.playerId), player.name, {url, start_time, end_time});
        res.json({message: 'Schedule added successfully'});
    } catch {
        res.status(400).json({error: 'Invalid data'});
    }
});

router.post('/schedule/:scheduleId', async (req, res) => {
    const db = getDb();
    const { url, start_time, end_time, days, priority } = req.body;
    const existing = await db.get(
        'SELECT s.*, p.name AS player_name FROM schedules s JOIN players p ON p.id = s.player_id WHERE s.id = ?',
        req.params.scheduleId
    );
    try {
        await db.run(
            'UPDATE schedules SET url = ?, start_time = ?, end_time = ?, days = ?, priority = ? WHERE id = ?',
            url, start_time, end_time, JSON.stringify(days), priority ?? existing?.priority ?? 0, req.params.scheduleId
        );
        if (existing) await audit(db, 'schedule_updated', Number(existing.player_id), existing.player_name, {url, start_time, end_time});
        res.json({message: 'Schedule updated'});
    } catch {
        res.status(400).json({error: 'Invalid data'});
    }
});

router.delete('/schedule/:scheduleId', async (req, res) => {
    const db = getDb();
    const existing = await db.get(
        'SELECT s.*, p.name AS player_name FROM schedules s JOIN players p ON p.id = s.player_id WHERE s.id = ?',
        req.params.scheduleId
    );
    await db.run('DELETE FROM schedules WHERE id = ?', req.params.scheduleId);
    if (existing) await audit(db, 'schedule_deleted', Number(existing.player_id), existing.player_name, {url: existing.url});
    res.json({message: 'Schedule deleted'});
});

// ── Templates ─────────────────────────────────────────────────────────────────
router.get('/templates', async (req, res) => {
    const db = getDb();
    const rows = await db.all('SELECT * FROM templates ORDER BY name');
    res.json(rows.map(t => ({...t, days: JSON.parse(t.days)})));
});

router.post('/template', async (req, res) => {
    const db = getDb();
    const { name, url, start_time, end_time, days } = req.body;
    const result = await db.run(
        'INSERT INTO templates (name, url, start_time, end_time, days) VALUES (?, ?, ?, ?, ?)',
        name, url, start_time, end_time, JSON.stringify(days)
    );
    res.json({id: result.lastID, name, url, start_time, end_time, days});
});

router.delete('/template/:id', async (req, res) => {
    const db = getDb();
    await db.run('DELETE FROM templates WHERE id = ?', req.params.id);
    res.json({message: 'Template deleted'});
});

// ── System / auto-update ──────────────────────────────────────────────────────
function playerScriptHash() {
    return crypto.createHash('sha256').update(fs.readFileSync(PLAYER_SCRIPT_PATH)).digest('hex').substring(0, 16);
}

async function getForceFlag(db) {
    const row = await db.get("SELECT value FROM config WHERE key = 'force_update'");
    return row?.value === '1';
}

router.get('/system/player-version', async (req, res) => {
    const db = getDb();
    try {
        const force = await getForceFlag(db);
        res.json({hash: playerScriptHash(), force});
    } catch {
        res.status(404).json({error: 'Player script not found'});
    }
});

router.get('/system/player-script', (req, res) => res.sendFile(PLAYER_SCRIPT_PATH));

// Set force flag so players apply the current server script on next poll
router.post('/system/push-update', async (req, res) => {
    const db = getDb();
    try {
        await db.run("INSERT OR REPLACE INTO config (key, value) VALUES ('force_update', '1')");
        res.json({success: true, hash: playerScriptHash(), force: true});
    } catch (e) {
        res.status(500).json({error: e.message});
    }
});

// Clear the force flag
router.delete('/system/push-update', async (req, res) => {
    const db = getDb();
    await db.run("INSERT OR REPLACE INTO config (key, value) VALUES ('force_update', '0')");
    res.json({success: true, force: false});
});

// Fetch latest player script from GitHub (updates server copy only, does not push to players)
router.post('/system/fetch-from-github', async (req, res) => {
    try {
        const {data} = await axios.get(
            'https://raw.githubusercontent.com/skydive-stockholm/signage/refs/heads/main/player/player.py',
            {timeout: 15000, responseType: 'text'}
        );
        fs.writeFileSync(PLAYER_SCRIPT_PATH, data, 'utf8');
        res.json({success: true, hash: playerScriptHash()});
    } catch (e) {
        res.status(500).json({error: 'GitHub fetch failed: ' + e.message});
    }
});

module.exports = router;

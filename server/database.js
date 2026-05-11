const BetterSqlite = require('better-sqlite3');

let _raw;

// better-sqlite3 uses strict type matching: integer 1 ≠ text '1'.
// The legacy schema stores player_id as TEXT, so coerce integers → strings to match.
function bind(args) {
    return args.flat().map(v => (Number.isInteger(v) ? String(v) : v));
}

// Async shim matching the 'sqlite' package API used throughout the codebase
function makeDb(raw) {
    return {
        exec(sql) {
            raw.exec(sql);
            return Promise.resolve();
        },
        run(sql, ...args) {
            const r = raw.prepare(sql).run(...bind(args));
            return Promise.resolve({ lastID: r.lastInsertRowid, changes: r.changes });
        },
        get(sql, ...args) {
            return Promise.resolve(raw.prepare(sql).get(...bind(args)));
        },
        all(sql, ...args) {
            return Promise.resolve(raw.prepare(sql).all(...bind(args)));
        },
    };
}

let db;

async function initializeDatabase() {
    _raw = new BetterSqlite('./database.sqlite');
    db = makeDb(_raw);

    await db.exec(`
    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT
    );
    CREATE TABLE IF NOT EXISTS players (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT
    );
    CREATE TABLE IF NOT EXISTS schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id TEXT,
      url TEXT,
      start_time TEXT,
      end_time TEXT,
      days TEXT,
      FOREIGN KEY (player_id) REFERENCES players(id)
    );
  `);

    const newTables = [
        `CREATE TABLE IF NOT EXISTS templates (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          url TEXT NOT NULL,
          start_time TEXT NOT NULL,
          end_time TEXT NOT NULL,
          days TEXT NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS audit_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          timestamp TEXT NOT NULL,
          action TEXT NOT NULL,
          player_id INTEGER,
          player_name TEXT,
          details TEXT
        )`,
    ];
    for (const t of newTables) {
        try { await db.exec(t); } catch {}
    }

    const migrations = [
        'ALTER TABLE players ADD COLUMN last_seen TEXT',
        'ALTER TABLE players ADD COLUMN current_url TEXT',
        'ALTER TABLE players ADD COLUMN override_url TEXT',
        'ALTER TABLE players ADD COLUMN override_until TEXT',
        'ALTER TABLE players ADD COLUMN group_name TEXT',
        'ALTER TABLE schedules ADD COLUMN priority INTEGER DEFAULT 0',
    ];
    for (const m of migrations) {
        try { await db.exec(m); } catch {}
    }
}

module.exports = {
    initializeDatabase,
    getDb: () => db,
    db,
};

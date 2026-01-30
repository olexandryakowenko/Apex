import sqlite3 from "sqlite3";
import path from "path";
import fs from "fs";

const DB_PATH = process.env.SQLITE_PATH || path.join(process.cwd(), "data.sqlite");

export function openDb() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const db = new sqlite3.Database(DB_PATH);
  db.serialize(() => {
    db.run(`
      CREATE TABLE IF NOT EXISTS leads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL,
        name TEXT,
        phone TEXT NOT NULL,
        car TEXT,
        message TEXT,
        page TEXT,
        ua TEXT,
        status TEXT NOT NULL DEFAULT 'new',
        internal_note TEXT
      )
    `);
  });
  return db;
}

export function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

export function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

export function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

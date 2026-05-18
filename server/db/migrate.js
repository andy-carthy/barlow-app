'use strict';
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = path.resolve(__dirname, '../../barlow.db');
const SCHEMA_PATH = path.resolve(__dirname, 'schema.sql');

function migrate() {
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
  const db = new Database(DB_PATH);
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  db.exec(schema);
  db.close();
  console.log(`Barlow DB initialized at ./${path.relative(process.cwd(), DB_PATH)}`);
}

migrate();

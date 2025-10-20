// server.js
// Node/Express server that wipes the entire public schema on startup,
// recreates it and creates some base tables. Also contains minimal
// Telegram webhook & send endpoint, and serves static files from ./public.
//
// WARNING: This WILL DELETE ALL DATA in the public schema of the DATABASE_URL.

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const axios = require('axios');
const path = require('path');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || "8217028556:AAFDNQfmRYuUnto4gb2dAUNyWjKanRZldfA";
const WEB_APP_URL = process.env.WEB_APP_URL || "https://wordlybot.xo.je";
const DATABASE_URL = process.env.DATABASE_URL || "postgresql://abolfazl:ZnczfHE6NUZWmPfYtPQjUdsuaseuFoHS@dpg-d3q9nrm3jp1c738f47pg-a.frankfurt-postgres.render.com/wordgame_lbh3";
const PORT = process.env.PORT || 3000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors({ origin: CORS_ORIGIN }));

// Serve static files (put your index.html into ./public)
app.use(express.static(path.join(__dirname, 'public')));

// Postgres pool
const pool = new Pool({
  connectionString: DATABASE_URL,
  // If your host requires SSL (e.g. Render), enable it via ssl: { rejectUnauthorized: false }
  // For many hosted Postgres providers, you need SSL:
  ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
});

async function wipeAndInitDatabase() {
  const client = await pool.connect();
  try {
    console.warn('⚠️  STARTING DATABASE WIPE: Dropping public schema (this deletes ALL data).');
    // Drop public schema and recreate it
    await client.query('BEGIN');
    await client.query('DROP SCHEMA public CASCADE');
    await client.query('CREATE SCHEMA public');
    // Recreate extensions you rely on (if any). Example: uuid-ossp
    // await client.query("CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\";");

    console.log('✅ Database wiped and initial schema created successfully.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error during DB wipe/init:', err);
    throw err;
  } finally {
    client.release();
  }
}



process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully.');
  try { await pool.end(); } catch (e) {}
  process.exit(0);
});

// server.js (fixed)
// - robust DB migrations (adds missing columns if necessary)
// - safe bigint handling (no Infinity/NaN inserted)
// - socket handlers guarded and validated

require('dotenv').config();

const PORT = process.env.PORT || 3000;
const WEB_APP_URL = process.env.WEB_APP_URL || `https://wordlygame.onrender.com`;
const HOST_URL = WEB_APP_URL;

const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const crypto = require('crypto');

// Build connection string (append sslmode=require if not present)
const buildConnectionString = () => {
  let cs = process.env.DATABASE_URL;
  if (cs && !/sslmode=/i.test(cs)) cs += (cs.includes('?') ? '&' : '?') + 'sslmode=require';
  if (cs) return cs;
  const host = process.env.PGHOST, port = process.env.PGPORT || 5432, user = process.env.PGUSER, pass = process.env.PGPASSWORD, db = process.env.PGDATABASE;
  if (host && user && pass && db) return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:${port}/${db}?sslmode=require`;
  return null;
};

const connectionString = buildConnectionString();
const sslEnabled = process.env.PGSSL !== 'false';
const pool = new Pool({
  connectionString,
  ssl: sslEnabled ? { rejectUnauthorized: false } : undefined,
});

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', methods: ['GET','POST'] } });

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// words data
const wordsData = require('./words');

const nowTs = () => Date.now();

// Deck generator (seed by room id so both players get same deck)
const newGameDeckForRoom = (roomId, level = 'medium') => {
  const all = [];
  for (const cat of wordsData.categories) {
    for (const w of cat.words.filter(x => (level ? x.level === level : true))) {
      // normalize spaces in word (optional), keep original text
      all.push({ word: String(w.text), category: cat.name, level: w.level });
    }
  }
  if (!all.length) return [];
  // simple seeded shuffle by roomId
  let seed = 0;
  for (let i = 0; i < roomId.length; i++) seed = (seed * 31 + roomId.charCodeAt(i)) >>> 0;
  const a = all.slice();
  for (let i = a.length - 1; i > 0; i--) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const j = seed % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, Math.min(10, a.length));
};

// --- Robust migrations and schema fixes ---
const ensureSchema = async () => {
  // base tables
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGINT PRIMARY KEY,
      username TEXT,
      first_name TEXT,
      last_name TEXT,
      language_code TEXT,
      photo_url TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      status TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  // ensure column 'level' exists on rooms (older deployments might not have it)
  try {
    await pool.query(`ALTER TABLE rooms ADD COLUMN IF NOT EXISTS level TEXT;`);
  } catch (e) {
    console.warn('Could not add rooms.level column safely:', e.message);
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS room_players (
      room_id TEXT,
      user_id BIGINT,
      role TEXT,
      joined_at TIMESTAMP DEFAULT NOW(),
      PRIMARY KEY (room_id, user_id)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS games (
      id TEXT PRIMARY KEY,
      room_id TEXT,
      deck JSONB,
      level TEXT,
      status TEXT,
      started_at TIMESTAMP,
      finished_at TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS game_states (
      game_id TEXT,
      user_id BIGINT,
      current_index INT DEFAULT 0,
      correct_letters JSONB DEFAULT '[]',
      wrong_letters JSONB DEFAULT '[]',
      hints_used INT DEFAULT 0,
      score INT DEFAULT 0,
      allowed_wrong INT DEFAULT 0,
      timer_ms BIGINT DEFAULT 0,
      last_update TIMESTAMP DEFAULT NOW(),
      PRIMARY KEY (game_id, user_id)
    );
  `);

  // Ensure columns exist that code expects (idempotent additions)
  try {
    await pool.query(`ALTER TABLE rooms ALTER COLUMN status SET DEFAULT 'waiting';`);
  } catch (e) { /* ignore */ }
};

// helper: safe number conversion for bigint fields
const safeBigIntParam = (v, fallback = 0) => {
  // numeric or string numeric -> Number
  let n = typeof v === 'number' ? v : (typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
  if (!Number.isFinite(n)) return fallback;
  // ensure integer
  n = Math.trunc(n);
  // Boundaries: clamp to safe bigint-range if needed (here keep reasonable)
  if (n < 0) n = Math.max(n, fallback);
  return n;
};

// Telegram init placeholder
const verifyTelegramInitData = (initData) => !!initData;

// Health
app.get('/health', async (req, res) => {
  try {
    const r = await pool.query('SELECT 1 AS ok');
    res.json({ ok: true, db: r.rows[0].ok === 1, ts: nowTs() });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'db_unreachable', detail: e.message });
  }
});

// auth endpoint
app.post('/auth/telegram', async (req, res) => {
  const { initData, user } = req.body;
  try {
    if (!verifyTelegramInitData(initData)) return res.status(400).json({ ok: false, error: 'invalid_init' });
    const uid = Number(user?.id);
    if (!uid) return res.status(400).json({ ok: false, error: 'no_user' });

    await pool.query(
      `INSERT INTO users (id, username, first_name, last_name, language_code, photo_url)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (id) DO UPDATE SET username=EXCLUDED.username, first_name=EXCLUDED.first_name,
         last_name=EXCLUDED.last_name, language_code=EXCLUDED.language_code, photo_url=EXCLUDED.photo_url, updated_at=NOW();`,
      [uid, user.username || null, user.first_name || null, user.last_name || null, user.language_code || null, user.photo_url || null]
    );

    res.json({ ok: true });
  } catch (e) {
    console.error('auth error:', e);
    res.status(500).json({ ok: false, error: 'server_error' });
  }
});

// join room (ensures both players are notified)
app.post('/rooms/join', async (req, res) => {
  const { user_id, preferred_level } = req.body;
  if (!user_id) return res.status(400).json({ ok: false, error: 'no_user_id' });
  const level = preferred_level || 'medium';

  try {
    // find waiting room with same level
    let roomId = null;
    const waiting = await pool.query(`SELECT id FROM rooms WHERE status='waiting' AND (level IS NULL OR level=$1) LIMIT 1;`, [level]);
    if (waiting.rows.length) roomId = waiting.rows[0].id;
    else {
      roomId = crypto.randomUUID();
      await pool.query(`INSERT INTO rooms (id, status, level) VALUES ($1, 'waiting', $2);`, [roomId, level]);
    }

    const countRes = await pool.query(`SELECT COUNT(*) AS cnt FROM room_players WHERE room_id=$1;`, [roomId]);
    const cnt = Number(countRes.rows[0].cnt || 0);
    const role = cnt === 0 ? 'p1' : 'p2';

    await pool.query(`INSERT INTO room_players (room_id, user_id, role) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING;`, [roomId, user_id, role]);

    const players = await pool.query(`SELECT user_id, role FROM room_players WHERE room_id=$1 ORDER BY joined_at ASC;`, [roomId]);

    if (players.rows.length >= 2) {
      // if active game doesn't exist create one and notify room
      const existing = await pool.query(`SELECT id FROM games WHERE room_id=$1 AND status='active' LIMIT 1;`, [roomId]);
      if (existing.rows.length === 0) {
        const gameId = crypto.randomUUID();
        const deck = newGameDeckForRoom(roomId, level);
        await pool.query(`INSERT INTO games (id, room_id, deck, level, status, started_at) VALUES ($1,$2,$3::jsonb,$4,'active',NOW());`, [gameId, roomId, JSON.stringify(deck), level]);

        for (const p of players.rows) {
          const firstWord = deck[0]?.word || '';
          const allowedWrong = Math.max(1, Math.ceil(String(firstWord).length * 1.2));
          await pool.query(`INSERT INTO game_states (game_id, user_id, current_index, correct_letters, wrong_letters, hints_used, score, allowed_wrong, timer_ms) VALUES ($1,$2,0,'[]','[]',0,0,$3,0) ON CONFLICT DO NOTHING;`, [gameId, p.user_id, allowedWrong]);
        }

        // update room status
        await pool.query(`UPDATE rooms SET status='playing' WHERE id=$1;`, [roomId]);

        // notify sockets in that room channel
        io.to(roomId).emit('game:started', { game_id: gameId, deck });
        return res.json({ ok: true, room_id: roomId, status: 'ready', game_id: gameId });
      } else {
        const gId = existing.rows[0].id;
        const g = await pool.query(`SELECT deck FROM games WHERE id=$1;`, [gId]);
        await pool.query(`UPDATE rooms SET status='playing' WHERE id=$1;`, [roomId]);
        io.to(roomId).emit('game:started', { game_id: gId, deck: g.rows[0].deck });
        return res.json({ ok: true, room_id: roomId, status: 'ready', game_id: gId });
      }
    }

    res.json({ ok: true, room_id: roomId, status: 'waiting' });
  } catch (e) {
    console.error('rooms/join error:', e);
    res.status(500).json({ ok: false, error: 'server_error' });
  }
});

app.post('/rooms/state', async (req, res) => {
  const { room_id } = req.body;
  if (!room_id) return res.status(400).json({ ok: false, error: 'no_room_id' });
  try {
    const room = await pool.query(`SELECT id, status, level FROM rooms WHERE id=$1;`, [room_id]);
    if (!room.rows.length) return res.status(404).json({ ok: false, error: 'room_not_found' });

    const players = await pool.query(`SELECT user_id, role FROM room_players WHERE room_id=$1 ORDER BY joined_at ASC;`, [room_id]);
    const game = await pool.query(`SELECT id, deck, level, status FROM games WHERE room_id=$1 ORDER BY started_at DESC LIMIT 1;`, [room_id]);

    res.json({ ok: true, room: room.rows[0], players: players.rows, game: game.rows.length ? game.rows[0] : null });
  } catch (e) {
    console.error('rooms/state error:', e);
    res.status(500).json({ ok: false, error: 'server_error' });
  }
});

// --- real-time ---
const roomSockets = new Map();
const socketToMeta = new Map();

io.on('connection', (socket) => {
  socket.on('join-room', ({ room_id, user_id }) => {
    if (!room_id) return;
    socket.join(room_id);
    socketToMeta.set(socket.id, { room_id, user_id });
    if (!roomSockets.has(room_id)) roomSockets.set(room_id, new Set());
    roomSockets.get(room_id).add(socket.id);
    io.to(room_id).emit('room:presence', { count: roomSockets.get(room_id).size });
  });

  socket.on('game:resume', async ({ game_id, user_id }) => {
    try {
      // read and emit safe state
      const gs = await pool.query(`SELECT * FROM game_states WHERE game_id=$1 AND user_id=$2;`, [game_id, user_id]);
      const g = await pool.query(`SELECT * FROM games WHERE id=$1;`, [game_id]);
      if (!gs.rows.length || !g.rows.length) return;
      socket.emit('game:state', { state: gs.rows[0], deck: g.rows[0].deck });
    } catch (e) {
      console.error('game:resume error:', e);
    }
  });

  socket.on('game:guess', async ({ game_id, user_id, letter }) => {
    try {
      // validate inputs
      if (!game_id || !user_id || !letter) return;
      const gsq = await pool.query(`SELECT * FROM game_states WHERE game_id=$1 AND user_id=$2;`, [game_id, user_id]);
      const gq = await pool.query(`SELECT * FROM games WHERE id=$1;`, [game_id]);
      if (!gsq.rows.length || !gq.rows.length) return;
      const gs = gsq.rows[0];
      const deck = gq.rows[0].deck;
      const idx = Number(gs.current_index) || 0;
      const currentWord = String(deck[idx]?.word || '');
      const normalizedLetter = String(letter).trim();
      if (!normalizedLetter || normalizedLetter.length !== 1) return;

      const correctLetters = Array.isArray(gs.correct_letters) ? gs.correct_letters : JSON.parse(gs.correct_letters || '[]');
      const wrongLetters = Array.isArray(gs.wrong_letters) ? gs.wrong_letters : JSON.parse(gs.wrong_letters || '[]');

      if (correctLetters.includes(normalizedLetter) || wrongLetters.includes(normalizedLetter)) {
        socket.emit('game:feedback', { type: 'duplicate', letter: normalizedLetter });
        return;
      }

      const positions = [];
      for (let i = 0; i < currentWord.length; i++) if (currentWord[i] === normalizedLetter) positions.push(i);

      const roomMeta = socketToMeta.get(socket.id);
      const roomId = roomMeta?.room_id;

      if (positions.length > 0) {
        correctLetters.push(normalizedLetter);
        const scoreDelta = 10 * positions.length;
        await pool.query(`UPDATE game_states SET correct_letters=$3::jsonb, score=score+$4, last_update=NOW() WHERE game_id=$1 AND user_id=$2;`, [game_id, user_id, JSON.stringify(correctLetters), scoreDelta]);
        io.to(roomId).emit('game:letter:correct', { user_id, letter: normalizedLetter, positions, scoreDelta });
      } else {
        wrongLetters.push(normalizedLetter);
        await pool.query(`UPDATE game_states SET wrong_letters=$3::jsonb, last_update=NOW() WHERE game_id=$1 AND user_id=$2;`, [game_id, user_id, JSON.stringify(wrongLetters)]);
        io.to(roomId).emit('game:letter:wrong', { user_id, letter: normalizedLetter, wrongCount: wrongLetters.length });
      }

      // solved check
      const uniqueLetters = new Set(currentWord.split(''));
      const solved = [...uniqueLetters].every(l => correctLetters.includes(l));
      if (solved) {
        const nextIndex = idx + 1;
        const deckLen = Array.isArray(deck) ? deck.length : 0;
        if (nextIndex >= deckLen) {
          await pool.query(`UPDATE games SET status='finished', finished_at=NOW() WHERE id=$1;`, [game_id]);
          io.to(roomId).emit('game:finished', { game_id });
        } else {
          const nextWord = String(deck[nextIndex].word || '');
          const allowedWrong = Math.max(1, Math.ceil(nextWord.length * 1.2));
          await pool.query(`UPDATE game_states SET current_index=$3, correct_letters='[]', wrong_letters='[]', allowed_wrong=$4, last_update=NOW() WHERE game_id=$1 AND user_id=$2;`, [game_id, user_id, nextIndex, allowedWrong]);
          // broadcast updated states for both players
          const states = await pool.query(`SELECT user_id, current_index FROM game_states WHERE game_id=$1;`, [game_id]);
          io.to(roomId).emit('game:next', { game_id, by_user: user_id, nextIndex, states: states.rows });
        }
      }
    } catch (e) {
      console.error('game:guess error:', e);
    }
  });

  socket.on('game:hint', async ({ game_id, user_id }) => {
    try {
      if (!game_id || !user_id) return;
      const gsq = await pool.query(`SELECT * FROM game_states WHERE game_id=$1 AND user_id=$2;`, [game_id, user_id]);
      const gq = await pool.query(`SELECT * FROM games WHERE id=$1;`, [game_id]);
      if (!gsq.rows.length || !gq.rows.length) return;
      const gs = gsq.rows[0];
      const deck = gq.rows[0].deck;
      const idx = Number(gs.current_index) || 0;
      const currentWord = String(deck[idx]?.word || '');
      const hintsUsed = Number(gs.hints_used) || 0;
      if (hintsUsed >= 2) { socket.emit('game:feedback', { type:'hint-limit' }); return; }
      const correctLetters = Array.isArray(gs.correct_letters) ? gs.correct_letters : JSON.parse(gs.correct_letters || '[]');
      const candidates = currentWord.split('').filter((l,i,arr) => arr.indexOf(l) === i && !correctLetters.includes(l));
      if (!candidates.length) { socket.emit('game:feedback', { type:'no-hint' }); return; }
      const reveal = candidates[Math.floor(Math.random() * candidates.length)];
      const positions = [];
      for (let i = 0; i < currentWord.length; i++) if (currentWord[i] === reveal) positions.push(i);
      const penalty = Math.max(5, 10 * positions.length);
      correctLetters.push(reveal);
      await pool.query(`UPDATE game_states SET correct_letters=$3::jsonb, hints_used=hints_used+1, score=GREATEST(score-$4,0), last_update=NOW() WHERE game_id=$1 AND user_id=$2;`, [game_id, user_id, JSON.stringify(correctLetters), penalty]);
      const roomMeta = socketToMeta.get(socket.id);
      const roomId = roomMeta?.room_id;
      io.to(roomId).emit('game:hint:reveal', { user_id, letter: reveal, positions, penalty });
    } catch (e) {
      console.error('game:hint error:', e);
    }
  });

  socket.on('game:timer', async ({ game_id, user_id, timer_ms }) => {
    try {
      if (!game_id || !user_id) return;
      const safeMs = safeBigIntParam(timer_ms, 0);
      await pool.query(`UPDATE game_states SET timer_ms=$3, last_update=NOW() WHERE game_id=$1 AND user_id=$2;`, [game_id, user_id, safeMs]);
    } catch (e) {
      console.error('game:timer error:', e);
    }
  });

  socket.on('disconnect', () => {
    const meta = socketToMeta.get(socket.id);
    if (meta) {
      const { room_id } = meta;
      if (roomSockets.has(room_id)) {
        roomSockets.get(room_id).delete(socket.id);
        io.to(room_id).emit('room:presence', { count: roomSockets.get(room_id).size });
      }
    }
    socketToMeta.delete(socket.id);
  });
});

// Boot with DB check and migrations
(async () => {
  try {
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();
    console.log('Postgres reachable. SSL enabled:', !!pool.options.ssl);
  } catch (e) {
    console.error('Postgres connection failed:', e.message);
    process.exit(1);
  }

  try {
    await ensureSchema();
    console.log('DB schema ensured/updated.');
  } catch (e) {
    console.error('Migration error:', e);
    process.exit(1);
  }

  app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

  server.listen(PORT, () => {
    console.log(`Server listening on ${PORT} (HOST_URL=${HOST_URL})`);
  });
})();

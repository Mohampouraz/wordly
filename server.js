// server.js
// Competitive Two-Player Telegram WebApp Game
// Fix: notify both players when second joins; robust PG SSL handling; socket events improved.

require('dotenv').config();

const PORT = process.env.PORT || 3000;
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const WEB_APP_URL = process.env.WEB_APP_URL || `https://wordlygame.onrender.com`;
const HOST_URL = WEB_APP_URL;

const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const crypto = require('crypto');

// PostgreSQL connection builder (adds sslmode=require if needed)
const buildConnectionString = () => {
  let cs = process.env.DATABASE_URL;
  if (cs && !/sslmode=/i.test(cs)) cs += (cs.includes('?') ? '&' : '?') + 'sslmode=require';
  if (cs) return cs;
  const host = process.env.PGHOST;
  const port = process.env.PGPORT || 5432;
  const user = process.env.PGUSER;
  const pass = process.env.PGPASSWORD;
  const db = process.env.PGDATABASE;
  if (host && user && pass && db) {
    return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:${port}/${db}?sslmode=require`;
  }
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
const io = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// words.js must export categories array as before
const wordsData = require('./words');

const nowTs = () => Date.now();

// Deterministic-ish deck generator (seeded by room id to ensure same deck for both)
const newGameDeckForRoom = (roomId, level = 'medium') => {
  const all = [];
  for (const cat of wordsData.categories) {
    for (const w of cat.words.filter((x) => x.level === level)) {
      all.push({ word: w.text, category: cat.name, level: w.level });
    }
  }
  // simple seeded shuffle using roomId
  let seed = 0;
  for (let i = 0; i < roomId.length; i++) seed = (seed * 31 + roomId.charCodeAt(i)) >>> 0;
  const a = all.slice();
  for (let i = a.length - 1; i > 0; i--) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const j = seed % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, 10);
};

// Basic schema creation (idempotent)
const ensureSchema = async () => {
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
      status TEXT, -- waiting | playing | finished
      level TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
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
};

// Placeholder: verify Telegram initData properly in production
const verifyTelegramInitData = (initData) => !!initData;

// Routes
app.get('/health', async (req, res) => {
  try {
    const r = await pool.query('SELECT 1 AS ok');
    res.json({ ok: true, db: r.rows[0].ok === 1, ts: nowTs() });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'db_unreachable', detail: e.message });
  }
});

app.post('/auth/telegram', async (req, res) => {
  const { initData, user } = req.body;
  if (!verifyTelegramInitData(initData)) return res.status(400).json({ ok: false, error: 'invalid_init' });
  const uid = Number(user?.id);
  if (!uid) return res.status(400).json({ ok: false, error: 'no_user' });
  try {
    await pool.query(
      `INSERT INTO users (id, username, first_name, last_name, language_code, photo_url)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (id) DO UPDATE SET
         username=EXCLUDED.username, first_name=EXCLUDED.first_name,
         last_name=EXCLUDED.last_name, language_code=EXCLUDED.language_code,
         photo_url=EXCLUDED.photo_url, updated_at=NOW();`,
      [uid, user.username || null, user.first_name || null, user.last_name || null, user.language_code || null, user.photo_url || null]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: 'server_error' });
  }
});

// Join room: improved to broadcast game start via socket when second joins
app.post('/rooms/join', async (req, res) => {
  const { user_id, preferred_level } = req.body;
  if (!user_id) return res.status(400).json({ ok: false, error: 'no_user_id' });
  const level = preferred_level || 'medium';
  try {
    // try to find waiting room with same level
    let roomId = null;
    const waiting = await pool.query(`SELECT id FROM rooms WHERE status='waiting' AND level=$1 LIMIT 1;`, [level]);
    if (waiting.rows.length) roomId = waiting.rows[0].id;
    else {
      roomId = crypto.randomUUID();
      await pool.query(`INSERT INTO rooms (id, status, level) VALUES ($1, 'waiting', $2);`, [roomId, level]);
    }

    const countRes = await pool.query(`SELECT COUNT(*) AS cnt FROM room_players WHERE room_id=$1;`, [roomId]);
    const cnt = Number(countRes.rows[0].cnt);
    const role = cnt === 0 ? 'p1' : 'p2';

    await pool.query(`INSERT INTO room_players (room_id, user_id, role) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING;`, [roomId, user_id, role]);

    // Re-check players
    const players = await pool.query(`SELECT user_id, role FROM room_players WHERE room_id=$1 ORDER BY joined_at ASC;`, [roomId]);

    if (players.rows.length >= 2) {
      // Create game if not exists
      const existingGame = await pool.query(`SELECT id FROM games WHERE room_id=$1 AND status='active' LIMIT 1;`, [roomId]);
      if (existingGame.rows.length === 0) {
        const gameId = crypto.randomUUID();
        const deck = newGameDeckForRoom(roomId, level);
        await pool.query(`INSERT INTO games (id, room_id, deck, level, status, started_at) VALUES ($1,$2,$3::jsonb,$4,'active',NOW());`, [gameId, roomId, JSON.stringify(deck), level]);

        // initialize both players game_state
        for (const p of players.rows) {
          const firstWord = deck[0].word;
          const allowedWrong = Math.ceil(firstWord.length * 1.2);
          await pool.query(
            `INSERT INTO game_states (game_id,user_id,current_index,correct_letters,wrong_letters,hints_used,score,allowed_wrong,timer_ms)
             VALUES ($1,$2,0,'[]','[]',0,0,$3,0) ON CONFLICT DO NOTHING;`,
            [gameId, p.user_id, allowedWrong]
          );
        }

        // Notify via socket to the room that game started (if sockets connected)
        // Send deck and gameId to everyone listening in that room channel
        io.to(roomId).emit('game:started', { game_id: gameId, deck });
        // Mark room playing
        await pool.query(`UPDATE rooms SET status='playing' WHERE id=$1;`, [roomId]);

        // Return response with started status
        return res.json({ ok: true, room_id: roomId, status: 'ready', game_id: gameId });
      } else {
        // game already exists
        const gId = existingGame.rows[0].id;
        const g = await pool.query(`SELECT deck FROM games WHERE id=$1;`, [gId]);
        io.to(roomId).emit('game:started', { game_id: gId, deck: g.rows[0].deck });
        await pool.query(`UPDATE rooms SET status='playing' WHERE id=$1;`, [roomId]);
        return res.json({ ok: true, room_id: roomId, status: 'ready', game_id: gId });
      }
    }

    res.json({ ok: true, room_id: roomId, status: 'waiting' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: 'server_error', detail: e.message });
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
    console.error(e);
    res.status(500).json({ ok: false, error: 'server_error' });
  }
});

// Real-time socket handling
const roomSockets = new Map();
const socketToUser = new Map();

io.on('connection', (socket) => {
  socket.on('join-room', ({ room_id, user_id }) => {
    if (!room_id) return;
    socket.join(room_id);
    socketToUser.set(socket.id, { room_id, user_id });
    if (!roomSockets.has(room_id)) roomSockets.set(room_id, new Set());
    roomSockets.get(room_id).add(socket.id);
    io.to(room_id).emit('room:presence', { count: roomSockets.get(room_id).size });
  });

  socket.on('game:resume', async ({ game_id, user_id }) => {
    try {
      const gs = await pool.query(`SELECT * FROM game_states WHERE game_id=$1 AND user_id=$2;`, [game_id, user_id]);
      const g = await pool.query(`SELECT * FROM games WHERE id=$1;`, [game_id]);
      if (!gs.rows.length || !g.rows.length) return;
      socket.emit('game:state', { state: gs.rows[0], deck: g.rows[0].deck });
    } catch (e) {
      console.error(e);
    }
  });

  socket.on('game:guess', async ({ game_id, user_id, letter }) => {
    try {
      const gsq = await pool.query(`SELECT * FROM game_states WHERE game_id=$1 AND user_id=$2;`, [game_id, user_id]);
      const gq = await pool.query(`SELECT * FROM games WHERE id=$1;`, [game_id]);
      if (!gsq.rows.length || !gq.rows.length) return;
      const gs = gsq.rows[0];
      const deck = gq.rows[0].deck;
      const idx = gs.current_index;
      const currentWord = deck[idx].word;
      const normalizedLetter = String(letter).trim();
      if (!normalizedLetter || normalizedLetter.length !== 1) return;

      const correctLetters = Array.isArray(gs.correct_letters) ? gs.correct_letters : JSON.parse(gs.correct_letters || '[]');
      const wrongLetters = Array.isArray(gs.wrong_letters) ? gs.wrong_letters : JSON.parse(gs.wrong_letters || '[]');

      if (correctLetters.includes(normalizedLetter) || wrongLetters.includes(normalizedLetter)) {
        socket.emit('game:feedback', { type: 'duplicate', letter: normalizedLetter });
        return;
      }

      const positions = [];
      for (let i = 0; i < currentWord.length; i++) {
        if (currentWord[i] === normalizedLetter) positions.push(i);
      }

      if (positions.length > 0) {
        correctLetters.push(normalizedLetter);
        const scoreDelta = 10 * positions.length;
        await pool.query(`UPDATE game_states SET correct_letters=$3::jsonb, score=score+$4, last_update=NOW() WHERE game_id=$1 AND user_id=$2;`, [game_id, user_id, JSON.stringify(correctLetters), scoreDelta]);
        // broadcast correct guess to room so opponent UI updates
        const roomId = socketToUser.get(socket.id)?.room_id;
        io.to(roomId).emit('game:letter:correct', { user_id, letter: normalizedLetter, positions, scoreDelta });
      } else {
        wrongLetters.push(normalizedLetter);
        await pool.query(`UPDATE game_states SET wrong_letters=$3::jsonb, last_update=NOW() WHERE game_id=$1 AND user_id=$2;`, [game_id, user_id, JSON.stringify(wrongLetters)]);
        const roomId = socketToUser.get(socket.id)?.room_id;
        io.to(roomId).emit('game:letter:wrong', { user_id, letter: normalizedLetter, wrongCount: wrongLetters.length });
      }

      // check solved
      const uniqueLetters = new Set(currentWord.split(''));
      const solved = [...uniqueLetters].every((l) => correctLetters.includes(l));
      if (solved) {
        const nextIndex = idx + 1;
        if (nextIndex >= deck.length) {
          await pool.query(`UPDATE games SET status='finished', finished_at=NOW() WHERE id=$1;`, [game_id]);
          const roomId = socketToUser.get(socket.id)?.room_id;
          io.to(roomId).emit('game:finished', { game_id });
        } else {
          const nextWord = deck[nextIndex].word;
          const allowedWrong = Math.ceil(nextWord.length * 1.2);
          await pool.query(`UPDATE game_states SET current_index=$3, correct_letters='[]', wrong_letters='[]', allowed_wrong=$4, last_update=NOW() WHERE game_id=$1 AND user_id=$2;`, [game_id, user_id, nextIndex, allowedWrong]);
          const roomId = socketToUser.get(socket.id)?.room_id;
          // broadcast both players next state so both UIs update
          const states = await pool.query(`SELECT user_id, current_index FROM game_states WHERE game_id=$1;`, [game_id]);
          io.to(roomId).emit('game:next', { game_id, by_user: user_id, nextIndex, states: states.rows });
        }
      }
    } catch (e) {
      console.error(e);
    }
  });

  socket.on('game:hint', async ({ game_id, user_id }) => {
    try {
      const gsq = await pool.query(`SELECT * FROM game_states WHERE game_id=$1 AND user_id=$2;`, [game_id, user_id]);
      const gq = await pool.query(`SELECT * FROM games WHERE id=$1;`, [game_id]);
      if (!gsq.rows.length || !gq.rows.length) return;
      const gs = gsq.rows[0];
      const deck = gq.rows[0].deck;
      const idx = gs.current_index;
      const currentWord = deck[idx].word;
      const hintsUsed = Number(gs.hints_used);
      if (hintsUsed >= 2) { socket.emit('game:feedback', { type: 'hint-limit' }); return; }
      const correctLetters = Array.isArray(gs.correct_letters) ? gs.correct_letters : JSON.parse(gs.correct_letters || '[]');
      const candidates = currentWord.split('').filter((l,i,arr)=>arr.indexOf(l)===i && !correctLetters.includes(l));
      if (!candidates.length) { socket.emit('game:feedback', { type: 'no-hint' }); return; }
      const reveal = candidates[Math.floor(Math.random()*candidates.length)];
      const positions = [];
      for (let i=0;i<currentWord.length;i++) if (currentWord[i]===reveal) positions.push(i);
      const penalty = Math.max(5,10*positions.length);
      correctLetters.push(reveal);
      await pool.query(`UPDATE game_states SET correct_letters=$3::jsonb, hints_used=hints_used+1, score=GREATEST(score-$4,0), last_update=NOW() WHERE game_id=$1 AND user_id=$2;`, [game_id, user_id, JSON.stringify(correctLetters), penalty]);
      const roomId = socketToUser.get(socket.id)?.room_id;
      io.to(roomId).emit('game:hint:reveal', { user_id, letter: reveal, positions, penalty });
    } catch (e) {
      console.error(e);
    }
  });

  socket.on('game:timer', async ({ game_id, user_id, timer_ms }) => {
    try {
      await pool.query(`UPDATE game_states SET timer_ms=$3, last_update=NOW() WHERE game_id=$1 AND user_id=$2;`, [game_id, user_id, Math.max(0, Number(timer_ms||0))]);
    } catch (e) { console.error(e); }
  });

  socket.on('disconnect', () => {
    const meta = socketToUser.get(socket.id);
    if (meta) {
      const { room_id } = meta;
      if (roomSockets.has(room_id)) {
        roomSockets.get(room_id).delete(socket.id);
        io.to(room_id).emit('room:presence', { count: roomSockets.get(room_id).size });
      }
    }
    socketToUser.delete(socket.id);
  });
});

// Boot sequence with DB check
(async () => {
  try {
    const c = await pool.connect();
    await c.query('SELECT 1');
    c.release();
    console.log('Postgres connected, SSL enforced:', !!pool.options.ssl);
  } catch (e) {
    console.error('Postgres connection failed:', e.message);
    process.exit(1);
  }
  await ensureSchema();
  app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
  server.listen(PORT, () => console.log(`Server listening on ${PORT}, HOST=${HOST_URL}`));
})();

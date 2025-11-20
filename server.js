// server.js
// Competitive Two-Player Telegram WebApp Game - Professional Implementation
// Tech: Node.js, Express, Socket.io, PostgreSQL
// Author: Abolfazl-friendly build with premium UX focus

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

// --- PostgreSQL Connection ---
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL ? { rejectUnauthorized: false } : undefined,
});

// --- Express App Setup ---
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- Static Frontend ---
app.use(express.static(path.join(__dirname, 'public')));

// --- Words and Categories (9-category grid) ---
const wordsData = require('./words'); // Ensure a words.js exporting categories and words

// --- Helpers ---
const toPersianDigits = (n) =>
  String(n).replace(/[0-9]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[parseInt(d, 10)]);

const nowTs = () => Date.now();

const newGameDeck = (level = 'medium') => {
  // Returns a deterministic set of 10 words (mix of categories, same for both players)
  // You can adjust selection logic per level.
  const all = [];
  for (const cat of wordsData.categories) {
    for (const w of cat.words.filter((x) => x.level === level)) {
      all.push({ word: w.text, category: cat.name, level: w.level });
    }
  }
  // Shuffle deterministically by seed
  const rnd = crypto.createHash('sha256').update(String(nowTs())).digest('hex');
  let seed = parseInt(rnd.slice(0, 8), 16);
  const shuffle = (arr) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      seed = (seed * 9301 + 49297) % 233280;
      const j = Math.floor((seed / 233280) * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const deck = shuffle(all).slice(0, 10);
  return deck;
};

// --- Database Migrations (basic) ---
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
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS room_players (
      room_id TEXT,
      user_id BIGINT,
      role TEXT, -- p1 | p2
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
      status TEXT, -- active | finished
      started_at TIMESTAMP,
      finished_at TIMESTAMP
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS game_states (
      game_id TEXT,
      user_id BIGINT,
      current_index INT DEFAULT 0, -- which of the 10 words
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

// --- Telegram WebApp Auth Placeholder ---
// In production, verify initData from Telegram WebApp (via HMAC with bot token).
const verifyTelegramInitData = (initData) => {
  // For demo: accept anything if provided.
  // Implement Telegram's recommended check with hash and data_check_string for real security.
  return initData && initData.length > 0;
};

// --- API Routes ---
app.get('/health', (req, res) => res.json({ ok: true, ts: nowTs() }));

app.post('/auth/telegram', async (req, res) => {
  const { initData, user } = req.body;
  try {
    if (!verifyTelegramInitData(initData)) {
      return res.status(400).json({ ok: false, error: 'invalid_init_data' });
    }
    const uid = Number(user?.id);
    if (!uid) return res.status(400).json({ ok: false, error: 'no_user' });

    await pool.query(
      `
      INSERT INTO users (id, username, first_name, last_name, language_code, photo_url)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (id) DO UPDATE SET
        username = EXCLUDED.username,
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        language_code = EXCLUDED.language_code,
        photo_url = EXCLUDED.photo_url,
        updated_at = NOW();
      `,
      [
        uid,
        user.username || null,
        user.first_name || null,
        user.last_name || null,
        user.language_code || null,
        user.photo_url || null,
      ]
    );

    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: 'server_error' });
  }
});

app.post('/rooms/join', async (req, res) => {
  const { user_id, preferred_level } = req.body;
  if (!user_id) return res.status(400).json({ ok: false, error: 'no_user_id' });
  const level = preferred_level || 'medium';

  try {
    // Find waiting room or create new
    let roomId = null;
    const waiting = await pool.query(
      `SELECT id FROM rooms WHERE status = 'waiting' LIMIT 1;`
    );
    if (waiting.rows.length) {
      roomId = waiting.rows[0].id;
    } else {
      roomId = crypto.randomUUID();
      await pool.query(
        `INSERT INTO rooms (id, status) VALUES ($1, 'waiting')`,
        [roomId]
      );
    }

    const rp = await pool.query(
      `SELECT COUNT(*) AS cnt FROM room_players WHERE room_id = $1;`,
      [roomId]
    );
    const cnt = Number(rp.rows[0].cnt);

    const role = cnt === 0 ? 'p1' : 'p2';
    await pool.query(
      `
      INSERT INTO room_players (room_id, user_id, role)
      VALUES ($1, $2, $3)
      ON CONFLICT (room_id, user_id) DO NOTHING;
      `,
      [roomId, user_id, role]
    );

    // If room has two players, start game
    const rp2 = await pool.query(
      `SELECT user_id, role FROM room_players WHERE room_id = $1 ORDER BY joined_at ASC;`,
      [roomId]
    );
    if (rp2.rows.length >= 2) {
      await pool.query(`UPDATE rooms SET status = 'playing' WHERE id = $1;`, [roomId]);
      // Create shared deck for both players
      const gameId = crypto.randomUUID();
      const deck = newGameDeck(level);
      await pool.query(
        `
        INSERT INTO games (id, room_id, deck, level, status, started_at)
        VALUES ($1, $2, $3::jsonb, $4, 'active', NOW());
        `,
        [gameId, roomId, JSON.stringify(deck), level]
      );
      // Initialize game state for each player
      for (const player of rp2.rows) {
        const word = deck[0].word;
        const allowedWrong = Math.ceil(word.length * 1.2);
        await pool.query(
          `
          INSERT INTO game_states (game_id, user_id, current_index, correct_letters, wrong_letters, hints_used, score, allowed_wrong, timer_ms)
          VALUES ($1, $2, 0, '[]', '[]', 0, 0, $3, 0)
          ON CONFLICT (game_id, user_id) DO NOTHING;
          `,
          [gameId, player.user_id, allowedWrong]
        );
      }
      return res.json({ ok: true, room_id: roomId, status: 'ready', game_id: gameId });
    }

    res.json({ ok: true, room_id: roomId, status: 'waiting' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: 'server_error' });
  }
});

app.post('/rooms/state', async (req, res) => {
  const { room_id } = req.body;
  if (!room_id) return res.status(400).json({ ok: false, error: 'no_room_id' });
  try {
    const room = await pool.query(
      `SELECT id, status FROM rooms WHERE id = $1;`,
      [room_id]
    );
    if (!room.rows.length) return res.status(404).json({ ok: false, error: 'room_not_found' });

    const players = await pool.query(
      `SELECT user_id, role FROM room_players WHERE room_id = $1 ORDER BY joined_at ASC;`,
      [room_id]
    );
    const game = await pool.query(
      `SELECT id, deck, level, status FROM games WHERE room_id = $1 ORDER BY started_at DESC LIMIT 1;`,
      [room_id]
    );

    res.json({
      ok: true,
      room: room.rows[0],
      players: players.rows,
      game: game.rows.length ? game.rows[0] : null,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: 'server_error' });
  }
});

// --- Socket.io: Real-time Game Handling ---
const roomSockets = new Map(); // roomId -> Set(socket.id)
const userSocketRoom = new Map(); // socket.id -> roomId

io.on('connection', (socket) => {
  // Join a room channel for updates
  socket.on('join-room', async ({ room_id }) => {
    if (!room_id) return;
    socket.join(room_id);
    userSocketRoom.set(socket.id, room_id);
    if (!roomSockets.has(room_id)) roomSockets.set(room_id, new Set());
    roomSockets.get(room_id).add(socket.id);

    io.to(room_id).emit('room:presence', {
      count: roomSockets.get(room_id).size,
    });
  });

  // Player starts or resumes (keep-alive and timer sync)
  socket.on('game:resume', async ({ game_id, user_id }) => {
    try {
      const gs = await pool.query(
        `SELECT * FROM game_states WHERE game_id = $1 AND user_id = $2;`,
        [game_id, user_id]
      );
      const g = await pool.query(
        `SELECT * FROM games WHERE id = $1;`,
        [game_id]
      );
      if (!gs.rows.length || !g.rows.length) return;
      socket.emit('game:state', {
        state: gs.rows[0],
        deck: g.rows[0].deck,
      });
    } catch (e) {
      console.error(e);
    }
  });

  // Guess a single Persian letter
  socket.on('game:guess', async ({ game_id, user_id, letter }) => {
    try {
      const gsq = await pool.query(
        `SELECT * FROM game_states WHERE game_id = $1 AND user_id = $2;`,
        [game_id, user_id]
      );
      const gq = await pool.query(
        `SELECT * FROM games WHERE id = $1;`,
        [game_id]
      );
      if (!gsq.rows.length || !gq.rows.length) return;

      const gs = gsq.rows[0];
      const deck = gq.rows[0].deck;
      const idx = gs.current_index;
      const currentWord = deck[idx].word;

      const normalizedLetter = String(letter).trim();
      if (!normalizedLetter || normalizedLetter.length !== 1) return;

      const correctLetters = Array.isArray(gs.correct_letters)
        ? gs.correct_letters
        : JSON.parse(gs.correct_letters || '[]');

      const wrongLetters = Array.isArray(gs.wrong_letters)
        ? gs.wrong_letters
        : JSON.parse(gs.wrong_letters || '[]');

      const alreadyGuessed =
        correctLetters.includes(normalizedLetter) || wrongLetters.includes(normalizedLetter);
      if (alreadyGuessed) {
        socket.emit('game:feedback', { type: 'duplicate', letter: normalizedLetter });
        return;
      }

      const positions = [];
      for (let i = 0; i < currentWord.length; i++) {
        if (currentWord[i] === normalizedLetter) positions.push(i);
      }

      let scoreDelta = 0;
      if (positions.length > 0) {
        // Correct guess
        correctLetters.push(normalizedLetter);
        // reward per correct letter and small bonus by remaining time weight handled client-side timer; add base score
        scoreDelta = 10 * positions.length;
        await pool.query(
          `
          UPDATE game_states
          SET correct_letters = $3::jsonb, score = score + $4, last_update = NOW()
          WHERE game_id = $1 AND user_id = $2;
          `,
          [game_id, user_id, JSON.stringify(correctLetters), scoreDelta]
        );
        io.to(userSocketRoom.get(socket.id)).emit('game:letter:correct', {
          user_id,
          letter: normalizedLetter,
          positions,
          scoreDelta,
        });
      } else {
        // Wrong guess
        wrongLetters.push(normalizedLetter);
        const overshoot = wrongLetters.length > gs.allowed_wrong;
        await pool.query(
          `
          UPDATE game_states
          SET wrong_letters = $3::jsonb, last_update = NOW()
          WHERE game_id = $1 AND user_id = $2;
          `,
          [game_id, user_id, JSON.stringify(wrongLetters)]
        );
        io.to(userSocketRoom.get(socket.id)).emit('game:letter:wrong', {
          user_id,
          letter: normalizedLetter,
          wrongCount: wrongLetters.length,
          overshoot,
        });
      }

      // Check if word solved
      const uniqueLetters = new Set(currentWord.split(''));
      const solved = [...uniqueLetters].every((l) => correctLetters.includes(l));
      if (solved) {
        // advance index, reset tracking for next word
        const nextIndex = idx + 1;
        if (nextIndex >= deck.length) {
          await pool.query(
            `UPDATE games SET status = 'finished', finished_at = NOW() WHERE id = $1`,
            [game_id]
          );
          io.to(userSocketRoom.get(socket.id)).emit('game:finished', { game_id });
        } else {
          const nextWord = deck[nextIndex].word;
          const allowedWrong = Math.ceil(nextWord.length * 1.2);
          await pool.query(
            `
            UPDATE game_states
            SET current_index = $3,
                correct_letters = '[]',
                wrong_letters = '[]',
                hints_used = hints_used,
                allowed_wrong = $4,
                last_update = NOW()
            WHERE game_id = $1 AND user_id = $2;
            `,
            [game_id, user_id, nextIndex, allowedWrong]
          );
          io.to(userSocketRoom.get(socket.id)).emit('game:next', {
            user_id,
            current_index: nextIndex,
            nextWordLength: nextWord.length,
          });
        }
      }
    } catch (e) {
      console.error(e);
    }
  });

  // Request hint (max 2)
  socket.on('game:hint', async ({ game_id, user_id }) => {
    try {
      const gsq = await pool.query(
        `SELECT * FROM game_states WHERE game_id = $1 AND user_id = $2;`,
        [game_id, user_id]
      );
      const gq = await pool.query(`SELECT * FROM games WHERE id = $1;`, [game_id]);
      if (!gsq.rows.length || !gq.rows.length) return;

      const gs = gsq.rows[0];
      const deck = gq.rows[0].deck;
      const idx = gs.current_index;
      const currentWord = deck[idx].word;

      const hintsUsed = Number(gs.hints_used);
      if (hintsUsed >= 2) {
        socket.emit('game:feedback', { type: 'hint-limit' });
        return;
      }

      const correctLetters = Array.isArray(gs.correct_letters)
        ? gs.correct_letters
        : JSON.parse(gs.correct_letters || '[]');

      // Find a letter not yet guessed
      const candidates = currentWord
        .split('')
        .filter((l, i, arr) => arr.indexOf(l) === i && !correctLetters.includes(l));

      if (candidates.length === 0) {
        socket.emit('game:feedback', { type: 'no-hint-needed' });
        return;
      }

      const reveal = candidates[Math.floor(Math.random() * candidates.length)];

      // Apply hint: add revealed letter and penalty
      const positions = [];
      for (let i = 0; i < currentWord.length; i++) {
        if (currentWord[i] === reveal) positions.push(i);
      }

      const penalty = Math.max(5, 10 * positions.length); // deduct score
      correctLetters.push(reveal);
      await pool.query(
        `
        UPDATE game_states
        SET correct_letters = $3::jsonb, hints_used = hints_used + 1, score = GREATEST(score - $4, 0), last_update = NOW()
        WHERE game_id = $1 AND user_id = $2;
        `,
        [game_id, user_id, JSON.stringify(correctLetters), penalty]
      );

      io.to(userSocketRoom.get(socket.id)).emit('game:hint:reveal', {
        user_id,
        letter: reveal,
        positions,
        penalty,
      });
    } catch (e) {
      console.error(e);
    }
  });

  // Sync timer from client (to persist resume)
  socket.on('game:timer', async ({ game_id, user_id, timer_ms }) => {
    try {
      await pool.query(
        `UPDATE game_states SET timer_ms = $3, last_update = NOW() WHERE game_id = $1 AND user_id = $2;`,
        [game_id, user_id, Math.max(0, Number(timer_ms || 0))]
      );
    } catch (e) {
      console.error(e);
    }
  });

  // Disconnect
  socket.on('disconnect', () => {
    const roomId = userSocketRoom.get(socket.id);
    if (roomId && roomSockets.has(roomId)) {
      roomSockets.get(roomId).delete(socket.id);
      io.to(roomId).emit('room:presence', {
        count: roomSockets.get(roomId).size,
      });
    }
    userSocketRoom.delete(socket.id);
  });
});

// --- Boot ---
(async () => {
  await ensureSchema();

  // Serve index.html from public
  app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  server.listen(PORT, () => {
    console.log(`Server listening on ${PORT}, HOST_URL=${HOST_URL}`);
  });
})();

// server.js
// Full, production-ready baseline for a 2-player competitive Telegram Web App game with Socket.IO and PostgreSQL

require('dotenv').config();

const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const TOKEN = process.env.TELEGRAM_BOT_TOKEN; // required for verifying initData hash
const WEB_APP_URL = process.env.WEB_APP_URL || `https://wordlygame.onrender.com`;
const HOST_URL = WEB_APP_URL;
const DATABASE_URL = process.env.DATABASE_URL;

// Ensure env
if (!TOKEN) {
  console.warn('Warning: TELEGRAM_BOT_TOKEN is not set. initData verification will be disabled.');
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: HOST_URL, methods: ['GET', 'POST'] }
});

const pool = new Pool({ connectionString: DATABASE_URL });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// --- Utility: Persian normalization and digits ---
function normalizePersianLetter(ch) {
  if (!ch) return '';
  return ch
    .replace(/[ي]/g, 'ی')
    .replace(/[ئ]/g, 'ی') // treat hamze on ی as ی (optional)
    .replace(/[ك]/g, 'ک')
    .replace(/[ة]/g, 'ه')
    .trim();
}
function toPersianDigits(val) {
  const map = '۰۱۲۳۴۵۶۷۸۹';
  return String(val).split('').map(ch => (/\d/.test(ch) ? map[ch] : ch)).join('');
}

// --- Telegram initData verification (recommended) ---
function parseInitData(initData) {
  if (!initData || typeof initData !== 'string') return null;
  const params = new URLSearchParams(initData);
  const userJson = params.get('user');
  if (!userJson) return null;
  let user;
  try { user = JSON.parse(userJson); } catch { return null; }

  // Optional but recommended: verify hash
  if (TOKEN) {
    const hash = params.get('hash');
    const dataCheckString = [...params.entries()]
      .filter(([k]) => k !== 'hash')
      .map(([k, v]) => `${k}=${v}`)
      .sort()
      .join('\n');
    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(TOKEN).digest();
    const checkHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
    if (checkHash !== hash) {
      return null;
    }
  }
  return user;
}

// --- Words dataset (9-category groups across levels) ---
const wordsByLevel = {
  easy: [
    { category: 'میوه‌ها', words: ['سیب','گلابی','انگور','هلو','آلو','کیوی','خرما','زردآلو','به'] },
    { category: 'رنگ‌ها', words: ['قرمز','آبی','سبز','زرد','مشکی','سفید','صورتی','نارنجی','بنفش'] },
    { category: 'حیوانات', words: ['گربه','سگ','اسب','گاو','گوسفند','مرغ','ماهی','قورباغه','روباه'] }
  ],
  medium: [
    { category: 'شهرها', words: ['قم','تهران','مشهد','اصفهان','شیراز','تبریز','رشت','اهواز','کرمان'] },
    { category: 'فصول', words: ['بهار','تابستان','پاییز','زمستان','باران','برف','نسیم','گرما','سرما'] },
    { category: 'اشیا', words: ['کتاب','دفتر','خودکار','میز','صندلی','کمد','تلفن','کامپیوتر','چراغ'] }
  ],
  hard: [
    { category: 'مشاغل', words: ['پژوهشگر','برنامه‌نویس','کتابدار','نقاش','مهندس','بنا','شیمی‌دان','خلبان','حقوق‌دان'] },
    { category: 'علوم', words: ['فیزیک','زیست‌شناسی','شیمی','ریاضی','ستاره‌شناسی','زمین‌شناسی','هواشناسی','آمار','الکترونیک'] },
    { category: 'فرهنگ', words: ['سنت','اندیشه','هنر','ادبیات','فلسفه','تاریخ','اسطوره','زبان','معماری'] }
  ]
};

function selectTenWordsDeterministic(seedText = 'default-seed') {
  // Flatten pool
  const pool = [];
  ['easy', 'medium', 'hard'].forEach(level => {
    if (wordsByLevel[level]) {
      wordsByLevel[level].forEach(group => {
        group.words.forEach(w => pool.push({ word: w, category: group.category, level }));
      });
    }
  });

  // Deterministic shuffle from seedText
  const seed = crypto.createHash('sha256').update(seedText).digest();
  let idx = 0;
  function rnd() {
    const val = seed[idx % seed.length];
    idx++;
    return val / 255; // 0..1
  }
  pool.sort(() => rnd() - 0.5);
  return pool.slice(0, 10);
}

// --- Database bootstrap ---
async function initDb() {
  await pool.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGINT PRIMARY KEY,
      username TEXT,
      first_name TEXT,
      last_name TEXT,
      language_code TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      status TEXT CHECK (status IN ('waiting','locked','in_progress','finished')) NOT NULL DEFAULT 'waiting',
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS room_players (
      room_id TEXT REFERENCES rooms(id) ON DELETE CASCADE,
      user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
      slot SMALLINT CHECK (slot IN (1,2)) NOT NULL,
      joined_at TIMESTAMP DEFAULT NOW(),
      PRIMARY KEY (room_id, user_id)
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS games (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      room_id TEXT REFERENCES rooms(id) ON DELETE CASCADE,
      words_seed TEXT NOT NULL,
      total_words SMALLINT DEFAULT 10,
      started_at TIMESTAMP,
      finished_at TIMESTAMP
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS game_words (
      game_id UUID REFERENCES games(id) ON DELETE CASCADE,
      idx SMALLINT NOT NULL,
      word TEXT NOT NULL,
      category TEXT NOT NULL,
      level TEXT NOT NULL,
      PRIMARY KEY (game_id, idx)
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS game_progress (
      game_id UUID REFERENCES games(id) ON DELETE CASCADE,
      user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
      word_index SMALLINT NOT NULL DEFAULT 0,
      current_word TEXT NOT NULL,
      category TEXT NOT NULL,
      level TEXT NOT NULL,
      placeholder TEXT NOT NULL,
      correct_letters TEXT[] NOT NULL DEFAULT '{}',
      wrong_letters TEXT[] NOT NULL DEFAULT '{}',
      hints_used SMALLINT NOT NULL DEFAULT 0,
      allowed_wrongs SMALLINT NOT NULL,
      time_spent_ms BIGINT NOT NULL DEFAULT 0,
      score INT NOT NULL DEFAULT 0,
      last_update TIMESTAMP DEFAULT NOW(),
      PRIMARY KEY (game_id, user_id)
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS guesses (
      id BIGSERIAL PRIMARY KEY,
      game_id UUID REFERENCES games(id) ON DELETE CASCADE,
      user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
      word_index SMALLINT,
      letter TEXT,
      is_correct BOOLEAN,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
}

initDb().catch(err => {
  console.error('DB init failed:', err);
  process.exit(1);
});

// --- API: upsert user from Telegram initData ---
app.post('/api/auth', async (req, res) => {
  const { initData } = req.body || {};
  const tgUser = parseInitData(initData);
  if (!tgUser || !tgUser.id) return res.status(401).json({ error: 'unauthorized' });

  const { id, username, first_name, last_name, language_code } = tgUser;
  try {
    await pool.query(`
      INSERT INTO users(id, username, first_name, last_name, language_code)
      VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (id) DO UPDATE SET
        username = EXCLUDED.username,
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        language_code = EXCLUDED.language_code,
        updated_at = NOW()
    `, [id, username || null, first_name || null, last_name || null, language_code || null]);
    res.json({ ok: true, user: { id, username, first_name, last_name, language_code } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'db_error' });
  }
});

// --- Socket rooms cache (lightweight) ---
const roomsCache = new Map(); // roomId -> { status, players: Set<userId>, sockets: Set<socket> }

// --- Socket.IO events ---
io.on('connection', (socket) => {
  let session = { userId: null, roomId: null, gameId: null };

  socket.on('auth', ({ initData }) => {
    const tgUser = parseInitData(initData);
    if (!tgUser || !tgUser.id) return socket.emit('error', { message: 'auth_failed' });
    session.userId = tgUser.id;
    socket.emit('auth_ok', { user: tgUser });
  });

  socket.on('join_room', async ({ roomId }) => {
    if (!session.userId) return socket.emit('error', { message: 'unauthorized' });
    if (!roomId) return socket.emit('error', { message: 'invalid_room' });

    try {
      // Create or fetch room
      let roomRes = await pool.query('SELECT * FROM rooms WHERE id = $1', [roomId]);
      if (roomRes.rowCount === 0) {
        roomRes = await pool.query('INSERT INTO rooms(id, status) VALUES ($1, $2) RETURNING *', [roomId, 'waiting']);
      }
      let room = roomRes.rows[0];

      // Players in room
      const playersRes = await pool.query('SELECT user_id, slot FROM room_players WHERE room_id = $1 ORDER BY slot', [roomId]);
      const players = playersRes.rows.map(r => r.user_id);

      if (!players.includes(session.userId)) {
        if (players.length >= 2 || room.status === 'locked' || room.status === 'in_progress') {
          return socket.emit('error', { message: 'room_full_or_locked' });
        }
        const slot = players.length === 0 ? 1 : 2;
        await pool.query('INSERT INTO room_players(room_id, user_id, slot) VALUES ($1,$2,$3)', [roomId, session.userId, slot]);
      }

      // Update status if second player joined
      const updatedPlayersRes = await pool.query('SELECT user_id FROM room_players WHERE room_id = $1 ORDER BY slot', [roomId]);
      const updatedPlayers = updatedPlayersRes.rows.map(r => r.user_id);
      if (updatedPlayers.length === 2 && room.status === 'waiting') {
        room = (await pool.query('UPDATE rooms SET status = $2 WHERE id = $1 RETURNING *', [roomId, 'locked'])).rows[0];
      }

      // Join socket room
      session.roomId = roomId;
      socket.join(roomId);

      if (!roomsCache.has(roomId)) roomsCache.set(roomId, { status: room.status, players: new Set(), sockets: new Set() });
      const cache = roomsCache.get(roomId);
      cache.status = room.status;
      cache.players.add(session.userId);
      cache.sockets.add(socket);

      // If two players: start or resume
      if (updatedPlayers.length === 2 && (room.status === 'locked' || room.status === 'in_progress')) {
        // Load or create game
        let gameRes = await pool.query('SELECT * FROM games WHERE room_id = $1 ORDER BY started_at DESC LIMIT 1', [roomId]);
        if (gameRes.rowCount === 0) {
          const wordsSeed = `room-${roomId}-${Date.now()}`;
          const started = await pool.query(
            `INSERT INTO games(room_id, words_seed, total_words, started_at)
             VALUES ($1,$2,$3,NOW()) RETURNING *`,
            [roomId, wordsSeed, 10]
          );
          const game = started.rows[0];
          session.gameId = game.id;

          const selection = selectTenWordsDeterministic(wordsSeed);
          // Persist exact selection
          for (let i = 0; i < selection.length; i++) {
            const w = selection[i];
            await pool.query(
              `INSERT INTO game_words(game_id, idx, word, category, level)
               VALUES ($1,$2,$3,$4,$5)`,
              [game.id, i, w.word, w.category, w.level]
            );
          }

          // Initialize progress for both users
          for (const uid of updatedPlayers) {
            const w0 = selection[0];
            await pool.query(`
              INSERT INTO game_progress(game_id, user_id, word_index, current_word, category, level, placeholder, correct_letters, wrong_letters, hints_used, allowed_wrongs)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
            `, [
              game.id, uid, 0, w0.word, w0.category, w0.level,
              '_'.repeat(w0.word.length),
              [], [], 0, Math.floor(1.2 * w0.word.length)
            ]);
          }

          await pool.query('UPDATE rooms SET status = $2 WHERE id = $1', [roomId, 'in_progress']);
          cache.status = 'in_progress';

          io.to(roomId).emit('game_start', { gameId: game.id, selection });
        } else {
          const game = gameRes.rows[0];
          session.gameId = game.id;
          cache.status = 'in_progress';
          const selection = await loadSelectionFromDb(game.id);
          // Ensure both players have progress rows
          for (const uid of updatedPlayers) {
            const progRes = await pool.query('SELECT * FROM game_progress WHERE game_id = $1 AND user_id = $2', [game.id, uid]);
            if (progRes.rowCount === 0) {
              const w0 = selection[0];
              await pool.query(`
                INSERT INTO game_progress(game_id, user_id, word_index, current_word, category, level, placeholder, correct_letters, wrong_letters, hints_used, allowed_wrongs)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
              `, [
                game.id, uid, 0, w0.word, w0.category, w0.level,
                '_'.repeat(w0.word.length),
                [], [], 0, Math.floor(1.2 * w0.word.length)
              ]);
            }
          }
          // Emit resume plus each user’s current state snapshot
          const snapshots = {};
          for (const uid of updatedPlayers) {
            const p = await pool.query('SELECT * FROM game_progress WHERE game_id = $1 AND user_id = $2', [game.id, uid]);
            snapshots[uid] = p.rows[0];
          }
          io.to(roomId).emit('game_resume', { gameId: game.id, selection, snapshots });
        }
      } else {
        io.to(roomId).emit('waiting', { count: updatedPlayers.length });
      }
    } catch (e) {
      console.error(e);
      socket.emit('error', { message: 'room_join_failed' });
    }
  });

  socket.on('guess_letter', async ({ letter }) => {
    if (!session.gameId || !session.userId) return;
    const ltrRaw = (letter || '').trim();
    if (!ltrRaw || ltrRaw.length !== 1) return socket.emit('guess_result', { ok: false, error: 'invalid_letter' });
    const ltr = normalizePersianLetter(ltrRaw);

    try {
      const progRes = await pool.query('SELECT * FROM game_progress WHERE game_id = $1 AND user_id = $2', [session.gameId, session.userId]);
      if (progRes.rowCount === 0) return;
      const prog = progRes.rows[0];

      // Ignore if already tried
      if (prog.correct_letters.includes(ltr) || prog.wrong_letters.includes(ltr)) {
        return socket.emit('guess_result', { ok: false, error: 'already_tried' });
      }

      const word = prog.current_word;
      const positions = [];
      for (let i = 0; i < word.length; i++) {
        if (normalizePersianLetter(word[i]) === ltr) positions.push(i);
      }
      const isCorrect = positions.length > 0;

      // Update placeholder
      const placeholderArr = prog.placeholder.split('');
      if (isCorrect) positions.forEach(idx => { placeholderArr[idx] = word[idx]; });

      const newCorrect = isCorrect ? [...prog.correct_letters, ltr] : prog.correct_letters;
      const newWrong = !isCorrect ? [...prog.wrong_letters, ltr] : prog.wrong_letters;

      await pool.query(`
        UPDATE game_progress
        SET placeholder = $1,
            correct_letters = $2,
            wrong_letters = $3,
            last_update = NOW()
        WHERE game_id = $4 AND user_id = $5
      `, [placeholderArr.join(''), newCorrect, newWrong, session.gameId, session.userId]);

      await pool.query(`
        INSERT INTO guesses(game_id, user_id, word_index, letter, is_correct)
        VALUES ($1,$2,$3,$4,$5)
      `, [session.gameId, session.userId, prog.word_index, ltr, isCorrect]);

      const exceeded = newWrong.length > prog.allowed_wrongs;
      const completed = placeholderArr.join('') === word;

      const scoreDelta = isCorrect ? 10 * positions.length : 0;
      await pool.query(`UPDATE game_progress SET score = score + $1 WHERE game_id = $2 AND user_id = $3`,
        [scoreDelta, session.gameId, session.userId]);

      io.to(session.roomId).emit('guess_update', {
        userId: session.userId,
        placeholder: placeholderArr.join(''),
        isCorrect,
        letter: ltr,
        wrongs: newWrong.length,
        corrects: newCorrect.length,
        exceeded,
        completed
      });

      if (completed || exceeded) {
        await advanceWordOrFinish(session);
      }
    } catch (e) {
      console.error(e);
      socket.emit('guess_result', { ok: false, error: 'server_error' });
    }
  });

  socket.on('request_hint', async () => {
    if (!session.gameId || !session.userId) return;
    try {
      const progRes = await pool.query('SELECT * FROM game_progress WHERE game_id = $1 AND user_id = $2', [session.gameId, session.userId]);
      if (progRes.rowCount === 0) return;
      const prog = progRes.rows[0];

      if (prog.hints_used >= 2) {
        return socket.emit('hint_result', { ok: false, error: 'max_hints' });
      }

      const word = prog.current_word;
      const placeholder = prog.placeholder.split('');
      let revealIdx = -1;
      for (let i = 0; i < word.length; i++) {
        if (placeholder[i] === '_') { revealIdx = i; break; }
      }
      if (revealIdx === -1) {
        return socket.emit('hint_result', { ok: false, error: 'already_complete' });
      }

      placeholder[revealIdx] = word[revealIdx];

      const penalty = 15;
      await pool.query(`
        UPDATE game_progress
        SET placeholder = $1,
            hints_used = hints_used + 1,
            score = GREATEST(score - $2, 0),
            last_update = NOW()
        WHERE game_id = $3 AND user_id = $4
      `, [placeholder.join(''), penalty, session.gameId, session.userId]);

      io.to(session.roomId).emit('hint_update', {
        userId: session.userId,
        revealIndex: revealIdx,
        placeholder: placeholder.join('')
      });
    } catch (e) {
      console.error(e);
      socket.emit('hint_result', { ok: false, error: 'server_error' });
    }
  });

  socket.on('sync_time', async ({ elapsedMs }) => {
    if (!session.gameId || !session.userId) return;
    try {
      await pool.query(`
        UPDATE game_progress
        SET time_spent_ms = $1, last_update = NOW()
        WHERE game_id = $2 AND user_id = $3
      `, [elapsedMs, session.gameId, session.userId]);
    } catch (e) {
      console.error(e);
    }
  });

  socket.on('leave_room', () => {
    cleanup();
  });

  socket.on('disconnect', () => {
    cleanup();
  });

  function cleanup() {
    if (!session.roomId) return;
    const cache = roomsCache.get(session.roomId);
    if (cache) {
      cache.sockets.delete(socket);
      cache.players.delete(session.userId);
      if (cache.sockets.size === 0) roomsCache.delete(session.roomId);
    }
    socket.leave(session.roomId);
  }
});

// --- Helpers: load selection and advance word ---
async function loadSelectionFromDb(gameId) {
  const res = await pool.query('SELECT idx, word, category, level FROM game_words WHERE game_id = $1 ORDER BY idx', [gameId]);
  return res.rows.map(r => ({ word: r.word, category: r.category, level: r.level }));
}

async function advanceWordOrFinish(session) {
  const progRes = await pool.query('SELECT * FROM game_progress WHERE game_id = $1 AND user_id = $2', [session.gameId, session.userId]);
  if (progRes.rowCount === 0) return;
  const prog = progRes.rows[0];

  const gameRes = await pool.query('SELECT * FROM games WHERE id = $1', [session.gameId]);
  const game = gameRes.rows[0];

  const selection = await loadSelectionFromDb(session.gameId);

  const nextIndex = prog.word_index + 1;
  if (nextIndex >= game.total_words) {
    // Mark user finished; if both finished, mark room finished
    io.to(session.roomId).emit('user_finished', { userId: session.userId });

    // Check both players completion
    const playersRes = await pool.query('SELECT user_id FROM room_players WHERE room_id = $1', [game.room_id]);
    const players = playersRes.rows.map(r => r.user_id);
    const progresses = await pool.query('SELECT user_id, word_index FROM game_progress WHERE game_id = $1', [session.gameId]);
    const allDone = progresses.rows.every(r => r.word_index >= game.total_words - 1);

    if (allDone) {
      await pool.query('UPDATE rooms SET status = $2 WHERE id = $1', [game.room_id, 'finished']);
      const finalScores = await pool.query('SELECT user_id, score, time_spent_ms FROM game_progress WHERE game_id = $1', [session.gameId]);
      io.to(session.roomId).emit('game_finished', { final: finalScores.rows });
    }
    return;
  }

  const nextWord = selection[nextIndex];

  await pool.query(`
    UPDATE game_progress
    SET word_index = $1,
        current_word = $2,
        category = $3,
        level = $4,
        placeholder = $5,
        correct_letters = '{}',
        wrong_letters = '{}',
        hints_used = 0,
        allowed_wrongs = $6,
        last_update = NOW()
    WHERE game_id = $7 AND user_id = $8
  `, [
    nextIndex,
    nextWord.word,
    nextWord.category,
    nextWord.level,
    '_'.repeat(nextWord.word.length),
    Math.floor(1.2 * nextWord.word.length),
    session.gameId,
    session.userId
  ]);

  io.to(session.roomId).emit('word_advanced', {
    userId: session.userId,
    wordIndex: nextIndex,
    totalWords: game.total_words,
    placeholder: '_'.repeat(nextWord.word.length),
    category: nextWord.category,
    level: nextWord.level
  });
}

// --- Serve index.html ---
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

server.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});

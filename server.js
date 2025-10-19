/**
 * server.js
 * Node + Express + pg + Socket.IO + Axios (برای تماس با Telegram API)
 *
 * نصب وابستگی‌ها:
 *   npm i express pg socket.io axios cors uuid
 *
 * راه‌اندازی:
 *   PORT, DATABASE_URL, TELEGRAM_BOT_TOKEN, WEB_APP_URL را تنظیم کنید.
 *
 * توضیح: اگر CLEAR_DB=true باشد، همهٔ جداول پاک شده و اسکیمای جدید ایجاد می‌شود.
 */

const express = require('express');
const http = require('http');
const { Pool } = require('pg');
const axios = require('axios');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(express.json());
app.use(cors());

// ENV
const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL || process.env.DATABASE || '';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const WEB_APP_URL = process.env.WEB_APP_URL || 'https://wordlybot.xo.je';
const CLEAR_DB = (process.env.CLEAR_DB || 'false').toLowerCase() === 'true';

if (!DATABASE_URL) {
  console.error('ERROR: DATABASE_URL not set.');
  process.exit(1);
}
if (!TELEGRAM_BOT_TOKEN) {
  console.warn('Warning: TELEGRAM_BOT_TOKEN not set — telegram webhook disabled until provided.');
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
});

// ---------- Database setup / reset ----------
async function resetAndSeedDB() {
  const client = await pool.connect();
  try {
    console.log('Resetting database...');

    // drop all user tables (safe-ish approach: drop known tables)
    await client.query(`
      drop table if exists guesses cascade;
      drop table if exists game_players cascade;
      drop table if exists games cascade;
      drop table if exists words cascade;
      drop table if exists categories cascade;
      drop table if exists users cascade;
    `);

    // create tables
    await client.query(`
      create table users (
        id uuid primary key,
        telegram_id text,
        name text,
        created_at timestamptz default now()
      );

      create table categories (
        id uuid primary key,
        name text not null
      );

      create table words (
        id uuid primary key,
        category_id uuid references categories(id) on delete cascade,
        word text not null,
        created_by uuid references users(id),
        created_at timestamptz default now()
      );

      create table games (
        id uuid primary key,
        word_id uuid references words(id),
        creator_id uuid references users(id),
        started_at timestamptz,
        finished_at timestamptz,
        attempts_allowed int,
        attempts_left int,
        guessed_letters text[], -- array of letters guessed
        revealed boolean[], -- parallel to letters of word (true if revealed)
        hints_used int default 0,
        score int default 0,
        status text default 'waiting', -- waiting, playing, finished
        created_at timestamptz default now()
      );

      create table game_players (
        id uuid primary key,
        game_id uuid references games(id) on delete cascade,
        user_id uuid references users(id),
        role text, -- creator | guesser | player
        joined_at timestamptz default now()
      );

      create table guesses (
        id uuid primary key,
        game_id uuid references games(id) on delete cascade,
        user_id uuid references users(id),
        letter text,
        correct boolean,
        created_at timestamptz default now()
      );
    `);

    // seed categories + words (مثال)
    const cat1 = uuidv4();
    const cat2 = uuidv4();
    await client.query(`insert into categories (id, name) values ($1,$2),($3,$4)`, [cat1,'Animals', cat2,'Everyday']);

    // insert some sample words (lowercase)
    const sampleWords = [
      { cat: cat1, w: 'elephant' },
      { cat: cat1, w: 'giraffe' },
      { cat: cat2, w: 'computer' },
      { cat: cat2, w: 'notebook' },
      { cat: cat2, w: 'bicycle' }
    ];
    for (let s of sampleWords) {
      const id = uuidv4();
      await client.query(`insert into words (id, category_id, word) values ($1,$2,$3)`, [id, s.cat, s.w]);
    }

    console.log('DB reset + seeded.');
  } finally {
    client.release();
  }
}

// Run DB reset if requested
(async () => {
  try {
    await pool.connect();
    if (CLEAR_DB) await resetAndSeedDB();
  } catch (err) {
    console.error('DB init error:', err);
    process.exit(1);
  }
})();

// ---------- Utility functions ----------
function maskWord(word, revealed) {
  // revealed: boolean[] same length; if undefined -> all false
  if (!revealed) revealed = Array.from({length: word.length}, ()=>false);
  let arr = word.split('');
  return arr.map((ch, i) => (revealed[i] ? ch : '_')).join('');
}

function computeScore(wordLength, correctCount, elapsedSeconds, attemptsLeft, attemptsAllowed) {
  // Example formula:
  // timeFactor: faster => higher => clamp between 0.1..1
  const maxTime = Math.max(10, wordLength * 10); // seconds baseline
  let timeFactor = Math.max(0.1, (maxTime - Math.min(elapsedSeconds, maxTime)) / maxTime);
  // correctnessFactor: fraction of letters revealed
  let correctnessFactor = correctCount / wordLength;
  // attemptsFactor: some bonus for remaining attempts
  let attemptsFactor = 1 + (attemptsLeft / Math.max(1, attemptsAllowed)) * 0.5;
  const base = 100 * wordLength;
  const raw = Math.round(base * correctnessFactor * (0.6 + 0.4 * timeFactor) * attemptsFactor);
  return Math.max(0, raw);
}

// ---------- API: categories / words ----------
app.get('/api/categories', async (req, res) => {
  const { rows } = await pool.query('select id, name from categories order by name');
  res.json(rows);
});

app.get('/api/words', async (req, res) => {
  // for challenge list - we only return id, category, masked length
  const { category } = req.query;
  const q = category
    ? 'select w.id, w.word, c.name as category from words w join categories c on w.category_id=c.id where c.id=$1'
    : 'select w.id, w.word, c.name as category from words w join categories c on w.category_id=c.id';
  const params = category ? [category] : [];
  const { rows } = await pool.query(q, params);
  // do NOT send raw words to client in production for real challenges; here we send only length
  const out = rows.map(r => ({ id: r.id, length: r.word.length, category: r.category }));
  res.json(out);
});

// ---------- API: start game ----------
app.post('/api/game/start', async (req, res) => {
  // body: { wordId, creatorTelegramId (optional), creatorName(optional) }
  const { wordId, creatorTelegramId, creatorName } = req.body;
  if (!wordId) return res.status(400).json({ error: 'wordId required' });

  // ensure user exists (simple)
  let userId = null;
  if (creatorTelegramId) {
    const r = await pool.query('select id from users where telegram_id=$1', [creatorTelegramId]);
    if (r.rows.length) userId = r.rows[0].id;
    else {
      userId = uuidv4();
      await pool.query('insert into users (id, telegram_id, name) values ($1,$2,$3)', [userId, creatorTelegramId, creatorName || null]);
    }
  }

  const wordRow = await pool.query('select word from words where id=$1', [wordId]);
  if (!wordRow.rows.length) return res.status(404).json({ error: 'word not found' });
  const word = wordRow.rows[0].word.toLowerCase();

  const attemptsAllowed = Math.ceil(1.5 * word.length);
  const revealed = Array.from({length: word.length}, ()=>false);
  const gameId = uuidv4();
  await pool.query(`insert into games (id, word_id, creator_id, attempts_allowed, attempts_left, guessed_letters, revealed, status, started_at)
                   values ($1,$2,$3,$4,$5,$6,$7,$8, now())`,
                   [gameId, wordId, userId, attemptsAllowed, attemptsAllowed, [], revealed, 'playing']);

  // add creator as player
  if (userId) {
    await pool.query(`insert into game_players (id, game_id, user_id, role) values ($1,$2,$3,$4)`, [uuidv4(), gameId, userId, 'creator']);
  }

  res.json({ gameId, length: word.length, attemptsAllowed });
});

// ---------- API: get game state ----------
app.get('/api/game/:gameId', async (req, res) => {
  const { gameId } = req.params;
  const g = await pool.query('select * from games where id=$1', [gameId]);
  if (!g.rows.length) return res.status(404).json({ error: 'game not found' });
  const game = g.rows[0];
  // fetch word text
  const w = await pool.query('select word from words where id=$1', [game.word_id]);
  const word = w.rows[0].word;
  const revealed = game.revealed || Array.from({length: word.length}, ()=>false);
  const masked = maskWord(word, revealed);
  // players
  const players = (await pool.query('select gp.*, u.name from game_players gp left join users u on gp.user_id=u.id where gp.game_id=$1', [gameId])).rows;
  res.json({
    id: game.id,
    masked,
    length: word.length,
    attemptsAllowed: game.attempts_allowed,
    attemptsLeft: game.attempts_left,
    guessedLetters: game.guessed_letters || [],
    hintsUsed: game.hints_used,
    status: game.status,
    score: game.score,
    players
  });
});

// ---------- API: guess letter ----------
app.post('/api/game/:gameId/guess', async (req, res) => {
  // body: { letter, userTelegramId, userName }
  const { gameId } = req.params;
  const { letter, userTelegramId, userName } = req.body;
  if (!letter || letter.length !== 1) return res.status(400).json({ error: 'single letter required' });
  const ch = letter.toLowerCase();

  const client = await pool.connect();
  try {
    await client.query('begin');

    // ensure user
    let userId = null;
    if (userTelegramId) {
      const r = await client.query('select id from users where telegram_id=$1', [userTelegramId]);
      if (r.rows.length) userId = r.rows[0].id;
      else { userId = uuidv4(); await client.query('insert into users (id, telegram_id, name) values ($1,$2,$3)', [userId, userTelegramId, userName || null]); }
    }

    const gq = await client.query('select * from games where id=$1 for update', [gameId]);
    if (!gq.rows.length) { await client.query('rollback'); return res.status(404).json({ error: 'game not found' }); }
    const game = gq.rows[0];
    if (game.status !== 'playing') { await client.query('rollback'); return res.status(400).json({ error: 'game not active' }); }
    if (game.attempts_left <= 0) { await client.query('rollback'); return res.status(400).json({ error: 'no attempts left' }); }

    const wr = await client.query('select word from words where id=$1', [game.word_id]);
    const word = wr.rows[0].word.toLowerCase();

    const guessed = new Set((game.guessed_letters || []).map(x => x.toLowerCase()));
    if (guessed.has(ch)) {
      await client.query('rollback');
      return res.status(400).json({ error: 'letter already guessed' });
    }

    // check correct positions
    let correctPositions = [];
    for (let i=0;i<word.length;i++){
      if (word[i] === ch) correctPositions.push(i);
    }
    const isCorrect = correctPositions.length > 0;
    // update guessed_letters
    const newGuessed = [...(game.guessed_letters || []), ch];

    // update revealed if correct
    let revealed = game.revealed || Array.from({length: word.length}, ()=>false);
    if (isCorrect) {
      for (let pos of correctPositions) revealed[pos] = true;
    } else {
      // reduce attempts
      game.attempts_left = Math.max(0, game.attempts_left - 1);
    }

    // store guess
    await client.query(`insert into guesses (id, game_id, user_id, letter, correct) values ($1,$2,$3,$4,$5)`, [uuidv4(), gameId, userId, ch, isCorrect]);

    // compute whether finished
    const finished = revealed.every(Boolean) || game.attempts_left <= 0;
    let status = finished ? 'finished' : 'playing';

    // compute score if finished or partial update
    const startedAt = game.started_at ? new Date(game.started_at) : new Date();
    const elapsedSeconds = Math.floor((Date.now() - startedAt.getTime()) / 1000);
    const correctCount = revealed.filter(Boolean).length;
    const attemptsAllowed = game.attempts_allowed;
    const attemptsLeft = game.attempts_left;
    const score = computeScore(word.length, correctCount, elapsedSeconds, attemptsLeft, attemptsAllowed);

    // update games row
    await client.query(`update games set guessed_letters=$1, revealed=$2, attempts_left=$3, status=$4, finished_at = CASE WHEN $5 THEN now() ELSE finished_at END, score=$6 where id=$7`,
      [newGuessed, revealed, game.attempts_left, status, finished, score, gameId]);

    await client.query('commit');

    // broadcast via socket.io
    io.to(gameId).emit('game:update', { gameId, masked: maskWord(word, revealed), attemptsLeft: game.attempts_left, guessedLetters: newGuessed, score, status });

    res.json({ correct: isCorrect, positions: correctPositions, masked: maskWord(word, revealed), attemptsLeft: game.attempts_left, score, status });
  } catch (err) {
    await client.query('rollback');
    console.error(err);
    res.status(500).json({ error: 'server error' });
  } finally {
    client.release();
  }
});

// ---------- API: hint ----------
app.post('/api/game/:gameId/hint', async (req, res) => {
  // body: { position (1-based), userTelegramId, userName }
  const { gameId } = req.params;
  const { position, userTelegramId, userName } = req.body;
  if (position === undefined) return res.status(400).json({ error: 'position required (1-based)' });

  const client = await pool.connect();
  try {
    await client.query('begin');

    // ensure user exists
    let userId = null;
    if (userTelegramId) {
      const r = await client.query('select id from users where telegram_id=$1', [userTelegramId]);
      if (r.rows.length) userId = r.rows[0].id;
      else { userId = uuidv4(); await client.query('insert into users (id, telegram_id, name) values ($1,$2,$3)', [userId, userTelegramId, userName || null]); }
    }

    const gq = await client.query('select * from games where id=$1 for update', [gameId]);
    if (!gq.rows.length) { await client.query('rollback'); return res.status(404).json({ error: 'game not found' }); }
    const game = gq.rows[0];
    if (game.status !== 'playing') { await client.query('rollback'); return res.status(400).json({ error: 'game not active' }); }

    if ((game.hints_used || 0) >= 3) { await client.query('rollback'); return res.status(400).json({ error: 'no hints left (max 3)' }); }
    if (game.attempts_left < 2) { await client.query('rollback'); return res.status(400).json({ error: 'not enough attempts to use hint' }); }

    const wr = await client.query('select word from words where id=$1', [game.word_id]);
    const word = wr.rows[0].word.toLowerCase();

    const posIdx = position - 1;
    if (posIdx<0 || posIdx>=word.length) { await client.query('rollback'); return res.status(400).json({ error: 'invalid position' }); }

    // reveal that position
    let revealed = game.revealed || Array.from({length: word.length}, ()=>false);
    revealed[posIdx] = true;

    const newHintsUsed = (game.hints_used || 0) + 1;
    const newAttemptsLeft = Math.max(0, game.attempts_left - 2);

    // recompute score quickly
    const startedAt = game.started_at ? new Date(game.started_at) : new Date();
    const elapsedSeconds = Math.floor((Date.now() - startedAt.getTime()) / 1000);
    const correctCount = revealed.filter(Boolean).length;
    const score = computeScore(word.length, correctCount, elapsedSeconds, newAttemptsLeft, game.attempts_allowed);

    const finished = revealed.every(Boolean) || newAttemptsLeft <= 0;
    const status = finished ? 'finished' : 'playing';

    await client.query(`update games set revealed=$1, hints_used=$2, attempts_left=$3, status=$4, finished_at = CASE WHEN $5 THEN now() ELSE finished_at END, score=$6 where id=$7`,
      [revealed, newHintsUsed, newAttemptsLeft, status, finished, score, gameId]);

    await client.query('commit');

    io.to(gameId).emit('game:update', { gameId, masked: maskWord(word, revealed), attemptsLeft: newAttemptsLeft, hintsUsed: newHintsUsed, score, status });

    res.json({ revealedPosition: position, letter: word[posIdx], attemptsLeft: newAttemptsLeft, hintsUsed: newHintsUsed, score, status });
  } catch (err) {
    await client.query('rollback');
    console.error(err);
    res.status(500).json({ error: 'server error' });
  } finally {
    client.release();
  }
});

// ---------- Multiplayer: join/leave (socket.io) ----------
io.on('connection', (socket) => {
  console.log('socket connected', socket.id);
  socket.on('join', (data) => {
    // data: { gameId, userId (optional), name (optional) }
    const { gameId, name } = data || {};
    if (!gameId) return;
    socket.join(gameId);
    socket.to(gameId).emit('player:joined', { socketId: socket.id, name });
  });
  socket.on('leave', (data) => {
    const { gameId } = data || {};
    if (gameId) {
      socket.leave(gameId);
      socket.to(gameId).emit('player:left', { socketId: socket.id });
    }
  });
});

// ---------- Telegram webhook handling ----------
async function telegramSendMessage(chatId, text, extra = {}) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const payload = {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    ...extra
  };
  try {
    const resp = await axios.post(url, payload);
    return resp.data;
  } catch (err) {
    console.error('telegram send error', err?.response?.data || err.message);
    throw err;
  }
}

app.post('/telegram-webhook', async (req, res) => {
  // expects Telegram update
  const update = req.body;
  if (!update) return res.sendStatus(200);
  try {
    // handle messages with /start
    if (update.message && update.message.text && update.message.chat) {
      const text = update.message.text.trim();
      const chatId = update.message.chat.id;
      const from = update.message.from || {};
      if (text.startsWith('/start')) {
        // reply with Web App button to open mini-app
        const keyboard = {
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: 'باز کردن Wordly (مینی‌اپ)',
                  web_app: { url: WEB_APP_URL }
                }
              ]
            ]
          }
        };
        await telegramSendMessage(chatId, `سلام ${from.first_name || ''}! برای شروع بازی روی دکمهٔ زیر کلیک کنید.`, keyboard);
      } else {
        // other messages: send help
        await telegramSendMessage(chatId, `برای شروع بازی از /start استفاده کنید.`);
      }
    }
  } catch (err) {
    console.error('telegram webhook handler error', err);
  }
  res.sendStatus(200);
});

// ---------- Basic health + static (if needed) ----------
app.get('/', (req, res) => res.send('Wordly game server is running'));

// start server
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
  if (TELEGRAM_BOT_TOKEN) {
    console.log('Telegram webhook endpoint ready at /telegram-webhook — set via setWebhook to point here.');
    console.log(`To set webhook (example):`);
    console.log(`curl -F "url=https://your-app-url/telegram-webhook" https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook`);
  }
});

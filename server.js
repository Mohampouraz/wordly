// server.js
require('dotenv').config();

const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;

const buildConnectionString = () => {
  let cs = process.env.DATABASE_URL;
  if (cs && !/sslmode=/i.test(cs)) cs += (cs.includes('?') ? '&' : '?') + 'sslmode=require';
  if (cs) return cs;
  const host = process.env.PGHOST, port = process.env.PGPORT || 5432, user = process.env.PGUSER, pass = process.env.PGPASSWORD, db = process.env.PGDATABASE;
  if (host && user && pass && db) return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:${port}/${db}?sslmode=require`;
  return null;
};

const connectionString = buildConnectionString();
const pool = new Pool({ connectionString, ssl: connectionString ? { rejectUnauthorized: false } : undefined });

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', methods: ['GET','POST'] } });

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// words.js must export { categories: [{ name, words:[{text, level}] }, ...] }
const wordsData = require('./words');

// ---------- Helpers ----------
const normalizeFaLetter = ch => {
  if (!ch) return '';
  const map = { '\u064A':'\u06CC', '\u0643':'\u06A9' }; // ي -> ی ، ك -> ک
  return (map[ch] || ch).normalize('NFC');
};
const normalizeFaWordKeepSpaces = word => {
  if (!word) return '';
  const removeMarks = /[\u0640\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g;
  let w = String(word).replace(removeMarks, '');
  w = w.replace(/\u064A/g, '\u06CC').replace(/\u0643/g, '\u06A9');
  return w.normalize('NFC');
};
const lenNoSpaces = s => String(s || '').replace(/\s/g,'').length;
const floor = Math.floor;
const ceil = Math.ceil;

// deterministic deck seeded by roomId
const newGameDeckForRoom = (roomId, level = 'medium') => {
  const all = [];
  for (const cat of wordsData.categories) {
    for (const w of cat.words.filter(x => (level ? x.level === level : true))) {
      all.push({ word: normalizeFaWordKeepSpaces(String(w.text)), category: cat.name, level: w.level });
    }
  }
  if (!all.length) return [];
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

// ---------- DB schema ----------
const ensureSchema = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGINT PRIMARY KEY,
      username TEXT,
      first_name TEXT,
      last_name TEXT,
      fullname TEXT,
      language_code TEXT,
      photo_url TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      name TEXT,
      status TEXT DEFAULT 'waiting',
      level TEXT,
      max_players INT DEFAULT 2,
      created_by BIGINT,
      reveal_mode TEXT DEFAULT 'shared',
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
      hints_allowed INT DEFAULT 0,
      score INT DEFAULT 0,
      guessed_count INT DEFAULT 0,
      allowed_wrong INT DEFAULT 0,
      timer_ms BIGINT DEFAULT 0,
      last_update TIMESTAMP DEFAULT NOW(),
      PRIMARY KEY (game_id, user_id)
    );
  `);
};

// simple telegram upsert (best-effort)
app.post('/auth/telegram', async (req, res) => {
  const { initData, user } = req.body;
  try {
    const uid = Number(user?.id);
    if (!uid) return res.status(400).json({ ok:false, error:'no_user' });
    const fullname = `${user.first_name || ''}${user.last_name ? ' ' + user.last_name : ''}`.trim() || null;
    await pool.query(`
      INSERT INTO users (id, username, first_name, last_name, fullname, language_code, photo_url)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (id) DO UPDATE SET
        username = EXCLUDED.username,
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        fullname = EXCLUDED.fullname,
        language_code = EXCLUDED.language_code,
        photo_url = EXCLUDED.photo_url,
        updated_at = NOW();
    `, [uid, user.username || null, user.first_name || null, user.last_name || null, fullname, user.language_code || null, user.photo_url || null]);
    res.json({ ok:true });
  } catch (e) {
    console.error('auth error', e);
    res.status(500).json({ ok:false, error:'server_error' });
  }
});

// list rooms
app.get('/rooms/list', async (req, res) => {
  const level = req.query.level || null;
  try {
    let q = `SELECT r.id, r.name, r.level, r.status, r.max_players, r.created_by, r.reveal_mode, COUNT(rp.user_id) AS players
             FROM rooms r LEFT JOIN room_players rp ON r.id = rp.room_id
             WHERE r.status <> 'finished'`;
    const params = [];
    if (level) { params.push(level); q += ` AND r.level = $${params.length}`; }
    q += ` GROUP BY r.id ORDER BY r.created_at DESC LIMIT 100;`;
    const out = await pool.query(q, params);
    res.json({ ok:true, rooms: out.rows });
  } catch (e) {
    console.error('rooms/list error', e);
    res.status(500).json({ ok:false, error:'server_error' });
  }
});

// create room
app.post('/rooms/create', async (req, res) => {
  const { user_id, name, level, max_players, reveal_mode } = req.body;
  if (!user_id) return res.status(400).json({ ok:false, error:'no_user' });
  try {
    const roomId = crypto.randomUUID();
    await pool.query(`INSERT INTO rooms (id, name, status, level, max_players, created_by, reveal_mode) VALUES ($1,$2,'waiting',$3,$4,$5,$6);`, [roomId, name || 'اتاق خصوصی', level || 'medium', Number(max_players) || 2, user_id, reveal_mode || 'shared']);
    await pool.query(`INSERT INTO room_players (room_id, user_id, role) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING;`, [roomId, user_id, 'host']);
    res.json({ ok:true, room_id: roomId });
  } catch (e) {
    console.error('rooms/create', e);
    res.status(500).json({ ok:false, error:'server_error' });
  }
});

// join room -> maybe start game
app.post('/rooms/join', async (req, res) => {
  const { room_id, user_id } = req.body;
  if (!room_id || !user_id) return res.status(400).json({ ok:false, error:'missing' });
  try {
    const r = await pool.query(`SELECT id, status, level, max_players, reveal_mode FROM rooms WHERE id=$1 LIMIT 1;`, [room_id]);
    if (!r.rows.length) return res.status(404).json({ ok:false, error:'not_found' });
    const rn = r.rows[0];
    const count = await pool.query(`SELECT COUNT(*) AS cnt FROM room_players WHERE room_id=$1;`, [room_id]);
    if (Number(count.rows[0].cnt) >= (rn.max_players || 2)) return res.status(400).json({ ok:false, error:'full' });

    await pool.query(`INSERT INTO room_players (room_id, user_id, role) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING;`, [room_id, user_id, 'player']);

    const players = await pool.query(`SELECT user_id FROM room_players WHERE room_id=$1 ORDER BY joined_at ASC;`, [room_id]);
    if (players.rows.length >= 2 && rn.status === 'waiting') {
      const gameId = crypto.randomUUID();
      const deck = newGameDeckForRoom(room_id, rn.level || 'medium');
      await pool.query(`INSERT INTO games (id, room_id, deck, level, status, started_at) VALUES ($1,$2,$3::jsonb,$4,'active',NOW());`, [gameId, room_id, JSON.stringify(deck), rn.level || 'medium']);

      for (const p of players.rows) {
        const firstWord = normalizeFaWordKeepSpaces(deck[0]?.word || '');
        const lettersLen = Math.max(1, lenNoSpaces(firstWord));
        const hintsAllowed = Math.max(0, floor(lettersLen / 2));
        const allowedWrong = Math.max(1, ceil(lettersLen * 1.5));
        await pool.query(`INSERT INTO game_states (game_id,user_id,current_index,correct_letters,wrong_letters,hints_used,hints_allowed,score,guessed_count,allowed_wrong,timer_ms) VALUES ($1,$2,0,'[]','[]',0,$3,0,0,$4,0) ON CONFLICT DO NOTHING;`, [gameId, p.user_id, hintsAllowed, allowedWrong]);
      }

      await pool.query(`UPDATE rooms SET status='playing' WHERE id=$1;`, [room_id]);
      io.to(room_id).emit('game:started', { game_id: gameId, deck, reveal_mode: rn.reveal_mode || 'shared' });
      return res.json({ ok:true, room_id, status:'ready', game_id: gameId, reveal_mode: rn.reveal_mode });
    }

    const cntAfter = await pool.query(`SELECT COUNT(*) AS cnt FROM room_players WHERE room_id=$1;`, [room_id]);
    io.to(room_id).emit('room:presence', { room_id, count: Number(cntAfter.rows[0].cnt) });
    res.json({ ok:true, room_id, status:'waiting' });
  } catch (e) {
    console.error('rooms/join error', e);
    res.status(500).json({ ok:false, error:'server_error' });
  }
});

// leave
app.post('/rooms/leave', async (req, res) => {
  const { room_id, user_id } = req.body;
  if (!room_id || !user_id) return res.status(400).json({ ok:false, error:'missing' });
  try {
    await pool.query(`DELETE FROM room_players WHERE room_id=$1 AND user_id=$2;`, [room_id, user_id]);
    const c = await pool.query(`SELECT COUNT(*) AS cnt FROM room_players WHERE room_id=$1;`, [room_id]);
    const cnt = Number(c.rows[0].cnt);
    if (cnt === 0) await pool.query(`UPDATE rooms SET status='waiting' WHERE id=$1;`, [room_id]);
    io.to(room_id).emit('room:presence', { room_id, count: cnt });
    res.json({ ok:true });
  } catch (e) {
    console.error('rooms/leave', e);
    res.status(500).json({ ok:false, error:'server_error' });
  }
});

// my rooms
app.post('/rooms/myrooms', async (req, res) => {
  const { user_id } = req.body;
  if (!user_id) return res.status(400).json({ ok:false, error:'no_user' });
  try {
    const r = await pool.query(`SELECT r.id, r.name, r.level, r.status, r.max_players, r.reveal_mode, rp.joined_at FROM rooms r JOIN room_players rp ON r.id = rp.room_id WHERE rp.user_id = $1 ORDER BY rp.joined_at DESC;`, [user_id]);
    res.json({ ok:true, rooms: r.rows });
  } catch (e) {
    console.error('rooms/myrooms', e);
    res.status(500).json({ ok:false, error:'server_error' });
  }
});

// rooms state
app.post('/rooms/state', async (req, res) => {
  const { room_id } = req.body;
  if (!room_id) return res.status(400).json({ ok:false, error:'no_room_id' });
  try {
    const room = await pool.query(`SELECT id, name, status, level, reveal_mode FROM rooms WHERE id = $1;`, [room_id]);
    if (!room.rows.length) return res.status(404).json({ ok:false, error:'room_not_found' });
    const players = await pool.query(`SELECT user_id, role FROM room_players WHERE room_id = $1 ORDER BY joined_at ASC;`, [room_id]);
    const game = await pool.query(`SELECT id, deck, level, status FROM games WHERE room_id = $1 ORDER BY started_at DESC LIMIT 1;`, [room_id]);
    res.json({ ok:true, room: room.rows[0], players: players.rows, game: game.rows.length ? game.rows[0] : null });
  } catch (e) {
    console.error('rooms/state', e);
    res.status(500).json({ ok:false, error:'server_error' });
  }
});

// helper: per-game states
app.get('/game/states', async (req, res) => {
  const game_id = req.query.game_id;
  if (!game_id) return res.status(400).json({ ok:false, error:'no_game_id' });
  try {
    const q = await pool.query(`
      SELECT gs.user_id, gs.current_index, gs.score, gs.guessed_count, gs.allowed_wrong, gs.hints_used, gs.hints_allowed, u.fullname
      FROM game_states gs LEFT JOIN users u ON u.id = gs.user_id
      WHERE gs.game_id = $1;
    `, [game_id]);
    res.json({ ok:true, states: q.rows });
  } catch (e) {
    console.error('game/states', e);
    res.status(500).json({ ok:false, error:'server_error' });
  }
});

// ---------- sockets ----------
const roomSockets = new Map();
const socketMeta = new Map();

io.on('connection', (socket) => {
  socketMeta.set(socket.id, { room_ids: new Set(), user_id: null });

  socket.on('join-room', ({ room_id, user_id }) => {
    if (!room_id) return;
    const m = socketMeta.get(socket.id);
    if (user_id) m.user_id = user_id;
    socket.join(room_id);
    m.room_ids.add(room_id);
    if (!roomSockets.has(room_id)) roomSockets.set(room_id, new Set());
    roomSockets.get(room_id).add(socket.id);
    io.to(room_id).emit('room:presence', { room_id, count: roomSockets.get(room_id).size });
  });

  // host can set reveal mode
  socket.on('room:setRevealMode', async ({ room_id, user_id, reveal_mode }) => {
    if (!room_id || !reveal_mode) return;
    try {
      const hostRow = await pool.query(`SELECT created_by FROM rooms WHERE id=$1 LIMIT 1;`, [room_id]);
      if (!hostRow.rows.length) return;
      if (Number(hostRow.rows[0].created_by) !== Number(user_id)) { socket.emit('room:setRevealMode:denied'); return; }
      await pool.query(`UPDATE rooms SET reveal_mode=$2 WHERE id=$1;`, [room_id, reveal_mode]);
      io.to(room_id).emit('room:revealModeChanged', { room_id, reveal_mode });
    } catch (e) { console.error('room:setRevealMode', e); }
  });

  socket.on('game:resume', async ({ game_id, user_id }) => {
    try {
      const gs = await pool.query(`SELECT * FROM game_states WHERE game_id=$1 AND user_id=$2;`, [game_id, user_id]);
      const g = await pool.query(`SELECT * FROM games WHERE id=$1;`, [game_id]);
      if (!gs.rows.length || !g.rows.length) return;
      const roomRow = await pool.query(`SELECT r.reveal_mode FROM rooms r JOIN games g ON g.room_id = r.id WHERE g.id = $1 LIMIT 1;`, [game_id]);
      const reveal_mode = roomRow.rows[0]?.reveal_mode || 'shared';
      const players = await pool.query(`SELECT gs.user_id, gs.current_index, gs.score, gs.guessed_count, gs.hints_used, gs.hints_allowed, u.fullname FROM game_states gs LEFT JOIN users u ON u.id = gs.user_id WHERE gs.game_id = $1;`, [game_id]);
      socket.emit('game:state', { state: gs.rows[0], deck: g.rows[0].deck, reveal_mode, players: players.rows });
    } catch (e) { console.error('game:resume', e); }
  });

  // guess with new logic
  socket.on('game:guess', async ({ game_id, user_id, letter }) => {
    try {
      if (!game_id || !user_id || !letter) return;
      const gsq = await pool.query(`SELECT * FROM game_states WHERE game_id=$1 AND user_id=$2;`, [game_id, user_id]);
      const gq  = await pool.query(`SELECT * FROM games WHERE id=$1;`, [game_id]);
      if (!gsq.rows.length || !gq.rows.length) return;
      const gs   = gsq.rows[0];
      const deck = gq.rows[0].deck;
      const idx  = Number(gs.current_index) || 0;

      const currentWordOrig = String(deck[idx]?.word || '');
      const currentWord     = normalizeFaWordKeepSpaces(currentWordOrig);
      const normalized      = normalizeFaLetter(String(letter).trim());
      if (!normalized || normalized.length !== 1) return;
      if (normalized === ' ') return;

      const correctLetters = Array.isArray(gs.correct_letters) ? gs.correct_letters : JSON.parse(gs.correct_letters || '[]');
      const wrongLetters   = Array.isArray(gs.wrong_letters) ? gs.wrong_letters   : JSON.parse(gs.wrong_letters   || '[]');

      if (correctLetters.includes(normalized) || wrongLetters.includes(normalized)) {
        socket.emit('game:feedback', { type: 'duplicate', letter: normalized });
        return;
      }

      // find room & reveal_mode
      const gameRow = await pool.query(`SELECT room_id FROM games WHERE id=$1 LIMIT 1;`, [game_id]);
      const roomId  = gameRow.rows[0]?.room_id;
      const roomRow = roomId ? await pool.query(`SELECT reveal_mode FROM rooms WHERE id=$1 LIMIT 1;`, [roomId]) : null;
      const reveal_mode = roomRow?.rows?.[0]?.reveal_mode || 'shared';

      const positions = [];
      for (let i = 0; i < currentWord.length; i++) if (currentWord[i] === normalized) positions.push(i);

      if (positions.length > 0) {
        // correct
        correctLetters.push(normalized);
        const scoreDelta = 10 * positions.length;
        const guessedInc = 1;
        await pool.query(`UPDATE game_states SET correct_letters=$3::jsonb, score=score+$4, guessed_count=guessed_count+$5, last_update=NOW() WHERE game_id=$1 AND user_id=$2;`, [game_id, user_id, JSON.stringify(correctLetters), scoreDelta, guessedInc]);

        const updatedPlayer = await pool.query(`SELECT user_id, score, guessed_count, hints_used, hints_allowed, allowed_wrong FROM game_states WHERE game_id=$1 AND user_id=$2 LIMIT 1;`, [game_id, user_id]);

        if (roomId) {
          if (reveal_mode === 'shared') {
            io.to(roomId).emit('game:letter:correct', { user_id, letter: normalized, positions, scoreDelta, shared: true, player: updatedPlayer.rows[0] });
          } else {
            socket.emit('game:letter:correct', { user_id, letter: normalized, positions, scoreDelta, shared: false, player: updatedPlayer.rows[0] });
            socket.to(roomId).emit('game:opponentEvent', { type: 'opponent_correct', by: user_id });
          }
        } else {
          socket.emit('game:letter:correct', { user_id, letter: normalized, positions, scoreDelta, shared: false, player: updatedPlayer.rows[0] });
        }
      } else {
        // wrong
        wrongLetters.push(normalized);
        await pool.query(`UPDATE game_states SET wrong_letters=$3::jsonb, last_update=NOW() WHERE game_id=$1 AND user_id=$2;`, [game_id, user_id, JSON.stringify(wrongLetters)]);
        const allowedWrong = Number(gs.allowed_wrong) || Math.max(1, ceil(lenNoSpaces(currentWord) * 1.5));
        if (roomId) io.to(roomId).emit('game:letter:wrong', { user_id, letter: normalized, wrongCount: wrongLetters.length, allowedWrong });
        else socket.emit('game:letter:wrong', { user_id, letter: normalized, wrongCount: wrongLetters.length, allowedWrong });

        // if exceeded allowed wrong -> fail word: subtract points equal to 10 * correctLetters.length and advance
        if (wrongLetters.length >= allowedWrong) {
          const correctCount = Array.isArray(correctLetters) ? correctLetters.length : JSON.parse(correctLetters || '[]').length;
          const lost = 10 * correctCount;
          await pool.query(`UPDATE game_states SET score = GREATEST(score - $3, 0) WHERE game_id=$1 AND user_id=$2;`, [game_id, user_id, lost]);

          const nextIndex = idx + 1;
          const deckLen = Array.isArray(deck) ? deck.length : 0;
          if (nextIndex >= deckLen) {
            await pool.query(`UPDATE games SET status='finished', finished_at=NOW() WHERE id=$1;`, [game_id]);
            if (roomId) io.to(roomId).emit('game:finished', { game_id });
          } else {
            const nextWord = normalizeFaWordKeepSpaces(String(deck[nextIndex]?.word || ''));
            const lettersLen = Math.max(1, lenNoSpaces(nextWord));
            const hintsAllowedNext = Math.max(0, floor(lettersLen / 2));
            const allowedWrongNext = Math.max(1, ceil(lettersLen * 1.5));
            await pool.query(`UPDATE game_states SET current_index=$3, correct_letters='[]', wrong_letters='[]', hints_used=0, hints_allowed=$4, allowed_wrong=$5, last_update=NOW() WHERE game_id=$1 AND user_id=$2;`, [game_id, user_id, nextIndex, hintsAllowedNext, allowedWrongNext]);
            if (roomId) {
              const states = await pool.query(`SELECT gs.user_id, gs.current_index, gs.score, gs.guessed_count, u.fullname FROM game_states gs LEFT JOIN users u ON u.id = gs.user_id WHERE gs.game_id=$1;`, [game_id]);
              io.to(roomId).emit('game:next', { game_id, by_user: user_id, nextIndex, states: states.rows });
            }
          }
        }
      }

      // solved check
      const uniqueLetters = new Set(currentWord.split('').filter(ch => ch !== ' '));
      const solved = [...uniqueLetters].every(l => correctLetters.includes(l));

      if (solved) {
        const nextIndex = idx + 1;
        const deckLen = Array.isArray(deck) ? deck.length : 0;
        if (nextIndex >= deckLen) {
          await pool.query(`UPDATE games SET status='finished', finished_at=NOW() WHERE id=$1;`, [game_id]);
          if (roomId) io.to(roomId).emit('game:finished', { game_id });
        } else {
          const nextWord = normalizeFaWordKeepSpaces(String(deck[nextIndex]?.word || ''));
          const lettersLen = Math.max(1, lenNoSpaces(nextWord));
          const hintsAllowedNext = Math.max(0, floor(lettersLen / 2));
          const allowedWrongNext = Math.max(1, ceil(lettersLen * 1.5));
          await pool.query(`UPDATE game_states SET current_index=$3, correct_letters='[]', wrong_letters='[]', hints_used=0, hints_allowed=$4, allowed_wrong=$5, last_update=NOW() WHERE game_id=$1 AND user_id=$2;`, [game_id, user_id, nextIndex, hintsAllowedNext, allowedWrongNext]);
          if (roomId) {
            const states = await pool.query(`SELECT gs.user_id, gs.current_index, gs.score, gs.guessed_count, u.fullname FROM game_states gs LEFT JOIN users u ON u.id = gs.user_id WHERE gs.game_id=$1;`, [game_id]);
            io.to(roomId).emit('game:next', { game_id, by_user: user_id, nextIndex, states: states.rows });
          }
        }
      }
    } catch (e) {
      console.error('game:guess error', e);
    }
  });

  // hint with penalty = 10 * positions.length; max hints = hints_allowed
  socket.on('game:hint', async ({ game_id, user_id }) => {
    try {
      if (!game_id || !user_id) return;
      const gsq = await pool.query(`SELECT * FROM game_states WHERE game_id=$1 AND user_id=$2;`, [game_id, user_id]);
      const gq  = await pool.query(`SELECT * FROM games WHERE id=$1;`, [game_id]);
      if (!gsq.rows.length || !gq.rows.length) return;
      const gs = gsq.rows[0];
      const deck = gq.rows[0].deck;
      const idx = Number(gs.current_index) || 0;
      const currentWord = normalizeFaWordKeepSpaces(String(deck[idx]?.word || ''));
      const hintsUsed = Number(gs.hints_used) || 0;
      const hintsAllowed = Number(gs.hints_allowed) || Math.max(0, floor(Math.max(1, lenNoSpaces(currentWord)) / 2));
      if (hintsUsed >= hintsAllowed) { socket.emit('game:feedback', { type: 'hint-limit' }); return; }

      const correctLetters = Array.isArray(gs.correct_letters) ? gs.correct_letters : JSON.parse(gs.correct_letters || '[]');
      const candidates = currentWord.split('').filter(ch => ch !== ' ').filter((l,i,arr) => arr.indexOf(l) === i && !correctLetters.includes(l));
      if (!candidates.length) { socket.emit('game:feedback', { type: 'no-hint' }); return; }
      const reveal = candidates[Math.floor(Math.random() * candidates.length)];
      const positions = [];
      for (let i = 0; i < currentWord.length; i++) if (currentWord[i] === reveal) positions.push(i);

      const penalty = 10 * positions.length;

      correctLetters.push(reveal);
      await pool.query(`UPDATE game_states SET correct_letters=$3::jsonb, hints_used=hints_used+1, score=GREATEST(score-$4,0), last_update=NOW() WHERE game_id=$1 AND user_id=$2;`, [game_id, user_id, JSON.stringify(correctLetters), penalty]);

      const gameRow = await pool.query(`SELECT room_id FROM games WHERE id=$1 LIMIT 1;`, [game_id]);
      const roomId = gameRow.rows[0]?.room_id;
      if (roomId) io.to(roomId).emit('game:hint:reveal', { user_id, letter: reveal, positions, penalty });
      else socket.emit('game:hint:reveal', { user_id, letter: reveal, positions, penalty });
    } catch (e) {
      console.error('game:hint error', e);
    }
  });

  socket.on('game:timer', async ({ game_id, user_id, timer_ms }) => {
    try {
      if (!game_id || !user_id) return;
      const safeMs = Math.max(0, parseInt(timer_ms) || 0);
      await pool.query(`UPDATE game_states SET timer_ms=$3, last_update=NOW() WHERE game_id=$1 AND user_id=$2;`, [game_id, user_id, safeMs]);
    } catch (e) { console.error('game:timer error', e); }
  });

  socket.on('disconnect', () => {
    const m = socketMeta.get(socket.id);
    if (!m) return;
    for (const rid of m.room_ids) {
      const set = roomSockets.get(rid);
      if (set) {
        set.delete(socket.id);
        io.to(rid).emit('room:presence', { room_id: rid, count: set.size });
      }
    }
    socketMeta.delete(socket.id);
  });
});

// boot
(async () => {
  try {
    const c = await pool.connect();
    await c.query('SELECT 1');
    c.release();
    console.log('Postgres reachable.');
  } catch (e) {
    console.error('Postgres connection failed:', e.message);
    process.exit(1);
  }

  try {
    await ensureSchema();
    console.log('DB schema ensured.');
  } catch (e) {
    console.error('Migration error:', e);
    process.exit(1);
  }

  app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

  server.listen(PORT, () => {
    console.log(`Server listening on ${PORT}`);
  });
})();

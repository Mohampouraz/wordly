require('dotenv').config();

const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const crypto = require('crypto');
const PORT = process.env.PORT || 3000;

/* ----------------------------------------------------------------
   DB CONNECTION
---------------------------------------------------------------- */
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

const wordsData = require('./words');

/* ----------------------------------------------------------------
   HELPERS
---------------------------------------------------------------- */
const normalizeFaLetter = ch => {
  if (!ch) return '';
  const map = { '\u064A':'\u06CC', '\u0643':'\u06A9' };
  return (map[ch] || ch).normalize('NFC');
};

const normalizeFaWordKeepSpaces = word => {
  if (!word) return '';
  const removeMarks = /[\u0640\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g;
  let w = String(word).replace(removeMarks, '');
  w = w.replace(/\u064A/g, '\u06CC').replace(/\u0643/g, '\u06A9');
  return w.normalize('NFC');
};

const normalizeFaWordStrict = word => {
  let w = normalizeFaWordKeepSpaces(word);
  return w.replace(/[\s\u200c\u200d\u200b\u00a0]/g, '');
};

const floor = Math.floor;
const ceil = Math.ceil;

const newGameDeckForRoom = (roomId, level = 'medium') => {
  const all = [];
  for (const cat of wordsData.categories) {
    for (const w of cat.words.filter(x => (level ? x.level === level : true))) {
      all.push({ 
        word: normalizeFaWordKeepSpaces(String(w.text)), 
        category: cat.name, 
        level: w.level,
        description: w.description 
      });
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

/* ----------------------------------------------------------------
   DB SCHEMA (FIXED: Added Migration for 'results' column)
---------------------------------------------------------------- */
const ensureSchema = async () => {
  const queries = [
    `CREATE TABLE IF NOT EXISTS users (
      id BIGINT PRIMARY KEY, username TEXT, first_name TEXT, last_name TEXT, fullname TEXT, 
      language_code TEXT, photo_url TEXT, created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW()
    );`,
    `CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY, name TEXT, status TEXT DEFAULT 'waiting', level TEXT, 
      max_players INT DEFAULT 2, created_by BIGINT, reveal_mode TEXT DEFAULT 'private', created_at TIMESTAMP DEFAULT NOW()
    );`,
    `CREATE TABLE IF NOT EXISTS room_players (
      room_id TEXT, user_id BIGINT, role TEXT, joined_at TIMESTAMP DEFAULT NOW(), PRIMARY KEY (room_id, user_id)
    );`,
    `CREATE TABLE IF NOT EXISTS games (
      id TEXT PRIMARY KEY, room_id TEXT, deck JSONB, level TEXT, status TEXT, 
      started_at TIMESTAMP, finished_at TIMESTAMP
    );`,
    // *** MIGRATION: Add results column if missing ***
    `ALTER TABLE games ADD COLUMN IF NOT EXISTS results JSONB DEFAULT '[]';`,
    
    `CREATE TABLE IF NOT EXISTS game_states (
      game_id TEXT, user_id BIGINT, current_index INT DEFAULT 0, correct_letters JSONB DEFAULT '[]', 
      wrong_letters JSONB DEFAULT '[]', hints_used INT DEFAULT 0, hints_allowed INT DEFAULT 0, 
      score INT DEFAULT 0, guessed_count INT DEFAULT 0, allowed_wrong INT DEFAULT 0, timer_ms BIGINT DEFAULT 0, 
      last_update TIMESTAMP DEFAULT NOW(), PRIMARY KEY (game_id, user_id)
    );`
  ];
  for(const q of queries) await pool.query(q);
};

/* ----------------------------------------------------------------
   API ROUTES
---------------------------------------------------------------- */
app.post('/auth/telegram', async (req, res) => {
  const { user } = req.body;
  try {
    const uid = Number(user?.id);
    if (!uid) return res.status(400).json({ ok:false });
    const fullname = `${user.first_name || ''}${user.last_name ? ' ' + user.last_name : ''}`.trim() || `کاربر ${uid}`;
    await pool.query(`
      INSERT INTO users (id, username, first_name, last_name, fullname, language_code, photo_url)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (id) DO UPDATE SET 
        username = EXCLUDED.username,
        first_name = EXCLUDED.first_name, 
        last_name = EXCLUDED.last_name, 
        fullname = EXCLUDED.fullname, 
        photo_url = EXCLUDED.photo_url, 
        updated_at = NOW();
    `, [uid, user.username, user.first_name, user.last_name, fullname, user.language_code, user.photo_url]);
    res.json({ ok:true });
  } catch (e) { console.error(e); res.status(500).json({ ok:false }); }
});

app.get('/rooms/list', async (req, res) => {
  try {
    const level = req.query.level;
    let q = `SELECT r.id, r.name, r.level, r.status, r.max_players, r.created_by, r.reveal_mode, COUNT(rp.user_id) AS players
             FROM rooms r LEFT JOIN room_players rp ON r.id = rp.room_id
             WHERE r.status <> 'finished'`; 
    const params = [];
    if (level) { params.push(level); q += ` AND r.level = $${params.length}`; }
    q += ` GROUP BY r.id ORDER BY r.created_at DESC LIMIT 100;`;
    const out = await pool.query(q, params);
    res.json({ ok:true, rooms: out.rows });
  } catch (e) { res.status(500).json({ ok:false }); }
});

app.post('/rooms/create', async (req, res) => {
  const { user_id, name, level, max_players, reveal_mode } = req.body;
  if (!user_id) return res.status(400).json({ ok:false });
  try {
    const roomId = crypto.randomUUID();
    const mode = reveal_mode || 'private'; 
    await pool.query(`INSERT INTO rooms (id, name, status, level, max_players, created_by, reveal_mode) VALUES ($1,$2,'waiting',$3,$4,$5,$6);`, 
      [roomId, name || 'اتاق خصوصی', level || 'medium', Number(max_players) || 2, user_id, mode]);
    await pool.query(`INSERT INTO room_players (room_id, user_id, role) VALUES ($1,$2,$3);`, [roomId, user_id, 'host']);
    res.json({ ok:true, room_id: roomId });
  } catch (e) { res.status(500).json({ ok:false }); }
});

app.post('/rooms/join', async (req, res) => {
  const { room_id, user_id } = req.body;
  if (!room_id || !user_id) return res.status(400).json({ ok:false });
  try {
    const r = await pool.query(`SELECT * FROM rooms WHERE id=$1 LIMIT 1;`, [room_id]);
    if (!r.rows.length) return res.status(404).json({ ok:false });
    const rn = r.rows[0];

    if (rn.status === 'finished') return res.status(400).json({ ok:false, error: 'finished' });
    
    const count = await pool.query(`SELECT COUNT(*) AS cnt FROM room_players WHERE room_id=$1;`, [room_id]);
    if (Number(count.rows[0].cnt) >= (rn.max_players || 2)) {
       const isMember = await pool.query(`SELECT 1 FROM room_players WHERE room_id=$1 AND user_id=$2`, [room_id, user_id]);
       if(!isMember.rows.length) return res.status(400).json({ ok:false, error:'full' });
    }

    await pool.query(`INSERT INTO room_players (room_id, user_id, role) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING;`, [room_id, user_id, 'player']);
    const players = await pool.query(`SELECT user_id FROM room_players WHERE room_id=$1 ORDER BY joined_at ASC;`, [room_id]);

    if (players.rows.length >= rn.max_players && rn.status === 'waiting') {
      const gameId = crypto.randomUUID();
      const deck = newGameDeckForRoom(room_id, rn.level || 'medium');
      
      await pool.query(`INSERT INTO games (id, room_id, deck, level, status, started_at) VALUES ($1,$2,$3::jsonb,$4,'active',NOW());`, 
        [gameId, room_id, JSON.stringify(deck), rn.level || 'medium']);
      
      for (const p of players.rows) {
        await createGameState(gameId, p.user_id, deck);
      }

      await pool.query(`UPDATE rooms SET status='playing' WHERE id=$1;`, [room_id]);
      io.to(room_id).emit('game:started', { game_id: gameId, deck, reveal_mode: rn.reveal_mode || 'private', players: players.rows });
      return res.json({ ok:true, room_id, status:'ready', game_id: gameId });
    }
    
    else if (rn.status === 'playing') {
      const game = await pool.query(`SELECT id, deck FROM games WHERE room_id=$1 AND status='active' LIMIT 1;`, [room_id]);
      if (game.rows.length > 0) {
         const g = game.rows[0];
         await createGameState(g.id, user_id, g.deck);
         const cntAfter = await pool.query(`SELECT COUNT(*) AS cnt FROM room_players WHERE room_id=$1;`, [room_id]);
         io.to(room_id).emit('room:presence', { room_id, count: Number(cntAfter.rows[0].cnt), players: players.rows });
         return res.json({ ok:true, room_id, status:'playing', game_id: g.id });
      }
    }

    const cntAfter = await pool.query(`SELECT COUNT(*) AS cnt FROM room_players WHERE room_id=$1;`, [room_id]);
    io.to(room_id).emit('room:presence', { room_id, count: Number(cntAfter.rows[0].cnt), players: players.rows });
    res.json({ ok:true, room_id, status:'waiting' });

  } catch (e) { 
    console.error('Join Error:', e); 
    res.status(500).json({ ok:false }); 
  }
});

async function createGameState(gameId, userId, deck) {
  const strictLen = normalizeFaWordStrict(deck[0]?.word || '').length;
  const hintsAllowed = Math.max(1, floor(strictLen / 3));
  const allowedWrong = Math.max(1, ceil(strictLen * 1.5));
  
  await pool.query(`
    INSERT INTO game_states (game_id, user_id, current_index, correct_letters, wrong_letters, hints_used, hints_allowed, score, guessed_count, allowed_wrong, timer_ms) 
    VALUES ($1,$2,0,'[]','[]',0,$3,0,0,$4,0) 
    ON CONFLICT (game_id, user_id) DO NOTHING;`, 
    [gameId, userId, hintsAllowed, allowedWrong]);
}

app.post('/rooms/leave', async (req, res) => {
  const { room_id, user_id } = req.body;
  try {
    await pool.query(`DELETE FROM room_players WHERE room_id=$1 AND user_id=$2;`, [room_id, user_id]);
    const c = await pool.query(`SELECT COUNT(*) AS cnt FROM room_players WHERE room_id=$1;`, [room_id]);
    const cnt = Number(c.rows[0].cnt);
    if (cnt === 0) await pool.query(`UPDATE rooms SET status='waiting' WHERE id=$1;`, [room_id]);
    io.to(room_id).emit('room:presence', { room_id, count: cnt });
    res.json({ ok:true });
  } catch (e) { res.status(500).json({ ok:false }); }
});

app.post('/rooms/myrooms', async (req, res) => {
  try {
    const q = `
      SELECT r.id, r.name, r.level, r.status, r.max_players 
      FROM rooms r 
      JOIN room_players rp ON r.id = rp.room_id 
      WHERE rp.user_id = $1 AND r.status IN ('playing', 'waiting')
      ORDER BY r.status ASC, rp.joined_at DESC;
    `;
    const r = await pool.query(q, [req.body.user_id]);
    res.json({ ok:true, rooms: r.rows });
  } catch(e){ res.status(500).json({ok:false}); }
});

app.post('/rooms/state', async (req, res) => {
  try {
    const { room_id } = req.body;
    const room = await pool.query(`SELECT * FROM rooms WHERE id = $1;`, [room_id]);
    if (!room.rows.length) return res.status(404).json({ ok:false });
    const players = await pool.query(`SELECT user_id, role FROM room_players WHERE room_id = $1 ORDER BY joined_at ASC;`, [room_id]);
    const game = await pool.query(`SELECT id, deck, level, status, results FROM games WHERE room_id = $1 ORDER BY started_at DESC LIMIT 1;`, [room_id]);
    res.json({ ok:true, room: room.rows[0], players: players.rows, game: game.rows[0] || null });
  } catch (e) { res.status(500).json({ ok:false }); }
});

app.post('/game/restart', async (req, res) => {
  const { room_id, user_id } = req.body;
  try {
    const r = await pool.query(`SELECT created_by FROM rooms WHERE id=$1`, [room_id]);
    if(!r.rows.length || String(r.rows[0].created_by) !== String(user_id)) return res.status(403).json({ok:false});
    await pool.query(`UPDATE rooms SET status='waiting' WHERE id=$1`, [room_id]);
    io.to(room_id).emit('room:reset', { room_id });
    res.json({ok:true});
  } catch(e) { res.status(500).json({ok:false}); }
});

/* ----------------------------------------------------------------
   STATS ROUTES
---------------------------------------------------------------- */
app.post('/stats/profile', async (req, res) => {
  const { user_id } = req.body;
  try {
    const stats = await pool.query(`SELECT COUNT(DISTINCT game_id) as games_played, COALESCE(SUM(score), 0) as total_score FROM game_states WHERE user_id = $1`, [user_id]);
    const userInfo = await pool.query(`SELECT fullname, photo_url FROM users WHERE id=$1`, [user_id]);
    res.json({ ok: true, user: userInfo.rows[0], stats: stats.rows[0] });
  } catch(e) { res.status(500).json({ok:false}); }
});

app.post('/stats/leaderboard', async (req, res) => {
  try {
    const list = await pool.query(`
      SELECT u.fullname, u.id as user_id, COALESCE(SUM(gs.score), 0) as total_score, COUNT(DISTINCT gs.game_id) as games_played
      FROM users u JOIN game_states gs ON u.id = gs.user_id GROUP BY u.id, u.fullname ORDER BY total_score DESC LIMIT 50
    `);
    res.json({ ok: true, list: list.rows });
  } catch(e) { res.status(500).json({ok:false}); }
});


/* ----------------------------------------------------------------
   SOCKET LOGIC
---------------------------------------------------------------- */
const roomSockets = new Map();
const socketMeta = new Map();

async function getGameStates(gameId) {
  const q = await pool.query(`
    SELECT gs.user_id, gs.current_index, gs.score, gs.guessed_count, gs.hints_used, gs.hints_allowed, u.fullname 
    FROM game_states gs LEFT JOIN users u ON u.id = gs.user_id 
    WHERE gs.game_id = $1;
  `, [gameId]);
  return q.rows;
}

async function advanceToNextWord(gameId, userId, currentIdx, deck, roomId) {
  const currentWordObj = deck[currentIdx];
  if (currentWordObj) {
    const currentWordStrict = normalizeFaWordStrict(currentWordObj.word);
    const required = new Set(currentWordStrict.split('').filter(c=>c && c.trim()));
    const states = await pool.query(`SELECT user_id, correct_letters FROM game_states WHERE game_id=$1`, [gameId]);
    const winners = [];
    for(const s of states.rows) {
       const letters = Array.isArray(s.correct_letters) ? s.correct_letters : JSON.parse(s.correct_letters||'[]');
       const isWin = [...required].every(char => letters.includes(char));
       if(isWin) winners.push(s.user_id);
    }
    const resultEntry = { index: currentIdx, word: currentWordObj.word, description: currentWordObj.description, winners: winners };
    
    // FIX: Ensure results column update works even if initially null
    await pool.query(`UPDATE games SET results = COALESCE(results, '[]'::jsonb) || $1::jsonb WHERE id=$2`, [JSON.stringify(resultEntry), gameId]);
  }

  const nextIndex = currentIdx + 1;
  const deckLen = Array.isArray(deck) ? deck.length : 0;
  
  if (nextIndex >= deckLen) {
    await pool.query(`UPDATE games SET status='finished', finished_at=NOW() WHERE id=$1;`, [gameId]);
    await pool.query(`UPDATE rooms SET status='finished' WHERE id=$1;`, [roomId]);
    const finalGame = await pool.query(`SELECT results, deck FROM games WHERE id=$1`, [gameId]);
    const finalPlayers = await getGameStates(gameId);
    if (roomId) io.to(roomId).emit('game:finished', { game_id: gameId, results: finalGame.rows[0].results || [], deck: finalGame.rows[0].deck, players: finalPlayers });
    return;
  }

  const nextWord = String(deck[nextIndex]?.word || '');
  const strictLen = normalizeFaWordStrict(nextWord).length;
  const hintsAllowedNext = Math.max(1, floor(strictLen / 3));
  const allowedWrongNext = Math.max(1, ceil(strictLen * 1.5));

  await pool.query(`UPDATE game_states SET current_index=$3, correct_letters='[]', wrong_letters='[]', hints_used=0, hints_allowed=$4, allowed_wrong=$5, last_update=NOW() WHERE game_id=$1 AND user_id=$2;`, 
    [gameId, userId, nextIndex, hintsAllowedNext, allowedWrongNext]);
  
  const playersState = await getGameStates(gameId);
  const newState = await pool.query(`SELECT * FROM game_states WHERE game_id=$1 AND user_id=$2`, [gameId, userId]);
  if (roomId) {
    io.to(roomId).emit('game:next', { game_id: gameId, by_user: userId, nextIndex, states: playersState });
    io.to(roomId).emit('game:states', { game_id: gameId, states: playersState }); 
  }
  return newState.rows[0];
}

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

  socket.on('game:resume', async ({ game_id, user_id }) => {
    try {
      const g = await pool.query(`SELECT * FROM games WHERE id=$1;`, [game_id]);
      if (!g.rows.length) return;
      if (g.rows[0].status === 'finished') {
         const players = await getGameStates(game_id);
         socket.emit('game:finished', { game_id, results: g.rows[0].results || [], deck: g.rows[0].deck, players });
         return;
      }
      let gs = await pool.query(`SELECT * FROM game_states WHERE game_id=$1 AND user_id=$2;`, [game_id, user_id]);
      if (!gs.rows.length) {
         await createGameState(game_id, user_id, g.rows[0].deck);
         gs = await pool.query(`SELECT * FROM game_states WHERE game_id=$1 AND user_id=$2;`, [game_id, user_id]);
      }
      const roomRow = await pool.query(`SELECT r.reveal_mode FROM rooms r JOIN games g ON g.room_id = r.id WHERE g.id = $1 LIMIT 1;`, [game_id]);
      const reveal_mode = roomRow.rows[0]?.reveal_mode || 'private';
      const players = await getGameStates(game_id);
      socket.emit('game:state', { state: gs.rows[0], deck: g.rows[0].deck, reveal_mode, players });
    } catch (e) { console.error('Resume Error', e); }
  });

  socket.on('game:guess', async ({ game_id, user_id, letter }) => {
    try {
      if (!game_id || !user_id || !letter) return;
      const gsq = await pool.query(`SELECT * FROM game_states WHERE game_id=$1 AND user_id=$2;`, [game_id, user_id]);
      const gq  = await pool.query(`SELECT * FROM games WHERE id=$1;`, [game_id]);
      if (!gsq.rows.length || !gq.rows.length) return;
      if (gq.rows[0].status === 'finished') return;

      const gs = gsq.rows[0];
      const deck = gq.rows[0].deck;
      const idx = Number(gs.current_index) || 0;
      const currentWordOrig = String(deck[idx]?.word || '');
      const currentWord = normalizeFaWordKeepSpaces(currentWordOrig);
      const normalized = normalizeFaLetter(String(letter).trim());
      if (!normalized || normalized.length !== 1) return;

      let correctLetters = Array.isArray(gs.correct_letters) ? gs.correct_letters : JSON.parse(gs.correct_letters || '[]');
      let wrongLetters = Array.isArray(gs.wrong_letters) ? gs.wrong_letters : JSON.parse(gs.wrong_letters || '[]');

      if (correctLetters.includes(normalized) || wrongLetters.includes(normalized)) {
        socket.emit('game:feedback', { type: 'duplicate', letter: normalized });
        return;
      }

      const gameRow = await pool.query(`SELECT room_id FROM games WHERE id=$1 LIMIT 1;`, [game_id]);
      const roomId = gameRow.rows[0]?.room_id;
      const roomRow = roomId ? await pool.query(`SELECT reveal_mode FROM rooms WHERE id=$1 LIMIT 1;`, [roomId]) : null;
      const reveal_mode = roomRow?.rows?.[0]?.reveal_mode || 'private';

      const positions = [];
      for (let i = 0; i < currentWord.length; i++) if (currentWord[i] === normalized) positions.push(i);
      
      if (positions.length > 0) {
        correctLetters.push(normalized);
        const scoreDelta = 10 * positions.length;
        await pool.query(`UPDATE game_states SET correct_letters=$3::jsonb, score=score+$4, guessed_count=guessed_count+1, last_update=NOW() WHERE game_id=$1 AND user_id=$2;`, 
          [game_id, user_id, JSON.stringify(correctLetters), scoreDelta]);
        const updatedPlayer = await pool.query(`SELECT user_id, score, guessed_count FROM game_states WHERE game_id=$1 AND user_id=$2`, [game_id, user_id]);
        const payload = { user_id, letter: normalized, positions, scoreDelta, player: updatedPlayer.rows[0] };
        if (roomId && reveal_mode === 'shared') io.to(roomId).emit('game:letter:correct', { ...payload, shared: true });
        else {
           socket.emit('game:letter:correct', { ...payload, shared: false });
           if(roomId) socket.to(roomId).emit('game:letter:correct', { user_id, letter: null, positions: [], scoreDelta, player: updatedPlayer.rows[0], shared: false });
        }
        const currentWordStrict = normalizeFaWordStrict(currentWordOrig);
        const uniqueRequired = new Set(currentWordStrict.split('').filter(c => c && c.trim() !== ''));
        const isWin = [...uniqueRequired].every(char => correctLetters.includes(char));
        if (isWin) await advanceToNextWord(game_id, user_id, idx, deck, roomId);

      } else {
        wrongLetters.push(normalized);
        await pool.query(`UPDATE game_states SET wrong_letters=$3::jsonb, last_update=NOW() WHERE game_id=$1 AND user_id=$2;`, 
          [game_id, user_id, JSON.stringify(wrongLetters)]);
        const strictLen = normalizeFaWordStrict(currentWordOrig).length;
        const allowedWrong = Number(gs.allowed_wrong) || Math.max(1, ceil(strictLen * 1.5));
        socket.emit('game:letter:wrong', { user_id, letter: normalized, wrongCount: wrongLetters.length, allowedWrong });
        if (wrongLetters.length >= allowedWrong) {
          const penalty = 5 * correctLetters.length;
          await pool.query(`UPDATE game_states SET score = GREATEST(score - $3, 0) WHERE game_id=$1 AND user_id=$2;`, [game_id, user_id, penalty]);
          socket.emit('game:feedback', { type: 'word-failed', word: currentWordOrig });
          await advanceToNextWord(game_id, user_id, idx, deck, roomId);
        }
      }
    } catch (e) { console.error('game:guess error', e); }
  });

  socket.on('game:hint', async ({ game_id, user_id }) => {
    try {
      if (!game_id || !user_id) return;
      const gsq = await pool.query(`SELECT * FROM game_states WHERE game_id=$1 AND user_id=$2;`, [game_id, user_id]);
      const gq  = await pool.query(`SELECT * FROM games WHERE id=$1;`, [game_id]);
      if (!gsq.rows.length || !gq.rows.length) return;
      if (gq.rows[0].status === 'finished') return;

      const gs = gsq.rows[0];
      const deck = gq.rows[0].deck;
      const idx = Number(gs.current_index) || 0;
      const currentWord = normalizeFaWordKeepSpaces(String(deck[idx]?.word || ''));
      const hintsUsed = Number(gs.hints_used) || 0;
      const hintsAllowed = Number(gs.hints_allowed);

      if (hintsUsed >= hintsAllowed) { socket.emit('game:feedback', { type: 'hint-limit' }); return; }

      let correctLetters = Array.isArray(gs.correct_letters) ? gs.correct_letters : JSON.parse(gs.correct_letters || '[]');
      const candidates = currentWord.split('').filter(ch => ch.trim() !== '' && ch !== '\u200c' && !correctLetters.includes(ch));
      const uniqueCandidates = [...new Set(candidates)];
      
      if (!uniqueCandidates.length) { socket.emit('game:feedback', { type: 'no-hint' }); return; }
      
      const reveal = uniqueCandidates[Math.floor(Math.random() * uniqueCandidates.length)];
      const positions = [];
      for (let i = 0; i < currentWord.length; i++) if (currentWord[i] === reveal) positions.push(i);
      
      const penalty = 10 * positions.length;
      correctLetters.push(reveal);
      
      await pool.query(`UPDATE game_states SET correct_letters=$3::jsonb, hints_used=hints_used+1, score=GREATEST(score-$4,0), last_update=NOW() WHERE game_id=$1 AND user_id=$2;`, 
        [game_id, user_id, JSON.stringify(correctLetters), penalty]);
      
      const gameRow = await pool.query(`SELECT room_id FROM games WHERE id=$1 LIMIT 1;`, [game_id]);
      const roomId = gameRow.rows[0]?.room_id;
      
      socket.emit('game:hint:reveal', { user_id, letter: reveal, positions, penalty });
      if(roomId) {
         const updatedPlayer = await pool.query(`SELECT user_id, score, guessed_count FROM game_states WHERE game_id=$1 AND user_id=$2`, [game_id, user_id]);
         socket.to(roomId).emit('game:states', { game_id, states: [updatedPlayer.rows[0]] });
      }
      const currentWordStrict = normalizeFaWordStrict(deck[idx]?.word || '');
      const uniqueRequired = new Set(currentWordStrict.split('').filter(c => c && c.trim() !== ''));
      const isWin = [...uniqueRequired].every(char => correctLetters.includes(char));
      if(isWin) await advanceToNextWord(game_id, user_id, idx, deck, roomId);

    } catch (e) { console.error(e); }
  });

  socket.on('game:timer', async ({ game_id, user_id, timer_ms }) => {
    try {
      if (!game_id || !user_id) return;
      const safeMs = Math.max(0, parseInt(timer_ms) || 0);
      await pool.query(`UPDATE game_states SET timer_ms=$3, last_update=NOW() WHERE game_id=$1 AND user_id=$2;`, [game_id, user_id, safeMs]);
    } catch (e) {}
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

(async () => {
  try {
    const c = await pool.connect();
    await c.query('SELECT 1');
    c.release();
    console.log('Postgres reachable.');
    await ensureSchema();
    console.log('DB schema ensured.');
  } catch (e) {
    console.error('Boot error:', e);
    process.exit(1);
  }

  app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

  server.listen(PORT, () => {
    console.log(`Server listening on ${PORT}`);
  });
})();

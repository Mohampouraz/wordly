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

const wordsData = require('./words'); [cite_start]// [cite: 1195]

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

// حذف تمام فاصله‌ها برای محاسبه طول دقیق و شرط برد
const normalizeFaWordStrict = word => {
  let w = normalizeFaWordKeepSpaces(word);
  return w.replace(/[\s\u200c\u200d\u200b\u00a0]/g, '');
};

const floor = Math.floor;
const ceil = Math.ceil;
const newGameDeckForRoom = (roomId, level = 'medium') => {
  const all = [];
  
  // تغییر: اضافه کردن description به کلمه
  for (const cat of wordsData.categories) {
    for (const w of cat.words.filter(x => (level ? x.level === level : true))) {
      all.push({ 
        word: normalizeFaWordKeepSpaces(String(w.text)), 
        category: cat.name, 
        level: w.level,
        description: w.description // اضافه شدن توصیف کلمه
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
   DB SCHEMA
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
      id TEXT PRIMARY KEY, room_id TEXT, deck JSONB, level TEXT, status TEXT, started_at TIMESTAMP, finished_at TIMESTAMP
    );`,
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
// ذخیره اطلاعات تلگرام در دیتابیس
app.post('/auth/telegram', async (req, res) => {
  const { user } = req.body;
  try {
    const uid = Number(user?.id);
    if (!uid) return res.status(400).json({ ok:false });
    
    // ساخت نام کامل از روی اطلاعات تلگرام
    const fullname = `${user.first_name || ''}${user.last_name ? ' ' + user.last_name : ''}`.trim() || `کاربر ${uid}`;
    
    await pool.query(`
      INSERT INTO 
      users (id, username, first_name, last_name, fullname, language_code, photo_url)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (id) DO UPDATE SET 
        first_name = EXCLUDED.first_name, 
        last_name = EXCLUDED.last_name, 
        fullname = EXCLUDED.fullname, 
        photo_url = EXCLUDED.photo_url, 
        updated_at = NOW();
    `, [uid, user.username, user.first_name, user.last_name, fullname, user.language_code, user.photo_url]);
    res.json({ ok:true });
  } catch (e) { 
    console.error(e);
    res.status(500).json({ ok:false }); 
  }
});
app.get('/rooms/list', async (req, res) => {
  try {
    const level = req.query.level;
    let q = `SELECT r.id, r.name, r.level, r.status, r.max_players, r.created_by, r.reveal_mode, COUNT(rp.user_id) AS players
             FROM rooms r LEFT JOIN room_players rp ON r.id = rp.room_id
             WHERE r.status <> 'finished'`;
    const params = [];
    if (level) { params.push(level); q += ` AND r.level = $${params.length}`; }
    q += ` 
    GROUP BY r.id ORDER BY r.created_at DESC LIMIT 100;`;
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
    res.json({ ok:true, room_id: 
    roomId });
  } catch (e) { res.status(500).json({ ok:false }); }
});
app.post('/rooms/join', async (req, res) => {
  const { room_id, user_id } = req.body;
  if (!room_id || !user_id) return res.status(400).json({ ok:false });
  try {
    const r = await pool.query(`SELECT * FROM rooms WHERE id=$1 LIMIT 1;`, [room_id]);
    if (!r.rows.length) return res.status(404).json({ ok:false });
    const rn = r.rows[0];
    
    const count = await pool.query(`SELECT COUNT(*) AS cnt FROM room_players WHERE room_id=$1;`, [room_id]);
    if (Number(count.rows[0].cnt) >= (rn.max_players || 2)) {
       const isMember = await pool.query(`SELECT 1 
       FROM room_players WHERE room_id=$1 AND user_id=$2`, [room_id, user_id]);
       if(!isMember.rows.length) return res.status(400).json({ ok:false, error:'full' });
    }

    await pool.query(`INSERT INTO room_players (room_id, user_id, role) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING;`, [room_id, user_id, 'player']);
    const players = await pool.query(`SELECT user_id FROM room_players WHERE room_id=$1 ORDER BY joined_at ASC;`, [room_id]);
    
    // Auto-start game logic
    if (players.rows.length >= rn.max_players && rn.status === 'waiting') {
      const gameId = crypto.randomUUID();
      const deck = newGameDeckForRoom(room_id, rn.level);

      if (!deck.length) return res.status(500).json({ ok:false, error:'no-words' });

      await pool.query(`UPDATE rooms SET status='playing' WHERE id=$1;`, [room_id]);
      await pool.query(`INSERT INTO games (id, room_id, deck, level, status, started_at) VALUES ($1,$2,$3,$4,'playing',NOW());`, 
        [gameId, room_id, JSON.stringify(deck), rn.level]);
      
      const firstWord = deck[0];
      const strictLen = normalizeFaWordStrict(firstWord.word).length;
      const hintsAllowed = Math.max(1, floor(strictLen / 3));
      const allowedWrong = Math.max(1, ceil(strictLen * 1.5));
      
      // Init game_states for all players
      const playerValues = players.rows.map(p => {
        return `('${gameId}', ${p.user_id}, ${hintsAllowed}, ${allowedWrong})`;
      }).join(',');

      await pool.query(`
        INSERT INTO game_states (game_id, user_id, hints_allowed, allowed_wrong)
        VALUES ${playerValues} ON CONFLICT DO NOTHING;
      `);
      
      const playersState = await getGameStates(gameId);
      
      io.to(room_id).emit('game:start', { game_id: gameId, deck, states: playersState });
    }
    
    const cntAfter = await pool.query(`SELECT COUNT(*) AS cnt FROM room_players WHERE room_id=$1;`, [room_id]);
    io.to(room_id).emit('room:presence', { room_id, count: Number(cntAfter.rows[0].cnt), players: players.rows });
    res.json({ ok:true, room_id, status:'waiting' });
  } catch (e) { res.status(500).json({ ok:false }); }
});
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
    const r = await pool.query(`SELECT r.id, r.name, r.level, r.status, r.max_players FROM rooms r JOIN room_players rp ON r.id = rp.room_id WHERE rp.user_id = $1 ORDER BY rp.joined_at DESC;`, [req.body.user_id]);
    res.json({ ok:true, rooms: r.rows });
  } catch (e) { res.status(500).json({ ok:false }); }
});

/* ----------------------------------------------------------------
   GAME LOGIC & SOCKETS
---------------------------------------------------------------- */
const getGameStates = async (gameId) => {
  const q = `
    SELECT gs.*, u.fullname, u.photo_url
    FROM game_states gs JOIN users u ON gs.user_id = u.id 
    WHERE gs.game_id=$1 ORDER BY gs.score DESC, gs.last_update ASC;
  `;
  const out = await pool.query(q, [gameId]);
  return out.rows.map(row => ({
    user_id: String(row.user_id),
    name: row.fullname,
    photo: row.photo_url,
    current_index: row.current_index,
    score: row.score,
    guessed_count: row.guessed_count,
    allowed_wrong: row.allowed_wrong,
    wrong_letters: Array.isArray(row.wrong_letters) ? row.wrong_letters : JSON.parse(row.wrong_letters || '[]'),
    correct_letters: Array.isArray(row.correct_letters) ? row.correct_letters : JSON.parse(row.correct_letters || '[]'),
    hints_used: row.hints_used,
    hints_allowed: row.hints_allowed,
    timer_ms: row.timer_ms,
    last_update: row.last_update
  }));
};

const advanceToNextWord = async (gameId, userId, currentIndex, deck, roomId = null) => {
  const nextIndex = currentIndex + 1;
  if (nextIndex >= deck.length) {
    // Game is over for this player
    await pool.query(`UPDATE game_states SET current_index=$3 WHERE game_id=$1 AND user_id=$2;`, [gameId, userId, nextIndex]);
    const playersState = await getGameStates(gameId);
    if (roomId) io.to(roomId).emit('game:finish', { game_id: gameId, by_user: userId, states: playersState });
    return null;
  }

  const nextWord = deck[nextIndex];
  const strictLen = normalizeFaWordStrict(nextWord.word).length;
  const hintsAllowedNext = Math.max(1, floor(strictLen / 3));
  const allowedWrongNext = Math.max(1, ceil(strictLen * 1.5));
  
  // 1.5x Rule applied here too
  await pool.query(`
    UPDATE game_states SET 
    current_index=$3, correct_letters='[]', wrong_letters='[]', hints_used=0, hints_allowed=$4, allowed_wrong=$5, last_update=NOW()
    WHERE game_id=$1 AND user_id=$2;
  `, [gameId, userId, nextIndex, hintsAllowedNext, allowedWrongNext]);
  
  const playersState = await getGameStates(gameId);
  const newState = await pool.query(`SELECT * FROM game_states WHERE game_id=$1 AND user_id=$2`, [gameId, userId]);
  
  if (roomId) {
    io.to(roomId).emit('game:next', { game_id: gameId, by_user: userId, nextIndex, states: playersState });
    io.to(roomId).emit('game:states', { game_id: gameId, states: playersState });
  }
  return newState.rows[0];
};

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

    // Broadcast presence count
    io.to(room_id).emit('room:presence', { room_id, count: roomSockets.get(room_id).size });
  });

  socket.on('game:letter', async ({ game_id, user_id, letter }) => {
    try {
      if (!game_id || !user_id || !letter) return;
      const normalized = normalizeFaLetter(String(letter));
      if (normalized.length !== 1 || !/\u0600-\u06FF/.test(normalized)) return; // Farsi letter check

      const gsRes = await pool.query(`SELECT * FROM game_states WHERE game_id=$1 AND user_id=$2`, [game_id, user_id]);
      const gs = gsRes.rows[0];
      if (!gs) return;

      let correctLetters = Array.isArray(gs.correct_letters) ? gs.correct_letters : JSON.parse(gs.correct_letters || '[]');
      let wrongLetters = Array.isArray(gs.wrong_letters) ? gs.wrong_letters : JSON.parse(gs.wrong_letters || '[]');

      if (correctLetters.includes(normalized) || wrongLetters.includes(normalized)) {
        socket.emit('game:feedback', { type: 'already-guessed' });
        return;
      }

      const gameRes = await pool.query(`SELECT room_id, deck FROM games WHERE id=$1`, [game_id]);
      const game = gameRes.rows[0];
      if (!game) return;
      const roomId = game.room_id;
      const deck = Array.isArray(game.deck) ? game.deck : JSON.parse(game.deck || '[]');

      const idx = Number(gs.current_index) || 0;
      const wordObj = deck[idx];
      if (!wordObj) return;
      const currentWord = normalizeFaWordKeepSpaces(wordObj.word);

      const roomRow = roomId ? await pool.query(`SELECT reveal_mode FROM rooms WHERE id=$1 LIMIT 1;`, [roomId]) : null;
      const reveal_mode = roomRow?.rows?.[0]?.reveal_mode || 'private';

      // 1. Check if correct
      const positions = [];
      for (let i = 0; i < currentWord.length; i++) if (currentWord[i] === normalized) positions.push(i);

      if (positions.length > 0) {
        // CORRECT
        correctLetters.push(normalized);
        const scoreDelta = 10 * positions.length;
        
        await pool.query(`UPDATE game_states SET correct_letters=$3::jsonb, score=score+$4, guessed_count=guessed_count+1, last_update=NOW() WHERE game_id=$1 AND user_id=$2;`, 
          [game_id, user_id, JSON.stringify(correctLetters), scoreDelta]);
        
        const updatedPlayer = await pool.query(`SELECT user_id, score, guessed_count FROM game_states WHERE game_id=$1 AND user_id=$2`, [game_id, user_id]);
        
        const payload = { user_id, letter: normalized, positions, scoreDelta, player: updatedPlayer.rows[0] };
        
        if (roomId && reveal_mode === 'shared') {
          io.to(roomId).emit('game:letter:correct', { ...payload, shared: true });
        } else {
          socket.emit('game:letter:correct', { ...payload, shared: false });
          if(roomId) socket.to(roomId).emit('game:states', { game_id, states: await getGameStates(game_id) }); // Update opponent's score/stats
        }

        // Check for WIN
        const requiredChars = normalizeFaWordStrict(currentWord);
        const uniqueRequired = [...new Set(requiredChars.split('').filter(c => c && c.trim() !== ''))];
        const isWin = [...uniqueRequired].every(char => correctLetters.includes(char));
        
        if(isWin) {
           await advanceToNextWord(game_id, user_id, idx, deck, roomId);
        }

      } else {
        // WRONG
        if (wrongLetters.length >= gs.allowed_wrong) {
          socket.emit('game:feedback', { type: 'wrong-limit' });
          return;
        }
        
        wrongLetters.push(normalized);
        const scoreDelta = -5;
        
        await pool.query(`UPDATE game_states SET wrong_letters=$3::jsonb, score=score+$4, guessed_count=guessed_count+1, last_update=NOW() WHERE game_id=$1 AND user_id=$2;`, 
          [game_id, user_id, JSON.stringify(wrongLetters), scoreDelta]);

        const updatedPlayer = await pool.query(`SELECT user_id, score, wrong_letters FROM game_states WHERE game_id=$1 AND user_id=$2`, [game_id, user_id]);

        socket.emit('game:letter:wrong', { user_id, letter: normalized, scoreDelta, player: updatedPlayer.rows[0] });
        if(roomId) io.to(roomId).emit('game:states', { game_id, states: await getGameStates(game_id) });
      }

    } catch (e) { console.error(e); }
  });

  socket.on('game:hint', async ({ game_id, user_id }) => {
    try {
      if (!game_id || !user_id) return;
      
      const gsRes = await pool.query(`SELECT * FROM game_states WHERE game_id=$1 AND user_id=$2`, [game_id, user_id]);
      const gs = gsRes.rows[0];
      if (!gs) return;

      const gameRes = await pool.query(`SELECT room_id, deck FROM games WHERE id=$1`, [game_id]);
      const game = gameRes.rows[0];
      if (!game) return;
      const roomId = game.room_id;
      const deck = Array.isArray(game.deck) ? game.deck : JSON.parse(game.deck || '[]');
      
      const idx = Number(gs.current_index) || 0;
      const wordObj = deck[idx];
      if (!wordObj) return;
      const currentWord = normalizeFaWordKeepSpaces(wordObj.word);

      const hintsUsed = Number(gs.hints_used) || 0;
      const hintsAllowed = Number(gs.hints_allowed) || 0;
      
      if (hintsUsed >= hintsAllowed) {
        socket.emit('game:feedback', { type: 'hint-limit' });
        return;
      }
      
      let correctLetters = Array.isArray(gs.correct_letters) ? gs.correct_letters : JSON.parse(gs.correct_letters || '[]');
      
      // Filter candidates
      const candidates = currentWord.split('').filter(ch => ch.trim() !== '' && ch !== '\u200c' && !correctLetters.includes(ch));
      
      const uniqueCandidates = [...new Set(candidates)];
      if (!uniqueCandidates.length) {
        socket.emit('game:feedback', { type: 'no-hint' });
        return;
      }

      const reveal = uniqueCandidates[Math.floor(Math.random() * uniqueCandidates.length)];
      correctLetters.push(reveal);

      const scoreDelta = -20; // Hint Penalty
      
      await pool.query(`
        UPDATE game_states SET 
        correct_letters=$3::jsonb, score=score+$4, hints_used=hints_used+1, last_update=NOW() 
        WHERE game_id=$1 AND user_id=$2;
      `, [game_id, user_id, JSON.stringify(correctLetters), scoreDelta]);

      const updatedPlayer = await pool.query(`SELECT user_id, score, hints_used, hints_allowed FROM game_states WHERE game_id=$1 AND user_id=$2`, [game_id, user_id]);

      socket.emit('game:hint:reveal', { user_id, letter: reveal, scoreDelta, player: updatedPlayer.rows[0] });
      if(roomId) io.to(roomId).emit('game:states', { game_id, states: await getGameStates(game_id) }); // Update opponent's stats
      
      // Check for WIN after hint (in case the last letter was revealed by a hint)
      const requiredChars = normalizeFaWordStrict(currentWord);
      const uniqueRequired = [...new Set(requiredChars.split('').filter(c => c && c.trim() !== ''))];
      const isWin = [...uniqueRequired].every(char => correctLetters.includes(char));
      
      if(isWin) {
         await advanceToNextWord(game_id, user_id, idx, deck, roomId);
      }

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
  await ensureSchema();
  server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
})();

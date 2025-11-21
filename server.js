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

async function getGameStates(gameId) {
  const q = `SELECT gs.*, u.fullname, u.username, u.photo_url 
             FROM game_states gs JOIN users u ON gs.user_id = u.id 
             WHERE gs.game_id = $1 ORDER BY gs.score DESC;`;
  const res = await pool.query(q, [gameId]);
  return res.rows.map(row => ({
    ...row,
    correct_letters: Array.isArray(row.correct_letters) ? row.correct_letters : JSON.parse(row.correct_letters || '[]'),
    wrong_letters: Array.isArray(row.wrong_letters) ? row.wrong_letters : JSON.parse(row.wrong_letters || '[]'),
    guess_history: Array.isArray(row.guess_history) ? row.guess_history : JSON.parse(row.guess_history || '[]'),
  }));
}

async function createGameState(gameId, userId, deck) { 
  const strictLen = normalizeFaWordStrict(deck[0]?.word || '').length;
  const hintsAllowed = Math.max(1, floor(strictLen / 3)); 
  const allowedWrong = Math.max(1, ceil(strictLen * 1.5));
  await pool.query(` 
    INSERT INTO game_states (game_id, user_id, current_index, correct_letters, wrong_letters, hints_used, hints_allowed, score, guessed_count, allowed_wrong, timer_ms, guess_history) 
    VALUES ($1,$2,0,'[]','[]',0,$3,0,0,$4,0,'[]') 
    ON CONFLICT (game_id, user_id) DO UPDATE SET 
      current_index = 0, correct_letters = '[]', wrong_letters = '[]', hints_used = 0, score = 0, guessed_count = 0, timer_ms = 0, guess_history = '[]', last_update = NOW();
  `, [gameId, userId, hintsAllowed, allowedWrong]);
}

async function advanceToNextWord(gameId, userId, currentWordIndex, deck, roomId) {
  const nextIndex = currentWordIndex + 1;
  const isLastWord = nextIndex >= deck.length; // Check if next word is beyond the deck size (10)
  
  // Game End Logic
  if (isLastWord) {
    const finalStates = await getGameStates(gameId); // Get all player states for scoring
    
    const finalPlayerScores = finalStates.map(s => ({
      user_id: s.user_id,
      score: Number(s.score),
      guessed_count: Number(s.guessed_count),
      timer_ms: Number(s.timer_ms) // Optional: Final time
    }));

    const gameResults = deck.map((wordObj, index) => {
      // Find the winner(s) for this word from players' guessed_count history (not ideal, but simple for now)
      const winnersForWord = finalStates
        .filter(s => s.guess_history.some(h => h.index === index && h.type === 'win'))
        .map(s => s.user_id);

      return { 
        word_index: index, 
        word: wordObj.word,
        description: wordObj.description,
        winners: winnersForWord 
      };
    });

    // Save final results to the games table
    await pool.query(`UPDATE games SET status='finished', finished_at=NOW(), results=$2::jsonb WHERE id=$1;`, 
      [gameId, JSON.stringify({ words: gameResults, scores: finalPlayerScores })]); 

    await pool.query(`UPDATE rooms SET status='finished' WHERE id=$1;`, [roomId]);
    
    // Emit game finished event with full data
    if (roomId) io.to(roomId).emit('game:finished', { 
        game_id: gameId, 
        results: { words: gameResults, scores: finalPlayerScores },
        deck: deck, 
        players: finalStates 
    });
    return;
  }
  
  // Continue to next word logic
  const nextWord = String(deck[nextIndex]?.word || '');
  const strictLen = normalizeFaWordStrict(nextWord).length;
  const hintsAllowedNext = Math.max(1, floor(strictLen / 3));
  const allowedWrongNext = Math.max(1, ceil(strictLen * 1.5));
  await pool.query(`UPDATE game_states SET current_index=$3, correct_letters='[]', wrong_letters='[]', hints_used=0, hints_allowed=$4, allowed_wrong=$5, last_update=NOW() WHERE game_id=$1 AND user_id=$2;`, [gameId, userId, nextIndex, hintsAllowedNext, allowedWrongNext]);
  
  const playersState = await getGameStates(gameId);
  const newState = await pool.query(`SELECT * FROM game_states WHERE game_id=$1 AND user_id=$2`, [gameId, userId]);
  
  if (roomId) { 
    io.to(roomId).emit('game:next', { game_id: gameId, by_user: userId, nextIndex, states: playersState }); 
    io.to(roomId).emit('game:states', { game_id: gameId, states: playersState });
  } 
  return newState.rows[0]; 
}

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
      id TEXT PRIMARY KEY, room_id TEXT, deck JSONB, level TEXT, status TEXT, 
      started_at TIMESTAMP, finished_at TIMESTAMP
    );`,
   
    // *** MIGRATION: Add results column if missing ***
    `ALTER TABLE games ADD COLUMN IF NOT EXISTS results JSONB DEFAULT '[]';`,
    
    `CREATE TABLE IF NOT EXISTS game_states (
      game_id TEXT, user_id BIGINT, current_index INT DEFAULT 0, correct_letters JSONB DEFAULT '[]', 
      wrong_letters JSONB DEFAULT '[]', hints_used INT DEFAULT 0, hints_allowed INT DEFAULT 0, 
      score INT DEFAULT 0, guessed_count INT DEFAULT 0, allowed_wrong INT DEFAULT 0, timer_ms BIGINT DEFAULT 0, 
      guess_history JSONB DEFAULT '[]', -- ADDED
      last_update TIMESTAMP DEFAULT NOW(), PRIMARY KEY (game_id, user_id)
    );`,
    // MIGRATION: Add guess_history if missing
    `ALTER TABLE game_states ADD COLUMN IF NOT EXISTS guess_history JSONB DEFAULT '[]';`
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
    // FIX: Fallback to username if first_name/last_name are missing (for Telegram Desktop)
    const fullname = `${user.first_name || ''}${user.last_name ? ' ' + user.last_name : ''}`.trim() || user.username || `کاربر ${uid}`;
    await pool.query(`
      INSERT INTO users (id, username, first_name, last_name, fullname, language_code, photo_url)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (id) DO 
      UPDATE SET 
        username = EXCLUDED.username, first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, fullname = EXCLUDED.fullname, photo_url = EXCLUDED.photo_url, updated_at = NOW();
    `, [uid, user.username, user.first_name, user.last_name, fullname, user.language_code, user.photo_url]);
    res.json({ ok:true });
  } catch (e) { console.error(e); res.status(500).json({ ok:false });
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
    q += ` GROUP BY r.id ORDER BY r.created_at DESC LIMIT 100;`;
    const out = await pool.query(q, params);
    res.json({ ok:true, rooms: out.rows });
  } catch (e) { res.status(500).json({ ok:false }); }
});

app.post('/rooms/myrooms', async (req, res) => {
  const { user_id } = req.body;
  if (!user_id) return res.status(400).json({ ok:false });
  try {
    // Fetch active and finished rooms
    const q = `
      SELECT 
        r.id as room_id, r.name, r.status, r.level, r.created_by, r.reveal_mode,
        g.id as game_id, g.started_at, g.finished_at,
        rp.role
      FROM room_players rp
      JOIN rooms r ON rp.room_id = r.id
      LEFT JOIN games g ON r.id = g.room_id 
      WHERE rp.user_id = $1
      ORDER BY r.status DESC, g.started_at DESC NULLS LAST;
    `;
    const out = await pool.query(q, [user_id]);
    
    // Separate active games (status='playing') and finished rooms (status='finished')
    const activeGames = out.rows.filter(r => r.status === 'playing' && r.game_id);
    const finishedRooms = out.rows.filter(r => r.status === 'finished' && r.game_id);
    
    res.json({ ok:true, active_games: activeGames, finished_rooms: finishedRooms });
  } catch (e) { console.error(e); res.status(500).json({ ok:false }); }
});

app.post('/games/history/:game_id', async (req, res) => {
  const { game_id } = req.params;
  const { user_id } = req.body;
  
  try {
    const gameQ = await pool.query(`SELECT * FROM games WHERE id=$1 AND status='finished' LIMIT 1;`, [game_id]);
    if (!gameQ.rows.length) return res.status(404).json({ ok: false, error: 'Game not found or not finished' });
    const game = gameQ.rows[0];
    
    // Check if user was a player in this game
    const playerCheck = await pool.query(`SELECT 1 FROM room_players WHERE room_id=$1 AND user_id=$2 LIMIT 1;`, [game.room_id, user_id]);
    if (!playerCheck.rows.length) return res.status(403).json({ ok: false, error: 'Access denied' });
    
    const states = await getGameStates(game_id); 
    
    res.json({ 
      ok: true, 
      game: { 
        id: game.id, 
        room_id: game.room_id, 
        level: game.level,
        started_at: game.started_at, 
        finished_at: game.finished_at 
      },
      deck: game.deck,
      results: game.results,
      player_states: states
    });
    
  } catch(e) { console.error('History Error:', e); res.status(500).json({ ok:false }); }
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
    if (Number(count.rows[0].cnt) >= (rn.max_players || 2)) 
    {
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
  } catch (e) { console.error('Join Error:', e);
    res.status(500).json({ ok:false }); }
});

app.post('/rooms/leave', async (req, res) => {
  const { room_id, user_id } = req.body;
  if (!room_id || !user_id) return res.status(400).json({ok:false});
  try {
    await pool.query(`DELETE FROM room_players WHERE room_id=$1 AND user_id=$2;`, [room_id, user_id]);
    const cntAfter = await pool.query(`SELECT COUNT(*) AS cnt FROM room_players WHERE room_id=$1;`, [room_id]);
    const players = await pool.query(`SELECT user_id FROM room_players WHERE room_id=$1 ORDER BY joined_at ASC;`, [room_id]);
    io.to(room_id).emit('room:presence', { room_id, count: Number(cntAfter.rows[0].cnt), players: players.rows });
    if(Number(cntAfter.rows[0].cnt) === 0) await pool.query(`UPDATE rooms SET status='finished' WHERE id=$1;`, [room_id]);
    res.json({ok:true});
  } catch(e) { res.status(500).json({ok:false}); }
});

app.post('/rooms/restart', async (req, res) => {
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
      FROM users u JOIN game_states gs ON u.id = gs.user_id 
      GROUP BY u.id 
      ORDER BY total_score DESC, games_played DESC 
      LIMIT 100;
    `);
    res.json({ ok: true, list: list.rows });
  } catch(e) { res.status(500).json({ok:false}); }
});

/* ----------------------------------------------------------------
   SOCKET.IO
---------------------------------------------------------------- */
const socketMeta = new Map();
const roomSockets = new Map();

io.on('connection', (socket) => {
  socket.on('room:join', async ({ room_id, user_id }) => {
    if (!room_id || !user_id) return;
    socket.join(room_id);
    const m = socketMeta.get(socket.id) || { room_ids: new Set() };
    m.room_ids.add(room_id);
    socketMeta.set(socket.id, m);
    
    let set = roomSockets.get(room_id);
    if (!set) { set = new Set(); roomSockets.set(room_id, set); }
    set.add(socket.id);
    
    const cntAfter = await pool.query(`SELECT COUNT(*) AS cnt FROM room_players WHERE room_id=$1;`, [room_id]);
    const players = await pool.query(`SELECT user_id FROM room_players WHERE room_id=$1 ORDER BY joined_at ASC;`, [room_id]);
    io.to(room_id).emit('room:presence', { room_id, count: Number(cntAfter.rows[0].cnt), players: players.rows });
    
    // Send current game state if room is playing
    const gameQ = await pool.query(`SELECT id, deck FROM games WHERE room_id=$1 AND status='active' LIMIT 1;`, [room_id]);
    if (gameQ.rows.length) {
      const gameId = gameQ.rows[0].id;
      const deck = gameQ.rows[0].deck;
      const gsq = await pool.query(`SELECT * FROM game_states WHERE game_id=$1 AND user_id=$2`, [gameId, user_id]);
      if (gsq.rows.length) {
        const roomQ = await pool.query(`SELECT reveal_mode FROM rooms WHERE id=$1`, [room_id]);
        const playersState = await getGameStates(gameId);
        socket.emit('game:state', { 
          game_id: gameId, 
          deck, 
          state: gsq.rows[0], 
          reveal_mode: roomQ.rows[0].reveal_mode, 
          players: playersState 
        });
      }
    }
  });

  socket.on('game:guess', async ({ game_id, user_id, letter }) => {
    try {
      if (!game_id || !user_id || !letter) return;
      
      const gsq = await pool.query(`SELECT * FROM game_states WHERE game_id=$1 AND user_id=$2`, [game_id, user_id]);
      const gq = await pool.query(`SELECT id, deck FROM games WHERE id=$1;`, [game_id]);
      if (!gsq.rows.length || !gq.rows.length) return;
      if (gq.rows[0].status === 'finished') return;
      
      const gs = gsq.rows[0];
      const deck = gq.rows[0].deck;
      const idx = Number(gs.current_index) || 0;
      const currentWordOrig = String(deck[idx]?.word || '');
      const currentWord = normalizeFaWordKeepSpaces(currentWordOrig);
      const currentWordStrict = normalizeFaWordStrict(currentWordOrig);
      
      const normalized = normalizeFaLetter(String(letter).trim());
      if (!normalized || normalized.length !== 1) return;
      
      let correctLetters = Array.isArray(gs.correct_letters) ? gs.correct_letters : JSON.parse(gs.correct_letters || '[]');
      let wrongLetters = Array.isArray(gs.wrong_letters) ? gs.wrong_letters : JSON.parse(gs.wrong_letters || '[]');
      let guessHistory = Array.isArray(gs.guess_history) ? gs.guess_history : JSON.parse(gs.guess_history || '[]'); // ADDED

      if (correctLetters.includes(normalized) || wrongLetters.includes(normalized)) { 
        socket.emit('game:feedback', { type: 'duplicate', letter: normalized }); 
        return;
      }
      
      // ADDED: Track the guess before processing
      guessHistory.push({ index: idx, letter: normalized, type: 'guess', timestamp: new Date().toISOString() });
      
      const gameRow = await pool.query(`SELECT room_id FROM games WHERE id=$1 LIMIT 1;`, [game_id]);
      const roomId = gameRow.rows[0]?.room_id;
      const roomRow = roomId ? await pool.query(`SELECT reveal_mode FROM rooms WHERE id=$1 LIMIT 1;`, [roomId]) : null;
      const reveal_mode = roomRow?.rows?.[0]?.reveal_mode || 'private';

      const positions = [];
      for (let i = 0; i < currentWord.length; i++) if (currentWord[i] === normalized) positions.push(i);

      let isCorrect = positions.length > 0;
      
      if (isCorrect) { 
        correctLetters.push(normalized);
        const scoreDelta = 10 * positions.length; 
        
        await pool.query(`UPDATE game_states SET correct_letters=$2::jsonb, score=score+$3, last_update=NOW(), guess_history=$5::jsonb WHERE game_id=$1 AND user_id=$4;`, 
          [game_id, JSON.stringify(correctLetters), scoreDelta, user_id, JSON.stringify(guessHistory)]);
        
        socket.emit('game:letter:correct', { user_id, letter: normalized, positions, score: scoreDelta, total_score: Number(gs.score) + scoreDelta });
        if (roomId && reveal_mode === 'public') io.to(roomId).emit('game:letter:correct', { user_id, letter: normalized, positions, score: scoreDelta, total_score: Number(gs.score) + scoreDelta });

      } else { 
        wrongLetters.push(normalized);
        const allowedWrong = Number(gs.allowed_wrong);
        const currentWrong = wrongLetters.length;
        let scorePenalty = 0;
        
        // Apply penalty only if the word has been guessed before
        if(Number(gs.guessed_count) > 0) scorePenalty = 5;

        await pool.query(`UPDATE game_states SET wrong_letters=$2::jsonb, score=GREATEST(0, score-$3), last_update=NOW(), guess_history=$5::jsonb WHERE game_id=$1 AND user_id=$4;`, 
          [game_id, JSON.stringify(wrongLetters), scorePenalty, user_id, JSON.stringify(guessHistory)]);

        socket.emit('game:letter:wrong', { user_id, letter: normalized, penalty: scorePenalty });
        if (roomId && reveal_mode === 'public') io.to(roomId).emit('game:letter:wrong', { user_id, letter: normalized, penalty: scorePenalty });
      }

      const uniqueRequired = new Set(currentWordStrict.split('').filter(c => c && c.trim() !== ''));
      const isWin = [...uniqueRequired].every(char => correctLetters.includes(char));

      if (isWin) {
        // ADDED: Track Win in History
        guessHistory.push({ index: idx, letter: '_WIN_', type: 'win', timestamp: new Date().toISOString() });
        await pool.query(`UPDATE game_states SET guessed_count=guessed_count+1, guess_history=$2::jsonb WHERE game_id=$1 AND user_id=$3;`, 
          [game_id, JSON.stringify(guessHistory), user_id]);
          
        socket.emit('game:word:win', { user_id, index: idx });
        if (roomId) io.to(roomId).emit('game:word:win', { user_id, index: idx });

        await advanceToNextWord(game_id, user_id, idx, deck, roomId);
      } else {
        const playersState = await getGameStates(game_id);
        if (roomId) io.to(roomId).emit('game:states', { game_id: game_id, states: playersState });
      }

    } catch (e) { console.error(e); }
  });

  socket.on('game:hint', async ({ game_id, user_id }) => {
    try {
      if (!game_id || !user_id) return;

      const gsq = await pool.query(`SELECT * FROM game_states WHERE game_id=$1 AND user_id=$2`, [game_id, user_id]);
      const gq = await pool.query(`SELECT id, deck FROM games WHERE id=$1;`, [game_id]);
      if (!gsq.rows.length || !gq.rows.length) return;
      if (gq.rows[0].status === 'finished') return;
      
      const gs = gsq.rows[0];
      const deck = gq.rows[0].deck;
      const idx = Number(gs.current_index) || 0;
      const currentWord = normalizeFaWordKeepSpaces(String(deck[idx]?.word || ''));
      const hintsUsed = Number(gs.hints_used) || 0;
      const hintsAllowed = Number(gs.hints_allowed);
      
      if (hintsUsed >= hintsAllowed) { 
        socket.emit('game:feedback', { type: 'hint:limit' }); 
        return; 
      }
      
      let correctLetters = Array.isArray(gs.correct_letters) ? gs.correct_letters : JSON.parse(gs.correct_letters || '[]');
      const currentWordStrict = normalizeFaWordStrict(currentWord);
      
      const availableLetters = [...new Set(currentWordStrict.split(''))].filter(c => !correctLetters.includes(c));
      if (!availableLetters.length) { 
        socket.emit('game:feedback', { type: 'hint:no_more' }); 
        return; 
      }

      const hintLetter = availableLetters[Math.floor(Math.random() * availableLetters.length)];
      correctLetters.push(hintLetter);

      const penalty = 20; // Hint penalty
      
      // ADDED: Track the hint in history
      let guessHistory = Array.isArray(gs.guess_history) ? gs.guess_history : JSON.parse(gs.guess_history || '[]');
      guessHistory.push({ index: idx, letter: '_HINT_', type: 'hint', hint_char: hintLetter, timestamp: new Date().toISOString() });
      
      await pool.query(`
        UPDATE game_states 
        SET hints_used=hints_used+1, score=GREATEST(0, score-$2), correct_letters=$4::jsonb, last_update=NOW(), guess_history=$5::jsonb
        WHERE game_id=$1 AND user_id=$3;
      `, [game_id, penalty, user_id, JSON.stringify(correctLetters), JSON.stringify(guessHistory)]);

      socket.emit('game:letter:hint', { user_id, letter: hintLetter, penalty });
      
      const gameRow = await pool.query(`SELECT room_id FROM games WHERE id=$1 LIMIT 1;`, [game_id]);
      const roomId = gameRow.rows[0]?.room_id;
      if (roomId) io.to(roomId).emit('game:letter:hint', { user_id, letter: hintLetter, penalty });
      
      const uniqueRequired = new Set(currentWordStrict.split('').filter(c => c && c.trim() !== ''));
      const isWin = [...uniqueRequired].every(char => correctLetters.includes(char));

      if (isWin) {
        // ADDED: Track Win in History
        guessHistory.push({ index: idx, letter: '_WIN_', type: 'win', timestamp: new Date().toISOString() });
        await pool.query(`UPDATE game_states SET guessed_count=guessed_count+1, guess_history=$2::jsonb WHERE game_id=$1 AND user_id=$3;`, 
          [game_id, JSON.stringify(guessHistory), user_id]);
          
        socket.emit('game:word:win', { user_id, index: idx });
        if (roomId) io.to(roomId).emit('game:word:win', { user_id, index: idx });
        
        await advanceToNextWord(game_id, user_id, idx, deck, roomId);
      } else {
        const playersState = await getGameStates(game_id);
        if (roomId) io.to(roomId).emit('game:states', { game_id: game_id, states: playersState });
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

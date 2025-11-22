require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const crypto = require('crypto');

// --- IMPORT WORDS ---
// طبق دستور شما، این فایل باید وجود داشته باشد.
const wordsData = require('./words'); 

const PORT = process.env.PORT || 3000;

const buildConnectionString = () => {
  let cs = process.env.DATABASE_URL;
  if (cs && !cs.includes('localhost') && !/sslmode=/i.test(cs)) cs += (cs.includes('?') ? '&' : '?') + 'sslmode=require';
  return cs;
};
const pool = new Pool({ 
  connectionString: buildConnectionString(), 
  ssl: buildConnectionString()?.includes('localhost') ? false : { rejectUnauthorized: false } 
});

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', methods: ['GET','POST'] } });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- HELPERS ---
const normalizeFaLetter = ch => ch ? (ch === '\u064A' ? '\u06CC' : (ch === '\u0643' ? '\u06A9' : ch)).normalize('NFC') : '';
const normalizeFaWordStrict = w => String(w || '').replace(/[\u0640\u064B-\u065F\u0670\u06D6-\u06ED]/g, '')
  .replace(/\u064A/g, '\u06CC').replace(/\u0643/g, '\u06A9')
  .replace(/[\s\u200c\u200d\u200b\u00a0]/g, '').normalize('NFC');

const newGameDeck = (level) => {
  const all = [];
  if(wordsData && wordsData.categories) {
    wordsData.categories.forEach(cat => {
      cat.words.filter(w => !level || w.level === level).forEach(w => {
        all.push({ word: w.text, category: cat.name, level: w.level, description: w.description });
      });
    });
  }
  return all.sort(() => 0.5 - Math.random()).slice(0, 10);
};

// --- FORMULAS ---
function getWordLimits(word) {
  const cleanWord = normalizeFaWordStrict(word);
  const len = cleanWord.length;
  return {
    allowedWrong: Math.max(1, Math.ceil(len * 1.5)), // 1.5 برابر
    allowedHints: Math.max(0, Math.floor(len * 1.3)) // 1.3 برابر
  };
}

// --- DB INIT ---
(async () => {
  await pool.query(`CREATE TABLE IF NOT EXISTS users (id BIGINT PRIMARY KEY, username TEXT, fullname TEXT, photo_url TEXT, created_at TIMESTAMP DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS rooms (id TEXT PRIMARY KEY, name TEXT, status TEXT DEFAULT 'waiting', level TEXT, max_players INT DEFAULT 2, created_by BIGINT, created_at TIMESTAMP DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS room_players (room_id TEXT, user_id BIGINT, role TEXT, joined_at TIMESTAMP DEFAULT NOW(), PRIMARY KEY (room_id, user_id))`);
  await pool.query(`CREATE TABLE IF NOT EXISTS games (id TEXT PRIMARY KEY, room_id TEXT, deck JSONB, status TEXT, started_at TIMESTAMP, finished_at TIMESTAMP, results JSONB DEFAULT '[]');`);
  await pool.query(`CREATE TABLE IF NOT EXISTS game_states (
    game_id TEXT, user_id BIGINT, current_index INT DEFAULT 0, 
    correct_letters JSONB DEFAULT '[]', wrong_letters JSONB DEFAULT '[]', 
    hints_used INT DEFAULT 0, hints_allowed INT DEFAULT 0, 
    score INT DEFAULT 0, allowed_wrong INT DEFAULT 5, 
    timer_ms BIGINT DEFAULT 0, last_update TIMESTAMP DEFAULT NOW(), 
    PRIMARY KEY (game_id, user_id)
  )`);
})();

async function getGamePlayers(gameId) {
  const res = await pool.query(`SELECT gs.*, u.fullname FROM game_states gs LEFT JOIN users u ON gs.user_id = u.id WHERE gs.game_id = $1`, [gameId]);
  return res.rows;
}

async function createGameState(gameId, userId, deck) {
  const word = deck[0]?.word || '';
  const limits = getWordLimits(word);
  await pool.query(`INSERT INTO game_states (game_id, user_id, allowed_wrong, hints_allowed) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [gameId, userId, limits.allowedWrong, limits.allowedHints]);
}

async function advanceToNextWord(gameId, userId, currentIdx, deck, roomId) {
  // ثبت نتیجه کلمه فعلی در آرایه results بازی
  if(deck[currentIdx]) {
    await pool.query(`UPDATE games SET results = COALESCE(results, '[]'::jsonb) || $1::jsonb WHERE id=$2`, 
      [JSON.stringify({ index: currentIdx, word: deck[currentIdx].word, winners: [userId] }), gameId]);
  }

  const nextIndex = currentIdx + 1;

  if(nextIndex >= deck.length) {
    // پایان بازی
    await pool.query(`UPDATE games SET status='finished', finished_at=NOW() WHERE id=$1`, [gameId]);
    await pool.query(`UPDATE rooms SET status='finished' WHERE id=$1`, [roomId]);
    const gameRes = await pool.query(`SELECT results FROM games WHERE id=$1`, [gameId]);
    io.to(roomId).emit('game:finished', { results: gameRes.rows[0].results });
    return;
  }

  // کلمه بعدی
  const nextWord = deck[nextIndex].word;
  const limits = getWordLimits(nextWord);
  
  await pool.query(`
    UPDATE game_states 
    SET current_index=$3, correct_letters='[]', wrong_letters='[]', 
        hints_used=0, allowed_wrong=$4, hints_allowed=$5 
    WHERE game_id=$1 AND user_id=$2
  `, [gameId, userId, nextIndex, limits.allowedWrong, limits.allowedHints]);

  const newState = {
    current_index: nextIndex, correct_letters: [], wrong_letters: [],
    allowed_wrong: limits.allowedWrong, hints_allowed: limits.allowedHints, hints_used: 0
  };
  
  io.to(roomId).emit('game:next', { game_id: gameId, user_id: userId, newState });
  const players = await getGamePlayers(gameId);
  io.to(roomId).emit('game:states', { game_id: gameId, states: players });
}

// --- ROUTES ---
app.post('/auth/telegram', async (req, res) => {
  const { user } = req.body;
  const name = (user.first_name + ' ' + (user.last_name||'')).trim();
  await pool.query(`INSERT INTO users (id, username, fullname, photo_url) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO UPDATE SET fullname=EXCLUDED.fullname`, [user.id, user.username, name, user.photo_url]);
  res.json({ok:true});
});

app.get('/rooms/list', async (req, res) => {
  let q = `SELECT r.*, COUNT(rp.user_id)::int as players FROM rooms r LEFT JOIN room_players rp ON r.id=rp.room_id WHERE r.status != 'finished'`;
  if(req.query.level) q += ` AND r.level = '${req.query.level}'`;
  q += ` GROUP BY r.id ORDER BY r.created_at DESC`;
  const { rows } = await pool.query(q);
  res.json({ ok: true, rooms: rows });
});

app.post('/rooms/create', async (req, res) => {
  const { user_id, name, level } = req.body;
  const rid = crypto.randomUUID();
  await pool.query(`INSERT INTO rooms (id, name, level, created_by) VALUES ($1,$2,$3,$4)`, [rid, name||'بی‌نام', level||'medium', user_id]);
  await pool.query(`INSERT INTO room_players (room_id, user_id, role) VALUES ($1,$2,'host')`, [rid, user_id]);
  res.json({ok:true, room_id: rid});
});

app.post('/rooms/join', async (req, res) => {
  const { room_id, user_id } = req.body;
  await pool.query(`INSERT INTO room_players (room_id, user_id, role) VALUES ($1,$2,'player') ON CONFLICT DO NOTHING`, [room_id, user_id]);
  
  const room = (await pool.query(`SELECT * FROM rooms WHERE id=$1`, [room_id])).rows[0];
  const players = (await pool.query(`SELECT * FROM room_players WHERE room_id=$1`, [room_id])).rows;
  let gameId = null;
  
  if(room.status === 'playing') {
    const g = (await pool.query(`SELECT id, deck FROM games WHERE room_id=$1 AND status='active'`, [room_id])).rows[0];
    if(g) { gameId = g.id; await createGameState(gameId, user_id, g.deck); }
  } else if(room.status === 'waiting' && players.length >= (room.max_players||2)) {
    gameId = crypto.randomUUID();
    const deck = newGameDeck(room.level);
    await pool.query(`INSERT INTO games (id, room_id, deck, status, started_at) VALUES ($1,$2,$3,'active',NOW())`, [gameId, room_id, JSON.stringify(deck)]);
    await pool.query(`UPDATE rooms SET status='playing' WHERE id=$1`, [room_id]);
    for(const p of players) await createGameState(gameId, p.user_id, deck);
    
    const limits = getWordLimits(deck[0].word);
    const gps = await getGamePlayers(gameId);
    io.to(room_id).emit('game:started', { game_id: gameId, deck, players: gps, first_limits: limits });
  }
  res.json({ ok:true, game_id: gameId });
});

app.post('/rooms/state', async (req, res) => {
  const g = (await pool.query(`SELECT * FROM games WHERE room_id=$1 AND status='active'`, [req.body.room_id])).rows[0];
  res.json({ ok:true, game: g });
});

app.post('/rooms/leave', async (req, res) => {
  await pool.query(`DELETE FROM room_players WHERE room_id=$1 AND user_id=$2`, [req.body.room_id, req.body.user_id]);
  res.json({ok:true});
});

// --- HISTORY ENDPOINT (NEW) ---
app.post('/stats/history', async (req, res) => {
  const { user_id } = req.body;
  try {
    // بازی‌هایی که کاربر در آن‌ها شرکت داشته (از طریق game_states)
    const result = await pool.query(`
      SELECT 
        g.id, g.finished_at, g.results, 
        r.name as room_name, 
        gs.score 
      FROM game_states gs
      JOIN games g ON gs.game_id = g.id
      JOIN rooms r ON g.room_id = r.id
      WHERE gs.user_id = $1 AND g.status = 'finished'
      ORDER BY g.finished_at DESC
      LIMIT 20
    `, [user_id]);
    
    res.json({ ok: true, games: result.rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false });
  }
});

// --- SOCKETS ---
io.on('connection', (socket) => {
  socket.on('join-room', ({room_id}) => socket.join(room_id));

  socket.on('game:resume', async ({game_id, user_id}) => {
    const game = (await pool.query(`SELECT * FROM games WHERE id=$1`, [game_id])).rows[0];
    if(!game) return;
    let state = (await pool.query(`SELECT * FROM game_states WHERE game_id=$1 AND user_id=$2`, [game_id, user_id])).rows[0];
    if(!state) { await createGameState(game_id, user_id, game.deck); state = (await pool.query(`SELECT * FROM game_states WHERE game_id=$1 AND user_id=$2`, [game_id, user_id])).rows[0]; }
    socket.emit('game:state', { state, deck: game.deck, players: await getGamePlayers(game_id) });
  });

  socket.on('game:guess', async ({game_id, user_id, letter}) => {
    const gs = (await pool.query(`SELECT * FROM game_states WHERE game_id=$1 AND user_id=$2`, [game_id, user_id])).rows[0];
    const game = (await pool.query(`SELECT * FROM games WHERE id=$1`, [game_id])).rows[0];
    if(!gs || !game) return;

    const deck = game.deck;
    const idx = gs.current_index;
    const target = normalizeFaWordStrict(deck[idx].word);
    const input = normalizeFaLetter(letter);
    let correct = gs.correct_letters || [], wrong = gs.wrong_letters || [];

    if(correct.includes(input) || wrong.includes(input)) return;

    if(target.includes(input)) {
      correct.push(input);
      const delta = 10 * (target.split(input).length - 1);
      await pool.query(`UPDATE game_states SET correct_letters=$1, score=score+$2 WHERE game_id=$3 AND user_id=$4`, [JSON.stringify(correct), delta, game_id, user_id]);
      socket.emit('game:letter:correct', { user_id, letter: input, scoreDelta: delta });
      
      if([...new Set(target.split(''))].every(c => correct.includes(c))) {
        await advanceToNextWord(game_id, user_id, idx, deck, game.room_id);
      } else {
        io.to(game.room_id).emit('game:states', { game_id, states: await getGamePlayers(game_id) });
      }
    } else {
      wrong.push(input);
      const WRONG_PENALTY = 2;
      await pool.query(`UPDATE game_states SET wrong_letters=$1, score=GREATEST(score-$2, 0) WHERE game_id=$3 AND user_id=$4`, [JSON.stringify(wrong), WRONG_PENALTY, game_id, user_id]);
      socket.emit('game:letter:wrong', { user_id, letter: input, scoreDelta: -WRONG_PENALTY });

      if(wrong.length >= gs.allowed_wrong) {
         await pool.query(`UPDATE game_states SET score=GREATEST(score-5, 0) WHERE game_id=$1 AND user_id=$2`, [game_id, user_id]);
         await advanceToNextWord(game_id, user_id, idx, deck, game.room_id);
      } else {
         io.to(game.room_id).emit('game:states', { game_id, states: await getGamePlayers(game_id) });
      }
    }
  });

  socket.on('game:hint', async ({game_id, user_id}) => {
    const gs = (await pool.query(`SELECT * FROM game_states WHERE game_id=$1 AND user_id=$2`, [game_id, user_id])).rows[0];
    if(!gs) return;
    if(gs.hints_used >= gs.hints_allowed) return;

    const game = (await pool.query(`SELECT * FROM games WHERE id=$1`, [game_id])).rows[0];
    const target = normalizeFaWordStrict(game.deck[gs.current_index].word);
    const correct = gs.correct_letters || [];
    const missing = [...target].filter(c => !correct.includes(c));
    
    if(missing.length) {
      const reveal = missing[Math.floor(Math.random() * missing.length)];
      correct.push(reveal);
      const HINT_PENALTY = 5;
      await pool.query(`UPDATE game_states SET correct_letters=$1, score=GREATEST(score-$2, 0), hints_used=hints_used+1 WHERE game_id=$3 AND user_id=$4`, [JSON.stringify(correct), HINT_PENALTY, game_id, user_id]);
      socket.emit('game:letter:correct', { user_id, letter: reveal, scoreDelta: -HINT_PENALTY });
      
      if([...new Set(target.split(''))].every(c => correct.includes(c))) {
         await advanceToNextWord(game_id, user_id, gs.current_index, game.deck, game.room_id);
      } else {
         io.to(game.room_id).emit('game:states', { game_id, states: await getGamePlayers(game_id) });
      }
    }
  });
});

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));

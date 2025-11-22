require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;

// --- DB SETUP ---
const buildConnectionString = () => {
  let cs = process.env.DATABASE_URL;
  if (cs && !/sslmode=/i.test(cs)) cs += (cs.includes('?') ? '&' : '?') + 'sslmode=require';
  if (cs) return cs;
  const { PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE } = process.env;
  if (PGHOST && PGUSER && PGPASSWORD && PGDATABASE) 
    return `postgresql://${encodeURIComponent(PGUSER)}:${encodeURIComponent(PGPASSWORD)}@${PGHOST}:${PGPORT || 5432}/${PGDATABASE}?sslmode=require`;
  return null;
};

const pool = new Pool({ 
  connectionString: buildConnectionString(), 
  ssl: { rejectUnauthorized: false } 
});

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', methods: ['GET','POST'] } });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const wordsData = require('./words'); // Assumed existing file

// --- HELPERS ---
const normalizeFaLetter = ch => {
  if (!ch) return '';
  return (ch === '\u064A' ? '\u06CC' : (ch === '\u0643' ? '\u06A9' : ch)).normalize('NFC');
};
const normalizeFaWordStrict = w => {
  if (!w) return '';
  return String(w).replace(/[\u0640\u064B-\u065F\u0670\u06D6-\u06ED]/g, '')
    .replace(/\u064A/g, '\u06CC').replace(/\u0643/g, '\u06A9')
    .replace(/[\s\u200c\u200d\u200b\u00a0]/g, '').normalize('NFC');
};

const newGameDeckForRoom = (roomId, level) => {
  const all = [];
  wordsData.categories.forEach(cat => {
    cat.words.filter(w => !level || w.level === level).forEach(w => {
      all.push({ word: w.text, category: cat.name, level: w.level, description: w.description });
    });
  });
  if(!all.length) return [];
  // Shuffle deterministic based on roomId for fairness if needed, or random
  return all.sort(() => 0.5 - Math.random()).slice(0, 10);
};

// --- DB INIT ---
(async () => {
  const queries = [
    `CREATE TABLE IF NOT EXISTS users (id BIGINT PRIMARY KEY, username TEXT, fullname TEXT, photo_url TEXT, created_at TIMESTAMP DEFAULT NOW());`,
    `CREATE TABLE IF NOT EXISTS rooms (id TEXT PRIMARY KEY, name TEXT, status TEXT DEFAULT 'waiting', level TEXT, max_players INT DEFAULT 2, created_by BIGINT, created_at TIMESTAMP DEFAULT NOW());`,
    `CREATE TABLE IF NOT EXISTS room_players (room_id TEXT, user_id BIGINT, role TEXT, joined_at TIMESTAMP DEFAULT NOW(), PRIMARY KEY (room_id, user_id));`,
    `CREATE TABLE IF NOT EXISTS games (id TEXT PRIMARY KEY, room_id TEXT, deck JSONB, status TEXT, started_at TIMESTAMP, results JSONB DEFAULT '[]');`,
    `CREATE TABLE IF NOT EXISTS game_states (
      game_id TEXT, user_id BIGINT, current_index INT DEFAULT 0, 
      correct_letters JSONB DEFAULT '[]', wrong_letters JSONB DEFAULT '[]', 
      hints_used INT DEFAULT 0, score INT DEFAULT 0, allowed_wrong INT DEFAULT 5, 
      timer_ms BIGINT DEFAULT 0, last_update TIMESTAMP DEFAULT NOW(), 
      PRIMARY KEY (game_id, user_id)
    );`
  ];
  for(const q of queries) await pool.query(q);
})();

// --- QUERIES ---
async function getGamePlayers(gameId) {
  const res = await pool.query(`
    SELECT gs.*, u.fullname, u.photo_url 
    FROM game_states gs 
    LEFT JOIN users u ON gs.user_id = u.id 
    WHERE gs.game_id = $1
  `, [gameId]);
  
  // Add derived stats (e.g., wrong attempts count)
  return res.rows.map(p => ({
    ...p,
    wrong_attempts: (p.wrong_letters || []).length
  }));
}

async function createGameState(gameId, userId, deck) {
  const word = deck[0]?.word || '';
  const allowed = Math.max(1, Math.ceil(normalizeFaWordStrict(word).length * 1.5));
  await pool.query(`
    INSERT INTO game_states (game_id, user_id, allowed_wrong) VALUES ($1,$2,$3) 
    ON CONFLICT (game_id, user_id) DO NOTHING
  `, [gameId, userId, allowed]);
}

// --- CORE GAME LOGIC (Real-time Fixes) ---
async function advanceToNextWord(gameId, userId, currentIdx, deck, roomId) {
  const wordObj = deck[currentIdx];
  
  // 1. Record Result
  if(wordObj) {
    await pool.query(`
      UPDATE games SET results = COALESCE(results, '[]'::jsonb) || $1::jsonb 
      WHERE id=$2
    `, [JSON.stringify({ 
         index: currentIdx, 
         word: wordObj.word, 
         winners: [userId] // Simple recording, can be expanded
       }), gameId]);
  }

  const nextIndex = currentIdx + 1;
  
  // 2. Check End Game
  if(nextIndex >= deck.length) {
    await pool.query(`UPDATE games SET status='finished' WHERE id=$1`, [gameId]);
    await pool.query(`UPDATE rooms SET status='finished' WHERE id=$1`, [roomId]);
    
    const gameRes = await pool.query(`SELECT results FROM games WHERE id=$1`, [gameId]);
    io.to(roomId).emit('game:finished', { results: gameRes.rows[0].results });
    return;
  }

  // 3. Reset State for Next Word
  const nextWord = deck[nextIndex].word;
  const allowed = Math.max(1, Math.ceil(normalizeFaWordStrict(nextWord).length * 1.5));
  
  await pool.query(`
    UPDATE game_states 
    SET current_index=$3, correct_letters='[]', wrong_letters='[]', allowed_wrong=$4, hints_used=0 
    WHERE game_id=$1 AND user_id=$2
  `, [gameId, userId, nextIndex, allowed]);

  // 4. Emit Immediate Update for Local User (Fast Render)
  // Construct the new clean state object
  const cleanState = {
    current_index: nextIndex,
    correct_letters: [],
    wrong_letters: [],
    allowed_wrong: allowed,
    hints_used: 0
  };
  
  io.to(roomId).emit('game:next', { 
    game_id: gameId, 
    user_id: userId, 
    newState: cleanState 
  });

  // 5. Emit Global Update for Progress Bars
  const players = await getGamePlayers(gameId);
  io.to(roomId).emit('game:states', { game_id: gameId, states: players });
}


// --- ROUTES ---
app.post('/auth/telegram', async (req, res) => {
  const { user } = req.body;
  const name = (user.first_name + ' ' + (user.last_name||'')).trim();
  await pool.query(`
    INSERT INTO users (id, username, fullname, photo_url) VALUES ($1,$2,$3,$4)
    ON CONFLICT (id) DO UPDATE SET fullname=EXCLUDED.fullname, photo_url=EXCLUDED.photo_url
  `, [user.id, user.username, name, user.photo_url]);
  res.json({ok:true});
});

app.get('/rooms/list', async (req, res) => {
  const level = req.query.level;
  let q = `SELECT r.*, COUNT(rp.user_id)::int as players FROM rooms r 
           LEFT JOIN room_players rp ON r.id=rp.room_id 
           WHERE r.status != 'finished'`;
  if(level) q += ` AND r.level = '${level}'`;
  q += ` GROUP BY r.id ORDER BY r.created_at DESC`;
  const { rows } = await pool.query(q);
  res.json({ ok: true, rooms: rows });
});

app.post('/rooms/create', async (req, res) => {
  const { user_id, name, level } = req.body;
  const rid = crypto.randomUUID();
  await pool.query(`INSERT INTO rooms (id, name, level, created_by) VALUES ($1,$2,$3,$4)`, 
    [rid, name||'بدون نام', level||'medium', user_id]);
  await pool.query(`INSERT INTO room_players (room_id, user_id, role) VALUES ($1,$2,'host')`, [rid, user_id]);
  res.json({ok:true, room_id: rid});
});

app.post('/rooms/join', async (req, res) => {
  const { room_id, user_id } = req.body;
  
  // Join Room
  await pool.query(`INSERT INTO room_players (room_id, user_id, role) VALUES ($1,$2,'player') ON CONFLICT DO NOTHING`, [room_id, user_id]);
  
  // Check if game active or start new
  const room = (await pool.query(`SELECT * FROM rooms WHERE id=$1`, [room_id])).rows[0];
  const players = (await pool.query(`SELECT * FROM room_players WHERE room_id=$1`, [room_id])).rows;
  
  let gameId = null;
  
  // If playing, return active game
  if(room.status === 'playing') {
    const g = (await pool.query(`SELECT id, deck FROM games WHERE room_id=$1 AND status='active'`, [room_id])).rows[0];
    if(g) {
      gameId = g.id;
      await createGameState(gameId, user_id, g.deck);
    }
  }
  // If waiting and full (2 players for now), start
  else if(room.status === 'waiting' && players.length >= (room.max_players||2)) {
    gameId = crypto.randomUUID();
    const deck = newGameDeckForRoom(room_id, room.level);
    await pool.query(`INSERT INTO games (id, room_id, deck, status, started_at) VALUES ($1,$2,$3,'active',NOW())`, [gameId, room_id, JSON.stringify(deck)]);
    await pool.query(`UPDATE rooms SET status='playing' WHERE id=$1`, [room_id]);
    
    for(const p of players) await createGameState(gameId, p.user_id, deck);
    
    // Notify Start
    const gps = await getGamePlayers(gameId);
    io.to(room_id).emit('game:started', { game_id: gameId, deck, players: gps });
  }

  res.json({ ok:true, game_id: gameId });
});

app.post('/rooms/state', async (req, res) => {
  const { room_id } = req.body;
  const game = (await pool.query(`SELECT * FROM games WHERE room_id=$1 AND status='active'`, [room_id])).rows[0];
  res.json({ ok:true, game });
});

app.post('/rooms/leave', async (req, res) => {
  await pool.query(`DELETE FROM room_players WHERE room_id=$1 AND user_id=$2`, [req.body.room_id, req.body.user_id]);
  res.json({ok:true});
});

// --- SOCKETS ---
io.on('connection', (socket) => {
  socket.on('join-room', ({room_id, user_id}) => {
    socket.join(room_id);
  });

  socket.on('game:resume', async ({game_id, user_id}) => {
    const game = (await pool.query(`SELECT * FROM games WHERE id=$1`, [game_id])).rows[0];
    if(!game) return;
    let state = (await pool.query(`SELECT * FROM game_states WHERE game_id=$1 AND user_id=$2`, [game_id, user_id])).rows[0];
    if(!state) {
      await createGameState(game_id, user_id, game.deck);
      state = (await pool.query(`SELECT * FROM game_states WHERE game_id=$1 AND user_id=$2`, [game_id, user_id])).rows[0];
    }
    const players = await getGamePlayers(game_id);
    socket.emit('game:state', { state, deck: game.deck, players });
  });

  socket.on('game:guess', async ({game_id, user_id, letter}) => {
    const gs = (await pool.query(`SELECT * FROM game_states WHERE game_id=$1 AND user_id=$2`, [game_id, user_id])).rows[0];
    const game = (await pool.query(`SELECT * FROM games WHERE id=$1`, [game_id])).rows[0];
    if(!gs || !game) return;

    const deck = game.deck;
    const idx = gs.current_index;
    const targetWord = normalizeFaWordStrict(deck[idx].word);
    const input = normalizeFaLetter(letter);

    let correct = gs.correct_letters || [];
    let wrong = gs.wrong_letters || [];

    if(correct.includes(input) || wrong.includes(input)) return; // Duplicate

    if(targetWord.includes(input)) {
      // CORRECT
      correct.push(input);
      const scoreDelta = 10 * (targetWord.split(input).length - 1); // 10 points per occurrence
      
      await pool.query(`UPDATE game_states SET correct_letters=$1, score=score+$2 WHERE game_id=$3 AND user_id=$4`, 
        [JSON.stringify(correct), scoreDelta, game_id, user_id]);
        
      socket.emit('game:letter:correct', { user_id, letter: input, scoreDelta });
      
      // Check Win
      const distinctChars = [...new Set(targetWord.split(''))];
      const isWin = distinctChars.every(c => correct.includes(c));
      
      if(isWin) {
        // Trigger Next Word Logic
        await advanceToNextWord(game_id, user_id, idx, deck, game.room_id);
      } else {
        // Broadcast stats update even if not win
        const players = await getGamePlayers(game_id);
        io.to(game.room_id).emit('game:states', { game_id, states: players });
      }
      
    } else {
      // WRONG
      wrong.push(input);
      await pool.query(`UPDATE game_states SET wrong_letters=$1 WHERE game_id=$2 AND user_id=$3`, 
        [JSON.stringify(wrong), game_id, user_id]);
        
      socket.emit('game:letter:wrong', { user_id, letter: input });
      
      if(wrong.length >= gs.allowed_wrong) {
        // Max failure, move next
        await pool.query(`UPDATE game_states SET score=GREATEST(score-5, 0) WHERE game_id=$1 AND user_id=$2`, [game_id, user_id]);
        await advanceToNextWord(game_id, user_id, idx, deck, game.room_id);
      } else {
        const players = await getGamePlayers(game_id);
        io.to(game.room_id).emit('game:states', { game_id, states: players });
      }
    }
  });

  socket.on('game:hint', async ({game_id, user_id}) => {
    // Simplified hint logic: reveal 1 random missing char, cost 5 points
    const gs = (await pool.query(`SELECT * FROM game_states WHERE game_id=$1 AND user_id=$2`, [game_id, user_id])).rows[0];
    if(!gs) return;
    
    const game = (await pool.query(`SELECT * FROM games WHERE id=$1`, [game_id])).rows[0];
    const targetWord = normalizeFaWordStrict(game.deck[gs.current_index].word);
    const correct = gs.correct_letters || [];
    
    const missing = [...targetWord].filter(c => !correct.includes(c));
    if(!missing.length) return;
    
    const reveal = missing[Math.floor(Math.random() * missing.length)];
    correct.push(reveal);
    
    await pool.query(`UPDATE game_states SET correct_letters=$1, score=GREATEST(score-5, 0), hints_used=hints_used+1 WHERE game_id=$2 AND user_id=$3`, 
      [JSON.stringify(correct), game_id, user_id]);

    // Emit correct letter event (so UI animates it)
    socket.emit('game:letter:correct', { user_id, letter: reveal, scoreDelta: -5 });
    
    // Check Win (Copy paste logic essentially)
    const distinctChars = [...new Set(targetWord.split(''))];
    const isWin = distinctChars.every(c => correct.includes(c));
    if(isWin) {
       await advanceToNextWord(game_id, user_id, gs.current_index, game.deck, game.room_id);
    } else {
       const players = await getGamePlayers(game_id);
       io.to(game.room_id).emit('game:states', { game_id, states: players });
    }
  });
});

server.listen(PORT, () => console.log(`Server on ${PORT}`));

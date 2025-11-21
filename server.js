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
const pool = new Pool({ 
  connectionString, 
  ssl: connectionString ? { rejectUnauthorized: false } : undefined,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

const app = express();
const server = http.createServer(app);
const io = new Server(server, { 
  cors: { 
    origin: process.env.ALLOWED_ORIGINS || '*', 
    methods: ['GET','POST'] 
  } 
});

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const wordsData = require('./words');

/* ----------------------------------------------------------------
   GAME CONFIGURATION
---------------------------------------------------------------- */
const GAME_CONFIG = {
  MAX_PLAYERS: 4,
  WORDS_PER_GAME: 10,
  HINT_PENALTY: 10,
  CORRECT_LETTER_SCORE: 10,
  WRONG_LETTER_PENALTY: 5,
  BASE_ALLOWED_WRONG_MULTIPLIER: 1.5,
  BASE_HINTS_MULTIPLIER: 0.33
};

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
        description: w.description,
        length: normalizeFaWordStrict(w.text).length
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
  return a.slice(0, Math.min(GAME_CONFIG.WORDS_PER_GAME, a.length)); 
};

const calculateGameParameters = (wordLength) => {
  return {
    hintsAllowed: Math.max(1, floor(wordLength * GAME_CONFIG.BASE_HINTS_MULTIPLIER)),
    allowedWrong: Math.max(1, ceil(wordLength * GAME_CONFIG.BASE_ALLOWED_WRONG_MULTIPLIER))
  };
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
      max_players INT DEFAULT ${GAME_CONFIG.MAX_PLAYERS}, created_by BIGINT, reveal_mode TEXT DEFAULT 'private', created_at TIMESTAMP DEFAULT NOW()
    );`,
    `CREATE TABLE IF NOT EXISTS room_players (
      room_id TEXT, user_id BIGINT, role TEXT, joined_at TIMESTAMP DEFAULT NOW(), PRIMARY KEY (room_id, user_id)
    );`,
    `CREATE TABLE IF NOT EXISTS games (
      id TEXT PRIMARY KEY, room_id TEXT, deck JSONB, level TEXT, status TEXT, 
      started_at TIMESTAMP, finished_at TIMESTAMP
    );`,
    `ALTER TABLE games ADD COLUMN IF NOT EXISTS results JSONB DEFAULT '[]';`,
    
    `CREATE TABLE IF NOT EXISTS game_states (
      game_id TEXT, user_id BIGINT, current_index INT DEFAULT 0, correct_letters JSONB DEFAULT '[]', 
      wrong_letters JSONB DEFAULT '[]', hints_used INT DEFAULT 0, hints_allowed INT DEFAULT 0, 
      score INT DEFAULT 0, guessed_count INT DEFAULT 0, allowed_wrong INT DEFAULT 0, timer_ms BIGINT DEFAULT 0, 
      last_update TIMESTAMP DEFAULT NOW(), PRIMARY KEY (game_id, user_id)
    );`,
    
    // ایجاد ایندکس برای بهبود عملکرد
    `CREATE INDEX IF NOT EXISTS idx_game_states_user_id ON game_states(user_id);`,
    `CREATE INDEX IF NOT EXISTS idx_game_states_game_id ON game_states(game_id);`,
    `CREATE INDEX IF NOT EXISTS idx_rooms_status ON rooms(status);`,
    `CREATE INDEX IF NOT EXISTS idx_games_status ON games(status);`,
    `CREATE INDEX IF NOT EXISTS idx_games_room_id ON games(room_id);`
  ];
  
  for(const q of queries) {
    try {
      await pool.query(q);
    } catch (error) {
      console.error('Schema creation error:', error);
    }
  }
};

// تابع کمکی برای دریافت اطلاعات کامل بازیکنان یک اتاق
async function getRoomPlayersWithDetails(roomId) {
  try {
    const query = `
      SELECT 
        rp.user_id,
        rp.role,
        u.fullname,
        u.photo_url,
        u.username,
        (SELECT COUNT(*) FROM game_states gs 
         JOIN games g ON gs.game_id = g.id 
         WHERE gs.user_id = u.id AND g.status = 'finished') as total_games,
        (SELECT COALESCE(SUM(score), 0) FROM game_states WHERE user_id = u.id) as total_score
      FROM room_players rp
      LEFT JOIN users u ON rp.user_id = u.id
      WHERE rp.room_id = $1
      ORDER BY rp.joined_at ASC
    `;
    const result = await pool.query(query, [roomId]);
    return result.rows;
  } catch (error) {
    console.error('Error getting room players:', error);
    return [];
  }
}

// تابع برای محاسبه آمار بازیکن
async function getPlayerStats(userId) {
  try {
    const statsQuery = `
      SELECT 
        COUNT(DISTINCT game_id) as games_played,
        COALESCE(SUM(score), 0) as total_score,
        COALESCE(AVG(score), 0) as avg_score,
        MAX(score) as best_score,
        COALESCE(SUM(guessed_count), 0) as total_guesses,
        COALESCE(SUM(hints_used), 0) as total_hints_used
      FROM game_states 
      WHERE user_id = $1
    `;
    const statsResult = await pool.query(statsQuery, [userId]);
    return statsResult.rows[0];
  } catch (error) {
    console.error('Error getting player stats:', error);
    return null;
  }
}

/* ----------------------------------------------------------------
   API ROUTES - IMPROVED
---------------------------------------------------------------- */
app.post('/auth/telegram', async (req, res) => {
  const { user } = req.body;
  try {
    const uid = Number(user?.id);
    if (!uid) return res.status(400).json({ ok:false, error: 'Invalid user data' });
    
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
  } catch (e) { 
    console.error('Auth error:', e); 
    res.status(500).json({ ok:false, error: 'Internal server error' }); 
  }
});

app.get('/rooms/list', async (req, res) => {
  try {
    const level = req.query.level;
    let q = `
      SELECT 
        r.id, r.name, r.level, r.status, r.max_players, r.created_by, r.reveal_mode, 
        COUNT(rp.user_id) AS players,
        u.fullname as creator_name
      FROM rooms r 
      LEFT JOIN room_players rp ON r.id = rp.room_id
      LEFT JOIN users u ON r.created_by = u.id
      WHERE r.status <> 'finished'
    `;
    
    const params = [];
    if (level) { 
      params.push(level); 
      q += ` AND r.level = $${params.length}`; 
    }
    
    q += ` GROUP BY r.id, u.fullname ORDER BY r.created_at DESC LIMIT 100;`;
    
    const out = await pool.query(q, params);
    res.json({ ok:true, rooms: out.rows });
  } catch (e) { 
    console.error('Rooms list error:', e);
    res.status(500).json({ ok:false, error: 'Failed to fetch rooms' }); 
  }
});

app.post('/rooms/create', async (req, res) => {
  const { user_id, name, level, max_players, reveal_mode } = req.body;
  
  if (!user_id) {
    return res.status(400).json({ ok:false, error: 'User ID is required' });
  }

  try {
    const roomId = crypto.randomUUID();
    const mode = reveal_mode || 'private';
    const playersCount = Math.min(Number(max_players) || 2, GAME_CONFIG.MAX_PLAYERS);
    
    await pool.query(
      `INSERT INTO rooms (id, name, status, level, max_players, created_by, reveal_mode) VALUES ($1,$2,'waiting',$3,$4,$5,$6);`, 
      [roomId, name || 'اتاق خصوصی', level || 'medium', playersCount, user_id, mode]
    );
    
    await pool.query(
      `INSERT INTO room_players (room_id, user_id, role) VALUES ($1,$2,$3);`, 
      [roomId, user_id, 'host']
    );
    
    res.json({ ok:true, room_id: roomId });
  } catch (e) { 
    console.error('Room creation error:', e);
    res.status(500).json({ ok:false, error: 'Failed to create room' }); 
  }
});

app.post('/rooms/join', async (req, res) => {
  const { room_id, user_id } = req.body;
  
  if (!room_id || !user_id) {
    return res.status(400).json({ ok:false, error: 'Room ID and User ID are required' });
  }

  try {
    const roomResult = await pool.query(`SELECT * FROM rooms WHERE id=$1 LIMIT 1;`, [room_id]);
    if (!roomResult.rows.length) {
      return res.status(404).json({ ok:false, error: 'Room not found' });
    }
    
    const room = roomResult.rows[0];

    if (room.status === 'finished') {
      return res.status(400).json({ ok:false, error: 'Room is finished' });
    }
    
    // بررسی تعداد بازیکنان
    const countResult = await pool.query(`SELECT COUNT(*) AS cnt FROM room_players WHERE room_id=$1;`, [room_id]);
    const currentPlayers = Number(countResult.rows[0].cnt);
    
    if (currentPlayers >= room.max_players) {
      const isMember = await pool.query(`SELECT 1 FROM room_players WHERE room_id=$1 AND user_id=$2`, [room_id, user_id]);
      if(!isMember.rows.length) {
        return res.status(400).json({ ok:false, error: 'Room is full' });
      }
    }

    // اضافه کردن بازیکن به اتاق
    await pool.query(
      `INSERT INTO room_players (room_id, user_id, role) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING;`, 
      [room_id, user_id, 'player']
    );
    
    // دریافت اطلاعات کامل بازیکنان با جزئیات و آمار
    const players = await getRoomPlayersWithDetails(room_id);

    // اگر اتاق پر شد و در حالت انتظار است، بازی شروع شود
    if (players.length >= room.max_players && room.status === 'waiting') {
      const gameId = crypto.randomUUID();
      const deck = newGameDeckForRoom(room_id, room.level || 'medium');
      
      await pool.query(
        `INSERT INTO games (id, room_id, deck, level, status, started_at) VALUES ($1,$2,$3::jsonb,$4,'active',NOW());`, 
        [gameId, room_id, JSON.stringify(deck), room.level || 'medium']
      );
      
      // ایجاد وضعیت بازی برای همه بازیکنان
      for (const player of players) {
        await createGameState(gameId, player.user_id, deck);
      }

      await pool.query(`UPDATE rooms SET status='playing' WHERE id=$1;`, [room_id]);
      
      // ارسال اطلاعات شروع بازی با آمار بازیکنان
      io.to(room_id).emit('game:started', { 
        game_id: gameId, 
        reveal_mode: room.reveal_mode || 'private', 
        players: players,
        total_words: deck.length
      });
      
      return res.json({ 
        ok:true, 
        room_id, 
        status:'ready', 
        game_id: gameId,
        players: players 
      });
    }
    
    // اگر بازی در حال انجام است
    else if (room.status === 'playing') {
      const gameResult = await pool.query(`SELECT id, deck FROM games WHERE room_id=$1 AND status='active' LIMIT 1;`, [room_id]);
      if (gameResult.rows.length > 0) {
        const game = gameResult.rows[0];
        await createGameState(game.id, user_id, game.deck);
        const playersAfter = await getRoomPlayersWithDetails(room_id);
        
        io.to(room_id).emit('room:presence', { 
          room_id, 
          count: playersAfter.length, 
          players: playersAfter 
        });
        
        return res.json({ 
          ok:true, 
          room_id, 
          status:'playing', 
          game_id: game.id,
          players: playersAfter 
        });
      }
    }

    // به روزرسانی حضور در اتاق
    const playersAfter = await getRoomPlayersWithDetails(room_id);
    io.to(room_id).emit('room:presence', { 
      room_id, 
      count: playersAfter.length, 
      players: playersAfter 
    });
    
    res.json({ 
      ok:true, 
      room_id, 
      status:'waiting',
      players: playersAfter 
    });

  } catch (e) { 
    console.error('Join room error:', e); 
    res.status(500).json({ ok:false, error: 'Failed to join room' }); 
  }
});

async function createGameState(gameId, userId, deck) {
  try {
    const currentWord = deck[0]?.word || '';
    const strictLen = normalizeFaWordStrict(currentWord).length;
    const { hintsAllowed, allowedWrong } = calculateGameParameters(strictLen);
    
    await pool.query(`
      INSERT INTO game_states (game_id, user_id, current_index, correct_letters, wrong_letters, hints_used, hints_allowed, score, guessed_count, allowed_wrong, timer_ms) 
      VALUES ($1,$2,0,'[]','[]',0,$3,0,0,$4,0) 
      ON CONFLICT (game_id, user_id) DO NOTHING;`, 
      [gameId, userId, hintsAllowed, allowedWrong]);
  } catch (error) {
    console.error('Error creating game state:', error);
  }
}

app.post('/rooms/leave', async (req, res) => {
  const { room_id, user_id } = req.body;
  
  if (!room_id || !user_id) {
    return res.status(400).json({ ok:false, error: 'Room ID and User ID are required' });
  }

  try {
    await pool.query(`DELETE FROM room_players WHERE room_id=$1 AND user_id=$2;`, [room_id, user_id]);
    
    const playersAfter = await getRoomPlayersWithDetails(room_id);
    const cnt = playersAfter.length;
    
    if (cnt === 0) {
      await pool.query(`UPDATE rooms SET status='waiting' WHERE id=$1;`, [room_id]);
    }
    
    io.to(room_id).emit('room:presence', { 
      room_id, 
      count: cnt, 
      players: playersAfter 
    });
    
    res.json({ ok:true });
  } catch (e) { 
    console.error('Leave room error:', e);
    res.status(500).json({ ok:false, error: 'Failed to leave room' }); 
  }
});

app.post('/rooms/myrooms', async (req, res) => {
  const { user_id } = req.body;
  
  if (!user_id) {
    return res.status(400).json({ ok:false, error: 'User ID is required' });
  }

  try {
    const query = `
      SELECT 
        r.id, r.name, r.level, r.status, r.max_players,
        COUNT(rp.user_id) as current_players
      FROM rooms r 
      JOIN room_players rp ON r.id = rp.room_id 
      WHERE rp.user_id = $1 AND r.status IN ('playing', 'waiting')
      GROUP BY r.id
      ORDER BY r.status ASC, rp.joined_at DESC;
    `;
    
    const result = await pool.query(query, [user_id]);
    res.json({ ok:true, rooms: result.rows });
  } catch(e) { 
    console.error('My rooms error:', e);
    res.status(500).json({ ok:false, error: 'Failed to fetch rooms' }); 
  }
});

app.post('/rooms/state', async (req, res) => {
  const { room_id } = req.body;
  
  if (!room_id) {
    return res.status(400).json({ ok:false, error: 'Room ID is required' });
  }

  try {
    const roomResult = await pool.query(`SELECT * FROM rooms WHERE id = $1;`, [room_id]);
    if (!roomResult.rows.length) {
      return res.status(404).json({ ok:false, error: 'Room not found' });
    }
    
    const players = await getRoomPlayersWithDetails(room_id);
    const gameResult = await pool.query(`SELECT id, deck, level, status, results FROM games WHERE room_id = $1 ORDER BY started_at DESC LIMIT 1;`, [room_id]);
    
    res.json({ 
      ok:true, 
      room: roomResult.rows[0], 
      players: players, 
      game: gameResult.rows[0] || null 
    });
  } catch (e) { 
    console.error('Room state error:', e);
    res.status(500).json({ ok:false, error: 'Failed to fetch room state' }); 
  }
});

app.post('/game/restart', async (req, res) => {
  const { room_id, user_id } = req.body;
  
  if (!room_id || !user_id) {
    return res.status(400).json({ ok:false, error: 'Room ID and User ID are required' });
  }

  try {
    const roomResult = await pool.query(`SELECT created_by FROM rooms WHERE id=$1`, [room_id]);
    if(!roomResult.rows.length || String(roomResult.rows[0].created_by) !== String(user_id)) {
      return res.status(403).json({ ok:false, error: 'Only room creator can restart the game' });
    }
    
    await pool.query(`UPDATE rooms SET status='waiting' WHERE id=$1`, [room_id]);
    io.to(room_id).emit('room:reset', { room_id });
    
    res.json({ ok:true });
  } catch(e) { 
    console.error('Game restart error:', e);
    res.status(500).json({ ok:false, error: 'Failed to restart game' }); 
  }
});

/* ----------------------------------------------------------------
   STATS ROUTES - IMPROVED
---------------------------------------------------------------- */
app.post('/stats/profile', async (req, res) => {
  const { user_id } = req.body;
  
  if (!user_id) {
    return res.status(400).json({ ok:false, error: 'User ID is required' });
  }

  try {
    const stats = await getPlayerStats(user_id);
    const userInfo = await pool.query(`SELECT fullname, photo_url, username FROM users WHERE id=$1`, [user_id]);
    
    if (!userInfo.rows.length) {
      return res.status(404).json({ ok:false, error: 'User not found' });
    }
    
    res.json({ 
      ok: true, 
      user: userInfo.rows[0], 
      stats: stats 
    });
  } catch(e) { 
    console.error('Profile stats error:', e);
    res.status(500).json({ ok:false, error: 'Failed to fetch profile stats' }); 
  }
});

// رتبه‌بندی جهانی با عملکرد بهینه
app.post('/stats/leaderboard', async (req, res) => {
  try {
    const { type = 'total', limit = 100 } = req.body;
    
    let orderBy = '';
    switch(type) {
      case 'average':
        orderBy = 'avg_score DESC, total_score DESC';
        break;
      case 'best':
        orderBy = 'best_score DESC, total_score DESC';
        break;
      case 'games':
        orderBy = 'games_played DESC, total_score DESC';
        break;
      default:
        orderBy = 'total_score DESC, games_played DESC';
    }
    
    const query = `
      SELECT 
        u.id as user_id,
        u.fullname,
        u.photo_url,
        u.username,
        COALESCE(SUM(gs.score), 0) as total_score,
        COUNT(DISTINCT gs.game_id) as games_played,
        COALESCE(AVG(gs.score), 0) as avg_score,
        MAX(gs.score) as best_score,
        COALESCE(SUM(gs.guessed_count), 0) as total_guesses
      FROM users u 
      LEFT JOIN game_states gs ON u.id = gs.user_id 
      WHERE u.fullname IS NOT NULL AND u.fullname != ''
      GROUP BY u.id, u.fullname, u.photo_url, u.username
      HAVING COUNT(DISTINCT gs.game_id) > 0
      ORDER BY ${orderBy}
      LIMIT $1
    `;
    
    const result = await pool.query(query, [limit]);
    res.json({ ok: true, list: result.rows, type });
  } catch(e) { 
    console.error('Leaderboard error:', e);
    res.status(500).json({ ok:false, error: 'Failed to fetch leaderboard' }); 
  }
});

// تاریخچه بازی‌ها با جزئیات کامل
app.post('/stats/history', async (req, res) => {
  const { user_id, limit = 20 } = req.body;
  
  if (!user_id) {
    return res.status(400).json({ ok:false, error: 'User ID is required' });
  }

  try {
    const historyQuery = `
      SELECT 
        g.id as game_id,
        r.name as room_name,
        r.level,
        g.finished_at,
        g.started_at,
        g.results,
        g.deck,
        (SELECT COUNT(*) FROM room_players WHERE room_id = r.id) as player_count
      FROM games g
      JOIN rooms r ON g.room_id = r.id
      JOIN room_players rp ON r.id = rp.room_id
      WHERE rp.user_id = $1 AND g.status = 'finished'
      ORDER BY g.finished_at DESC
      LIMIT $2
    `;
    
    const historyResult = await pool.query(historyQuery, [user_id, limit]);
    
    if (!historyResult.rows.length) {
      return res.json({ ok: true, games: [] });
    }
    
    // برای هر بازی، اطلاعات بازیکنان و آمار را دریافت می‌کنیم
    const gamesWithDetails = await Promise.all(
      historyResult.rows.map(async (game) => {
        try {
          // اطلاعات بازیکنان
          const playersQuery = `
            SELECT 
              gs.user_id,
              gs.score,
              gs.wrong_letters,
              gs.hints_used,
              gs.allowed_wrong,
              gs.guessed_count,
              u.fullname,
              u.photo_url
            FROM game_states gs
            LEFT JOIN users u ON gs.user_id = u.id
            WHERE gs.game_id = $1
            ORDER BY gs.score DESC
          `;
          
          const playersResult = await pool.query(playersQuery, [game.game_id]);
          
          // پیدا کردن امتیاز و رتبه کاربر جاری
          const sortedPlayers = playersResult.rows.sort((a, b) => b.score - a.score);
          const userRank = sortedPlayers.findIndex(p => String(p.user_id) === String(user_id)) + 1;
          const userScore = sortedPlayers.find(p => String(p.user_id) === String(user_id))?.score || 0;
          
          // پارس کردن results و deck اگر string هستند
          let results = game.results;
          let deck = game.deck;
          
          if (typeof results === 'string') {
            try { results = JSON.parse(results); } catch (e) { results = []; }
          }
          
          if (typeof deck === 'string') {
            try { deck = JSON.parse(deck); } catch (e) { deck = []; }
          }
          
          // محاسبه آمار بازیکنان
          const playersWithStats = playersResult.rows.map((player, index) => {
            let wrong_letters = player.wrong_letters;
            if (typeof wrong_letters === 'string') {
              try { wrong_letters = JSON.parse(wrong_letters); } catch (e) { wrong_letters = []; }
            }
            
            const wrongAttempts = Array.isArray(wrong_letters) ? wrong_letters.length : 0;
            const allowedWrong = player.allowed_wrong || 0;
            const hintsUsed = player.hints_used || 0;
            const accuracy = player.guessed_count > 0 ? 
              Math.round((player.guessed_count / (player.guessed_count + wrongAttempts)) * 100) : 0;
            
            return {
              ...player,
              rank: index + 1,
              wrong_attempts: wrongAttempts,
              allowed_wrong: allowedWrong,
              hints_used: hintsUsed,
              accuracy: accuracy
            };
          });
          
          return {
            ...game,
            players: playersWithStats,
            user_score: userScore,
            user_rank: userRank,
            results: results || [],
            deck: deck || [],
            total_players: game.player_count
          };
        } catch (error) {
          console.error('Error processing game details:', error);
          return { ...game, players: [], error: 'Failed to process game details' };
        }
      })
    );
    
    res.json({ ok: true, games: gamesWithDetails });
  } catch(e) { 
    console.error('History error:', e);
    res.status(500).json({ ok:false, error: 'Failed to fetch game history' }); 
  }
});

/* ----------------------------------------------------------------
   SOCKET LOGIC - IMPROVED
---------------------------------------------------------------- */
const roomSockets = new Map();
const socketMeta = new Map();

async function getGameStates(gameId) {
  try {
    const query = await pool.query(`
      SELECT 
        gs.user_id, 
        gs.current_index, 
        gs.score, 
        gs.guessed_count, 
        gs.hints_used, 
        gs.hints_allowed, 
        gs.wrong_letters, 
        gs.allowed_wrong, 
        gs.timer_ms,
        u.fullname,
        u.photo_url
      FROM game_states gs 
      LEFT JOIN users u ON u.id = gs.user_id 
      WHERE gs.game_id = $1
      ORDER BY gs.score DESC;
    `, [gameId]);
    
    // محاسبه آمار اضافی برای هر بازیکن
    const statesWithStats = query.rows.map(state => {
      let wrong_letters = state.wrong_letters;
      if (typeof wrong_letters === 'string') {
        try { wrong_letters = JSON.parse(wrong_letters); } catch (e) { wrong_letters = []; }
      }
      
      const wrongAttempts = Array.isArray(wrong_letters) ? wrong_letters.length : 0;
      const totalAttempts = state.guessed_count + wrongAttempts;
      const accuracy = totalAttempts > 0 ? Math.round((state.guessed_count / totalAttempts) * 100) : 0;
      
      return {
        ...state,
        wrong_attempts: wrongAttempts,
        accuracy: accuracy,
        efficiency: state.timer_ms > 0 ? Math.round(state.score / (state.timer_ms / 1000)) : 0 // امتیاز بر ثانیه
      };
    });
    
    return statesWithStats;
  } catch (error) {
    console.error('Error getting game states:', error);
    return [];
  }
}

async function advanceToNextWord(gameId, userId, currentIdx, deck, roomId) {
  try {
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
      
      const resultEntry = { 
        index: currentIdx, 
        word: currentWordObj.word, 
        description: currentWordObj.description, 
        winners: winners,
        category: currentWordObj.category 
      };
      
      await pool.query(`UPDATE games SET results = COALESCE(results, '[]'::jsonb) || $1::jsonb WHERE id=$2`, [JSON.stringify(resultEntry), gameId]);
    }

    const nextIndex = currentIdx + 1;
    const deckLen = Array.isArray(deck) ? deck.length : 0;
    
    if (nextIndex >= deckLen) {
      await pool.query(`UPDATE games SET status='finished', finished_at=NOW() WHERE id=$1;`, [gameId]);
      await pool.query(`UPDATE rooms SET status='finished' WHERE id=$1;`, [roomId]);
      
      const finalGame = await pool.query(`SELECT results, deck FROM games WHERE id=$1`, [gameId]);
      const finalPlayers = await getGameStates(gameId);
      
      if (roomId) {
        io.to(roomId).emit('game:finished', { 
          game_id: gameId, 
          results: finalGame.rows[0].results || [], 
          deck: finalGame.rows[0].deck, 
          players: finalPlayers 
        });
      }
      return;
    }

    // محاسبه پارامترهای بازی برای کلمه بعدی
    const nextWord = String(deck[nextIndex]?.word || '');
    const { hintsAllowed, allowedWrong } = calculateGameParameters(normalizeFaWordStrict(nextWord).length);

    await pool.query(`
      UPDATE game_states 
      SET current_index=$3, correct_letters='[]', wrong_letters='[]', hints_used=0, hints_allowed=$4, allowed_wrong=$5, last_update=NOW() 
      WHERE game_id=$1 AND user_id=$2;`, 
      [gameId, userId, nextIndex, hintsAllowed, allowedWrong]);
    
    const playersState = await getGameStates(gameId);
    const newState = await pool.query(`SELECT * FROM game_states WHERE game_id=$1 AND user_id=$2`, [gameId, userId]);
    
    if (roomId) {
      io.to(roomId).emit('game:next', { 
        game_id: gameId, 
        by_user: userId, 
        nextIndex, 
        states: playersState,
        next_word_length: normalizeFaWordStrict(nextWord).length,
        total_words: deck.length
      });
      
      io.to(roomId).emit('game:states', { 
        game_id: gameId, 
        states: playersState 
      });
    }
    
    return newState.rows[0];
  } catch (error) {
    console.error('Error advancing to next word:', error);
  }
}

io.on('connection', (socket) => {
  socketMeta.set(socket.id, { room_ids: new Set(), user_id: null });

  socket.on('join-room', async ({ room_id, user_id }) => {
    if (!room_id) return;
    
    const meta = socketMeta.get(socket.id);
    if (user_id) meta.user_id = user_id;
    
    socket.join(room_id);
    meta.room_ids.add(room_id);
    
    if (!roomSockets.has(room_id)) roomSockets.set(room_id, new Set());
    roomSockets.get(room_id).add(socket.id);
    
    // ارسال اطلاعات کامل بازیکنان با آمار به همه کاربران اتاق
    try {
      const players = await getRoomPlayersWithDetails(room_id);
      io.to(room_id).emit('room:presence', { 
        room_id, 
        count: players.length, 
        players 
      });
    } catch (error) {
      console.error('Error getting room players:', error);
    }
  });

  socket.on('game:resume', async ({ game_id, user_id }) => {
    try {
      const gameResult = await pool.query(`SELECT * FROM games WHERE id=$1;`, [game_id]);
      if (!gameResult.rows.length) return;
      
      const game = gameResult.rows[0];
      
      if (game.status === 'finished') {
        const players = await getGameStates(game_id);
        socket.emit('game:finished', { 
          game_id, 
          results: game.results || [], 
          deck: game.deck, 
          players 
        });
        return;
      }
      
      let gameState = await pool.query(`SELECT * FROM game_states WHERE game_id=$1 AND user_id=$2;`, [game_id, user_id]);
      
      if (!gameState.rows.length) {
        await createGameState(game_id, user_id, game.deck);
        gameState = await pool.query(`SELECT * FROM game_states WHERE game_id=$1 AND user_id=$2;`, [game_id, user_id]);
      }
      
      const roomResult = await pool.query(`SELECT r.reveal_mode FROM rooms r JOIN games g ON g.room_id = r.id WHERE g.id = $1 LIMIT 1;`, [game_id]);
      const reveal_mode = roomResult.rows[0]?.reveal_mode || 'private';
      const players = await getGameStates(game_id);
      
      socket.emit('game:state', { 
        state: gameState.rows[0], 
        reveal_mode, 
        players,
        total_words: game.deck?.length || 0,
        current_word: game.deck?.[gameState.rows[0]?.current_index || 0] || null
      });
    } catch (e) { 
      console.error('Game resume error:', e); 
      socket.emit('game:error', { error: 'Failed to resume game' });
    }
  });

  socket.on('game:guess', async ({ game_id, user_id, letter }) => {
    try {
      if (!game_id || !user_id || !letter) return;
      
      const gameStateResult = await pool.query(`SELECT * FROM game_states WHERE game_id=$1 AND user_id=$2;`, [game_id, user_id]);
      const gameResult = await pool.query(`SELECT * FROM games WHERE id=$1;`, [game_id]);
      
      if (!gameStateResult.rows.length || !gameResult.rows.length) return;
      if (gameResult.rows[0].status === 'finished') return;

      const gameState = gameStateResult.rows[0];
      const deck = gameResult.rows[0].deck;
      const idx = Number(gameState.current_index) || 0;
      const currentWordOrig = String(deck[idx]?.word || '');
      const currentWord = normalizeFaWordKeepSpaces(currentWordOrig);
      const normalized = normalizeFaLetter(String(letter).trim());
      
      if (!normalized || normalized.length !== 1) return;

      let correctLetters = Array.isArray(gameState.correct_letters) ? gameState.correct_letters : JSON.parse(gameState.correct_letters || '[]');
      let wrongLetters = Array.isArray(gameState.wrong_letters) ? gameState.wrong_letters : JSON.parse(gameState.wrong_letters || '[]');

      if (correctLetters.includes(normalized) || wrongLetters.includes(normalized)) {
        socket.emit('game:feedback', { type: 'duplicate', letter: normalized });
        return;
      }

      const gameRow = await pool.query(`SELECT room_id FROM games WHERE id=$1 LIMIT 1;`, [game_id]);
      const roomId = gameRow.rows[0]?.room_id;
      const roomRow = roomId ? await pool.query(`SELECT reveal_mode FROM rooms WHERE id=$1 LIMIT 1;`, [roomId]) : null;
      const reveal_mode = roomRow?.rows?.[0]?.reveal_mode || 'private';

      const positions = [];
      for (let i = 0; i < currentWord.length; i++) {
        if (currentWord[i] === normalized) positions.push(i);
      }
      
      if (positions.length > 0) {
        correctLetters.push(normalized);
        const scoreDelta = GAME_CONFIG.CORRECT_LETTER_SCORE * positions.length;
        
        await pool.query(`
          UPDATE game_states 
          SET correct_letters=$3::jsonb, score=score+$4, guessed_count=guessed_count+1, last_update=NOW() 
          WHERE game_id=$1 AND user_id=$2;`, 
          [game_id, user_id, JSON.stringify(correctLetters), scoreDelta]);
        
        const updatedPlayer = await pool.query(`SELECT user_id, score, guessed_count FROM game_states WHERE game_id=$1 AND user_id=$2`, [game_id, user_id]);
        const allPlayersState = await getGameStates(game_id);
        
        const payload = { 
          user_id, 
          letter: normalized, 
          positions, 
          scoreDelta, 
          player: updatedPlayer.rows[0],
          current_score: updatedPlayer.rows[0].score
        };
        
        if (roomId && reveal_mode === 'shared') {
          io.to(roomId).emit('game:letter:correct', { ...payload, shared: true });
          io.to(roomId).emit('game:states', { game_id, states: allPlayersState });
        } else {
          socket.emit('game:letter:correct', { ...payload, shared: false });
          if(roomId) {
            socket.to(roomId).emit('game:letter:correct', { 
              user_id, 
              letter: null, 
              positions: [], 
              scoreDelta, 
              player: updatedPlayer.rows[0], 
              shared: false 
            });
            io.to(roomId).emit('game:states', { game_id, states: allPlayersState });
          }
        }
        
        const currentWordStrict = normalizeFaWordStrict(currentWordOrig);
        const uniqueRequired = new Set(currentWordStrict.split('').filter(c => c && c.trim() !== ''));
        const isWin = [...uniqueRequired].every(char => correctLetters.includes(char));
        
        if (isWin) {
          await advanceToNextWord(game_id, user_id, idx, deck, roomId);
        }

      } else {
        wrongLetters.push(normalized);
        await pool.query(`
          UPDATE game_states 
          SET wrong_letters=$3::jsonb, last_update=NOW() 
          WHERE game_id=$1 AND user_id=$2;`, 
          [game_id, user_id, JSON.stringify(wrongLetters)]);
        
        const strictLen = normalizeFaWordStrict(currentWordOrig).length;
        const allowedWrong = Math.max(1, ceil(strictLen * GAME_CONFIG.BASE_ALLOWED_WRONG_MULTIPLIER));
        
        socket.emit('game:letter:wrong', { 
          user_id, 
          letter: normalized, 
          wrongCount: wrongLetters.length, 
          allowedWrong 
        });
        
        const allPlayersState = await getGameStates(game_id);
        if (roomId) {
          io.to(roomId).emit('game:states', { game_id, states: allPlayersState });
        }
        
        if (wrongLetters.length >= allowedWrong) {
          const penalty = GAME_CONFIG.WRONG_LETTER_PENALTY * correctLetters.length;
          await pool.query(`UPDATE game_states SET score = GREATEST(score - $3, 0) WHERE game_id=$1 AND user_id=$2;`, [game_id, user_id, penalty]);
          socket.emit('game:feedback', { type: 'word-failed', word: currentWordOrig });
          
          const finalPlayersState = await getGameStates(game_id);
          if (roomId) {
            io.to(roomId).emit('game:states', { game_id, states: finalPlayersState });
          }
          
          await advanceToNextWord(game_id, user_id, idx, deck, roomId);
        }
      }
    } catch (e) { 
      console.error('Game guess error:', e); 
      socket.emit('game:error', { error: 'Failed to process guess' });
    }
  });

  socket.on('game:hint', async ({ game_id, user_id }) => {
    try {
      if (!game_id || !user_id) return;
      
      const gameStateResult = await pool.query(`SELECT * FROM game_states WHERE game_id=$1 AND user_id=$2;`, [game_id, user_id]);
      const gameResult = await pool.query(`SELECT * FROM games WHERE id=$1;`, [game_id]);
      
      if (!gameStateResult.rows.length || !gameResult.rows.length) return;
      if (gameResult.rows[0].status === 'finished') return;

      const gameState = gameStateResult.rows[0];
      const deck = gameResult.rows[0].deck;
      const idx = Number(gameState.current_index) || 0;
      const currentWord = normalizeFaWordKeepSpaces(String(deck[idx]?.word || ''));
      const hintsUsed = Number(gameState.hints_used) || 0;
      const hintsAllowed = Number(gameState.hints_allowed);

      if (hintsUsed >= hintsAllowed) { 
        socket.emit('game:feedback', { type: 'hint-limit' }); 
        return; 
      }

      let correctLetters = Array.isArray(gameState.correct_letters) ? gameState.correct_letters : JSON.parse(gameState.correct_letters || '[]');
      const candidates = currentWord.split('').filter(ch => ch.trim() !== '' && ch !== '\u200c' && !correctLetters.includes(ch));
      const uniqueCandidates = [...new Set(candidates)];
      
      if (!uniqueCandidates.length) { 
        socket.emit('game:feedback', { type: 'no-hint' }); 
        return; 
      }
      
      const reveal = uniqueCandidates[Math.floor(Math.random() * uniqueCandidates.length)];
      const positions = [];
      for (let i = 0; i < currentWord.length; i++) {
        if (currentWord[i] === reveal) positions.push(i);
      }
      
      const penalty = GAME_CONFIG.HINT_PENALTY * positions.length;
      const newScore = Math.max(0, (gameState.score || 0) - penalty);
      correctLetters.push(reveal);
      
      await pool.query(`
        UPDATE game_states 
        SET correct_letters=$3::jsonb, hints_used=hints_used+1, score=$4, last_update=NOW() 
        WHERE game_id=$1 AND user_id=$2;`, 
        [game_id, user_id, JSON.stringify(correctLetters), newScore]);
      
      const gameRow = await pool.query(`SELECT room_id FROM games WHERE id=$1 LIMIT 1;`, [game_id]);
      const roomId = gameRow.rows[0]?.room_id;
      
      const updatedPlayer = await pool.query(`SELECT user_id, score, hints_used FROM game_states WHERE game_id=$1 AND user_id=$2`, [game_id, user_id]);
      const allPlayersState = await getGameStates(game_id);
      
      socket.emit('game:hint:reveal', { 
        user_id, 
        letter: reveal, 
        positions, 
        penalty,
        new_score: newScore,
        hints_used: updatedPlayer.rows[0].hints_used,
        hints_remaining: hintsAllowed - (updatedPlayer.rows[0].hints_used + 1)
      });
      
      if(roomId) {
        io.to(roomId).emit('game:states', { game_id, states: allPlayersState });
      }
      
      const currentWordStrict = normalizeFaWordStrict(deck[idx]?.word || '');
      const uniqueRequired = new Set(currentWordStrict.split('').filter(c => c && c.trim() !== ''));
      const isWin = [...uniqueRequired].every(char => correctLetters.includes(char));
      
      if(isWin) {
        await advanceToNextWord(game_id, user_id, idx, deck, roomId);
      }

    } catch (e) { 
      console.error('Hint error:', e); 
      socket.emit('game:error', { error: 'Failed to process hint' });
    }
  });

  socket.on('game:timer', async ({ game_id, user_id, timer_ms }) => {
    try {
      if (!game_id || !user_id) return;
      const safeMs = Math.max(0, parseInt(timer_ms) || 0);
      await pool.query(`UPDATE game_states SET timer_ms=$3, last_update=NOW() WHERE game_id=$1 AND user_id=$2;`, [game_id, user_id, safeMs]);
    } catch (e) {
      console.error('Timer update error:', e);
    }
  });

  socket.on('disconnect', () => {
    const meta = socketMeta.get(socket.id);
    if (!meta) return;
    
    for (const roomId of meta.room_ids) {
      const set = roomSockets.get(roomId);
      if (set) {
        set.delete(socket.id);
        
        getRoomPlayersWithDetails(roomId).then(players => {
          io.to(roomId).emit('room:presence', { 
            room_id: roomId, 
            count: players.length, 
            players 
          });
        }).catch(err => {
          console.error('Error getting room players on disconnect:', err);
        });
      }
    }
    socketMeta.delete(socket.id);
  });
});

/* ----------------------------------------------------------------
   SERVER INITIALIZATION
---------------------------------------------------------------- */
(async () => {
  try {
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();
    console.log('PostgreSQL connection established successfully.');
    
    await ensureSchema();
    console.log('Database schema ensured.');
    
    app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
    app.get('/health', (req, res) => res.json({ status: 'OK', timestamp: new Date().toISOString() }));

    server.listen(PORT, () => {
      console.log(`Server listening on port ${PORT}`);
      console.log(`Game configuration: ${GAME_CONFIG.MAX_PLAYERS} max players, ${GAME_CONFIG.WORDS_PER_GAME} words per game`);
    });
  } catch (error) {
    console.error('Server initialization error:', error);
    process.exit(1);
  }
})();

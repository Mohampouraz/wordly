require('dotenv').config();

const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const crypto = require('crypto');
const PORT = process.env.PORT || 3000;

// فراخوانی فایل کلمات. فرض بر این است که این فایل یک آرایه از اشیاء { word: string, description: string, level: string } را صادر می‌کند.
const wordsData = require('./words');

/* ----------------------------------------------------------------
   UTILITIES
---------------------------------------------------------------- */

// تابع کمکی برای نرمال‌سازی حروف فارسی بدون نیم‌فاصله و فاصله
const normalizeFaWordStrict = (w) => (w || '').replace(/[\u0643\u0649\u064A]/g, (m) => ({
    '\u0643': '\u06a9', // ك -> ک
    '\u0649': '\u06cc', // ى -> ی
    '\u064A': '\u06cc', // ي -> ی
})[m]).replace(/[\s\u200c]/g, '');

const ceil = Math.ceil;
const floor = Math.floor;
const round = Math.round;

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

/* ----------------------------------------------------------------
   MODELS/DB FUNCTIONS
---------------------------------------------------------------- */

// تابع برای ثبت یا واکشی کاربر
async function getOrCreateUser(tg_id, username) {
    const res = await pool.query(`INSERT INTO users (id, username) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET username = $2 RETURNING *;`, [tg_id, username]);
    return res.rows[0];
}

// واکشی اطلاعات اتاق
async function getRoom(room_id) {
    const res = await pool.query(`SELECT * FROM rooms WHERE id = $1;`, [room_id]);
    return res.rows[0];
}

// ذخیره‌سازی موقت کلمات فیلتر شده بر اساس سطح
const cachedWordsByLevel = {};

/**
 * واکشی تصادفی کلمه جدید از آرایه wordsData (فایل words.js) در حافظه بر اساس سطح.
 * @param {string} level سطح کلمه (easy, medium, hard)
 * @returns {object} کلمه و توضیحات آن
 */
function getNewWord(level) {
    if (!cachedWordsByLevel[level]) {
        // فیلتر کردن و ذخیره در حافظه برای جستجوی سریعتر
        cachedWordsByLevel[level] = wordsData.filter(w => w.level === level);
    }
    
    const filteredWords = cachedWordsByLevel[level];
    
    if (filteredWords.length === 0) {
        console.error(`No words available for level: ${level}. Check your words.js file.`);
        // کلمه اضطراری
        return { word: 'خطا', description: 'کلمه‌ای اضطراری. بانک کلمات خالی است.', level: level }; 
    }
    
    const randomIndex = Math.floor(Math.random() * filteredWords.length);
    return filteredWords[randomIndex];
}

// واکشی وضعیت کامل بازی برای یک کاربر
async function getFullGameState(game_id, user_id) {
    const gameRes = await pool.query(`SELECT * FROM games WHERE id=$1;`, [game_id]);
    if (gameRes.rows.length === 0) return null;
    const game = gameRes.rows[0];

    const statesRes = await pool.query(`SELECT gs.*, u.username FROM game_states gs JOIN users u ON gs.user_id = u.id WHERE gs.game_id=$1;`, [game_id]);
    
    const userScoreRes = await pool.query(`SELECT COALESCE(SUM(score), 0) AS total_score FROM game_states WHERE user_id=$1;`, [user_id]);
    
    return {
        game_id: game.id,
        room_id: game.room_id,
        room_name: (await getRoom(game.room_id))?.name || 'بازی رقابتی',
        level: game.level,
        status: game.status,
        deck: game.deck,
        player_states: statesRes.rows.map(row => ({
            user_id: row.user_id,
            username: row.username,
            score: row.score,
            current_word_index: row.current_word_index,
            correct_letters: row.correct_letters || [],
            wrong_letters: row.wrong_letters || [],
            allowed_wrong: row.allowed_wrong,
            hint_used: row.hint_used,
            timer_ms: row.timer_ms
        })),
        user_total_score: userScoreRes.rows[0].total_score
    };
}


// ایجاد و شروع یک بازی جدید
async function createGame(owner_id, room_id, level) {
    const deckSize = 3; 
    const deck = []; 
    for(let i=0; i<deckSize; i++) { 
        const word = getNewWord(level); // استفاده از تابع جدید getNewWord
        if (!word) throw new Error(`Could not generate enough words for deck. Level: ${level}`);
        deck.push(word);
    }
    const game_id = crypto.randomUUID();
    
    const currentWordStrict = normalizeFaWordStrict(deck[0]?.word || '');
    const strictLen = currentWordStrict.length;
    
    // منطق حدس‌های نادرست مجاز: 1.5 برابر طول کلمه (سقف)
    const allowedWrong = Math.max(1, ceil(strictLen * 1.5));
    
    // ایجاد رکورد بازی
    await pool.query(`INSERT INTO games (id, room_id, owner_id, deck, level, status) VALUES ($1, $2, $3, $4, $5, 'active');`, 
        [game_id, room_id, owner_id, JSON.stringify(deck), level]);
    
    // ایجاد وضعیت اولیه برای مالک اتاق
    const gameState = {
        user_id: owner_id,
        game_id: game_id,
        score: 0,
        current_word_index: 0,
        correct_letters: [],
        wrong_letters: [],
        allowed_wrong: allowedWrong,
        hint_used: false,
        timer_ms: 0
    };

    await pool.query(`INSERT INTO game_states (game_id, user_id, score, current_word_index, correct_letters, wrong_letters, allowed_wrong, hint_used, timer_ms) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9);`, 
        [game_id, owner_id, gameState.score, gameState.current_word_index, JSON.stringify(gameState.correct_letters), JSON.stringify(gameState.wrong_letters), gameState.allowed_wrong, gameState.hint_used, gameState.timer_ms]);

    return { game_id, deck, gameState };
}

// پیشروی به کلمه بعدی
async function advanceToNextWord(game_id, user_id, word_index, deck, roomId, isWin = true) {
    const nextIndex = word_index + 1;
    const isGameOver = nextIndex >= deck.length;

    // ثبت نتیجه کلمه فعلی
    await pool.query(`
        UPDATE games 
        SET results = COALESCE(results, '[]'::jsonb) || jsonb_build_object('word_index', $2, 'winners', $3::integer[]) 
        WHERE id = $1;
    `, [game_id, word_index, isWin ? [user_id] : []]); 

    if (isGameOver) {
        await pool.query(`UPDATE games SET status='completed' WHERE id=$1;`, [game_id]);
        io.to(roomId).emit('game:update', { game_id, status: 'completed' });
        return;
    }

    // تنظیمات کلمه بعدی
    const currentWordStrict = normalizeFaWordStrict(deck[nextIndex]?.word || '');
    const strictLen = currentWordStrict.length;
    
    // منطق حدس‌های نادرست مجاز: 1.5 برابر طول کلمه (سقف)
    const allowedWrong = Math.max(1, ceil(strictLen * 1.5));

    // به‌روزرسانی وضعیت تمامی بازیکنان در بازی به کلمه بعدی
    await pool.query(`
        UPDATE game_states 
        SET 
            current_word_index = $2, 
            correct_letters = '[]'::jsonb, 
            wrong_letters = '[]'::jsonb, 
            allowed_wrong = $3, 
            hint_used = false,
            timer_ms = 0, 
            last_update = NOW()
        WHERE game_id = $1; 
    `, [game_id, nextIndex, allowedWrong]); 

    // اعلان به‌روزرسانی به اتاق
    io.to(roomId).emit('game:update', { 
        game_id, 
        current_word_index: nextIndex,
        allowed_wrong: allowedWrong,
        correct_letters: [],
        wrong_letters: [],
        hint_used: false,
    });
}


/* ----------------------------------------------------------------
   EXPRESS SETUP
---------------------------------------------------------------- */
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

/* ----------------------------------------------------------------
   SOCKET.IO STATE MANAGEMENT
---------------------------------------------------------------- */
const roomSockets = new Map(); 
const socketMeta = new Map();  
const userRooms = new Map();   

/* ----------------------------------------------------------------
   SOCKET.IO HANDLERS
---------------------------------------------------------------- */

io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  // -------------------------
  // AUTHENTICATION/USER INFO
  // -------------------------
  socket.on('auth:user', async ({ id, username }) => {
    try {
        const user = await getOrCreateUser(id, username);
        socketMeta.set(socket.id, { user_id: user.id, username: user.username, room_ids: new Set() });
        
        const userScoreRes = await pool.query(`SELECT COALESCE(SUM(score), 0) AS total_score FROM game_states WHERE user_id=$1;`, [user.id]);

        socket.emit('auth:success', { 
            id: user.id, 
            username: user.username, 
            score: userScoreRes.rows[0].total_score 
        });
        console.log(`User ${user.username} authenticated.`);
    } catch (e) {
        console.error('Auth error:', e);
        socket.emit('auth:error', { message: 'Authentication failed.' });
    }
  });

  // -------------------------
  // ROOMS (LOBBY)
  // -------------------------
  socket.on('room:fetch_list', async () => {
      try {
          const result = await pool.query(`
              SELECT r.id, r.name, r.level, r.status, COUNT(gs.user_id) AS players_count
              FROM rooms r
              LEFT JOIN games g ON r.active_game_id = g.id AND g.status = 'active'
              LEFT JOIN game_states gs ON g.id = gs.game_id
              GROUP BY r.id, r.name, r.level, r.status, r.created_at
              ORDER BY r.status, r.created_at DESC;
          `);
          socket.emit('room:list', result.rows.map(row => ({
              ...row,
              players_count: parseInt(row.players_count)
          })));
      } catch (e) {
          console.error('Error fetching room list:', e);
      }
  });
  
  socket.on('room:create', async ({ user_id, room_name, level }) => {
      try {
          // 1. ایجاد اتاق
          const room_id = crypto.randomUUID();
          await pool.query(`INSERT INTO rooms (id, name, level, owner_id, status) VALUES ($1, $2, $3, $4, 'waiting');`, 
              [room_id, room_name, level, user_id]);

          // 2. شروع بازی (با کلمات بارگذاری شده از words.js)
          const { game_id } = await createGame(user_id, room_id, level);

          // 3. به‌روزرسانی اتاق و پیوستن سوکت
          await pool.query(`UPDATE rooms SET active_game_id=$1, status='active' WHERE id=$2;`, [game_id, room_id]);

          socket.join(room_id);
          if (!roomSockets.has(room_id)) roomSockets.set(room_id, new Set());
          roomSockets.get(room_id).add(socket.id);
          socketMeta.get(socket.id)?.room_ids.add(room_id);
          userRooms.set(user_id, room_id);
          
          // 4. ارسال وضعیت بازی به مالک
          const fullGameState = await getFullGameState(game_id, user_id);

          io.to(room_id).emit('game:new', { 
              game_id: game_id, 
              room_name: room_name,
              game_data: fullGameState 
          });
          
          io.emit('room:presence', { room_id, count: 1 });
          io.emit('room:fetch_list'); 

      } catch (e) {
          console.error('Error creating room:', e);
          socket.emit('room:error', { message: 'Failed to create room.' });
      }
  });

  socket.on('room:join', async ({ room_id, user_id }) => {
      try {
          const room = await getRoom(room_id);
          if (!room) return socket.emit('room:error', { message: 'Room not found.' });

          // پیوستن سوکت و مدیریت وضعیت
          socket.join(room_id);
          if (!roomSockets.has(room_id)) roomSockets.set(room_id, new Set());
          roomSockets.get(room_id).add(socket.id);
          socketMeta.get(socket.id)?.room_ids.add(room_id);
          userRooms.set(user_id, room_id);
          
          if (room.status === 'active' && room.active_game_id) {
              const game_id = room.active_game_id;
              const gameStateRes = await pool.query(`SELECT * FROM game_states WHERE game_id=$1 AND user_id=$2;`, [game_id, user_id]);
              let fullGameData = await getFullGameState(game_id, user_id);
              
              if (gameStateRes.rows.length === 0) {
                  // بازیکن جدید به بازی فعال پیوسته است
                  const currentWordIndex = fullGameData.player_states[0]?.current_word_index || 0;
                  const allowedWrong = fullGameData.player_states[0]?.allowed_wrong || 5; 

                  await pool.query(`INSERT INTO game_states (game_id, user_id, score, current_word_index, correct_letters, wrong_letters, allowed_wrong, hint_used, timer_ms) 
                      VALUES ($1, $2, 0, $3, '[]'::jsonb, '[]'::jsonb, $4, false, 0);`, 
                      [game_id, user_id, currentWordIndex, allowedWrong]);
                      
                  fullGameData = await getFullGameState(game_id, user_id);
                  io.to(room_id).emit('game:update', { game_id, user_id, score: 0 }); 
                  socket.emit('room:join_success', { game_id, room_name: room.name, game_data: fullGameData });

              } else {
                  // بازیکن مجدداً به بازی خود پیوسته است
                  socket.emit('room:join_success', { game_id, room_name: room.name, game_data: fullGameData });
              }
          } else {
              // اتاق در حالت انتظار است
              socket.emit('room:join_success', { game_id: null, room_name: room.name });
          }
          
          io.to(room_id).emit('room:presence', { room_id, count: roomSockets.get(room_id).size });

      } catch (e) {
          console.error('Error joining room:', e);
          socket.emit('room:error', { message: 'Failed to join room.' });
      }
  });


  // -------------------------
  // GAMES
  // -------------------------
  
  socket.on('game:guess', async ({ game_id, user_id, letter }) => {
    try {
      if (!game_id || !user_id || !letter) return;
      const normalizedLetter = normalizeFaWordStrict(letter)[0] || '';
      if (!normalizedLetter) return;

      const stateResult = await pool.query(`SELECT gs.*, g.deck, g.room_id FROM game_states gs JOIN games g ON gs.game_id = g.id WHERE gs.game_id=$1 AND gs.user_id=$2;`, [game_id, user_id]);
      if (stateResult.rows.length === 0) return;
      const state = stateResult.rows[0];
      const deck = state.deck;
      const idx = state.current_word_index;
      const roomId = state.room_id;

      const currentWord = deck[idx]?.word || '';
      const currentWordStrict = normalizeFaWordStrict(currentWord);
      
      const correctLetters = state.correct_letters || [];
      const wrongLetters = state.wrong_letters || [];
      const allowedWrong = state.allowed_wrong;

      if (correctLetters.includes(normalizedLetter) || wrongLetters.includes(normalizedLetter)) {
        return;
      }

      let newWrongCount = wrongLetters.length;
      let newScore = state.score;
      let newCorrectLetters = [...correctLetters];
      let newWrongLetters = [...wrongLetters];

      if (currentWordStrict.includes(normalizedLetter)) {
        newCorrectLetters.push(normalizedLetter);
        newScore += 10;
      } else {
        newWrongLetters.push(normalizedLetter);
        newWrongCount++;
        newScore = Math.max(0, newScore - 5);
      }
      
      const isWordFailed = newWrongCount >= allowedWrong;

      // به‌روزرسانی وضعیت بازیکن در دیتابیس
      await pool.query(`
        UPDATE game_states 
        SET 
          score = $2, 
          correct_letters = $3, 
          wrong_letters = $4, 
          last_update = NOW()
        WHERE game_id = $1 AND user_id = $5;
      `, [game_id, newScore, JSON.stringify(newCorrectLetters), JSON.stringify(newWrongLetters), user_id]);

      // ارسال به‌روزرسانی به اتاق
      io.to(roomId).emit('game:update', {
        game_id,
        user_id,
        score: newScore,
        correct_letters: newCorrectLetters,
        wrong_letters: newWrongLetters,
      });

      // بررسی وضعیت برد/باخت
      const uniqueRequired = new Set(currentWordStrict.split('').filter(c => c && c.trim() !== ''));
      const isWin = [...uniqueRequired].every(char => newCorrectLetters.includes(char));
      
      if (isWin) {
          // برد کلمه
          await advanceToNextWord(game_id, user_id, idx, deck, roomId, true);
      } else if (isWordFailed) {
          // باخت کلمه (سوختن)
          await advanceToNextWord(game_id, user_id, idx, deck, roomId, false);
      }

    } catch (e) { console.error('Error on game:guess:', e); }
  });

  socket.on('game:hint', async ({ game_id, user_id }) => {
      try {
          if (!game_id || !user_id) return;
          
          const stateResult = await pool.query(`SELECT * FROM game_states WHERE game_id=$1 AND user_id=$2;`, [game_id, user_id]);
          if (stateResult.rows.length === 0) return;
          const state = stateResult.rows[0];
          
          if (state.hint_used) return; 

          const newScore = Math.max(0, state.score - 50); // جریمه 50 امتیازی برای استفاده از راهنما

          await pool.query(`
              UPDATE game_states 
              SET score = $2, hint_used = true, last_update = NOW()
              WHERE game_id = $1 AND user_id = $3;
          `, [game_id, newScore, user_id]);

          socket.emit('game:update', {
              game_id,
              user_id,
              score: newScore,
              hint_used: true,
          });

      } catch (e) { console.error('Error on game:hint:', e); }
  });


  // -------------------------
  // LEADERBOARD
  // -------------------------
  socket.on('leaderboard:fetch', async () => {
      try {
          const result = await pool.query(`
              SELECT 
                  u.username,
                  COALESCE(SUM(gs.score), 0) AS total_score,
                  COUNT(DISTINCT gs.game_id) AS games_played,
                  COUNT(DISTINCT CASE WHEN g.status = 'completed' AND g.results @> jsonb_build_array(jsonb_build_object('winners', jsonb_build_array(gs.user_id))) THEN g.id ELSE NULL END) AS wins
              FROM 
                  users u
              LEFT JOIN 
                  game_states gs ON u.id = gs.user_id
              LEFT JOIN
                  games g ON gs.game_id = g.id
              GROUP BY 
                  u.id, u.username
              HAVING
                  COUNT(DISTINCT gs.game_id) > 0 
              ORDER BY 
                  total_score DESC, games_played DESC
              LIMIT 50;
          `);
          socket.emit('leaderboard:data', result.rows);
      } catch (e) {
          console.error('Error fetching leaderboard:', e);
          socket.emit('leaderboard:error', { message: 'Could not fetch leaderboard data.' });
      }
  });
  
  // -------------------------
  // USER PROFILE/HISTORY
  // -------------------------
  socket.on('user:fetch_history', async ({ user_id }) => {
      try {
          const historyRes = await pool.query(`
              SELECT 
                  g.id, g.level, g.status, g.deck, g.results, 
                  gs.score AS player_score
              FROM 
                  games g
              JOIN 
                  game_states gs ON g.id = gs.game_id
              WHERE 
                  gs.user_id = $1
              ORDER BY 
                  g.created_at DESC;
          `, [user_id]);

          const formattedHistory = historyRes.rows.map(row => ({
              id: row.id,
              level: row.level,
              status: row.status,
              deck: row.deck,
              results: row.results,
              player_state: { score: row.player_score, user_id: user_id } 
          }));

          socket.emit('user:history', formattedHistory);

      } catch (e) {
          console.error('Error fetching history:', e);
          socket.emit('user:history_error', { message: 'Could not fetch history.' });
      }
  });
  
  socket.on('user:fetch_profile', async ({ user_id }) => {
      try {
          const profileRes = await pool.query(`
              SELECT 
                  u.username,
                  COALESCE(SUM(gs.score), 0) AS total_score,
                  COUNT(DISTINCT gs.game_id) AS games_played,
                  COUNT(DISTINCT CASE WHEN g.status = 'completed' AND g.results @> jsonb_build_array(jsonb_build_object('winners', jsonb_build_array(gs.user_id))) THEN g.id ELSE NULL END) AS wins
              FROM 
                  users u
              LEFT JOIN 
                  game_states gs ON u.id = gs.user_id
              LEFT JOIN
                  games g ON gs.game_id = g.id
              WHERE u.id = $1
              GROUP BY u.id, u.username;
          `, [user_id]);

          socket.emit('user:profile', profileRes.rows[0] || { username: 'کاربر نامشخص', total_score: 0, games_played: 0, wins: 0 });

      } catch (e) {
          console.error('Error fetching profile:', e);
          socket.emit('user:profile_error', { message: 'Could not fetch profile.' });
      }
  });

  // -------------------------
  // MISC
  // -------------------------
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
    userRooms.delete(m.user_id);
  });
});

/* ----------------------------------------------------------------
   SERVER STARTUP
---------------------------------------------------------------- */

async function setupDatabase() {
    console.log('Checking database tables...');
    
    // 1. جدول کاربران
    await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY,
            username VARCHAR(255) NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
    `);

    // 2. جدول اتاق‌ها
    await pool.query(`
        CREATE TABLE IF NOT EXISTS rooms (
            id UUID PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            level VARCHAR(10) NOT NULL,
            owner_id INTEGER REFERENCES users(id),
            status VARCHAR(20) NOT NULL, -- waiting, active, finished
            active_game_id UUID,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
    `);

    // 3. جدول بازی‌ها (شامل دک کلمات و نتایج)
    await pool.query(`
        CREATE TABLE IF NOT EXISTS games (
            id UUID PRIMARY KEY,
            room_id UUID REFERENCES rooms(id),
            owner_id INTEGER REFERENCES users(id),
            deck JSONB NOT NULL,
            level VARCHAR(10) NOT NULL,
            status VARCHAR(20) NOT NULL, -- active, completed, cancelled
            results JSONB, -- [{ word_index: 0, winners: [user_id] }]
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
    `);

    // 4. جدول وضعیت بازی‌ها (امتیاز و حدس‌های هر بازیکن در هر بازی)
    await pool.query(`
        CREATE TABLE IF NOT EXISTS game_states (
            game_id UUID REFERENCES games(id),
            user_id INTEGER REFERENCES users(id),
            score INTEGER DEFAULT 0,
            current_word_index INTEGER DEFAULT 0,
            correct_letters JSONB DEFAULT '[]'::jsonb,
            wrong_letters JSONB DEFAULT '[]'::jsonb,
            allowed_wrong INTEGER,
            hint_used BOOLEAN DEFAULT FALSE,
            timer_ms INTEGER DEFAULT 0,
            last_update TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (game_id, user_id)
        );
    `);
    
    // جدول کلمات حذف شد و کلمات مستقیماً از words.js استفاده می‌شوند.
    console.log('Database setup complete. Word data is loaded from words.js in memory.');
}


(async () => {
  try {
    if (!connectionString) throw new Error('DATABASE_URL or related environment variables are not set.');
    
    await pool.connect();
    console.log('DB connected successfully');
    
    await setupDatabase();

    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (e) {
    console.error('Failed to start server:', e.message);
    process.exit(1);
  }
})();

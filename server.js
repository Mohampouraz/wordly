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

// =========================================================================
// ۱. داده‌های کلمات (Word Data) - برگرفته از فایل words.txt
// =========================================================================
const WORD_DATA = {
  categories: [
    // حیوانات (20)
    {
      name: 'حیوانات',
      words: [
        { text: 'گربه', level: 'easy', description: 'حیوان خانگی کوچک و پشمالو.' },
        { text: 'سگ', level: 'easy', description: 'وفادارترین دوست انسان.' },
        { text: 'اسب', level: 'easy', description: 'حیوانی قوی که برای سواری استفاده می‌شود.' },
        { text: 'خرگوش', level: 'easy', description: 'حیوانی با گوش‌های بلند و سرعت زیاد.' },
        { text: 'شیر', level: 'easy', description: 'سلطان جنگل.' },
        { text: 'پلنگ', level: 'medium', description: 'گربه‌سان خالدار و چابک.' },
        { text: 'فیل', level: 'easy', description: 'بزرگترین حیوان خشکی با خرطوم.' },
        { text: 'زرافه', level: 'easy', description: 'حیوانی با گردن بسیار بلند.' },
        { text: 'تمساح', level: 'hard', description: 'خزنده آبزی خطرناک با پوزه‌ای بلند.' },
        { text: 'پنگوئن', level: 'medium', description: 'پرنده‌ای که پرواز نمی‌کند و در مناطق سرد زندگی می‌کند.' },
      ],
    },

    // افعال (10)
    {
      name: 'افعال',
      words: [
        { text: 'نوشتن', level: 'easy', description: 'عملی برای ثبت حروف و کلمات.' },
        { text: 'خواندن', level: 'easy', description: 'عملی برای درک متون.' },
        { text: 'دویدن', level: 'easy', description: 'حرکت سریع با پاها.' },
        { text: 'آفریدن', level: 'medium', description: 'خلق کردن، به وجود آوردن.' },
        { text: 'اندیشیدن', level: 'medium', description: 'فکر کردن، تعمق.' },
      ],
    },

    // بدن انسان (10)
    {
      name: 'بدن انسان',
      words: [
        { text: 'سر', level: 'easy', description: 'بالاترین قسمت بدن که مغز را در بر می‌گیرد.' },
        { text: 'چشم', level: 'easy', description: 'عضو بینایی.' },
        { text: 'گردن', level: 'easy', description: 'قسمتی که سر را به تنه متصل می‌کند.' },
        { text: 'شانه', level: 'easy', description: 'قسمت بالایی بازو.' },
        { text: 'زانو', level: 'easy', description: 'مفصل اصلی پا.' },
      ],
    },
  ],
};


// =========================================================================
// ۲. تنظیمات دیتابیس (PostgreSQL)
// =========================================================================
const buildConnectionString = () => {
  let cs = process.env.DATABASE_URL;
  if (cs && !/sslmode=/i.test(cs)) cs += (cs.includes('?') ? '&' : '?') + 'sslmode=require';
  // Fallback for individual env vars if DATABASE_URL is not set
  if (!cs) {
    const host = process.env.PGHOST, port = process.env.PGPORT || 5432, user = process.env.PGUSER, pass = process.env.PGPASSWORD, db = process.env.PGDATABASE;
    if (host && user && pass && db) return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:${port}/${db}?sslmode=require`;
  }
  return cs;
};

const connectionString = buildConnectionString();
const pool = new Pool({ 
  connectionString, 
  ssl: connectionString && connectionString.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined 
});


// =========================================================================
// ۳. ابزارهای کمکی (Helpers)
// =========================================================================
/** حروف کلمه‌ی فارسی را نرمالایز و فیلتر می‌کند */
function normalizeWord(word) {
  // جایگزینی 'ی' عربی با فارسی و 'ک' عربی با فارسی
  let normalized = word.replace(/ي/g, 'ی').replace(/ك/g, 'ک');
  // حذف نیم‌فاصله (Zero Width Non-Joiner - U+200C) و فاصله‌ها
  normalized = normalized.replace(/\s+/g, '').replace(/\u200c/g, ''); 
  return normalized.normalize('NFC');
}

/** تولید رشته تصادفی/آیدی */
function generateRandomString(length = 10) {
  return crypto.randomBytes(length).toString('hex').slice(0, length);
}

/** کلماتی را بر اساس سطح و تعداد کلمات انتخاب می‌کند */
function selectDeck(level, count = 10) {
  const allWords = WORD_DATA.categories.flatMap(cat => 
    cat.words.map(word => ({
      text: normalizeWord(word.text),
      raw_text: word.text, // برای نمایش در فرانت
      category: cat.name,
      level: word.level,
      description: word.description,
      word_length: normalizeWord(word.text).length,
    })).filter(w => w.level === level)
  );

  // شافل کردن و انتخاب 'count' کلمه
  const shuffled = allWords.sort(() => 0.5 - Math.random());
  return shuffled.slice(0, count);
}

/** محاسبه امتیاز بر اساس تعداد حدس‌های صحیح متوالی و سرعت */
function calculateScore(wordLength, correctCount, timeTakenMs) {
  const baseScore = wordLength * 5;
  const timeBonus = Math.max(0, 50000 - timeTakenMs) / 10000; // تا ۵ امتیاز پاداش
  const finalScore = Math.floor(baseScore + timeBonus);
  return finalScore;
}

// =========================================================================
// ۴. تعریف مدل‌های دیتابیس و ایجاد جدول‌ها
// =========================================================================
async function setupDatabase() {
  const client = await pool.connect();
  try {
    // 1. جدول اتاق‌ها (Rooms)
    await client.query(`
      CREATE TABLE IF NOT EXISTS rooms (
        id VARCHAR(10) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        level VARCHAR(50) NOT NULL, -- easy, medium, hard
        max_players INTEGER DEFAULT 4,
        status VARCHAR(50) DEFAULT 'waiting', -- waiting, playing, finished
        current_game_id VARCHAR(10),
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // 2. جدول بازیکنان (Players)
    await client.query(`
      CREATE TABLE IF NOT EXISTS room_players (
        room_id VARCHAR(10) REFERENCES rooms(id) ON DELETE CASCADE,
        user_id VARCHAR(50) NOT NULL,
        fullname VARCHAR(255),
        is_owner BOOLEAN DEFAULT FALSE,
        joined_at TIMESTAMP DEFAULT NOW(),
        PRIMARY KEY (room_id, user_id)
      );
    `);
    
    // 3. جدول بازی‌ها (Games)
    await client.query(`
      CREATE TABLE IF NOT EXISTS games (
        id VARCHAR(10) PRIMARY KEY,
        room_id VARCHAR(10) REFERENCES rooms(id) ON DELETE CASCADE,
        deck JSONB NOT NULL, -- لیست کلمات بازی
        status VARCHAR(50) DEFAULT 'active', -- active, finished
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // 4. جدول وضعیت بازیکنان در بازی (Game States)
    await client.query(`
      CREATE TABLE IF NOT EXISTS game_states (
        game_id VARCHAR(10) REFERENCES games(id) ON DELETE CASCADE,
        user_id VARCHAR(50) NOT NULL,
        score INTEGER DEFAULT 0,
        current_index INTEGER DEFAULT 0, -- شاخص کلمه فعلی در deck
        correct_letters JSONB DEFAULT '[]', -- حروف صحیح حدس زده شده
        wrong_letters JSONB DEFAULT '[]', -- حروف غلط حدس زده شده
        allowed_wrong INTEGER DEFAULT 5, -- حد مجاز حدس غلط
        word_start_time TIMESTAMP DEFAULT NOW(),
        word_deadline TIMESTAMP,
        last_update TIMESTAMP DEFAULT NOW(),
        PRIMARY KEY (game_id, user_id)
      );
    `);
    console.log('Database tables are ready.');
  } catch (err) {
    console.error('Error setting up database:', err);
    throw err;
  } finally {
    client.release();
  }
}


// =========================================================================
// ۵. تنظیم Express و Socket.IO
// =========================================================================
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', methods: ['GET','POST'] } });

app.use(cors());
app.use(express.json());

/** * مهم: رفع خطای "Cannot GET /"
 * این مسیر، فایل اصلی index.html را به کاربر برمی‌گرداند.
 */
app.get('/', (req, res) => {
  // فرض بر این است که فایل index.html در کنار server.js قرار دارد
  res.sendFile(path.join(__dirname, 'index.html'));
});

// =========================================================================
// ۶. مسیرهای API (Express Routes)
// =========================================================================
const router = express.Router();

/** لیست اتاق‌های عمومی */
router.get('/list', async (req, res) => {
  try {
    const { level } = req.query;
    let query = `
      SELECT r.id, r.name, r.level, r.max_players, r.status, COUNT(p.user_id) as players 
      FROM rooms r
      LEFT JOIN room_players p ON r.id = p.room_id
      WHERE r.status IN ('waiting', 'playing') 
    `;
    const params = [];
    if (level && ['easy', 'medium', 'hard'].includes(level)) {
      query += ` AND r.level = $1`;
      params.push(level);
    }
    query += ` GROUP BY r.id ORDER BY r.created_at DESC;`;

    const { rows } = await pool.query(query, params);
    res.json({ ok: true, rooms: rows });
  } catch (e) {
    console.error('Error fetching rooms:', e);
    res.status(500).json({ ok: false, error: 'Internal server error' });
  }
});

/** ساخت اتاق جدید */
router.post('/create', async (req, res) => {
  const { user_id, name, level = 'medium', max_players = 4 } = req.body;
  if (!user_id || !name) return res.status(400).json({ ok: false, error: 'Missing parameters' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const roomId = generateRandomString(6);
    await client.query(
      `INSERT INTO rooms (id, name, level, max_players, status) VALUES ($1, $2, $3, $4, 'waiting');`,
      [roomId, name, level, max_players]
    );

    await client.query(
      `INSERT INTO room_players (room_id, user_id, fullname, is_owner) VALUES ($1, $2, $3, TRUE);`,
      [roomId, user_id, `کاربر ${String(user_id).slice(-4)}`, true] // Placeholder for fullname
    );

    await client.query('COMMIT');
    res.json({ ok: true, room_id: roomId });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Error creating room:', e);
    res.status(500).json({ ok: false, error: 'Database error' });
  } finally {
    client.release();
  }
});

/** پیوستن به اتاق */
router.post('/join', async (req, res) => {
  const { room_id, user_id, fullname } = req.body;
  if (!room_id || !user_id) return res.status(400).json({ ok: false, error: 'Missing parameters' });

  try {
    // Check if room is full
    const { rows: roomRows } = await pool.query('SELECT max_players FROM rooms WHERE id = $1', [room_id]);
    if (roomRows.length === 0) return res.status(404).json({ ok: false, error: 'Room not found' });
    const maxPlayers = roomRows[0].max_players;

    const { rows: countRows } = await pool.query('SELECT COUNT(*) FROM room_players WHERE room_id = $1', [room_id]);
    const playerCount = parseInt(countRows[0].count, 10);
    if (playerCount >= maxPlayers) return res.status(403).json({ ok: false, error: 'full' });

    // Join
    const userFullName = fullname || `کاربر ${String(user_id).slice(-4)}`;
    await pool.query(
      `INSERT INTO room_players (room_id, user_id, fullname) VALUES ($1, $2, $3) ON CONFLICT (room_id, user_id) DO NOTHING;`,
      [room_id, user_id, userFullName]
    );

    io.to(room_id).emit('room:joined', { room_id, user_id, fullname: userFullName });
    res.json({ ok: true });
  } catch (e) {
    console.error('Error joining room:', e);
    res.status(500).json({ ok: false, error: 'Database error' });
  }
});

/** ترک اتاق */
router.post('/leave', async (req, res) => {
    const { room_id, user_id } = req.body;
    if (!room_id || !user_id) return res.status(400).json({ ok: false, error: 'Missing parameters' });

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('DELETE FROM room_players WHERE room_id = $1 AND user_id = $2', [room_id, user_id]);
        
        // Check if room is empty, if so, delete it
        const { rows: countRows } = await client.query('SELECT COUNT(*) FROM room_players WHERE room_id = $1', [room_id]);
        if (parseInt(countRows[0].count, 10) === 0) {
            await client.query('DELETE FROM rooms WHERE id = $1', [room_id]);
        } else {
            // Check for owner change if the leaver was the owner
            await client.query(`
                UPDATE room_players SET is_owner = TRUE 
                WHERE room_id = $1 AND is_owner = FALSE 
                LIMIT 1;
            `, [room_id]);
        }
        await client.query('COMMIT');
        
        io.to(room_id).emit('room:left', { room_id, user_id });
        res.json({ ok: true });
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('Error leaving room:', e);
        res.status(500).json({ ok: false, error: 'Database error' });
    } finally {
        client.release();
    }
});

/** وضعیت یک اتاق */
router.post('/state', async (req, res) => {
    const { room_id } = req.body;
    if (!room_id) return res.status(400).json({ ok: false, error: 'Missing parameters' });
    try {
        const { rows: roomRows } = await pool.query('SELECT * FROM rooms WHERE id = $1', [room_id]);
        const { rows: playerRows } = await pool.query('SELECT user_id, fullname, is_owner FROM room_players WHERE room_id = $1', [room_id]);
        
        const room = roomRows[0];
        if (!room) return res.status(404).json({ ok: false, error: 'Room not found' });

        let game = null;
        if (room.status === 'playing' && room.current_game_id) {
            const { rows: gameRows } = await pool.query('SELECT id, deck, status FROM games WHERE id = $1', [room.current_game_id]);
            game = gameRows[0];
        }

        res.json({ ok: true, room, players: playerRows, game });
    } catch (e) {
        console.error('Error fetching room state:', e);
        res.status(500).json({ ok: false, error: 'Database error' });
    }
});

/** لیست بازی‌های فعال کاربر (برای داشبورد) */
router.post('/myrooms', async (req, res) => {
    const { user_id } = req.body;
    if (!user_id) return res.status(400).json({ ok: false, error: 'Missing parameters' });
    try {
        const { rows } = await pool.query(`
            SELECT r.id, r.name, r.level, r.status
            FROM rooms r
            JOIN room_players p ON r.id = p.room_id
            WHERE p.user_id = $1 AND r.status IN ('waiting', 'playing')
            ORDER BY r.created_at DESC;
        `, [user_id]);
        res.json({ ok: true, rooms: rows });
    } catch (e) {
        console.error('Error fetching user rooms:', e);
        res.status(500).json({ ok: false, error: 'Database error' });
    }
});

app.use('/rooms', router);

// =========================================================================
// ۷. منطق بازی (Socket.IO)
// =========================================================================

// Store temporary socket metadata (room IDs the socket is in)
const socketMeta = new Map();

// Helper to get all player states for a game
async function getGameStates(gameId) {
    const { rows } = await pool.query(`SELECT * FROM game_states WHERE game_id = $1 ORDER BY score DESC, user_id ASC;`, [gameId]);
    return rows;
}

// Helper to get player names
async function getPlayerFullnames(roomId) {
    const { rows } = await pool.query(`SELECT user_id, fullname FROM room_players WHERE room_id = $1;`, [roomId]);
    return rows.reduce((map, p) => { map[p.user_id] = p.fullname; return map; }, {});
}

// Helper to combine game state with player names
async function combineStates(gameId, roomPlayers) {
    const states = await getGameStates(gameId);
    const playerNames = roomPlayers.reduce((map, p) => { map[p.user_id] = p.fullname; return map; }, {});
    return states.map(s => ({
        ...s,
        fullname: playerNames[s.user_id] || `کاربر ${String(s.user_id).slice(-4)}`
    }));
}

// Helper to check if a word is complete for a player
function isWordComplete(word, correctLetters) {
    const normalizedWord = normalizeWord(word.raw_text);
    return [...new Set(normalizedWord.split(''))].every(letter => correctLetters.includes(letter));
}

// Helper to move to the next word
async function goToNextWord(gameId, roomId, deck, wordIndex, players) {
    const nextIndex = wordIndex + 1;
    const now = new Date();
    const deadline = new Date(now.getTime() + 60 * 1000); // ۶۰ ثانیه زمان برای کلمه جدید

    if (nextIndex < deck.length) {
        // Update all players' state to the next word
        await pool.query(`
            UPDATE game_states SET 
                current_index = $1, 
                correct_letters = '[]', 
                wrong_letters = '[]', 
                word_start_time = $2,
                word_deadline = $3,
                last_update = NOW()
            WHERE game_id = $4;
        `, [nextIndex, now, deadline, gameId]);
        
        io.to(roomId).emit('game:next', { 
            game_id: gameId, 
            nextIndex, 
            newState: { word_deadline: deadline },
            states: players.map(p => ({ ...p, current_index: nextIndex, correct_letters: [], wrong_letters: [] }))
        });
        
    } else {
        // Game finished
        await pool.query(`UPDATE rooms SET status='finished', current_game_id=NULL WHERE id=$1`, [roomId]);
        await pool.query(`UPDATE games SET status='finished' WHERE id=$1`, [gameId]);
        io.to(roomId).emit('game:finished', { game_id: gameId });
    }
}


io.on('connection', (socket) => {
  // Setup socket metadata
  socketMeta.set(socket.id, { user_id: null, room_ids: new Set() });

  socket.on('join-room', async (data) => {
    const { room_id, user_id } = data;
    if (!room_id || !user_id) return;
    
    // Check if the user is a player in the room
    const { rows: playerRows } = await pool.query('SELECT fullname, is_owner FROM room_players WHERE room_id = $1 AND user_id = $2', [room_id, user_id]);
    if (playerRows.length === 0) return; 

    // Join the socket room
    socket.join(room_id);
    const meta = socketMeta.get(socket.id);
    if (meta) {
      meta.user_id = user_id;
      meta.room_ids.add(room_id);
    }
    
    // Broadcast presence update (though not used in client yet, it's good practice)
    // io.to(room_id).emit('room:presence', { room_id, count: io.sockets.adapter.rooms.get(room_id)?.size || 0 });

    // Try to start the game if the user is the owner and the room is waiting
    const { rows: roomRows } = await pool.query('SELECT level, status, current_game_id FROM rooms WHERE id = $1', [room_id]);
    const room = roomRows[0];

    if (room && room.status === 'waiting' && playerRows[0].is_owner) {
      // Auto-start game logic (simplified: start when owner joins)
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const gameId = generateRandomString(10);
        const deck = selectDeck(room.level);
        
        await client.query(
            `INSERT INTO games (id, room_id, deck) VALUES ($1, $2, $3);`,
            [gameId, room_id, JSON.stringify(deck)]
        );
        
        const { rows: players } = await client.query('SELECT user_id, fullname FROM room_players WHERE room_id = $1', [room_id]);
        const now = new Date();
        const deadline = new Date(now.getTime() + 60 * 1000); // ۶۰ ثانیه زمان برای کلمه اول
        
        for (const player of players) {
          await client.query(
              `INSERT INTO game_states (game_id, user_id, word_start_time, word_deadline) VALUES ($1, $2, $3, $4);`,
              [gameId, player.user_id, now, deadline]
          );
        }

        await client.query(`UPDATE rooms SET status='playing', current_game_id=$1 WHERE id=$2`, [gameId, room_id]);
        await client.query('COMMIT');

        const initialStates = await combineStates(gameId, players);
        io.to(room_id).emit('game:started', { game_id: gameId, deck, players: initialStates });
        
      } catch (e) {
        await client.query('ROLLBACK');
        console.error('Error starting game:', e);
      } finally {
        client.release();
      }
    }
  });

  socket.on('game:resume', async ({ game_id, user_id }) => {
    if (!game_id || !user_id) return;
    try {
        const { rows: gameRows } = await pool.query('SELECT room_id, deck FROM games WHERE id = $1', [game_id]);
        const { rows: stateRows } = await pool.query('SELECT * FROM game_states WHERE game_id = $1 AND user_id = $2', [game_id, user_id]);
        const { rows: playerRows } = await pool.query('SELECT user_id, fullname FROM room_players WHERE room_id = $1', [gameRows[0].room_id]);

        if (gameRows.length === 0 || stateRows.length === 0) return;

        const deck = gameRows[0].deck;
        const myState = stateRows[0];
        const allStates = await combineStates(game_id, playerRows);

        // Send my state back to me
        socket.emit('game:state', { 
            game_id, 
            deck, 
            state: myState, 
            players: allStates
        });
        
    } catch (e) {
        console.error('game:resume error', e);
    }
  });


  socket.on('game:guess', async ({ game_id, user_id, letter }) => {
    if (!game_id || !user_id || !letter) return;
    const normalizedLetter = normalizeWord(letter);

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        // Fetch game info
        const { rows: gameRows } = await client.query('SELECT room_id, deck FROM games WHERE id = $1', [game_id]);
        const { rows: stateRows } = await client.query('SELECT * FROM game_states WHERE game_id = $1 AND user_id = $2 FOR UPDATE', [game_id, user_id]);
        if (gameRows.length === 0 || stateRows.length === 0) { await client.query('ROLLBACK'); return; }

        const room_id = gameRows[0].room_id;
        const deck = gameRows[0].deck;
        let state = stateRows[0];
        const currentWord = deck[state.current_index];
        const normalizedCurrentWord = normalizeWord(currentWord.raw_text);
        
        // Already guessed?
        if (state.correct_letters.includes(normalizedLetter) || state.wrong_letters.includes(normalizedLetter)) {
            await client.query('ROLLBACK');
            return; 
        }

        let isCorrect = normalizedCurrentWord.includes(normalizedLetter);
        let updatedScore = state.score;
        let updateQuery = '';
        let updateParams = [];
        
        if (isCorrect) {
            // Correct guess: Add to correct_letters, calculate new score
            const newCorrectLetters = [...state.correct_letters, normalizedLetter];
            
            // Check if the word is complete
            const wordComplete = isWordComplete(currentWord, newCorrectLetters);
            
            if (wordComplete) {
                // Word Complete: Calculate final score for this word
                const timeTakenMs = Date.now() - new Date(state.word_start_time).getTime();
                const scoreIncrease = calculateScore(currentWord.word_length, newCorrectLetters.length, timeTakenMs);
                updatedScore += scoreIncrease;
                
                updateQuery = `UPDATE game_states SET score=$3, correct_letters=$4, last_update=NOW() WHERE game_id=$1 AND user_id=$2 RETURNING *;`;
                updateParams = [game_id, user_id, updatedScore, JSON.stringify(newCorrectLetters)];

            } else {
                // Word Not Complete: Just update correct letters and score
                updatedScore += 2; // امتیاز پایه برای هر حرف صحیح
                updateQuery = `UPDATE game_states SET score=$3, correct_letters=$4, last_update=NOW() WHERE game_id=$1 AND user_id=$2 RETURNING *;`;
                updateParams = [game_id, user_id, updatedScore, JSON.stringify(newCorrectLetters)];
            }

            const { rows: updatedStateRows } = await client.query(updateQuery, updateParams);
            state = updatedStateRows[0];
            
            // Send back correct feedback
            io.to(room_id).emit('game:letter:correct', { 
                game_id, 
                user_id, 
                letter: normalizedLetter, 
                player: { score: updatedScore, correct_letters: newCorrectLetters } 
            });

            // If word is complete, move to the next word for everyone
            if (wordComplete) {
                const { rows: playerRows } = await client.query('SELECT user_id, fullname FROM room_players WHERE room_id = $1', [room_id]);
                const allStates = await combineStates(game_id, playerRows);
                await goToNextWord(game_id, room_id, deck, state.current_index, allStates);
            }

        } else {
            // Wrong guess: Add to wrong_letters, check for word failure
            const newWrongLetters = [...state.wrong_letters, normalizedLetter];
            const wrongCount = newWrongLetters.length;
            
            if (wrongCount > state.allowed_wrong) {
                // Word Failed: Penalize score, mark current word as failed, and move to next word
                updatedScore = Math.max(0, updatedScore - 15); // کسر امتیاز برای شکست
                
                updateQuery = `UPDATE game_states SET score=$3, wrong_letters=$4, last_update=NOW() WHERE game_id=$1 AND user_id=$2 RETURNING *;`;
                updateParams = [game_id, user_id, updatedScore, JSON.stringify(newWrongLetters)];
                
                await client.query(updateQuery, updateParams);

                io.to(room_id).emit('game:letter:wrong', { game_id, user_id, letter: normalizedLetter });
                io.to(room_id).emit('game:feedback', { game_id, type: 'word-failed', user_id, word: currentWord.raw_text });
                
                const { rows: playerRows } = await client.query('SELECT user_id, fullname FROM room_players WHERE room_id = $1', [room_id]);
                const allStates = await combineStates(game_id, playerRows);
                await goToNextWord(game_id, room_id, deck, state.current_index, allStates);

            } else {
                // Wrong guess, but still attempts left
                updateQuery = `UPDATE game_states SET wrong_letters=$3, last_update=NOW() WHERE game_id=$1 AND user_id=$2 RETURNING *;`;
                updateParams = [game_id, user_id, JSON.stringify(newWrongLetters)];
                
                await client.query(updateQuery, updateParams);
                io.to(room_id).emit('game:letter:wrong', { game_id, user_id, letter: normalizedLetter });
            }
        }
        
        await client.query('COMMIT');
        
        // Broadcast all states update
        const { rows: playerRows } = await client.query('SELECT user_id, fullname FROM room_players WHERE room_id = $1', [room_id]);
        io.to(room_id).emit('game:states', { game_id, states: await combineStates(game_id, playerRows) });

    } catch (e) {
        await client.query('ROLLBACK');
        console.error('game:guess error', e);
    } finally {
        client.release();
    }
  });

  socket.on('game:hint', async ({ game_id, user_id }) => {
    if (!game_id || !user_id) return;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Fetch game and state info
        const { rows: gameRows } = await client.query('SELECT room_id, deck FROM games WHERE id = $1', [game_id]);
        const { rows: stateRows } = await client.query('SELECT * FROM game_states WHERE game_id = $1 AND user_id = $2 FOR UPDATE', [game_id, user_id]);
        if (gameRows.length === 0 || stateRows.length === 0) { await client.query('ROLLBACK'); return; }

        const room_id = gameRows[0].room_id;
        const deck = gameRows[0].deck;
        let state = stateRows[0];
        const currentWord = deck[state.current_index];
        const normalizedCurrentWord = normalizeWord(currentWord.raw_text);

        if (state.score < 10) { await client.query('ROLLBACK'); return; }

        const allLetters = [...new Set(normalizedCurrentWord.split(''))];
        const unrevealedLetters = allLetters.filter(l => !state.correct_letters.includes(l));

        if (unrevealedLetters.length === 0) { await client.query('ROLLBACK'); return; } // Word is already solved!

        // Select a random unrevealed letter
        const reveal = unrevealedLetters[Math.floor(Math.random() * unrevealedLetters.length)];
        const penalty = 10;
        const newScore = Math.max(0, state.score - penalty);
        const newCorrectLetters = [...state.correct_letters, reveal];
        
        // Update state
        const updateQuery = `UPDATE game_states SET score=$3, correct_letters=$4, last_update=NOW() WHERE game_id=$1 AND user_id=$2 RETURNING *;`;
        const updateParams = [game_id, user_id, newScore, JSON.stringify(newCorrectLetters)];
        const { rows: updatedStateRows } = await client.query(updateQuery, updateParams);
        state = updatedStateRows[0];
        
        await client.query('COMMIT');
        
        // Send back hint feedback
        io.to(room_id).emit('game:hint:reveal', { 
            game_id, 
            user_id, 
            letter: reveal, 
            penalty, 
            player: { score: newScore, correct_letters: newCorrectLetters } 
        });

        // Check if the word is complete after hint
        const wordComplete = isWordComplete(currentWord, newCorrectLetters);
        if (wordComplete) {
            const { rows: playerRows } = await client.query('SELECT user_id, fullname FROM room_players WHERE room_id = $1', [room_id]);
            const allStates = await combineStates(game_id, playerRows);
            await goToNextWord(game_id, room_id, deck, state.current_index, allStates);
        } else {
            // Broadcast all states update
            const { rows: playerRows } = await client.query('SELECT user_id, fullname FROM room_players WHERE room_id = $1', [room_id]);
            io.to(room_id).emit('game:states', { game_id, states: await combineStates(game_id, playerRows) });
        }


    } catch (e) {
        await client.query('ROLLBACK');
        console.error('game:hint error', e);
    } finally {
        client.release();
    }
  });
  
  // Handling word timeout (triggered by client after deadline)
  socket.on('game:timeout', async ({ game_id, user_id }) => {
    if (!game_id || !user_id) return;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        const { rows: gameRows } = await client.query('SELECT room_id, deck FROM games WHERE id = $1', [game_id]);
        const { rows: stateRows } = await client.query('SELECT * FROM game_states WHERE game_id = $1 AND user_id = $2 FOR UPDATE', [game_id, user_id]);
        if (gameRows.length === 0 || stateRows.length === 0) { await client.query('ROLLBACK'); return; }

        const room_id = gameRows[0].room_id;
        const deck = gameRows[0].deck;
        let state = stateRows[0];
        const currentWord = deck[state.current_index];
        
        // Only proceed if the deadline has passed (safety check)
        if (new Date(state.word_deadline).getTime() < Date.now()) {
            
            io.to(room_id).emit('game:feedback', { game_id, type: 'word-failed', user_id, word: currentWord.raw_text });
            
            // Move to the next word for everyone
            const { rows: playerRows } = await client.query('SELECT user_id, fullname FROM room_players WHERE room_id = $1', [room_id]);
            const allStates = await combineStates(game_id, playerRows);
            await goToNextWord(game_id, room_id, deck, state.current_index, allStates);
        }

        await client.query('COMMIT');
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('game:timeout error', e);
    } finally {
        client.release();
    }
  });


  socket.on('disconnect', () => {
    const m = socketMeta.get(socket.id);
    if (!m) return;
    for (const rid of m.room_ids) {
      // Logic to handle room presence update (if needed)
    }
    socketMeta.delete(socket.id);
  });
});


// =========================================================================
// ۸. راه‌اندازی سرور (Boot)
// =========================================================================
(async () => {
  try {
    // 1. Check DB connection and setup tables
    await setupDatabase();

    // 2. Start the HTTP/Socket.IO server
    server.listen(PORT, () => {
      console.log(`✅ Server is running on port ${PORT}`);
      console.log(`🌐 Open http://localhost:${PORT} in your browser`);
    });
  } catch (err) {
    console.error('❌ Failed to start server:', err);
    process.exit(1);
  }
})();

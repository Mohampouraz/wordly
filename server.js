// --- تنظیمات اولیه ---
const express = require('express');
const path = require('path');
const http = require('http');
const socketIo = require('socket.io');
const { Pool } = require('pg');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const WEB_APP_URL = process.env.WEB_APP_URL || `https://wordlygame.onrender.com`;

// --- تنظیمات PostgreSQL ---
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// --- ایجاد جداول ---
async function initializeDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS games (
        id SERIAL PRIMARY KEY,
        game_code VARCHAR(10) UNIQUE NOT NULL,
        creator_id BIGINT NOT NULL,
        word VARCHAR(50) NOT NULL,
        category VARCHAR(100) NOT NULL,
        difficulty VARCHAR(10) CHECK (difficulty IN ('easy', 'medium', 'hard')) DEFAULT 'medium',
        max_attempts INTEGER NOT NULL,
        time_limit INTEGER NOT NULL,
        game_state VARCHAR(10) CHECK (game_state IN ('waiting', 'active', 'finished')) DEFAULT 'waiting',
        start_time TIMESTAMP,
        end_time TIMESTAMP,
        winner_id BIGINT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS game_players (
        id SERIAL PRIMARY KEY,
        game_id INTEGER REFERENCES games(id) ON DELETE CASCADE,
        telegram_id BIGINT NOT NULL,
        username VARCHAR(255),
        joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        is_active BOOLEAN DEFAULT true,
        UNIQUE(game_id, telegram_id)
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS game_guesses (
        id SERIAL PRIMARY KEY,
        game_id INTEGER REFERENCES games(id) ON DELETE CASCADE,
        player_id BIGINT NOT NULL,
        letter VARCHAR(1) NOT NULL,
        position INTEGER DEFAULT -1,
        is_correct BOOLEAN DEFAULT false,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS revealed_letters (
        id SERIAL PRIMARY KEY,
        game_id INTEGER REFERENCES games(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        revealed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log('Database tables initialized successfully');
  } catch (error) {
    console.error('Error initializing database:', error);
  }
}

initializeDatabase();

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- روت‌ها ---
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ایجاد بازی جدید
app.post('/api/game/create', async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const { creatorId, word, category, difficulty } = req.body;
    
    const wordLength = word.length;
    let maxAttempts, timeLimit;
    
    switch(difficulty) {
      case 'easy':
        maxAttempts = Math.ceil(wordLength * 1.5);
        timeLimit = 5;
        break;
      case 'medium':
        maxAttempts = Math.ceil(wordLength * 1.3);
        timeLimit = 4;
        break;
      case 'hard':
        maxAttempts = Math.ceil(wordLength * 1.1);
        timeLimit = 3;
        break;
      default:
        maxAttempts = Math.ceil(wordLength * 1.3);
        timeLimit = 4;
    }
    
    const gameCode = crypto.randomBytes(3).toString('hex').toUpperCase();
    
    const gameResult = await client.query(
      `INSERT INTO games (game_code, creator_id, word, category, difficulty, max_attempts, time_limit) 
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [gameCode, creatorId, word.toLowerCase(), category, difficulty, maxAttempts, timeLimit]
    );
    
    const gameId = gameResult.rows[0].id;
    
    await client.query(
      `INSERT INTO game_players (game_id, telegram_id, username) 
       VALUES ($1, $2, $3)`,
      [gameId, creatorId, req.body.username || 'Unknown']
    );
    
    await client.query('COMMIT');
    
    res.json({
      success: true,
      gameCode,
      message: 'بازی با موفقیت ایجاد شد'
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error creating game:', error);
    res.status(500).json({
      success: false,
      message: 'خطا در ایجاد بازی'
    });
  } finally {
    client.release();
  }
});

// پیوستن به بازی - نسخه جدید که بازی رو شروع میکنه
app.post('/api/game/join', async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const { gameCode, playerId, username } = req.body;
    
    console.log(`پیوستن به بازی: ${gameCode} توسط کاربر: ${playerId}`);
    
    // پیدا کردن بازی
    const gameResult = await client.query(
      `SELECT id, game_state, creator_id FROM games WHERE game_code = $1`,
      [gameCode]
    );
    
    if (gameResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'بازی یافت نشد'
      });
    }
    
    const gameId = gameResult.rows[0].id;
    const gameState = gameResult.rows[0].game_state;
    const creatorId = gameResult.rows[0].creator_id;
    
    // بررسی آیا کاربر قبلا به بازی پیوسته است
    const playerResult = await client.query(
      `SELECT id FROM game_players WHERE game_id = $1 AND telegram_id = $2`,
      [gameId, playerId]
    );
    
    if (playerResult.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'شما قبلا به این بازی پیوسته‌اید'
      });
    }
    
    // اضافه کردن کاربر به بازی
    await client.query(
      `INSERT INTO game_players (game_id, telegram_id, username) 
       VALUES ($1, $2, $3)`,
      [gameId, playerId, username]
    );
    
    // اگر بازی در حالت waiting هست و الان کاربر دوم پیوست، بازی رو شروع کن
    let gameStarted = false;
    if (gameState === 'waiting') {
      const playersCount = await client.query(
        `SELECT COUNT(*) as count FROM game_players WHERE game_id = $1`,
        [gameId]
      );
      
      // اگر حداقل 2 بازیکن وجود داره، بازی رو شروع کن
      if (parseInt(playersCount.rows[0].count) >= 2) {
        const startTime = new Date();
        const endTime = new Date(startTime.getTime() + 5 * 60 * 1000); // 5 دقیقه
        
        await client.query(
          `UPDATE games SET game_state = 'active', start_time = $1, end_time = $2 WHERE id = $3`,
          [startTime, endTime, gameId]
        );
        
        gameStarted = true;
        console.log(`بازی ${gameCode} به صورت خودکار شروع شد`);
      }
    }
    
    await client.query('COMMIT');
    
    // دریافت اطلاعات کامل بازی
    const gameInfo = await getGameInfo(gameId);
    
    res.json({
      success: true,
      message: 'با موفقیت به بازی پیوستید',
      game: gameInfo,
      gameStarted: gameStarted
    });
    
    // اطلاع‌رسانی به سایر بازیکنان
    const playersResult = await client.query(
      `SELECT telegram_id, username, is_active FROM game_players WHERE game_id = $1`,
      [gameId]
    );
    
    io.to(gameCode).emit('playerJoined', {
      playerId,
      username,
      players: playersResult.rows,
      gameStarted: gameStarted
    });
    
    // اگر بازی شروع شد، اطلاع‌رسانی کن
    if (gameStarted) {
      io.to(gameCode).emit('gameStarted', {
        startTime: startTime,
        endTime: endTime,
        timeLimit: 5
      });
    }
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error joining game:', error);
    res.status(500).json({
      success: false,
      message: 'خطا در پیوستن به بازی'
    });
  } finally {
    client.release();
  }
});

// تابع کمکی برای دریافت اطلاعات بازی
async function getGameInfo(gameId) {
  try {
    const gameResult = await pool.query(`SELECT * FROM games WHERE id = $1`, [gameId]);
    if (gameResult.rows.length === 0) return null;
    
    const game = gameResult.rows[0];
    
    const playersResult = await pool.query(
      `SELECT telegram_id, username, joined_at, is_active FROM game_players WHERE game_id = $1`,
      [game.id]
    );
    
    const guessesResult = await pool.query(
      `SELECT player_id, letter, position, is_correct, timestamp 
       FROM game_guesses WHERE game_id = $1 ORDER BY timestamp`,
      [game.id]
    );
    
    const revealedResult = await pool.query(
      `SELECT position FROM revealed_letters WHERE game_id = $1`,
      [game.id]
    );
    
    game.players = playersResult.rows;
    game.guesses = guessesResult.rows;
    game.revealedLetters = revealedResult.rows.map(r => r.position);
    
    return game;
  } catch (error) {
    console.error('Error getting game info:', error);
    return null;
  }
}

// API برای دریافت اطلاعات بازی
app.get('/api/game/:gameCode', async (req, res) => {
  try {
    const { gameCode } = req.params;
    
    const gameResult = await pool.query(`SELECT id FROM games WHERE game_code = $1`, [gameCode]);
    if (gameResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'بازی یافت نشد' });
    }
    
    const gameId = gameResult.rows[0].id;
    const game = await getGameInfo(gameId);
    
    if (!game) {
      return res.status(404).json({ success: false, message: 'خطا در دریافت اطلاعات بازی' });
    }
    
    res.json({ success: true, game });
  } catch (error) {
    console.error('Error fetching game:', error);
    res.status(500).json({ success: false, message: 'خطا در دریافت اطلاعات بازی' });
  }
});

// API برای ثبت حدس
app.post('/api/game/guess', async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const { gameCode, playerId, letter } = req.body;
    
    const gameResult = await client.query(
      `SELECT id, word, max_attempts FROM games WHERE game_code = $1 AND game_state = 'active'`,
      [gameCode]
    );
    
    if (gameResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'بازی فعال یافت نشد' });
    }
    
    const game = gameResult.rows[0];
    
    const playerResult = await client.query(
      `SELECT id FROM game_players WHERE game_id = $1 AND telegram_id = $2 AND is_active = true`,
      [game.id, playerId]
    );
    
    if (playerResult.rows.length === 0) {
      return res.status(403).json({ success: false, message: 'شما در این بازی شرکت ندارید' });
    }
    
    const guessesResult = await client.query(
      `SELECT COUNT(*) as count FROM game_guesses WHERE game_id = $1 AND player_id = $2`,
      [game.id, playerId]
    );
    
    const guessCount = parseInt(guessesResult.rows[0].count);
    
    if (guessCount >= game.max_attempts) {
      return res.status(400).json({ success: false, message: 'تعداد حدس‌های مجاز شما به پایان رسیده است' });
    }
    
    const word = game.word;
    const positions = [];
    let isCorrect = false;
    
    for (let i = 0; i < word.length; i++) {
      if (word[i] === letter.toLowerCase()) {
        positions.push(i);
        isCorrect = true;
      }
    }
    
    const position = positions.length > 0 ? positions[0] : -1;
    
    await client.query(
      `INSERT INTO game_guesses (game_id, player_id, letter, position, is_correct) 
       VALUES ($1, $2, $3, $4, $5)`,
      [game.id, playerId, letter.toLowerCase(), position, isCorrect]
    );
    
    await client.query('COMMIT');
    
    res.json({
      success: true,
      isCorrect,
      positions,
      remainingAttempts: game.max_attempts - (guessCount + 1)
    });
    
    const playerInfo = await client.query(
      `SELECT username FROM game_players WHERE game_id = $1 AND telegram_id = $2`,
      [game.id, playerId]
    );
    
    const username = playerInfo.rows[0]?.username || 'Unknown';
    
    io.to(gameCode).emit('newGuess', {
      playerId,
      username,
      letter: letter.toLowerCase(),
      isCorrect,
      positions,
      remainingAttempts: game.max_attempts - (guessCount + 1)
    });
    
    await checkGameEnd(game.id, gameCode);
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error processing guess:', error);
    res.status(500).json({ success: false, message: 'خطا در پردازش حدس' });
  } finally {
    client.release();
  }
});

// API برای درخواست راهنمایی
app.post('/api/game/hint', async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const { gameCode, playerId } = req.body;
    
    const gameResult = await client.query(
      `SELECT id, word FROM games WHERE game_code = $1 AND game_state = 'active'`,
      [gameCode]
    );
    
    if (gameResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'بازی فعال یافت نشد' });
    }
    
    const game = gameResult.rows[0];
    
    const revealedResult = await client.query(
      `SELECT position FROM revealed_letters WHERE game_id = $1`,
      [game.id]
    );
    
    const revealedPositions = revealedResult.rows.map(r => r.position);
    const word = game.word;
    const unrevealedPositions = [];
    
    for (let i = 0; i < word.length; i++) {
      if (!revealedPositions.includes(i)) {
        unrevealedPositions.push(i);
      }
    }
    
    if (unrevealedPositions.length === 0) {
      return res.status(400).json({ success: false, message: 'همه حروف قبلا آشکار شده‌اند' });
    }
    
    const randomPosition = unrevealedPositions[Math.floor(Math.random() * unrevealedPositions.length)];
    const revealedLetter = word[randomPosition];
    
    await client.query(
      `INSERT INTO revealed_letters (game_id, position) VALUES ($1, $2)`,
      [game.id, randomPosition]
    );
    
    await client.query('COMMIT');
    
    res.json({ success: true, position: randomPosition, letter: revealedLetter });
    
    io.to(gameCode).emit('hintUsed', { playerId, position: randomPosition, letter: revealedLetter });
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error providing hint:', error);
    res.status(500).json({ success: false, message: 'خطا در ارائه راهنمایی' });
  } finally {
    client.release();
  }
});

// --- توابع کمکی ---
async function checkGameEnd(gameId, gameCode) {
  // پیاده‌سازی منطق پایان بازی
}

// --- WebSocket Connection ---
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  
  socket.on('joinGame', (gameCode) => {
    socket.join(gameCode);
    console.log(`User ${socket.id} joined game ${gameCode}`);
  });
  
  socket.on('leaveGame', (gameCode) => {
    socket.leave(gameCode);
    console.log(`User ${socket.id} left game ${gameCode}`);
  });
  
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

// --- راه‌اندازی سرور ---
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Web app URL: ${WEB_APP_URL}`);
});

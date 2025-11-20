// --- تنظیمات اولیه ---
const express = require('express');
const path = require('path');
const http = require('http');
const socketIo = require('socket.io');
const { Pool } = require('pg');
const moment = require('moment-jalaali');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const WEB_APP_URL = process.env.WEB_APP_URL || `https://wordlygame.onrender.com`;
const HOST_URL = WEB_APP_URL;

// --- تنظیمات PostgreSQL ---
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// --- ایجاد جداول در صورت عدم وجود ---
async function initializeDatabase() {
  try {
    // جدول کاربران
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        telegram_id BIGINT UNIQUE NOT NULL,
        username VARCHAR(255),
        first_name VARCHAR(255),
        last_name VARCHAR(255),
        join_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        score INTEGER DEFAULT 0,
        games_played INTEGER DEFAULT 0,
        games_won INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // جدول بازی‌ها
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

    // جدول بازیکنان
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

    // جدول حدس‌ها
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

    // جدول حروف آشکار شده
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

// --- میدلورها ---
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- روت‌ها ---
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API برای ایجاد بازی جدید
app.post('/api/game/create', async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const { creatorId, word, category, difficulty } = req.body;
    
    // محاسبه تعداد حدس مجاز و زمان بازی بر اساس سطح و طول کلمه
    const wordLength = word.length;
    let maxAttempts, timeLimit;
    
    switch(difficulty) {
      case 'easy':
        maxAttempts = Math.ceil(wordLength * 1.5);
        timeLimit = 10; // دقیقه
        break;
      case 'medium':
        maxAttempts = Math.ceil(wordLength * 1.3);
        timeLimit = 8; // دقیقه
        break;
      case 'hard':
        maxAttempts = Math.ceil(wordLength * 1.1);
        timeLimit = 6; // دقیقه
        break;
      default:
        maxAttempts = Math.ceil(wordLength * 1.3);
        timeLimit = 8; // دقیقه
    }
    
    // تولید کد بازی
    const gameCode = crypto.randomBytes(3).toString('hex').toUpperCase();
    
    // ایجاد بازی جدید
    const gameResult = await client.query(
      `INSERT INTO games (game_code, creator_id, word, category, difficulty, max_attempts, time_limit) 
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [gameCode, creatorId, word.toLowerCase(), category, difficulty, maxAttempts, timeLimit]
    );
    
    const gameId = gameResult.rows[0].id;
    
    // اضافه کردن سازنده به لیست بازیکنان
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

// API برای پیوستن به بازی
app.post('/api/game/join', async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const { gameCode, playerId, username } = req.body;
    
    // پیدا کردن بازی
    const gameResult = await client.query(
      `SELECT id, game_state FROM games WHERE game_code = $1 AND game_state = 'waiting'`,
      [gameCode]
    );
    
    if (gameResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'بازی یافت نشد یا قبلا شروع شده است'
      });
    }
    
    const gameId = gameResult.rows[0].id;
    
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
    
    await client.query('COMMIT');
    
    res.json({
      success: true,
      message: 'با موفقیت به بازی پیوستید'
    });
    
    // اطلاع‌رسانی به سایر بازیکنان
    const playersResult = await client.query(
      `SELECT telegram_id, username FROM game_players WHERE game_id = $1 AND is_active = true`,
      [gameId]
    );
    
    io.to(gameCode).emit('playerJoined', {
      playerId,
      username,
      players: playersResult.rows
    });
    
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

// API برای دریافت اطلاعات بازی
app.get('/api/game/:gameCode', async (req, res) => {
  try {
    const { gameCode } = req.params;
    
    // دریافت اطلاعات اصلی بازی
    const gameResult = await pool.query(
      `SELECT * FROM games WHERE game_code = $1`,
      [gameCode]
    );
    
    if (gameResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'بازی یافت نشد'
      });
    }
    
    const game = gameResult.rows[0];
    
    // دریافت لیست بازیکنان
    const playersResult = await pool.query(
      `SELECT telegram_id, username, joined_at, is_active 
       FROM game_players WHERE game_id = $1`,
      [game.id]
    );
    
    // دریافت تاریخچه حدس‌ها
    const guessesResult = await pool.query(
      `SELECT player_id, letter, position, is_correct, timestamp 
       FROM game_guesses WHERE game_id = $1 ORDER BY timestamp`,
      [game.id]
    );
    
    // دریافت حروف آشکار شده
    const revealedResult = await pool.query(
      `SELECT position FROM revealed_letters WHERE game_id = $1`,
      [game.id]
    );
    
    game.players = playersResult.rows;
    game.guesses = guessesResult.rows;
    game.revealedLetters = revealedResult.rows.map(r => r.position);
    
    res.json({
      success: true,
      game
    });
  } catch (error) {
    console.error('Error fetching game:', error);
    res.status(500).json({
      success: false,
      message: 'خطا در دریافت اطلاعات بازی'
    });
  }
});

// API برای ثبت حدس
app.post('/api/game/guess', async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const { gameCode, playerId, letter } = req.body;
    
    // پیدا کردن بازی فعال
    const gameResult = await client.query(
      `SELECT id, word, max_attempts FROM games 
       WHERE game_code = $1 AND game_state = 'active'`,
      [gameCode]
    );
    
    if (gameResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'بازی فعال یافت نشد'
      });
    }
    
    const game = gameResult.rows[0];
    
    // بررسی آیا کاربر در بازی است
    const playerResult = await client.query(
      `SELECT id FROM game_players 
       WHERE game_id = $1 AND telegram_id = $2 AND is_active = true`,
      [game.id, playerId]
    );
    
    if (playerResult.rows.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'شما در این بازی شرکت ندارید'
      });
    }
    
    // بررسی تعداد حدس‌های قبلی این کاربر
    const guessesResult = await client.query(
      `SELECT COUNT(*) as count FROM game_guesses 
       WHERE game_id = $1 AND player_id = $2`,
      [game.id, playerId]
    );
    
    const guessCount = parseInt(guessesResult.rows[0].count);
    
    if (guessCount >= game.max_attempts) {
      return res.status(400).json({
        success: false,
        message: 'تعداد حدس‌های مجاز شما به پایان رسیده است'
      });
    }
    
    // بررسی وضعیت حرف
    const word = game.word;
    const positions = [];
    let isCorrect = false;
    
    for (let i = 0; i < word.length; i++) {
      if (word[i] === letter.toLowerCase()) {
        positions.push(i);
        isCorrect = true;
      }
    }
    
    // ثبت حدس
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
    
    // اطلاع‌رسانی به سایر بازیکنان
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
    
    // بررسی پایان بازی
    await checkGameEnd(game.id, gameCode);
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error processing guess:', error);
    res.status(500).json({
      success: false,
      message: 'خطا در پردازش حدس'
    });
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
    
    // پیدا کردن بازی فعال
    const gameResult = await client.query(
      `SELECT id, word FROM games WHERE game_code = $1 AND game_state = 'active'`,
      [gameCode]
    );
    
    if (gameResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'بازی فعال یافت نشد'
      });
    }
    
    const game = gameResult.rows[0];
    
    // پیدا کردن حروفی که هنوز آشکار نشده‌اند
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
      return res.status(400).json({
        success: false,
        message: 'همه حروف قبلا آشکار شده‌اند'
      });
    }
    
    // انتخاب یک حرف تصادفی برای آشکارسازی
    const randomPosition = unrevealedPositions[Math.floor(Math.random() * unrevealedPositions.length)];
    const revealedLetter = word[randomPosition];
    
    // ثبت راهنمایی
    await client.query(
      `INSERT INTO revealed_letters (game_id, position) VALUES ($1, $2)`,
      [game.id, randomPosition]
    );
    
    await client.query('COMMIT');
    
    res.json({
      success: true,
      position: randomPosition,
      letter: revealedLetter
    });
    
    // اطلاع‌رسانی به سایر بازیکنان
    io.to(gameCode).emit('hintUsed', {
      playerId,
      position: randomPosition,
      letter: revealedLetter
    });
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error providing hint:', error);
    res.status(500).json({
      success: false,
      message: 'خطا در ارائه راهنمایی'
    });
  } finally {
    client.release();
  }
});

// API برای شروع بازی
app.post('/api/game/start', async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const { gameCode, playerId } = req.body;
    
    // پیدا کردن بازی
    const gameResult = await client.query(
      `SELECT id, creator_id, time_limit FROM games WHERE game_code = $1`,
      [gameCode]
    );
    
    if (gameResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'بازی یافت نشد'
      });
    }
    
    const game = gameResult.rows[0];
    
    // بررسی آیا کاربر سازنده بازی است
    if (game.creator_id !== playerId) {
      return res.status(403).json({
        success: false,
        message: 'فقط سازنده بازی می‌تواند بازی را شروع کند'
      });
    }
    
    // بررسی حداقل تعداد بازیکنان
    const playersResult = await client.query(
      `SELECT COUNT(*) as count FROM game_players WHERE game_id = $1`,
      [game.id]
    );
    
    if (parseInt(playersResult.rows[0].count) < 1) {
      return res.status(400).json({
        success: false,
        message: 'حداقل یک بازیکن برای شروع بازی لازم است'
      });
    }
    
    // شروع بازی
    const startTime = new Date();
    const endTime = new Date(startTime.getTime() + game.time_limit * 60 * 1000);
    
    await client.query(
      `UPDATE games SET game_state = 'active', start_time = $1, end_time = $2 WHERE id = $3`,
      [startTime, endTime, game.id]
    );
    
    await client.query('COMMIT');
    
    res.json({
      success: true,
      message: 'بازی شروع شد',
      endTime: endTime
    });
    
    // اطلاع‌رسانی به همه بازیکنان
    io.to(gameCode).emit('gameStarted', {
      startTime: startTime,
      endTime: endTime,
      timeLimit: game.time_limit
    });
    
    // شروع تایمر برای پایان بازی
    setTimeout(async () => {
      const currentGameResult = await pool.query(
        `SELECT game_state FROM games WHERE game_code = $1`,
        [gameCode]
      );
      
      if (currentGameResult.rows.length > 0 && currentGameResult.rows[0].game_state === 'active') {
        await endGameByTimeout(game.id, gameCode);
      }
    }, game.time_limit * 60 * 1000);
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error starting game:', error);
    res.status(500).json({
      success: false,
      message: 'خطا در شروع بازی'
    });
  } finally {
    client.release();
  }
});

// API برای دریافت بازی‌های فعال کاربر
app.get('/api/user/games/:telegramId', async (req, res) => {
  try {
    const { telegramId } = req.params;
    
    const gamesResult = await pool.query(`
      SELECT g.game_code, g.word, g.category, g.difficulty, g.game_state, g.created_at,
             COUNT(gp.telegram_id) as player_count
      FROM games g
      JOIN game_players gp ON g.id = gp.game_id
      WHERE gp.telegram_id = $1 AND g.game_state != 'finished'
      GROUP BY g.id, g.game_code, g.word, g.category, g.difficulty, g.game_state, g.created_at
      ORDER BY g.created_at DESC
    `, [telegramId]);
    
    res.json({
      success: true,
      games: gamesResult.rows
    });
  } catch (error) {
    console.error('Error fetching user games:', error);
    res.status(500).json({
      success: false,
      message: 'خطا در دریافت بازی‌های کاربر'
    });
  }
});

// --- توابع کمکی ---

// بررسی پایان بازی
async function checkGameEnd(gameId, gameCode) {
  const client = await pool.connect();
  
  try {
    // دریافت اطلاعات بازی
    const gameResult = await client.query(
      `SELECT word FROM games WHERE id = $1`,
      [gameId]
    );
    
    if (gameResult.rows.length === 0) return;
    
    const word = gameResult.rows[0].word;
    
    // دریافت لیست بازیکنان
    const playersResult = await client.query(
      `SELECT telegram_id FROM game_players WHERE game_id = $1 AND is_active = true`,
      [gameId]
    );
    
    const players = playersResult.rows;
    
    // بررسی آیا همه حروف حدس زده شده‌اند
    const correctGuessesResult = await client.query(
      `SELECT DISTINCT position FROM game_guesses 
       WHERE game_id = $1 AND is_correct = true AND position >= 0`,
      [gameId]
    );
    
    const correctPositions = correctGuessesResult.rows.map(r => r.position);
    const allLettersGuessed = word.split('').every((_, index) => correctPositions.includes(index));
    
    // اگر همه حروف حدس زده شده‌اند
    if (allLettersGuessed) {
      // پیدا کردن بازیکنی که بیشترین حروف صحیح را حدس زده است
      let bestPlayer = null;
      let maxCorrectGuesses = -1;
      
      for (const player of players) {
        const correctCountResult = await client.query(
          `SELECT COUNT(*) as count FROM game_guesses 
           WHERE game_id = $1 AND player_id = $2 AND is_correct = true`,
          [gameId, player.telegram_id]
        );
        
        const correctCount = parseInt(correctCountResult.rows[0].count);
        
        if (correctCount > maxCorrectGuesses) {
          maxCorrectGuesses = correctCount;
          bestPlayer = player.telegram_id;
        }
      }
      
      await endGameWithWinner(client, gameId, gameCode, bestPlayer);
      return;
    }
    
    // بررسی آیا همه بازیکنان تمام حدس‌هایشان را استفاده کرده‌اند
    let allPlayersExhausted = true;
    
    for (const player of players) {
      const guessesResult = await client.query(
        `SELECT COUNT(*) as count FROM game_guesses 
         WHERE game_id = $1 AND player_id = $2`,
        [gameId, player.telegram_id]
      );
      
      const maxAttemptsResult = await client.query(
        `SELECT max_attempts FROM games WHERE id = $1`,
        [gameId]
      );
      
      const guessCount = parseInt(guessesResult.rows[0].count);
      const maxAttempts = maxAttemptsResult.rows[0].max_attempts;
      
      if (guessCount < maxAttempts) {
        allPlayersExhausted = false;
        break;
      }
    }
    
    if (allPlayersExhausted) {
      await endGameWithWinner(client, gameId, gameCode, null);
    }
  } catch (error) {
    console.error('Error checking game end:', error);
  } finally {
    client.release();
  }
}

// پایان بازی با برنده
async function endGameWithWinner(client, gameId, gameCode, winnerId) {
  try {
    await client.query('BEGIN');
    
    const endTime = new Date();
    
    await client.query(
      `UPDATE games SET game_state = 'finished', winner_id = $1, end_time = $2 WHERE id = $3`,
      [winnerId, endTime, gameId]
    );
    
    // محاسبه امتیاز
    if (winnerId) {
      const score = await calculateScore(client, gameId, winnerId);
      
      // به روزرسانی امتیاز کاربر
      await client.query(`
        INSERT INTO users (telegram_id, score, games_played, games_won) 
        VALUES ($1, $2, 1, 1)
        ON CONFLICT (telegram_id) 
        DO UPDATE SET 
          score = users.score + $2,
          games_played = users.games_played + 1,
          games_won = users.games_won + 1
      `, [winnerId, score]);
      
      // برای سایر بازیکنان
      const playersResult = await client.query(
        `SELECT telegram_id FROM game_players WHERE game_id = $1 AND telegram_id != $2`,
        [gameId, winnerId]
      );
      
      for (const player of playersResult.rows) {
        await client.query(`
          INSERT INTO users (telegram_id, games_played) 
          VALUES ($1, 1)
          ON CONFLICT (telegram_id) 
          DO UPDATE SET games_played = users.games_played + 1
        `, [player.telegram_id]);
      }
      
      await client.query('COMMIT');
      
      io.to(gameCode).emit('gameFinished', {
        winnerId,
        winnerScore: score,
        endTime: endTime
      });
    } else {
      await client.query('COMMIT');
      
      io.to(gameCode).emit('gameFinished', {
        winnerId: null,
        message: 'بازی بدون برنده به پایان رسید'
      });
    }
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error ending game with winner:', error);
  }
}

// پایان بازی به دلیل اتمام زمان
async function endGameByTimeout(gameId, gameCode) {
  const client = await pool.connect();
  
  try {
    // پیدا کردن بازیکنی که بیشترین حروف صحیح را حدس زده است
    const bestPlayerResult = await client.query(`
      SELECT player_id, COUNT(*) as correct_count
      FROM game_guesses 
      WHERE game_id = $1 AND is_correct = true
      GROUP BY player_id 
      ORDER BY correct_count DESC 
      LIMIT 1
    `, [gameId]);
    
    const bestPlayer = bestPlayerResult.rows.length > 0 ? bestPlayerResult.rows[0].player_id : null;
    
    await endGameWithWinner(client, gameId, gameCode, bestPlayer);
  } catch (error) {
    console.error('Error ending game by timeout:', error);
  } finally {
    client.release();
  }
}

// محاسبه امتیاز
async function calculateScore(client, gameId, winnerId) {
  try {
    // دریافت اطلاعات بازی
    const gameResult = await client.query(
      `SELECT word, difficulty, start_time, time_limit FROM games WHERE id = $1`,
      [gameId]
    );
    
    if (gameResult.rows.length === 0) return 0;
    
    const game = gameResult.rows[0];
    const wordLength = game.word.length;
    
    // محاسبه زمان استفاده شده
    const startTime = new Date(game.start_time);
    const timeUsed = (new Date() - startTime) / 1000 / 60; // دقیقه
    const timeLimit = game.time_limit;
    
    // امتیاز پایه بر اساس طول کلمه
    let baseScore = wordLength * 10;
    
    // ضریب زمان (هرچه سریعتر تمام کند امتیاز بیشتری می‌گیرد)
    const timeFactor = Math.max(0.1, 1 - (timeUsed / timeLimit));
    
    // ضریب دشواری
    let difficultyFactor = 1;
    switch(game.difficulty) {
      case 'easy': difficultyFactor = 0.8; break;
      case 'medium': difficultyFactor = 1; break;
      case 'hard': difficultyFactor = 1.5; break;
    }
    
    // تعداد حدس‌های صحیح برنده
    const correctGuessesResult = await client.query(
      `SELECT COUNT(*) as count FROM game_guesses 
       WHERE game_id = $1 AND player_id = $2 AND is_correct = true`,
      [gameId, winnerId]
    );
    
    const correctCount = parseInt(correctGuessesResult.rows[0].count);
    const accuracy = correctCount / wordLength;
    
    // محاسبه امتیاز نهایی
    const finalScore = Math.round(baseScore * timeFactor * difficultyFactor * accuracy);
    
    return Math.max(10, finalScore); // حداقل امتیاز 10
  } catch (error) {
    console.error('Error calculating score:', error);
    return 0;
  }
}

// --- WebSocket Connection ---
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  
  // پیوستن به اتاق بازی
  socket.on('joinGame', (gameCode) => {
    socket.join(gameCode);
    console.log(`User ${socket.id} joined game ${gameCode}`);
  });
  
  // ترک اتاق بازی
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

const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const TelegramBot = require('node-telegram-bot-api');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Database connection
const pool = new Pool({
  connectionString: "postgresql://abolfazl:gecrw6BsIFRJfASXUuG3NTepMnv1Hqpx@dpg-d3qbq8d6ubrc73fqfim0-a.frankfurt-postgres.render.com/wordlygame",
  ssl: {
    rejectUnauthorized: false
  }
});

// Telegram Bot
const bot = new TelegramBot('8217028556:AAFDNQfmRYuUnto4gb2dAUNyWjKanRZldfA', { polling: true });

// Initialize Database
async function initializeDatabase() {
  try {
    // Drop all existing tables
    await pool.query(`
      DROP TABLE IF EXISTS user_scores CASCADE;
      DROP TABLE IF EXISTS multiplayer_games CASCADE;
      DROP TABLE IF EXISTS multiplayer_rooms CASCADE;
      DROP TABLE IF EXISTS challenge_games CASCADE;
      DROP TABLE IF EXISTS words CASCADE;
      DROP TABLE IF EXISTS users CASCADE;
    `);

    // Create tables
    await pool.query(`
      CREATE TABLE users (
        id SERIAL PRIMARY KEY,
        telegram_id BIGINT UNIQUE NOT NULL,
        username VARCHAR(255),
        first_name VARCHAR(255),
        last_name VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE words (
        id SERIAL PRIMARY KEY,
        word VARCHAR(255) NOT NULL,
        category VARCHAR(255) NOT NULL,
        difficulty VARCHAR(50) DEFAULT 'medium',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE challenge_games (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        word_id INTEGER REFERENCES words(id),
        guessed_letters TEXT[] DEFAULT '{}',
        correct_letters TEXT[] DEFAULT '{}',
        attempts_left INTEGER NOT NULL,
        total_attempts INTEGER NOT NULL,
        score INTEGER DEFAULT 0,
        start_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        end_time TIMESTAMP,
        completed BOOLEAN DEFAULT FALSE,
        used_hints INTEGER DEFAULT 0
      );

      CREATE TABLE multiplayer_rooms (
        id SERIAL PRIMARY KEY,
        creator_id INTEGER REFERENCES users(id),
        word_id INTEGER REFERENCES words(id),
        player2_id INTEGER REFERENCES users(id),
        status VARCHAR(50) DEFAULT 'waiting',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE multiplayer_games (
        id SERIAL PRIMARY KEY,
        room_id INTEGER REFERENCES multiplayer_rooms(id),
        player1_id INTEGER REFERENCES users(id),
        player2_id INTEGER REFERENCES users(id),
        current_player INTEGER REFERENCES users(id),
        guessed_letters TEXT[] DEFAULT '{}',
        correct_letters TEXT[] DEFAULT '{}',
        attempts_left INTEGER NOT NULL,
        player1_score INTEGER DEFAULT 0,
        player2_score INTEGER DEFAULT 0,
        status VARCHAR(50) DEFAULT 'active'
      );

      CREATE TABLE user_scores (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        game_type VARCHAR(50) NOT NULL,
        score INTEGER NOT NULL,
        game_id INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Insert sample words
    await pool.query(`
      INSERT INTO words (word, category, difficulty) VALUES
      ('برنامه', 'فناوری', 'medium'),
      ('کامپیوتر', 'فناوری', 'medium'),
      ('اینترنت', 'فناوری', 'easy'),
      ('هوش', 'فناوری', 'easy'),
      ('الگوریتم', 'فناوری', 'hard'),
      ('فوتبال', 'ورزشی', 'easy'),
      ('والیبال', 'ورزشی', 'medium'),
      ('بسکتبال', 'ورزشی', 'medium'),
      ('تنیس', 'ورزشی', 'easy'),
      ('شیرینی', 'غذا', 'easy'),
      ('کباب', 'غذا', 'easy'),
      ('پیتزا', 'غذا', 'easy'),
      ('قیمه', 'غذا', 'medium'),
      ('کتاب', 'آموزشی', 'easy'),
      ('دانشگاه', 'آموزشی', 'medium'),
      ('مدرسه', 'آموزشی', 'easy'),
      ('ریاضی', 'آموزشی', 'medium');
    `);

    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Error initializing database:', error);
  }
}

// Initialize database on server start
initializeDatabase();

// Routes

// Get user by Telegram ID
app.get('/api/user/:telegramId', async (req, res) => {
  try {
    const { telegramId } = req.params;
    const result = await pool.query(
      'SELECT * FROM users WHERE telegram_id = $1',
      [telegramId]
    );
    
    if (result.rows.length > 0) {
      res.json(result.rows[0]);
    } else {
      res.status(404).json({ error: 'User not found' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create or update user
app.post('/api/user', async (req, res) => {
  try {
    const { telegramId, username, firstName, lastName } = req.body;
    
    const result = await pool.query(
      `INSERT INTO users (telegram_id, username, first_name, last_name) 
       VALUES ($1, $2, $3, $4) 
       ON CONFLICT (telegram_id) 
       DO UPDATE SET username = $2, first_name = $3, last_name = $4 
       RETURNING *`,
      [telegramId, username, firstName, lastName]
    );
    
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get words by category
app.get('/api/words/:category', async (req, res) => {
  try {
    const { category } = req.params;
    const result = await pool.query(
      'SELECT * FROM words WHERE category = $1',
      [category]
    );
    
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all categories
app.get('/api/categories', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT DISTINCT category FROM words ORDER BY category'
    );
    
    res.json(result.rows.map(row => row.category));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start a challenge game
app.post('/api/challenge/start', async (req, res) => {
  try {
    const { userId, wordId } = req.body;
    
    // Get the word
    const wordResult = await pool.query(
      'SELECT * FROM words WHERE id = $1',
      [wordId]
    );
    
    if (wordResult.rows.length === 0) {
      return res.status(404).json({ error: 'Word not found' });
    }
    
    const word = wordResult.rows[0];
    const wordLength = word.word.length;
    const attempts = Math.ceil(wordLength * 1.5);
    
    // Create challenge game
    const gameResult = await pool.query(
      `INSERT INTO challenge_games (user_id, word_id, attempts_left, total_attempts) 
       VALUES ($1, $2, $3, $4) 
       RETURNING *`,
      [userId, wordId, attempts, attempts]
    );
    
    const game = gameResult.rows[0];
    
    res.json({
      gameId: game.id,
      wordLength: wordLength,
      attempts: attempts,
      category: word.category
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Make a guess in challenge game
app.post('/api/challenge/guess', async (req, res) => {
  try {
    const { gameId, letter, userId } = req.body;
    
    // Get game and word
    const gameResult = await pool.query(
      `SELECT cg.*, w.word 
       FROM challenge_games cg 
       JOIN words w ON cg.word_id = w.id 
       WHERE cg.id = $1 AND cg.user_id = $2 AND cg.completed = FALSE`,
      [gameId, userId]
    );
    
    if (gameResult.rows.length === 0) {
      return res.status(404).json({ error: 'Game not found' });
    }
    
    const game = gameResult.rows[0];
    const word = game.word;
    const guessedLetters = game.guessed_letters || [];
    const correctLetters = game.correct_letters || [];
    let attemptsLeft = game.attempts_left;
    
    // Check if letter was already guessed
    if (guessedLetters.includes(letter) || correctLetters.includes(letter)) {
      return res.json({
        success: false,
        message: 'این حرف قبلاً حدس زده شده است',
        attemptsLeft: attemptsLeft,
        gameCompleted: false
      });
    }
    
    // Check if letter is in the word
    const isCorrect = word.includes(letter);
    
    if (isCorrect) {
      // Add to correct letters
      correctLetters.push(letter);
      
      // Calculate score based on time and correct guesses
      const startTime = new Date(game.start_time);
      const currentTime = new Date();
      const timeDiff = Math.floor((currentTime - startTime) / 1000); // in seconds
      
      // Score calculation: more points for less time and more correct letters
      const baseScore = 1000;
      const timeBonus = Math.max(0, 500 - timeDiff);
      const correctBonus = correctLetters.length * 50;
      const score = baseScore + timeBonus + correctBonus;
      
      // Update game
      await pool.query(
        `UPDATE challenge_games 
         SET correct_letters = $1, score = $2 
         WHERE id = $3`,
        [correctLetters, score, gameId]
      );
      
      // Check if game is completed (all letters guessed)
      const allLettersGuessed = Array.from(word).every(char => 
        correctLetters.includes(char)
      );
      
      if (allLettersGuessed) {
        await pool.query(
          `UPDATE challenge_games 
           SET completed = TRUE, end_time = CURRENT_TIMESTAMP 
           WHERE id = $1`,
          [gameId]
        );
        
        // Save score to leaderboard
        await pool.query(
          `INSERT INTO user_scores (user_id, game_type, score, game_id) 
           VALUES ($1, 'challenge', $2, $3)`,
          [userId, score, gameId]
        );
      }
      
      res.json({
        success: true,
        isCorrect: true,
        correctLetters: correctLetters,
        attemptsLeft: attemptsLeft,
        score: score,
        gameCompleted: allLettersGuessed,
        message: allLettersGuessed ? 'تبریک! شما برنده شدید!' : 'حدس درست بود!'
      });
    } else {
      // Incorrect guess
      attemptsLeft--;
      guessedLetters.push(letter);
      
      await pool.query(
        `UPDATE challenge_games 
         SET guessed_letters = $1, attempts_left = $2 
         WHERE id = $3`,
        [guessedLetters, attemptsLeft, gameId]
      );
      
      // Check if game is over
      if (attemptsLeft <= 0) {
        await pool.query(
          `UPDATE challenge_games 
           SET completed = TRUE, end_time = CURRENT_TIMESTAMP 
           WHERE id = $1`,
          [gameId]
        );
        
        res.json({
          success: false,
          isCorrect: false,
          guessedLetters: guessedLetters,
          attemptsLeft: attemptsLeft,
          gameCompleted: true,
          message: 'متاسفانه بازی تمام شد!'
        });
      } else {
        res.json({
          success: false,
          isCorrect: false,
          guessedLetters: guessedLetters,
          attemptsLeft: attemptsLeft,
          gameCompleted: false,
          message: 'حدس نادرست بود'
        });
      }
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get hint in challenge game
app.post('/api/challenge/hint', async (req, res) => {
  try {
    const { gameId, position, userId } = req.body;
    
    // Get game and word
    const gameResult = await pool.query(
      `SELECT cg.*, w.word 
       FROM challenge_games cg 
       JOIN words w ON cg.word_id = w.id 
       WHERE cg.id = $1 AND cg.user_id = $2 AND cg.completed = FALSE`,
      [gameId, userId]
    );
    
    if (gameResult.rows.length === 0) {
      return res.status(404).json({ error: 'Game not found' });
    }
    
    const game = gameResult.rows[0];
    const word = game.word;
    const correctLetters = game.correct_letters || [];
    let attemptsLeft = game.attempts_left;
    let usedHints = game.used_hints;
    
    // Check if user has enough attempts for hint
    if (attemptsLeft < 2) {
      return res.status(400).json({ error: 'تعداد حدس‌های باقیمانده برای راهنمایی کافی نیست' });
    }
    
    // Check if user has used maximum hints
    if (usedHints >= 3) {
      return res.status(400).json({ error: 'شما حداکثر تعداد راهنمایی مجاز را استفاده کرده‌اید' });
    }
    
    // Validate position
    if (position < 0 || position >= word.length) {
      return res.status(400).json({ error: 'موقعیت نامعتبر است' });
    }
    
    // Get the letter at the specified position
    const hintLetter = word[position];
    
    // Check if this letter was already revealed
    if (correctLetters.includes(hintLetter)) {
      return res.status(400).json({ error: 'این حرف قبلاً حدس زده شده است' });
    }
    
    // Apply hint cost (2 attempts)
    attemptsLeft -= 2;
    usedHints += 1;
    
    // Add the hinted letter to correct letters
    correctLetters.push(hintLetter);
    
    await pool.query(
      `UPDATE challenge_games 
       SET correct_letters = $1, attempts_left = $2, used_hints = $3 
       WHERE id = $4`,
      [correctLetters, attemptsLeft, usedHints, gameId]
    );
    
    // Check if game is completed
    const allLettersGuessed = Array.from(word).every(char => 
      correctLetters.includes(char)
    );
    
    if (allLettersGuessed) {
      await pool.query(
        `UPDATE challenge_games 
         SET completed = TRUE, end_time = CURRENT_TIMESTAMP 
         WHERE id = $1`,
        [gameId]
      );
      
      // Calculate final score
      const startTime = new Date(game.start_time);
      const currentTime = new Date();
      const timeDiff = Math.floor((currentTime - startTime) / 1000);
      const baseScore = 1000;
      const timeBonus = Math.max(0, 500 - timeDiff);
      const correctBonus = correctLetters.length * 50;
      const hintPenalty = usedHints * 100; // Penalty for using hints
      const score = baseScore + timeBonus + correctBonus - hintPenalty;
      
      await pool.query(
        `UPDATE challenge_games SET score = $1 WHERE id = $2`,
        [score, gameId]
      );
      
      // Save score to leaderboard
      await pool.query(
        `INSERT INTO user_scores (user_id, game_type, score, game_id) 
         VALUES ($1, 'challenge', $2, $3)`,
        [userId, score, gameId]
      );
    }
    
    res.json({
      hintLetter: hintLetter,
      position: position,
      attemptsLeft: attemptsLeft,
      usedHints: usedHints,
      correctLetters: correctLetters,
      gameCompleted: allLettersGuessed,
      message: allLettersGuessed ? 'تبریک! شما برنده شدید!' : 'راهنمایی اعمال شد'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get leaderboard
app.get('/api/leaderboard/:type', async (req, res) => {
  try {
    const { type } = req.params;
    const limit = parseInt(req.query.limit) || 10;
    
    const result = await pool.query(
      `SELECT u.username, u.first_name, u.last_name, us.score, us.created_at
       FROM user_scores us
       JOIN users u ON us.user_id = u.id
       WHERE us.game_type = $1
       ORDER BY us.score DESC
       LIMIT $2`,
      [type, limit]
    );
    
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Multiplayer routes
app.post('/api/multiplayer/create-room', async (req, res) => {
  try {
    const { userId, wordId } = req.body;
    
    const roomResult = await pool.query(
      `INSERT INTO multiplayer_rooms (creator_id, word_id) 
       VALUES ($1, $2) 
       RETURNING *`,
      [userId, wordId]
    );
    
    res.json(roomResult.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/multiplayer/rooms', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT mr.*, u.username as creator_name, w.category 
       FROM multiplayer_rooms mr
       JOIN users u ON mr.creator_id = u.id
       JOIN words w ON mr.word_id = w.id
       WHERE mr.status = 'waiting'`
    );
    
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Telegram Bot commands
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const gameUrl = `https://wordlybot.xo.je?start=${chatId}`;
  
  bot.sendMessage(chatId, 'به بازی Wordly خوش آمدید! برای شروع بازی روی لینک زیر کلیک کنید:', {
    reply_markup: {
      inline_keyboard: [
        [{ text: 'شروع بازی', web_app: { url: gameUrl } }]
      ]
    }
  });
});


app.get('/api/challenge/game/:gameId', async (req, res) => {
  try {
    const { gameId } = req.params;
    const { userId } = req.query;
    
    const gameResult = await pool.query(
      `SELECT cg.*, w.word 
       FROM challenge_games cg 
       JOIN words w ON cg.word_id = w.id 
       WHERE cg.id = $1 AND cg.user_id = $2`,
      [gameId, userId]
    );
    
    if (gameResult.rows.length === 0) {
      return res.status(404).json({ error: 'Game not found' });
    }
    
    const game = gameResult.rows[0];
    const word = game.word;
    const correctLetters = game.correct_letters || [];
    
    // Create word display with revealed letters
    const wordDisplay = Array.from(word).map((letter, index) => {
      return {
        position: index,
        letter: correctLetters.includes(letter) ? letter : null,
        isRevealed: correctLetters.includes(letter)
      };
    });
    
    res.json({
      gameId: game.id,
      wordLength: word.length,
      wordDisplay: wordDisplay,
      correctLetters: correctLetters,
      guessedLetters: game.guessed_letters || [],
      attemptsLeft: game.attempts_left,
      score: game.score,
      completed: game.completed,
      usedHints: game.used_hints
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Also update the guess endpoint to return word positions
app.post('/api/challenge/guess', async (req, res) => {
  try {
    const { gameId, letter, userId } = req.body;
    
    // Get game and word
    const gameResult = await pool.query(
      `SELECT cg.*, w.word 
       FROM challenge_games cg 
       JOIN words w ON cg.word_id = w.id 
       WHERE cg.id = $1 AND cg.user_id = $2 AND cg.completed = FALSE`,
      [gameId, userId]
    );
    
    if (gameResult.rows.length === 0) {
      return res.status(404).json({ error: 'Game not found' });
    }
    
    const game = gameResult.rows[0];
    const word = game.word;
    const guessedLetters = game.guessed_letters || [];
    const correctLetters = game.correct_letters || [];
    let attemptsLeft = game.attempts_left;
    
    // Check if letter was already guessed
    if (guessedLetters.includes(letter) || correctLetters.includes(letter)) {
      return res.json({
        success: false,
        message: 'این حرف قبلاً حدس زده شده است',
        attemptsLeft: attemptsLeft,
        gameCompleted: false
      });
    }
    
    // Check if letter is in the word and get positions
    const positions = [];
    Array.from(word).forEach((char, index) => {
      if (char === letter) {
        positions.push(index);
      }
    });
    
    const isCorrect = positions.length > 0;
    
    if (isCorrect) {
      // Add to correct letters
      if (!correctLetters.includes(letter)) {
        correctLetters.push(letter);
      }
      
      // Calculate score based on time and correct guesses
      const startTime = new Date(game.start_time);
      const currentTime = new Date();
      const timeDiff = Math.floor((currentTime - startTime) / 1000);
      
      const baseScore = 1000;
      const timeBonus = Math.max(0, 500 - timeDiff);
      const correctBonus = correctLetters.length * 50;
      const score = baseScore + timeBonus + correctBonus;
      
      // Update game
      await pool.query(
        `UPDATE challenge_games 
         SET correct_letters = $1, score = $2 
         WHERE id = $3`,
        [correctLetters, score, gameId]
      );
      
      // Create word display with revealed letters
      const wordDisplay = Array.from(word).map((char, index) => {
        return {
          position: index,
          letter: correctLetters.includes(char) ? char : null,
          isRevealed: correctLetters.includes(char)
        };
      });
      
      // Check if game is completed
      const allLettersGuessed = Array.from(word).every(char => 
        correctLetters.includes(char)
      );
      
      if (allLettersGuessed) {
        await pool.query(
          `UPDATE challenge_games 
           SET completed = TRUE, end_time = CURRENT_TIMESTAMP 
           WHERE id = $1`,
          [gameId]
        );
        
        // Save score to leaderboard
        await pool.query(
          `INSERT INTO user_scores (user_id, game_type, score, game_id) 
           VALUES ($1, 'challenge', $2, $3)`,
          [userId, score, gameId]
        );
      }
      
      res.json({
        success: true,
        isCorrect: true,
        positions: positions,
        correctLetters: correctLetters,
        wordDisplay: wordDisplay,
        attemptsLeft: attemptsLeft,
        score: score,
        gameCompleted: allLettersGuessed,
        message: allLettersGuessed ? 'تبریک! شما برنده شدید!' : 'حدس درست بود!'
      });
    } else {
      // Incorrect guess
      attemptsLeft--;
      guessedLetters.push(letter);
      
      await pool.query(
        `UPDATE challenge_games 
         SET guessed_letters = $1, attempts_left = $2 
         WHERE id = $3`,
        [guessedLetters, attemptsLeft, gameId]
      );
      
      // Check if game is over
      if (attemptsLeft <= 0) {
        await pool.query(
          `UPDATE challenge_games 
           SET completed = TRUE, end_time = CURRENT_TIMESTAMP 
           WHERE id = $1`,
          [gameId]
        );
        
        res.json({
          success: false,
          isCorrect: false,
          guessedLetters: guessedLetters,
          attemptsLeft: attemptsLeft,
          gameCompleted: true,
          message: 'متاسفانه بازی تمام شد!'
        });
      } else {
        res.json({
          success: false,
          isCorrect: false,
          guessedLetters: guessedLetters,
          attemptsLeft: attemptsLeft,
          gameCompleted: false,
          message: 'حدس نادرست بود'
        });
      }
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

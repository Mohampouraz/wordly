const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Database connection
const pool = new Pool({
  connectionString: "postgresql://abolfazl:gecrw6BsIFRJfASXUuG3NTepMnv1Hqpx@dpg-d3qbq8d6ubrc73fqfim0-a.frankfurt-postgres.render.com/wordlygame",
  ssl: {
    rejectUnauthorized: false
  }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Initialize Database Tables
async function initializeDatabase() {
  try {
    console.log('Clearing and creating database tables...');
    
    // Drop all tables
    await pool.query(`
      DROP TABLE IF EXISTS game_moves CASCADE;
      DROP TABLE IF EXISTS challenge_games CASCADE;
      DROP TABLE IF EXISTS two_player_games CASCADE;
      DROP TABLE IF EXISTS words CASCADE;
      DROP TABLE IF EXISTS categories CASCADE;
      DROP TABLE IF EXISTS users CASCADE;
    `);

    // Create users table
    await pool.query(`
      CREATE TABLE users (
        id SERIAL PRIMARY KEY,
        telegram_id BIGINT UNIQUE NOT NULL,
        username VARCHAR(255),
        first_name VARCHAR(255),
        last_name VARCHAR(255),
        total_score INTEGER DEFAULT 0,
        games_played INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create categories table
    await pool.query(`
      CREATE TABLE categories (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        name_fa VARCHAR(255) NOT NULL,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create words table
    await pool.query(`
      CREATE TABLE words (
        id SERIAL PRIMARY KEY,
        word VARCHAR(255) NOT NULL,
        word_fa VARCHAR(255) NOT NULL,
        category_id INTEGER REFERENCES categories(id),
        difficulty INTEGER DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create challenge games table
    await pool.query(`
      CREATE TABLE challenge_games (
        id SERIAL PRIMARY KEY,
        word_id INTEGER REFERENCES words(id),
        creator_id INTEGER REFERENCES users(id),
        guesser_id INTEGER REFERENCES users(id),
        current_state VARCHAR(255) NOT NULL,
        guessed_letters VARCHAR(255) DEFAULT '',
        remaining_attempts INTEGER NOT NULL,
        total_attempts INTEGER NOT NULL,
        help_used INTEGER DEFAULT 0,
        score INTEGER DEFAULT 0,
        start_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        end_time TIMESTAMP,
        status VARCHAR(50) DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create two-player games table
    await pool.query(`
      CREATE TABLE two_player_games (
        id SERIAL PRIMARY KEY,
        room_code VARCHAR(10) UNIQUE NOT NULL,
        word_id INTEGER REFERENCES words(id),
        player1_id INTEGER REFERENCES users(id),
        player2_id INTEGER REFERENCES users(id),
        creator_id INTEGER REFERENCES users(id),
        current_state VARCHAR(255) NOT NULL,
        guessed_letters VARCHAR(255) DEFAULT '',
        current_turn INTEGER REFERENCES users(id),
        remaining_attempts INTEGER NOT NULL,
        status VARCHAR(50) DEFAULT 'waiting',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create game moves table
    await pool.query(`
      CREATE TABLE game_moves (
        id SERIAL PRIMARY KEY,
        game_id INTEGER NOT NULL,
        game_type VARCHAR(20) NOT NULL,
        user_id INTEGER REFERENCES users(id),
        letter VARCHAR(1) NOT NULL,
        position INTEGER,
        is_correct BOOLEAN,
        is_help BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Insert Persian categories
    await pool.query(`
      INSERT INTO categories (name, name_fa, description) VALUES 
      ('Animals', 'حیوانات', 'نام حیوانات مختلف'),
      ('Countries', 'کشورها', 'نام کشورهای جهان'),
      ('Food', 'غذا', 'انواع غذا و خوراکی'),
      ('Sports', 'ورزش', 'ورزش‌ها و فعالیت‌های ورزشی'),
      ('Technology', 'تکنولوژی', 'اصطلاحات تکنولوژی و شرکت‌ها');
    `);

    // Insert Persian words
    await pool.query(`
      INSERT INTO words (word, word_fa, category_id, difficulty) VALUES
      -- Animals
      ('elephant', 'فیل', 1, 1),
      ('giraffe', 'زرافه', 1, 2),
      ('kangaroo', 'کانگورو', 1, 3),
      ('penguin', 'پنگوئن', 1, 1),
      ('dolphin', 'دلفین', 1, 2),
      -- Countries
      ('canada', 'کانادا', 2, 1),
      ('japan', 'ژاپن', 2, 1),
      ('brazil', 'برزیل', 2, 2),
      ('australia', 'استرالیا', 2, 3),
      ('germany', 'آلمان', 2, 2),
      -- Food
      ('pizza', 'پیتزا', 3, 1),
      ('sushi', 'سوشی', 3, 2),
      ('pasta', 'پاستا', 3, 1),
      ('burger', 'برگر', 3, 1),
      ('taco', 'تاکو', 3, 1);
    `);

    console.log('Database initialized successfully!');
  } catch (error) {
    console.error('Error initializing database:', error);
  }
}

// User authentication
app.post('/api/auth', async (req, res) => {
  try {
    const { telegram_id, username, first_name, last_name } = req.body;
    
    let user = await pool.query(
      'SELECT * FROM users WHERE telegram_id = $1',
      [telegram_id]
    );

    if (user.rows.length === 0) {
      user = await pool.query(
        `INSERT INTO users (telegram_id, username, first_name, last_name) 
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [telegram_id, username, first_name, last_name]
      );
    } else {
      user = await pool.query(
        `UPDATE users SET username = $1, first_name = $2, last_name = $3 
         WHERE telegram_id = $4 RETURNING *`,
        [username, first_name, last_name, telegram_id]
      );
    }

    res.json(user.rows[0]);
  } catch (error) {
    console.error('Auth error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

// Get categories
app.get('/api/categories', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM categories ORDER BY name_fa');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get words by category
app.get('/api/words/:categoryId', async (req, res) => {
  try {
    const { categoryId } = req.params;
    const result = await pool.query(
      'SELECT * FROM words WHERE category_id = $1 ORDER BY word_fa',
      [categoryId]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create challenge game
app.post('/api/challenge-game', async (req, res) => {
  try {
    const { word_id, creator_id, guesser_id } = req.body;
    
    const word = await pool.query('SELECT * FROM words WHERE id = $1', [word_id]);
    if (word.rows.length === 0) {
      return res.status(404).json({ error: 'Word not found' });
    }

    const wordText = word.rows[0].word;
    const wordLength = wordText.length;
    const totalAttempts = Math.floor(wordLength * 1.5);
    const currentState = '_'.repeat(wordLength);

    const game = await pool.query(
      `INSERT INTO challenge_games 
       (word_id, creator_id, guesser_id, current_state, remaining_attempts, total_attempts) 
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [word_id, creator_id, guesser_id, currentState, totalAttempts, totalAttempts]
    );

    res.json(game.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Guess letter in challenge game
app.post('/api/challenge-game/:id/guess', async (req, res) => {
  try {
    const { id } = req.params;
    const { letter, user_id } = req.body;

    const game = await pool.query(
      'SELECT cg.*, w.word FROM challenge_games cg JOIN words w ON cg.word_id = w.id WHERE cg.id = $1',
      [id]
    );

    if (game.rows.length === 0) {
      return res.status(404).json({ error: 'Game not found' });
    }

    const gameData = game.rows[0];
    const word = gameData.word.toLowerCase();
    const letterLower = letter.toLowerCase();
    let currentState = gameData.current_state;
    let isCorrect = false;
    let newState = '';

    // Check if letter is in word
    for (let i = 0; i < word.length; i++) {
      if (word[i] === letterLower && currentState[i] === '_') {
        newState += letterLower;
        isCorrect = true;
      } else {
        newState += currentState[i];
      }
    }

    // Update game state
    const updatedGame = await pool.query(
      `UPDATE challenge_games 
       SET current_state = $1, 
           remaining_attempts = remaining_attempts - $2,
           guessed_letters = guessed_letters || $3
       WHERE id = $4 RETURNING *`,
      [newState, isCorrect ? 0 : 1, letterLower, id]
    );

    // Record move
    await pool.query(
      `INSERT INTO game_moves (game_id, game_type, user_id, letter, is_correct) 
       VALUES ($1, 'challenge', $2, $3, $4)`,
      [id, user_id, letterLower, isCorrect]
    );

    // Check if game is completed
    if (newState === word) {
      const endTime = new Date();
      const startTime = new Date(gameData.start_time);
      const timeTaken = (endTime - startTime) / 1000; // in seconds
      
      // Calculate score: base score + time bonus
      const baseScore = word.length * 10;
      const timeBonus = Math.max(0, 300 - timeTaken); // 5 minutes max
      const totalScore = baseScore + Math.floor(timeBonus);
      
      await pool.query(
        `UPDATE challenge_games 
         SET status = 'completed', end_time = $1, score = $2 
         WHERE id = $3`,
        [endTime, totalScore, id]
      );

      // Update user score
      await pool.query(
        'UPDATE users SET total_score = total_score + $1, games_played = games_played + 1 WHERE id = $2',
        [totalScore, user_id]
      );
    }

    res.json({
      game: updatedGame.rows[0],
      isCorrect,
      isCompleted: newState === word
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Use help in challenge game
app.post('/api/challenge-game/:id/help', async (req, res) => {
  try {
    const { id } = req.params;
    const { position, user_id } = req.body;

    const game = await pool.query(
      'SELECT cg.*, w.word FROM challenge_games cg JOIN words w ON cg.word_id = w.id WHERE cg.id = $1',
      [id]
    );

    if (game.rows.length === 0) {
      return res.status(404).json({ error: 'Game not found' });
    }

    const gameData = game.rows[0];
    
    // Check if help is allowed
    if (gameData.help_used >= 3) {
      return res.status(400).json({ error: 'حداکثر کمک استفاده شده است' });
    }
    if (gameData.remaining_attempts < 2) {
      return res.status(400).json({ error: 'تعداد حدس‌های باقی‌مانده برای کمک کافی نیست' });
    }

    const word = gameData.word.toLowerCase();
    const positionIndex = position - 1;
    
    if (positionIndex < 0 || positionIndex >= word.length) {
      return res.status(400).json({ error: 'موقعیت نامعتبر' });
    }

    let currentState = gameData.current_state.split('');
    currentState[positionIndex] = word[positionIndex];
    const newState = currentState.join('');

    // Update game with help
    const updatedGame = await pool.query(
      `UPDATE challenge_games 
       SET current_state = $1, 
           remaining_attempts = remaining_attempts - 2,
           help_used = help_used + 1
       WHERE id = $2 RETURNING *`,
      [newState, id]
    );

    // Record help move
    await pool.query(
      `INSERT INTO game_moves (game_id, game_type, user_id, letter, position, is_help) 
       VALUES ($1, 'challenge', $2, $3, $4, true)`,
      [id, user_id, word[positionIndex], position]
    );

    res.json(updatedGame.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get rankings
app.get('/api/rankings', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT first_name, last_name, username, total_score, games_played 
       FROM users 
       WHERE total_score > 0 
       ORDER BY total_score DESC 
       LIMIT 100`
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Socket.io for real-time two-player games
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('create-room', async (data) => {
    try {
      const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
      
      const game = await pool.query(
        `INSERT INTO two_player_games 
         (room_code, creator_id, player1_id, status) 
         VALUES ($1, $2, $3, 'waiting') RETURNING *`,
        [roomCode, data.user_id, data.user_id]
      );

      socket.join(roomCode);
      socket.emit('room-created', { roomCode, game: game.rows[0] });
    } catch (error) {
      socket.emit('error', { message: 'خطا در ایجاد اتاق' });
    }
  });

  socket.on('join-room', async (data) => {
    try {
      const game = await pool.query(
        `UPDATE two_player_games 
         SET player2_id = $1, status = 'active' 
         WHERE room_code = $2 AND status = 'waiting' 
         RETURNING *`,
        [data.user_id, data.roomCode]
      );

      if (game.rows.length === 0) {
        return socket.emit('error', { message: 'اتاق پیدا نشد' });
      }

      socket.join(data.roomCode);
      socket.to(data.roomCode).emit('player-joined', { playerId: data.user_id });
      io.to(data.roomCode).emit('game-started', { game: game.rows[0] });
    } catch (error) {
      socket.emit('error', { message: 'خطا در پیوستن به اتاق' });
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

// Initialize database on startup
initializeDatabase();

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

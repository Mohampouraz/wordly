const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const crypto = require('crypto');
const app = express();

// Environment variables
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || "8217028556:AAFDNQfmRYuUnto4gb2dAUNyWjKanRZldfA";
const WEB_APP_URL = process.env.WEB_APP_URL || "https://wordlybot.xo.je";
const DATABASE_URL = process.env.DATABASE_URL || "postgresql://abolfazl:ZnczfHE6NUZWmPfYtPQjUdsuaseuFoHS@dpg-d3q9nrm3jp1c738f47pg-a.frankfurt-postgres.render.com/wordgame_lbh3";

// Database connection
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Telegram Bot Setup
const TelegramBot = require('node-telegram-bot-api');
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

// Set webhook (for production)
if (process.env.NODE_ENV === 'production') {
  bot.setWebHook(`${WEB_APP_URL}/bot${TELEGRAM_TOKEN}`);
}

// Handle /start command
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const firstName = msg.from.first_name;
  
  const webAppUrl = `${WEB_APP_URL}?startapp=${chatId}`;
  
  const keyboard = {
    inline_keyboard: [[
      {
        text: '🎮 شروع بازی',
        web_app: { url: webAppUrl }
      }
    ]]
  };

  bot.sendMessage(chatId, `سلام ${firstName}!
  
به بازی WordlyBot خوش آمدید! 🎉

در این بازی می‌توانید:
• بازی انفرادی ایجاد کنید
• با دوستان رقابت کنید  
• در لیگ شرکت کنید

برای شروع بازی روی دکمه زیر کلیک کنید:`, {
    reply_markup: keyboard
  });
});

// Handle /help command
bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;
  
  bot.sendMessage(chatId, `راهنمای بازی WordlyBot:

🔸 بازی انفرادی: کلمه را خودتان انتخاب می‌کنید
🔸 بازی دو نفره: با دوستان رقابت می‌کنید
🔸 حالت لیگ: با 10 بازیکن رقابت می‌کنید

برای شروع از دستور /start استفاده کنید.`);
});

// Handle /ranking command
bot.onText(/\/ranking/, (msg) => {
  const chatId = msg.chat.id;
  const webAppUrl = `${WEB_APP_URL}?startapp=${chatId}&view=ranking`;
  
  const keyboard = {
    inline_keyboard: [[
      {
        text: '🏆 مشاهده رتبه‌بندی',
        web_app: { url: webAppUrl }
      }
    ]]
  };

  bot.sendMessage(chatId, 'برای مشاهده رتبه‌بندی بازیکنان، روی دکمه زیر کلیک کنید:', {
    reply_markup: keyboard
  });
});

// Webhook endpoint for Telegram
app.post(`/bot${TELEGRAM_TOKEN}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// Routes
app.get('/', (req, res) => {
  const startapp = req.query.startapp;
  const view = req.query.view;
  
  if (startapp) {
    // Set user session or redirect to game with user data
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  } else {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
});

// API endpoint to get user data from Telegram
app.post('/api/telegram-user', async (req, res) => {
  const { initData } = req.body;
  
  try {
    // Verify Telegram WebApp data
    const isValid = verifyTelegramData(initData);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid Telegram data' });
    }
    
    // Parse user data from initData
    const userData = parseInitData(initData);
    
    // Save or update user in database
    const user = await saveOrUpdateUser(userData);
    
    res.json({ user });
  } catch (error) {
    console.error('Error processing Telegram user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Verify Telegram WebApp data
function verifyTelegramData(initData) {
  // Implementation of Telegram data verification
  // This is a simplified version - in production use proper validation
  return true; // For demo purposes
}

// Parse initData from Telegram
function parseInitData(initData) {
  const params = new URLSearchParams(initData);
  const userStr = params.get('user');
  
  if (userStr) {
    return JSON.parse(userStr);
  }
  
  return null;
}

// Save or update user in database
async function saveOrUpdateUser(userData) {
  const { id, first_name, last_name, username, photo_url } = userData;
  
  try {
    const result = await pool.query(
      `INSERT INTO users (id, username, full_name, avatar_url, created_at) 
       VALUES ($1, $2, $3, $4, NOW()) 
       ON CONFLICT (id) 
       DO UPDATE SET 
         username = EXCLUDED.username,
         full_name = EXCLUDED.full_name,
         avatar_url = EXCLUDED.avatar_url,
         last_seen = NOW()
       RETURNING *`,
      [id, username, `${first_name} ${last_name || ''}`.trim(), photo_url]
    );
    
    return result.rows[0];
  } catch (error) {
    console.error('Error saving user:', error);
    throw error;
  }
}

// Get all active games
app.get('/api/games', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT g.*, u.username as creator_name 
      FROM games g 
      JOIN users u ON g.creator_id = u.id 
      WHERE g.status = 'active'
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching games:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create a new game
app.post('/api/games', async (req, res) => {
  const { creatorId, word, category, mode, maxPlayers } = req.body;
  
  try {
    // Generate unique game code
    const code = Math.random().toString(36).substring(2, 6).toUpperCase();
    
    const result = await pool.query(
      `INSERT INTO games (code, word, category, mode, creator_id, max_players, status) 
       VALUES ($1, $2, $3, $4, $5, $6, 'active') 
       RETURNING *`,
      [code, word, category, mode, creatorId, maxPlayers]
    );
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error creating game:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Join a game
app.post('/api/games/:id/join', async (req, res) => {
  const gameId = req.params.id;
  const { userId } = req.body;
  
  try {
    // Check if game exists and has space
    const gameResult = await pool.query(
      'SELECT * FROM games WHERE id = $1 AND status = $2',
      [gameId, 'active']
    );
    
    if (gameResult.rows.length === 0) {
      return res.status(404).json({ error: 'Game not found' });
    }
    
    const game = gameResult.rows[0];
    
    // Check if user is already in the game
    const playerResult = await pool.query(
      'SELECT * FROM game_players WHERE game_id = $1 AND user_id = $2',
      [gameId, userId]
    );
    
    if (playerResult.rows.length > 0) {
      return res.status(400).json({ error: 'User already in game' });
    }
    
    // Check if game is full
    const playerCountResult = await pool.query(
      'SELECT COUNT(*) FROM game_players WHERE game_id = $1',
      [gameId]
    );
    
    const playerCount = parseInt(playerCountResult.rows[0].count);
    if (playerCount >= game.max_players) {
      return res.status(400).json({ error: 'Game is full' });
    }
    
    // Add player to game
    await pool.query(
      'INSERT INTO game_players (game_id, user_id) VALUES ($1, $2)',
      [gameId, userId]
    );
    
    res.json({ message: 'Joined game successfully' });
  } catch (error) {
    console.error('Error joining game:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get user ranking
app.get('/api/ranking', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT u.id, u.username, u.full_name, COALESCE(SUM(g.score), 0) as total_score
      FROM users u
      LEFT JOIN game_results g ON u.id = g.user_id
      GROUP BY u.id, u.username, u.full_name
      ORDER BY total_score DESC
      LIMIT 100
    `);
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching ranking:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get online players
app.get('/api/players/online', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT u.id, u.username, u.full_name, u.avatar_url
      FROM users u
      JOIN sessions s ON u.id = s.user_id
      WHERE s.expires_at > NOW()
    `);
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching online players:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Initialize database tables
async function initializeDatabase() {
  try {
    // Create users table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id BIGINT PRIMARY KEY,
        username VARCHAR(255),
        full_name VARCHAR(255),
        avatar_url TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        last_seen TIMESTAMP DEFAULT NOW()
      )
    `);
    
    // Create games table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS games (
        id SERIAL PRIMARY KEY,
        code VARCHAR(10) UNIQUE NOT NULL,
        word VARCHAR(255) NOT NULL,
        category VARCHAR(50) NOT NULL,
        mode VARCHAR(20) NOT NULL,
        creator_id BIGINT REFERENCES users(id),
        max_players INTEGER DEFAULT 2,
        status VARCHAR(20) DEFAULT 'active',
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    
    // Create game_players table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS game_players (
        id SERIAL PRIMARY KEY,
        game_id INTEGER REFERENCES games(id),
        user_id BIGINT REFERENCES users(id),
        joined_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(game_id, user_id)
      )
    `);
    
    // Create game_results table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS game_results (
        id SERIAL PRIMARY KEY,
        game_id INTEGER REFERENCES games(id),
        user_id BIGINT REFERENCES users(id),
        score INTEGER DEFAULT 0,
        time_taken INTEGER DEFAULT 0,
        correct_guesses INTEGER DEFAULT 0,
        total_guesses INTEGER DEFAULT 0,
        completed_at TIMESTAMP DEFAULT NOW()
      )
    `);
    
    // Create sessions table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        id SERIAL PRIMARY KEY,
        user_id BIGINT REFERENCES users(id),
        session_token VARCHAR(255) UNIQUE NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    
    console.log('Database tables initialized successfully');
  } catch (error) {
    console.error('Error initializing database:', error);
  }
}

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Web app URL: ${WEB_APP_URL}`);
  console.log(`Telegram Bot Token: ${TELEGRAM_TOKEN.substring(0, 10)}...`);
  
  // Initialize database
  await initializeDatabase();
  
  // Set webhook in production
  if (process.env.NODE_ENV === 'production') {
    try {
      await bot.setWebHook(`${WEB_APP_URL}/bot${TELEGRAM_TOKEN}`);
      console.log('Webhook set successfully');
    } catch (error) {
      console.error('Error setting webhook:', error);
    }
  }
});

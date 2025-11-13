const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const crypto = require('crypto');
const app = express();

// Environment variables
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || "8217028556:AAFDNQfmRYuUnto4gb2dAUNyWjKanRZldfA";
const WEB_APP_URL = process.env.WEB_APP_URL || "https://wordlybot.xo.je";
const DATABASE_URL = process.env.DATABASE_URL || "postgresql://abolfazl:ZnczfHE6NUZWmPfYtPQjUdsuaseuFoHS@dpg-d3q9nrm3jp1c738f47pg-a.frankfurt-postgres.render.com/wordgame_lbh3";
const NODE_ENV = process.env.NODE_ENV || 'development';

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

// Use polling in development, webhook in production
let bot;
if (NODE_ENV === 'production') {
  bot = new TelegramBot(TELEGRAM_TOKEN);
  
  const setupWebhook = async () => {
    try {
      await bot.deleteWebHook();
      console.log('Existing webhook deleted');
      
      await bot.setWebHook(`${WEB_APP_URL}/bot${TELEGRAM_TOKEN}`);
      console.log('Webhook set successfully');
    } catch (error) {
      console.error('Error setting webhook:', error.message);
      bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
      setupBotHandlers();
    }
  };
  
  setupWebhook();
} else {
  bot = new TelegramBot(TELEGRAM_TOKEN, { 
    polling: { 
      interval: 300,
      autoStart: true
    } 
  });
  console.log('Bot started in polling mode (development)');
}

// Setup bot handlers
function setupBotHandlers() {
  // Handle /start command
  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const user = msg.from;
    
    // Save user to database
    try {
      await saveOrUpdateUser({
        id: user.id,
        first_name: user.first_name,
        last_name: user.last_name || '',
        username: user.username,
        photo_url: null // Telegram doesn't provide photo_url in basic messages
      });
    } catch (error) {
      console.error('Error saving user:', error);
    }
    
    const firstName = user.first_name;
    const webAppUrl = `${WEB_APP_URL}?tg=${chatId}`;
    
    const keyboard = {
      inline_keyboard: [[
        {
          text: '🎮 شروع بازی',
          web_app: { url: webAppUrl }
        }
      ]]
    };

    bot.sendMessage(chatId, `سلام ${firstName} عزیز! 🌟
  
به بازی WordlyBot خوش آمدید! 

🎯 در این بازی می‌توانید:
• بازی انفرادی ایجاد کنید
• با دوستان رقابت کنید  
• در لیگ شرکت کنید

برای شروع بازی روی دکمه زیر کلیک کنید:`, {
      reply_markup: keyboard
    }).catch(error => {
      console.error('Error sending start message:', error.message);
    });
  });

  // Handle /help command
  bot.onText(/\/help/, (msg) => {
    const chatId = msg.chat.id;
    
    bot.sendMessage(chatId, `🎮 راهنمای بازی WordlyBot:

🔸 بازی انفرادی: کلمه را خودتان انتخاب می‌کنید
🔸 بازی دو نفره: با دوستان رقابت می‌کنید  
🔸 حالت لیگ: با 10 بازیکن رقابت می‌کنید

🏆 امتیازدهی:
• حدس صحیح: +5 امتیاز
• حدس غلط: -2 امتیاز
• راهنمایی: -5 امتیاز
• برنده شدن: +20 امتیاز

برای شروع از دستور /start استفاده کنید.`).catch(error => {
      console.error('Error sending help message:', error.message);
    });
  });

  // Handle /ranking command
  bot.onText(/\/ranking/, (msg) => {
    const chatId = msg.chat.id;
    const webAppUrl = `${WEB_APP_URL}?tg=${chatId}&view=ranking`;
    
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
    }).catch(error => {
      console.error('Error sending ranking message:', error.message);
    });
  });

  // Handle any other messages
  bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    
    if (text && !text.startsWith('/')) {
      bot.sendMessage(chatId, 'برای شروع بازی از دستور /start استفاده کنید. 😊').catch(error => {
        console.error('Error sending message:', error.message);
      });
    }
  });

  console.log('Bot handlers setup completed');
}

// Initialize bot handlers
setupBotHandlers();

// Webhook endpoint for Telegram (production only)
if (NODE_ENV === 'production') {
  app.post(`/bot${TELEGRAM_TOKEN}`, (req, res) => {
    try {
      bot.processUpdate(req.body);
      res.sendStatus(200);
    } catch (error) {
      console.error('Error processing webhook update:', error);
      res.sendStatus(200);
    }
  });
}

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API to get user data by Telegram ID
app.get('/api/user/:telegramId', async (req, res) => {
  try {
    const { telegramId } = req.params;
    
    const result = await pool.query(
      'SELECT * FROM users WHERE id = $1',
      [telegramId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({ user: result.rows[0] });
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// API endpoint to get user data from Telegram WebApp
app.post('/api/telegram-user', async (req, res) => {
  const { initData } = req.body;
  
  try {
    const userData = parseInitData(initData);
    
    if (!userData) {
      return res.status(400).json({ error: 'Invalid user data' });
    }
    
    const user = await saveOrUpdateUser(userData);
    
    res.json({ user });
  } catch (error) {
    console.error('Error processing Telegram user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Parse initData from Telegram WebApp
function parseInitData(initData) {
  try {
    const params = new URLSearchParams(initData);
    const userStr = params.get('user');
    
    if (userStr) {
      const userData = JSON.parse(userStr);
      
      // Ensure all required fields are present
      return {
        id: userData.id,
        first_name: userData.first_name || '',
        last_name: userData.last_name || '',
        username: userData.username || '',
        photo_url: userData.photo_url || null
      };
    }
    
    return null;
  } catch (error) {
    console.error('Error parsing initData:', error);
    return null;
  }
}

// Save or update user in database
async function saveOrUpdateUser(userData) {
  const { id, first_name, last_name, username, photo_url } = userData;
  const fullName = `${first_name} ${last_name}`.trim();
  
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
      [id, username, fullName, photo_url]
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
      SELECT g.*, u.full_name as creator_name 
      FROM games g 
      JOIN users u ON g.creator_id = u.id 
      WHERE g.status = 'active'
      ORDER BY g.created_at DESC
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
      [code, word, category, mode, creatorId, maxPlayers || 2]
    );
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error creating game:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    environment: NODE_ENV 
  });
});

// Initialize database tables (clean setup)
async function initializeDatabase() {
  try {
    // Create users table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id BIGINT PRIMARY KEY,
        username VARCHAR(255),
        full_name VARCHAR(255) NOT NULL,
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
    
    console.log('Database tables initialized successfully');
    
    // Clean up any test data (optional - uncomment if you want to start fresh)
    // await pool.query('DELETE FROM game_results WHERE 1=1');
    // await pool.query('DELETE FROM game_players WHERE 1=1');
    // await pool.query('DELETE FROM games WHERE 1=1');
    // console.log('Test data cleaned up');
    
  } catch (error) {
    console.error('Error initializing database:', error);
  }
}

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Web app URL: ${WEB_APP_URL}`);
  console.log(`Environment: ${NODE_ENV}`);
  
  // Initialize database
  await initializeDatabase();
  
  if (NODE_ENV === 'production') {
    console.log('Running in production mode with webhook');
  } else {
    console.log('Running in development mode with polling');
  }
});

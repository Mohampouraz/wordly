const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const app = express();

// Environment variables
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || "8217028556:AAFDNQfmRYuUnto4gb2dAUNyWjKanRZldfA";
const WEB_APP_URL = process.env.WEB_APP_URL || "https://wordlybot.xo.je";
const DATABASE_URL = process.env.DATABASE_URL || "postgresql://abolfazl:ZnczfHE6NUZWmPfYtPQjUdsuaseuFoHS@dpg-d3q9nrm3jp1c738f47pg-a.frankfurt-postgres.render.com/wordgame_lbh3";

// Database connection
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Telegram Bot Setup - ONLY POLLING
const TelegramBot = require('node-telegram-bot-api');
const bot = new TelegramBot(TELEGRAM_TOKEN, { 
  polling: {
    interval: 300,
    autoStart: true,
    params: {
      timeout: 10
    }
  }
});

console.log('🤖 Telegram Bot Started with Polling...');

// Handle /start command
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const user = msg.from;
  
  console.log(`📨 /start command from: ${user.first_name} (${user.id})`);
  
  // Save user to database
  try {
    await saveOrUpdateUser({
      id: user.id,
      first_name: user.first_name,
      last_name: user.last_name || '',
      username: user.username,
      photo_url: null
    });
    console.log(`✅ User saved: ${user.first_name}`);
  } catch (error) {
    console.error('❌ Error saving user:', error);
  }
  
  const firstName = user.first_name;
  const webAppUrl = `${WEB_APP_URL}?tg=${chatId}`;
  
  const keyboard = {
    inline_keyboard: [[
      {
        text: '🎮 شروع بازی WordlyBot',
        web_app: { url: webAppUrl }
      }
    ]]
  };

  try {
    await bot.sendMessage(chatId, `سلام ${firstName} عزیز! 🌟

به **WordlyBot** خوش آمدید! 

🎯 **امکانات بازی:**
• 🎮 بازی انفرادی
• 👥 بازی دو نفره  
• 🏆 حالت لیگ

💎 **برای شروع بازی روی دکمه زیر کلیک کنید:**`, {
      reply_markup: keyboard,
      parse_mode: 'Markdown'
    });
    console.log(`✅ Start message sent to: ${user.first_name}`);
  } catch (error) {
    console.error('❌ Error sending start message:', error.message);
  }
});

// Handle /help command
bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;
  
  bot.sendMessage(chatId, `🎮 *راهنمای WordlyBot*

🔸 *بازی انفرادی:* کلمه را خودتان انتخاب می‌کنید
🔸 *بازی دو نفره:* با دوستان رقابت می‌کنید  
🔸 *حالت لیگ:* با 10 بازیکن رقابت می‌کنید

🏆 *سیستم امتیازدهی:*
• ✅ حدس صحیح: +5 امتیاز
• ❌ حدس غلط: -2 امتیاز  
• 💡 راهنمایی: -5 امتیاز
• 🎉 برنده شدن: +20 امتیاز

برای شروع بازی از دستور /start استفاده کنید.`, {
    parse_mode: 'Markdown'
  }).catch(error => {
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
    bot.sendMessage(chatId, `برای شروع بازی از دستور /start استفاده کنید. 😊

اگر مشکلی دارید، از /help کمک بگیرید.`).catch(error => {
      console.error('Error sending message:', error.message);
    });
  }
});

// Bot error handling
bot.on('error', (error) => {
  console.error('🤖 Bot Error:', error);
});

bot.on('polling_error', (error) => {
  console.error('🤖 Polling Error:', error);
});

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
    message: 'WordlyBot Server is running!'
  });
});

// Test bot endpoint
app.get('/test-bot', async (req, res) => {
  try {
    const botInfo = await bot.getMe();
    res.json({
      bot_working: true,
      bot_username: botInfo.username,
      bot_name: `${botInfo.first_name} ${botInfo.last_name || ''}`
    });
  } catch (error) {
    res.json({
      bot_working: false,
      error: error.message
    });
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
    
    console.log('✅ Database tables initialized successfully');
  } catch (error) {
    console.error('❌ Error initializing database:', error);
  }
}

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log('🚀 WordlyBot Server Starting...');
  console.log(`📍 Port: ${PORT}`);
  console.log(`🌐 Web App URL: ${WEB_APP_URL}`);
  console.log(`🤖 Bot Token: ${TELEGRAM_TOKEN.substring(0, 10)}...`);
  console.log('📊 Initializing database...');
  
  // Initialize database
  await initializeDatabase();
  
  console.log('✅ Server is ready!');
  console.log('📨 Bot is listening for /start commands...');
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('🛑 Shutting down gracefully...');
  await pool.end();
  process.exit(0);
});

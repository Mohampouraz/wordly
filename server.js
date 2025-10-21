require('dotenv').config();
const { Telegraf } = require('telegraf');
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const { Client } = require('pg');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || "8217028556:AAFDNQfmRYuUnto4gb2dAUNyWjKanRZldfA";
const WEB_APP_URL = process.env.WEB_APP_URL || "https://wordlybot.xo.je";
const DATABASE_URL = process.env.DATABASE_URL || "postgresql://abolfazl:ZnczfHE6NUZWmPfYtPQjUdsuaseuFoHS@dpg-d3q9nrm3jp1c738f47pg-a.frankfurt-postgres.render.com/wordgame_lbh3";

console.log('🔧 Starting server...');
console.log('🌐 WEB_APP_URL:', WEB_APP_URL);

// Express app
const app = express();

// ✅ CORS کامل برای Telegram Mini App
app.use(cors({
  origin: [WEB_APP_URL, 'https://web.telegram.org', 'https://t.me'],
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS']
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// 🚀 Database با SSL
const client = new Client({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// اتصال DB
async function connectDB() {
  try {
    await client.connect();
    console.log('✅ Database connected successfully');
    
    // ایجاد جدول users
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        user_id BIGINT PRIMARY KEY,
        username VARCHAR(255),
        first_name VARCHAR(255),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ Users table ready');
  } catch (err) {
    console.error('❌ Database connection failed:', err.message);
  }
}
connectDB();

// 🧪 Test endpoints
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    dbConnected: client.readyState === 1
  });
});

app.get('/api/test-db', async (req, res) => {
  try {
    const result = await client.query('SELECT NOW()');
    res.json({ success: true, time: result.rows[0].now });
  } catch (err) {
    console.error('DB Test Error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 🎯 API اصلی - User Info (با Debug کامل)
app.post('/api/user-info', async (req, res) => {
  console.log('📡 /api/user-info called');
  console.log('📦 Request body:', req.body);
  
  try {
    const { initData } = req.body;
    
    if (!initData) {
      console.log('❌ No initData');
      return res.status(400).json({ success: false, error: 'initData missing' });
    }

    // Parse initData
    const userData = new URLSearchParams(initData);
    const userId = userData.get('user_id');
    const username = userData.get('username') || null;
    const firstName = userData.get('first_name') || null;
    
    console.log('👤 User parsed:', { userId, username, firstName });

    if (!userId) {
      return res.status(400).json({ success: false, error: 'Invalid user_id' });
    }

    // ذخیره کاربر
    const query = `
      INSERT INTO users (user_id, username, first_name, created_at, updated_at) 
      VALUES ($1, $2, $3, NOW(), NOW()) 
      ON CONFLICT (user_id) DO UPDATE SET 
        username = EXCLUDED.username, 
        first_name = EXCLUDED.first_name,
        updated_at = NOW()
      RETURNING *
    `;
    
    const result = await client.query(query, [userId, username, firstName]);
    console.log('💾 User saved:', result.rows[0]);
    
    res.json({ 
      success: true, 
      user: result.rows[0],
      message: 'User info loaded successfully!'
    });
    
  } catch (err) {
    console.error('❌ /api/user-info ERROR:', err);
    res.status(500).json({ 
      success: false, 
      error: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
});

// Socket.io
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: [WEB_APP_URL, 'https://web.telegram.org', 'https://t.me'],
    methods: ["GET", "POST"]
  }
});

io.on('connection', (socket) => {
  console.log('👤 Socket connected:', socket.id);
});

// Telegram Bot
const bot = new Telegraf(TELEGRAM_TOKEN);

bot.start((ctx) => {
  console.log('🤖 /start from:', ctx.from.id);
  ctx.reply('🎮 به Wordly Bot خوش آمدید!\n\nروی دکمه زیر کلیک کنید:', {
    reply_markup: {
      inline_keyboard: [[
        { text: '🚀 شروع بازی', web_app: { url: WEB_APP_URL } }
      ]]
    }
  });
});

bot.launch().then(() => {
  console.log('🤖 Bot started successfully');
});

// Server start
const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📊 Health: https://wordlygame.onrender.com/health`);
  console.log(`🧪 DB Test: https://wordlygame.onrender.com/api/test-db`);
});

// Graceful shutdown
process.once('SIGINT', async () => {
  console.log('🛑 Shutting down...');
  await bot.stop('SIGINT');
  await client.end();
  server.close(() => process.exit(0));
});

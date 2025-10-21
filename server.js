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

// Express app
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: WEB_APP_URL,
    methods: ["GET", "POST"]
  }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// 🚀 Database با SSL پشتیبانی (حل مشکل Render PostgreSQL)
const client = new Client({
  connectionString: DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // ✅ مهم برای Render
  }
});

// اتصال به DB با error handling
client.connect()
  .then(() => {
    console.log('✅ Database connected successfully');
  })
  .catch((err) => {
    console.error('❌ Database connection failed:', err.message);
    console.log('🔄 Trying to reconnect...');
  });

// Test DB connection endpoint
app.get('/api/test-db', async (req, res) => {
  try {
    const result = await client.query('SELECT NOW()');
    res.json({ success: true, time: result.rows[0].now });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Socket.io - Real-time communication
io.on('connection', (socket) => {
  console.log('👤 کاربر متصل شد:', socket.id);
  
  socket.on('join-room', (roomId) => {
    socket.join(roomId);
    console.log(`🔗 ${socket.id} وارد اتاق ${roomId} شد`);
  });
  
  socket.on('game-move', (data) => {
    io.to(data.roomId).emit('opponent-move', data);
  });
  
  socket.on('disconnect', () => {
    console.log('👋 کاربر قطع شد:', socket.id);
  });
});

// API Routes
app.post('/api/user-info', async (req, res) => {
  try {
    const { initData } = req.body;
    if (!initData) return res.status(400).json({ success: false, error: 'initData missing' });

    const userData = new URLSearchParams(initData);
    const userId = userData.get('user_id');
    const username = userData.get('username') || null;
    const firstName = userData.get('first_name') || null;

    // ایجاد جدول users اگر وجود نداره
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        user_id BIGINT PRIMARY KEY,
        username VARCHAR(255),
        first_name VARCHAR(255),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // ذخیره/به‌روزرسانی کاربر در DB
    const query = `
      INSERT INTO users (user_id, username, first_name, created_at, updated_at) 
      VALUES ($1, $2, $3, NOW(), NOW()) 
      ON CONFLICT (user_id) DO UPDATE SET 
        username = EXCLUDED.username, 
        first_name = EXCLUDED.first_name,
        updated_at = NOW()
    `;
    
    await client.query(query, [userId, username, firstName]);
    
    // اطلاعات کاربر رو برگردون
    const userQuery = 'SELECT * FROM users WHERE user_id = $1';
    const userResult = await client.query(userQuery, [userId]);
    
    res.json({ 
      success: true, 
      user: userResult.rows[0] 
    });
  } catch (err) {
    console.error('❌ DB Error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    dbConnected: client.readyState === 1
  });
});

// Telegram Bot
const bot = new Telegraf(TELEGRAM_TOKEN);

bot.start((ctx) => {
  ctx.reply('🎮 به Wordly Bot خوش آمدید!\n\nروی دکمه زیر کلیک کنید:', {
    reply_markup: {
      inline_keyboard: [[
        { text: '🚀 شروع بازی', web_app: { url: WEB_APP_URL } }
      ], [
        { text: 'ℹ️ راهنما', callback_data: 'help' }
      ]]
    }
  });
});

bot.command('menu', (ctx) => {
  ctx.reply('🍽 منو:', {
    reply_markup: {
      inline_keyboard: [[
        { text: '🚀 شروع بازی', web_app: { url: WEB_APP_URL } }
      ]]
    }
  });
});

bot.on('callback_query', async (ctx) => {
  const data = ctx.callbackQuery.data;
  
  if (data === 'help') {
    ctx.answerCbQuery('راهنما در راه است! 🎯');
    ctx.reply('📖 راهنمای بازی:\n\n1️⃣ روی "شروع بازی" کلیک کنید\n2️⃣ کلمات ۵ حرفی حدس بزنید\n3️⃣ از رنگ‌ها برای راهنمایی استفاده کنید');
  }
});

bot.on('text', (ctx) => {
  ctx.reply('❓ دستور نامعتبر!\nاز /start یا /menu استفاده کنید:', {
    reply_markup: {
      inline_keyboard: [[
        { text: '🚀 شروع بازی', web_app: { url: WEB_APP_URL } }
      ]]
    }
  });
});

bot.launch();

// Server listen
const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌐 WebSocket server active`);
  console.log(`🤖 Bot started successfully`);
  console.log(`📊 Health: http://localhost:${PORT}/health`);
});

// Graceful shutdown
process.once('SIGINT', async () => {
  console.log('🛑 Shutting down gracefully...');
  bot.stop('SIGINT');
  try {
    await client.end();
    console.log('✅ Database connection closed');
  } catch (err) {
    console.error('❌ Error closing DB:', err.message);
  }
  server.close(() => process.exit(0));
});

process.once('SIGTERM', async () => {
  console.log('🛑 Shutting down gracefully...');
  bot.stop('SIGTERM');
  try {
    await client.end();
    console.log('✅ Database connection closed');
  } catch (err) {
    console.error('❌ Error closing DB:', err.message);
  }
  server.close(() => process.exit(0));
});

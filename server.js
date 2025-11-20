const express = require('express');
const { Pool } = require('pg');
const { Telegraf, session } = require('telegraf');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

// --- تنظیمات اولیه ---
const PORT = process.env.PORT || 3000;
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const WEB_APP_URL = process.env.WEB_APP_URL || `https://wordlygame.onrender.com`;
const HOST_URL = WEB_APP_URL;

// تنظیمات دیتابیس PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// تنظیمات تلگرام
const bot = new Telegraf(TOKEN);

// میدلورها
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// سشن تلگرام
bot.use(session());

// دیتابیس initialization
async function initializeDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        telegram_id BIGINT UNIQUE NOT NULL,
        username VARCHAR(255),
        first_name VARCHAR(255),
        last_name VARCHAR(255),
        score INTEGER DEFAULT 0,
        games_played INTEGER DEFAULT 0,
        games_won INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE TABLE IF NOT EXISTS game_rooms (
        id SERIAL PRIMARY KEY,
        room_code VARCHAR(10) UNIQUE NOT NULL,
        player1_id BIGINT,
        player2_id BIGINT,
        player1_score INTEGER DEFAULT 0,
        player2_score INTEGER DEFAULT 0,
        current_word_index INTEGER DEFAULT 0,
        words JSONB,
        game_state VARCHAR(20) DEFAULT 'waiting',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE TABLE IF NOT EXISTS game_sessions (
        id SERIAL PRIMARY KEY,
        room_id INTEGER REFERENCES game_rooms(id),
        player_id BIGINT,
        word_index INTEGER,
        guessed_letters JSONB,
        wrong_letters JSONB,
        hints_used INTEGER DEFAULT 0,
        completed BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Database initialization error:', error);
  }
}

// راه‌اندازی دیتابیس
initializeDatabase();

// مسیر اصلی
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Web App برای تلگرام
bot.command('start', (ctx) => {
  ctx.reply('به بازی Wordly خوش آمدید!', {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🎮 شروع بازی', web_app: { url: `${WEB_APP_URL}` } }]
      ]
    }
  });
});

// هندل کردن داده‌های وب‌اپ
app.post('/webapp-data', async (req, res) => {
  try {
    const { initData } = req.body;
    // پردازش داده‌های اولیه تلگرام
    // این بخش نیاز به اعتبارسنجی دارد
    res.json({ status: 'success' });
  } catch (error) {
    console.error('Error processing webapp data:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Socket.io برای ارتباط بلادرنگ
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join-room', async (data) => {
    const { roomCode, userData } = data;
    
    try {
      // بررسی وجود اتاق
      const roomResult = await pool.query(
        'SELECT * FROM game_rooms WHERE room_code = $1',
        [roomCode]
      );
      
      if (roomResult.rows.length === 0) {
        // ایجاد اتاق جدید
        await pool.query(
          'INSERT INTO game_rooms (room_code, player1_id) VALUES ($1, $2)',
          [roomCode, userData.id]
        );
        socket.join(roomCode);
        socket.emit('room-joined', { status: 'waiting', roomCode });
      } else {
        const room = roomResult.rows[0];
        
        if (room.player2_id === null && room.player1_id !== userData.id) {
          // پیوستن به اتاق به عنوان بازیکن دوم
          await pool.query(
            'UPDATE game_rooms SET player2_id = $1, game_state = $2 WHERE room_code = $3',
            [userData.id, 'playing', roomCode]
          );
          socket.join(roomCode);
          
          // شروع بازی
          io.to(roomCode).emit('game-started', {
            player1: await getUserData(room.player1_id),
            player2: userData
          });
        } else if (room.player1_id === userData.id || room.player2_id === userData.id) {
          // بازیکن قبلاً در اتاق است
          socket.join(roomCode);
          socket.emit('room-rejoined', { roomCode });
        } else {
          // اتاق پر است
          socket.emit('room-full', { roomCode });
        }
      }
    } catch (error) {
      console.error('Error joining room:', error);
      socket.emit('error', { message: 'خطا در پیوستن به اتاق' });
    }
  });

  socket.on('guess-letter', async (data) => {
    const { roomCode, letter, userId } = data;
    
    try {
      // پردازش حدس حرف
      // این بخش نیاز به منطق بازی دارد
      io.to(roomCode).emit('letter-guessed', {
        userId,
        letter,
        isCorrect: true // این مقدار باید بر اساس منطق بازی محاسبه شود
      });
    } catch (error) {
      console.error('Error processing guess:', error);
      socket.emit('error', { message: 'خطا در پردازش حدس' });
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

// تابع کمکی برای دریافت اطلاعات کاربر
async function getUserData(userId) {
  try {
    const result = await pool.query(
      'SELECT * FROM users WHERE telegram_id = $1',
      [userId]
    );
    
    if (result.rows.length > 0) {
      return result.rows[0];
    } else {
      return null;
    }
  } catch (error) {
    console.error('Error getting user data:', error);
    return null;
  }
}

// راه‌اندازی سرور
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// راه‌اندازی بات تلگرام
bot.launch().then(() => {
  console.log('Telegram bot started');
});

const express = require('express');
const { Pool } = require('pg');
const { Telegraf, session } = require('telegraf');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

// --- تنظیمات اولیه ---
const PORT = process.env.PORT || 3000;
const TOKEN = process.env.TELEGRAM_BOT_TOKEN || 'YOUR_BOT_TOKEN';
const WEB_APP_URL = process.env.WEB_APP_URL || `http://localhost:${PORT}`;
const HOST_URL = WEB_APP_URL;

// تنظیمات دیتابیس PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://username:password@localhost:5432/wordly_game',
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

// پایگاه داده کلمات
const wordsDatabase = {
  "آسان": [
    {
      category: "میوه‌ها",
      words: ["سیب", "پرتقال", "موز", "انگور", "هلو", "گیلاس", "انار", "انجیر", "خربزه"]
    },
    {
      category: "حیوانات",
      words: ["سگ", "گربه", "موش", "مرغ", "خرگوش", "گوسفند", "گاو", "اسب", "ماهی"]
    }
  ],
  "متوسط": [
    {
      category: "شهرهای ایران",
      words: ["تهران", "مشهد", "اصفهان", "شیراز", "تبریز", "کرج", "قم", "اهواز", "کرمانشاه"]
    },
    {
      category: "کشورها",
      words: ["ایران", "ترکیه", "آلمان", "فرانسه", "ایتالیا", "ژاپن", "چین", "روسیه", "کانادا"]
    }
  ],
  "سخت": [
    {
      category: "دانشمندان",
      words: ["ابوریحان", "خیام", "زکریا", "انیشتین", "نیوتن", "داوینچی", "گالیله", "پاستور", "کپلر"]
    },
    {
      category: "عناصر شیمیایی",
      words: ["هیدروژن", "اکسیژن", "نیتروژن", "کربن", "آهن", "طلا", "نقره", "مس", "جیوه"]
    }
  ]
};

// تابع برای دریافت کلمات تصادفی
function getRandomWords(difficulty, count = 10) {
  const difficultyWords = wordsDatabase[difficulty];
  if (!difficultyWords) return [];
  
  const selectedWords = [];
  const usedCategories = new Set();
  
  while (selectedWords.length < count && usedCategories.size < difficultyWords.length) {
    const randomCategoryIndex = Math.floor(Math.random() * difficultyWords.length);
    
    if (!usedCategories.has(randomCategoryIndex)) {
      usedCategories.add(randomCategoryIndex);
      const category = difficultyWords[randomCategoryIndex];
      const randomWordIndex = Math.floor(Math.random() * category.words.length);
      
      selectedWords.push({
        word: category.words[randomWordIndex],
        category: category.category
      });
    }
  }
  
  return selectedWords;
}

// ذخیره وضعیت بازی‌های فعال
const activeGames = new Map();

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
        player1_data JSONB,
        player2_data JSONB,
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

// ذخیره کاربر در دیتابیس
app.post('/save-user', async (req, res) => {
  try {
    const { user } = req.body;
    
    await pool.query(
      `INSERT INTO users (telegram_id, username, first_name, last_name) 
       VALUES ($1, $2, $3, $4) 
       ON CONFLICT (telegram_id) 
       DO UPDATE SET username = $2, first_name = $3, last_name = $4`,
      [user.id, user.username, user.firstName, user.lastName]
    );
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error saving user:', error);
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
        const newRoom = await pool.query(
          `INSERT INTO game_rooms (room_code, player1_id, player1_data) 
           VALUES ($1, $2, $3) RETURNING *`,
          [roomCode, userData.id, userData]
        );
        
        // ذخیره در حافظه فعال
        activeGames.set(roomCode, {
          roomId: newRoom.rows[0].id,
          player1: userData,
          player2: null,
          gameState: 'waiting',
          words: [],
          currentWordIndex: 0
        });
        
        socket.join(roomCode);
        socket.emit('room-joined', { status: 'waiting', roomCode });
        
        console.log(`Room ${roomCode} created by user ${userData.id}`);
      } else {
        const room = roomResult.rows[0];
        
        if (room.player2_id === null && room.player1_id !== userData.id) {
          // پیوستن به اتاق به عنوان بازیکن دوم
          await pool.query(
            'UPDATE game_rooms SET player2_id = $1, player2_data = $2, game_state = $3 WHERE room_code = $4',
            [userData.id, userData, 'playing', roomCode]
          );
          
          // به‌روزرسانی در حافظه فعال
          const game = activeGames.get(roomCode);
          if (game) {
            game.player2 = userData;
            game.gameState = 'playing';
            
            // تولید کلمات برای بازی
            game.words = getRandomWords("متوسط", 10);
            
            // ذخیره کلمات در دیتابیس
            await pool.query(
              'UPDATE game_rooms SET words = $1 WHERE room_code = $2',
              [JSON.stringify(game.words), roomCode]
            );
          }
          
          socket.join(roomCode);
          
          // شروع بازی - ارسال رویداد به همه کاربران در اتاق
          io.to(roomCode).emit('game-started', {
            player1: room.player1_data || { id: room.player1_id, username: 'بازیکن 1' },
            player2: userData,
            words: game.words
          });
          
          console.log(`User ${userData.id} joined room ${roomCode} as player 2`);
        } else if (room.player1_id === userData.id || room.player2_id === userData.id) {
          // بازیکن قبلاً در اتاق است
          socket.join(roomCode);
          
          // اگر بازی در حال انجام است، ارسال وضعیت فعلی
          if (room.game_state === 'playing') {
            const game = activeGames.get(roomCode);
            if (game) {
              socket.emit('game-started', {
                player1: room.player1_data || { id: room.player1_id, username: 'بازیکن 1' },
                player2: room.player2_data || { id: room.player2_id, username: 'بازیکن 2' },
                words: game.words
              });
            }
          } else {
            socket.emit('room-rejoined', { roomCode });
          }
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
      const game = activeGames.get(roomCode);
      if (!game) {
        socket.emit('error', { message: 'بازی یافت نشد' });
        return;
      }
      
      const currentWord = game.words[game.currentWordIndex];
      const isCorrect = currentWord.word.includes(letter);
      
      // ارسال نتیجه به همه کاربران در اتاق
      io.to(roomCode).emit('letter-guessed', {
        userId,
        letter,
        isCorrect,
        currentWord: currentWord.word,
        currentCategory: currentWord.category
      });
      
      console.log(`User ${userId} guessed letter "${letter}" in room ${roomCode}. Correct: ${isCorrect}`);
    } catch (error) {
      console.error('Error processing guess:', error);
      socket.emit('error', { message: 'خطا در پردازش حدس' });
    }
  });

  socket.on('request-hint', async (data) => {
    const { roomCode, userId } = data;
    
    try {
      const game = activeGames.get(roomCode);
      if (!game) {
        socket.emit('error', { message: 'بازی یافت نشد' });
        return;
      }
      
      // ارسال راهنمایی به کاربر درخواست‌دهنده
      socket.emit('hint-provided', {
        hint: 'این یک راهنمایی تست است' // در حالت واقعی باید منطق پیچیده‌تری داشته باشد
      });
    } catch (error) {
      console.error('Error processing hint request:', error);
      socket.emit('error', { message: 'خطا در ارائه راهنمایی' });
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

// راه‌اندازی بات تلگرام (اگر توکن ارائه شده باشد)
if (TOKEN && TOKEN !== 'YOUR_BOT_TOKEN') {
  bot.launch().then(() => {
    console.log('Telegram bot started');
  });
} else {
  console.log('Telegram bot not started - no valid token provided');
}

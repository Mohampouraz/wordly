const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const { Telegraf } = require('telegraf');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// تنظیمات محیط
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || "8217028556:AAFDNQfmRYuUnto4gb2dAUNyWjKanRZldfA";
const WEB_APP_URL = process.env.WEB_APP_URL || "https://wordlybot.xo.je";
const DATABASE_URL = process.env.DATABASE_URL || "postgresql://abolfazl:ZnczfHE6NUZWmPfYtPQjUdsuaseuFoHS@dpg-d3q9nrm3jp1c738f47pg-a.frankfurt-postgres.render.com/wordgame_lbh3";

// اتصال به دیتابیس
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// ایجاد جدول کاربران اگر وجود ندارد
async function initializeDatabase() {
  try {
    const client = await pool.connect();
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        telegram_id BIGINT UNIQUE NOT NULL,
        full_name VARCHAR(255) NOT NULL,
        username VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE TABLE IF NOT EXISTS user_sessions (
        id SERIAL PRIMARY KEY,
        telegram_id BIGINT NOT NULL,
        session_id VARCHAR(255) UNIQUE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP NOT NULL
      );
      
      CREATE TABLE IF NOT EXISTS notifications (
        id SERIAL PRIMARY KEY,
        telegram_id BIGINT NOT NULL,
        message TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    client.release();
    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Database initialization error:', error);
  }
}

initializeDatabase();

// راه‌اندازی تلگرام بات
const bot = new Telegraf(TELEGRAM_TOKEN);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ذخیره‌سازی کاربران آنلاین
const connectedUsers = new Map();
const notificationSubscribers = new Map();

// اعتبارسنجی داده‌های دریافتی از تلگرام
function validateTelegramData(initData) {
  try {
    const botToken = TELEGRAM_TOKEN;
    
    // استخراج پارامترها
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    params.delete('hash');
    
    // مرتب‌سازی پارامترها
    const dataCheckString = Array.from(params.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');
    
    // محاسبه کلید
    const secretKey = crypto.createHmac('sha256', 'WebAppData')
      .update(botToken)
      .digest();
    
    // محاسبه هش
    const calculatedHash = crypto.createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');
    
    return calculatedHash === hash;
  } catch (error) {
    console.error('Validation error:', error);
    return false;
  }
}

// مسیر اصلی برای Mini App
app.get('/webapp', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// دریافت اطلاعات کاربر و ثبت در دیتابیس
app.post('/user-info', async (req, res) => {
  try {
    const { initData } = req.body;
    
    if (!validateTelegramData(initData)) {
      return res.status(401).json({ error: 'داده‌های تلگرام معتبر نیستند' });
    }
    
    // استخراج اطلاعات کاربر از initData
    const params = new URLSearchParams(initData);
    const userData = JSON.parse(params.get('user'));
    
    // ذخیره کاربر در دیتابیس
    const client = await pool.connect();
    await client.query(
      `INSERT INTO users (telegram_id, full_name, username, last_seen) 
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
       ON CONFLICT (telegram_id) 
       DO UPDATE SET full_name = $2, username = $3, last_seen = CURRENT_TIMESTAMP`,
      [userData.id, `${userData.first_name} ${userData.last_name || ''}`.trim(), userData.username || null]
    );
    
    // ایجاد session
    const sessionId = crypto.randomBytes(16).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
    
    await client.query(
      `INSERT INTO user_sessions (telegram_id, session_id, expires_at) 
       VALUES ($1, $2, $3)`,
      [userData.id, sessionId, expiresAt]
    );
    
    client.release();
    
    // ذخیره کاربر آنلاین
    const user = {
      id: userData.id,
      fullName: `${userData.first_name} ${userData.last_name || ''}`.trim(),
      username: userData.username,
      joinedAt: new Date().toISOString(),
      sessionId: sessionId
    };
    
    connectedUsers.set(userData.id, user);
    
    // ارسال نوتیفیکیشن به همه کاربران آنلاین
    broadcastNotification({
      type: 'user_joined',
      message: `👋 کاربر جدید: ${user.fullName} به بازی پیوست!`,
      user: user
    });
    
    // ارسال پاسخ
    res.json({
      success: true,
      user: user,
      sessionId: sessionId
    });
    
  } catch (error) {
    console.error('User info error:', error);
    res.status(500).json({ error: 'خطای سرور' });
  }
});

// ارسال نوتیفیکیشن همگانی
function broadcastNotification(notification) {
  notificationSubscribers.forEach((subscriber, telegramId) => {
    try {
      subscriber.write(`data: ${JSON.stringify(notification)}\n\n`);
    } catch (error) {
      console.error('Broadcast error:', error);
      notificationSubscribers.delete(telegramId);
    }
  });
}

// SSE برای اطلاع‌رسانی کاربران جدید
app.get('/events', async (req, res) => {
  const sessionId = req.headers['session-id'];
  
  if (!sessionId) {
    return res.status(401).json({ error: 'Session ID required' });
  }
  
  try {
    const client = await pool.connect();
    const sessionResult = await client.query(
      'SELECT telegram_id FROM user_sessions WHERE session_id = $1 AND expires_at > CURRENT_TIMESTAMP',
      [sessionId]
    );
    
    if (sessionResult.rows.length === 0) {
      client.release();
      return res.status(401).json({ error: 'Session expired or invalid' });
    }
    
    const telegramId = sessionResult.rows[0].telegram_id;
    client.release();
    
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });
    
    // ثبت کاربر برای دریافت نوتیفیکیشن
    notificationSubscribers.set(telegramId, res);
    
    // ارسال رویداد خوش‌آمدگویی
    res.write(`data: ${JSON.stringify({ 
      type: 'connected', 
      message: 'اتصال با سرور برقرار شد' 
    })}\n\n`);
    
    // ارسال کاربران آنلاین
    const onlineUsers = Array.from(connectedUsers.values());
    res.write(`data: ${JSON.stringify({ 
      type: 'online_users', 
      users: onlineUsers 
    })}\n\n`);
    
    // نگهداری اتصال
    const keepAlive = setInterval(() => {
      res.write('data: {"type":"keepalive"}\n\n');
    }, 30000);
    
    req.on('close', () => {
      clearInterval(keepAlive);
      notificationSubscribers.delete(telegramId);
    });
    
  } catch (error) {
    console.error('SSE connection error:', error);
    res.status(500).json({ error: 'خطای سرور' });
  }
});

// دریافت تعداد کاربران آنلاین
app.get('/online-users', (req, res) => {
  res.json({
    count: connectedUsers.size,
    users: Array.from(connectedUsers.values())
  });
});

// دستور start برای تلگرام بات
bot.start((ctx) => {
  const webAppUrl = `${WEB_APP_URL}/webapp`;
  ctx.reply(
    '🎮 به بازی Wordly خوش آمدید!\n\n' +
    'برای شروع بازی روی دکمه زیر کلیک کنید:',
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🚀 شروع بازی', web_app: { url: webAppUrl } }]
        ]
      }
    }
  );
});

// راه‌اندازی وب‌هوک برای بات
app.use(bot.webhookCallback('/webhook'));
bot.telegram.setWebhook(`${process.env.RENDER_EXTERNAL_URL || 'https://wordlygame.onrender.com'}/webhook`);

// مسیر برای تست
app.get('/test', (req, res) => {
  res.json({ 
    message: 'سرور فعال است!',
    onlineUsers: connectedUsers.size
  });
});

app.listen(PORT, () => {
  console.log(`سرور روی پورت ${PORT} راه‌اندازی شد`);
  console.log(`وب‌اپ: ${WEB_APP_URL}/webapp`);
});

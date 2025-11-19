// server.js - شامل Express، ربات تلگرام و اتصال به PostgreSQL
const express = require('express');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');
// **** اضافه شدن کتابخانه PostgreSQL ****
const { Pool } = require('pg'); 

const app = express();

// ****************************
// تنظیمات و کانفیگ محیطی ⚙️
// ****************************
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || "8217028556:AAFDNQfmRYuUnto4gb2dAUNyWjKanRZldfA";
// **مهم**: از آدرس واقعی دیتابیس خود استفاده کنید.
const DATABASE_URL = process.env.DATABASE_URL || "postgresql://abolfazl:uADpBikvq08jFXFWHURmINea1L5oz389@dpg-d4bn1mer433s73d1tiug-a.frankfurt-postgres.render.com/wordlygame_yqt5";
const WEB_APP_URL = process.env.WEB_APP_URL || "https://wordlygame.onrender.com";
const PORT = process.env.PORT || 3000;


// ****************************
// ۱. تنظیمات دیتابیس PostgreSQL
// ****************************

// ایجاد یک Pool برای مدیریت بهینه اتصالات به دیتابیس
const pool = new Pool({
    connectionString: DATABASE_URL,
    // در محیط‌های Production (مثل Render) به SSL نیاز است
    ssl: {
        rejectUnauthorized: false 
    }
});

// تابع برای اتصال و ایجاد جدول کاربران
async function setupDatabase() {
    try {
        const client = await pool.connect();
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id VARCHAR(255) PRIMARY KEY,
                full_name VARCHAR(255) NOT NULL,
                score INTEGER DEFAULT 1000,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);
        client.release();
        console.log('✅ PostgreSQL: Database connection successful and "users" table ensured.');
    } catch (err) {
        console.error('❌ PostgreSQL: Error setting up database:', err.message);
        // از اجرای سرور جلوگیری نمی‌کنیم، اما خطا را ثبت می‌کنیم
    }
}

// تابع برای دریافت امتیاز یا ثبت کاربر جدید (Upsert Logic)
async function getUserScoreAndUpsert(userId, fullName) {
    const defaultScore = 1000;
    try {
        const result = await pool.query('SELECT score FROM users WHERE id = $1', [userId]);

        if (result.rows.length > 0) {
            // کاربر قبلاً ثبت شده است
            return result.rows[0].score;
        } else {
            // کاربر جدید است، آن را ثبت می‌کنیم
            await pool.query(
                'INSERT INTO users (id, full_name, score) VALUES ($1, $2, $3)',
                [userId, fullName, defaultScore]
            );
            console.log(`👤 New user registered: ${fullName} (${userId})`);
            return defaultScore;
        }
    } catch (error) {
        console.error('❌ Error in getUserScoreAndUpsert:', error.message);
        // در صورت خطا، امتیاز پیش‌فرض را برمی‌گردانیم تا برنامه متوقف نشود
        return defaultScore; 
    }
}


// ****************************
// ۲. راه‌اندازی ربات تلگرام 🤖
// ****************************
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
console.log('🤖 Telegram Bot is running in polling mode...');

bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const userName = msg.from.first_name || "کاربر عزیز";

    const keyboard = {
        inline_keyboard: [
            [
                { 
                    text: "🚀 باز کردن پنل بازی", 
                    web_app: { 
                        url: WEB_APP_URL 
                    } 
                }
            ]
        ]
    };

    bot.sendMessage(
        chatId, 
        `سلام ${userName} 👋! برای دسترسی به پنل کاربری و شروع بازی کلمات، دکمه زیر را فشار دهید:`, 
        { 
            reply_markup: keyboard 
        }
    );
});


// ****************************
// ۳. راه‌اندازی سرور Express و API
// ****************************

app.use(express.static(path.join(__dirname, 'public')));

// مسیر اصلی (/)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// مسیر API واقعی برای دریافت امتیاز کاربر از دیتابیس
app.get('/api/user/score', async (req, res) => {
    const userId = req.query.userId;
    const fullName = req.query.fullName || 'Unknown User'; // نام از جاوااسکریپت WebApp فرستاده می‌شود

    if (!userId) {
        return res.status(400).json({ success: false, message: "User ID is required." });
    }
    
    // استفاده از منطق دیتابیس
    const score = await getUserScoreAndUpsert(userId, fullName);

    res.json({ 
        success: true, 
        userId: userId, 
        score: score, 
        message: 'Score retrieved from PostgreSQL.'
    });
});


// ****************************
// ۴. راه‌اندازی و گوش دادن به پورت
// ****************************
setupDatabase().then(() => {
    app.listen(PORT, () => {
        console.log(`🌐 Express Server is running on port ${PORT}`);
        console.log(`Web App URL: ${WEB_APP_URL}`);
        console.log('-----------------------------------');
    });
});

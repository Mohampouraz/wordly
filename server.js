const express = require('express');
const { Telegraf } = require('telegraf');
const { Client } = require('pg');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 10000;

// تنظیمات
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const DATABASE_URL = process.env.DATABASE_URL;
const WEB_APP_URL = process.env.WEB_APP_URL || `https://wordlygame.onrender.com`;

const bot = new Telegraf(TELEGRAM_TOKEN);
const dbClient = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// middleware
app.use(express.json());
app.use(express.static('public'));

// اتصال به دیتابیس
dbClient.connect()
    .then(() => console.log('Connected to PostgreSQL'))
    .catch(err => console.error('Database connection error:', err));

// ایجاد جدول کاربران
async function createUsersTable() {
    try {
        await dbClient.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                telegram_id BIGINT UNIQUE NOT NULL,
                full_name VARCHAR(255),
                username VARCHAR(255),
                first_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('Users table ready');
    } catch (error) {
        console.error('Error creating table:', error);
    }
}

createUsersTable();

// هندلر کامند /start
bot.command('start', async (ctx) => {
    const userId = ctx.from.id;
    const fullName = `${ctx.from.first_name || ''} ${ctx.from.last_name || ''}`.trim();
    const username = ctx.from.username;

    // ذخیره یا آپدیت کاربر در دیتابیس
    try {
        await dbClient.query(
            `INSERT INTO users (telegram_id, full_name, username, last_seen) 
             VALUES ($1, $2, $3, CURRENT_TIMESTAMP) 
             ON CONFLICT (telegram_id) 
             DO UPDATE SET last_seen = CURRENT_TIMESTAMP, full_name = $2, username = $3`,
            [userId, fullName, username]
        );
    } catch (error) {
        console.error('Error saving user:', error);
    }

    // ایجاد دکمه برای باز کردن وب اپ
    const keyboard = {
        inline_keyboard: [
            [{
                text: '🚀 باز کردن پنل کاربری',
                web_app: { url: `${WEB_APP_URL}/index.html` }
            }]
        ]
    };

    await ctx.reply('🌐 به ربات خوش آمدید! برای مشاهده پنل کاربری روی دکمه زیر کلیک کنید:', {
        reply_markup: keyboard
    });
});

// API برای دریافت اطلاعات کاربر
app.get('/api/user/:telegramId', async (req, res) => {
    try {
        const telegramId = req.params.telegramId;
        
        const result = await dbClient.query(
            'SELECT * FROM users WHERE telegram_id = $1',
            [telegramId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        const user = result.rows[0];
        res.json({
            telegram_id: user.telegram_id,
            full_name: user.full_name,
            username: user.username,
            first_seen: user.first_seen,
            last_seen: user.last_seen
        });
    } catch (error) {
        console.error('Error fetching user:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// هندلر برای سرو فایل‌های استاتیک
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});

// راه‌اندازی سرور
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

// راه‌اندازی ربات
bot.launch()
    .then(() => console.log('Bot is running'))
    .catch(err => console.error('Bot error:', err));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

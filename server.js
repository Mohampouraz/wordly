// server.js - شامل Express، ربات تلگرام، و مدیریت دیتابیس برای بازی‌ها و کلمات
const express = require('express');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');
const { Pool } = require('pg'); 
const crypto = require('crypto');

const app = express();
app.use(express.json());

// ****************************
// تنظیمات و کانفیگ محیطی ⚙️
// ****************************
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || "8217028556:AAFDNQfmRYuUnto4gb2dAUNyWjKanRZldfA";
const DATABASE_URL = process.env.DATABASE_URL || "postgresql://abolfazl:uADpBikvq08jFXFWHURmINea1L5oz389@dpg-d4bn1mer433s73d1tiug-a.frankfurt-postgres.render.com/wordlygame_yqt5";
const WEB_APP_URL = process.env.WEB_APP_URL || "https://wordlygame.onrender.com";
const PORT = process.env.PORT || 3000;


// ****************************
// ۱. تنظیمات دیتابیس PostgreSQL
// ****************************

const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

function generateGameCode() {
    return crypto.randomBytes(3).toString('hex').toUpperCase(); 
}

// تابع برای اتصال و ایجاد جداول (بدون تغییر)
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
        await client.query(`
            CREATE TABLE IF NOT EXISTS words (
                id SERIAL PRIMARY KEY,
                word VARCHAR(50) UNIQUE NOT NULL,
                category VARCHAR(50) NOT NULL,
                difficulty VARCHAR(20) NOT NULL,
                creator_id VARCHAR(255)
            );
        `);
        await client.query(`
            CREATE TABLE IF NOT EXISTS games (
                id SERIAL PRIMARY KEY,
                game_code VARCHAR(10) UNIQUE NOT NULL,
                word_id INTEGER REFERENCES words(id) NOT NULL,
                creator_id VARCHAR(255) REFERENCES users(id) NOT NULL,
                status VARCHAR(20) DEFAULT 'waiting', -- waiting, active, finished
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);
        client.release();
        console.log('✅ PostgreSQL: All database tables (Users, Words, Games) ensured.');
    } catch (err) {
        console.error('❌ PostgreSQL: Error setting up database:', err.message);
    }
}

// تابع برای دریافت امتیاز یا ثبت کاربر جدید (بدون تغییر)
async function getUserScoreAndUpsert(userId, fullName) {
    const defaultScore = 1000;
    try {
        let result = await pool.query('SELECT score FROM users WHERE id = $1', [userId]);

        if (result.rows.length > 0) {
            return result.rows[0].score;
        } else {
            await pool.query(
                'INSERT INTO users (id, full_name, score) VALUES ($1, $2, $3)',
                [userId, fullName, defaultScore]
            );
            return defaultScore;
        }
    } catch (error) {
        console.error('❌ Error in getUserScoreAndUpsert:', error.message);
        return defaultScore; 
    }
}

// ****************************
// ۲. راه‌اندازی ربات تلگرام 🤖 (بدون تغییر)
// ****************************
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
console.log('🤖 Telegram Bot is running in polling mode...');

bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const userName = msg.from.first_name || "کاربر عزیز";

    const keyboard = {
        inline_keyboard: [
            [{ text: "🚀 باز کردن پنل بازی", web_app: { url: WEB_APP_URL } }]
        ]
    };
    bot.sendMessage(
        chatId, 
        `سلام ${userName} 👋! برای دسترسی به پنل کاربری و شروع بازی کلمات، دکمه زیر را فشار دهید:`, 
        { reply_markup: keyboard }
    );
});


// ****************************
// ۳. راه‌اندازی سرور Express و API
// ****************************

app.use(express.static(path.join(__dirname, 'public')));

// مسیر API برای دریافت امتیاز کاربر (بدون تغییر)
app.get('/api/user/score', async (req, res) => {
    const userId = req.query.userId;
    const fullName = req.query.fullName || 'Unknown User';

    if (!userId) {
        return res.status(400).json({ success: false, message: "User ID is required." });
    }
    
    const score = await getUserScoreAndUpsert(userId, fullName);

    res.json({ success: true, userId: userId, score: score });
});

// مسیر API جدید برای ایجاد کلمه و بازی (بدون تغییر)
app.post('/api/game/create', async (req, res) => {
    const { word, category, difficulty, creatorId } = req.body;
    
    if (!word || !category || !difficulty || !creatorId) {
        return res.status(400).json({ success: false, message: "Missing required fields (word, category, difficulty, creatorId)." });
    }

    try {
        let wordResult = await pool.query(
            `INSERT INTO words (word, category, difficulty, creator_id) 
             VALUES ($1, $2, $3, $4) 
             ON CONFLICT (word) 
             DO UPDATE SET category = $2, difficulty = $3
             RETURNING id`, 
            [word.toLowerCase(), category, difficulty, creatorId]
        );
        const wordId = wordResult.rows[0].id;

        let gameCode;
        let codeExists = true;
        while(codeExists) {
            gameCode = generateGameCode();
            const check = await pool.query('SELECT game_code FROM games WHERE game_code = $1', [gameCode]);
            if (check.rows.length === 0) {
                codeExists = false;
            }
        }

        await pool.query(
            `INSERT INTO games (game_code, word_id, creator_id, status) 
             VALUES ($1, $2, $3, 'waiting')`,
            [gameCode, wordId, creatorId]
        );
        
        console.log(`🎮 Game created: ${gameCode} by ${creatorId}`);
        
        return res.json({ 
            success: true, 
            message: "Game created successfully.",
            gameCode: gameCode,
            word: word,
            difficulty: difficulty
        });

    } catch (error) {
        console.error('❌ Error creating game:', error.message);
        return res.status(500).json({ success: false, message: "Internal server error during game creation." });
    }
});

// مسیر API به‌روز شده برای دریافت لیست بازی‌های فعال کاربر و بازی‌های قابل پیوستن
app.get('/api/games/active', async (req, res) => {
    const userId = req.query.userId;
    if (!userId) {
        return res.status(400).json({ success: false, message: "User ID is required." });
    }

    try {
        // کوئری برای دریافت: 
        // ۱. بازی‌های ساخته شده توسط کاربر (با هر وضعیتی)
        // ۲. بازی‌های ساخته شده توسط دیگران که وضعیت 'waiting' دارند.
        const gamesResult = await pool.query(`
            SELECT 
                g.game_code, 
                g.status, 
                g.created_at,
                w.word,
                w.difficulty,
                u.full_name AS creator_name,
                -- فیلد کلیدی برای تشخیص نقش کاربر
                CASE WHEN g.creator_id = $1 THEN TRUE ELSE FALSE END AS is_creator
            FROM games g
            JOIN words w ON g.word_id = w.id
            JOIN users u ON g.creator_id = u.id
            WHERE g.creator_id = $1 OR (g.status = 'waiting' AND g.creator_id != $1)
            ORDER BY g.created_at DESC
        `, [userId]);

        return res.json({ 
            success: true, 
            games: gamesResult.rows 
        });

    } catch (error) {
        console.error('❌ Error fetching active games:', error.message);
        return res.status(500).json({ success: false, message: "Internal server error fetching active games." });
    }
});


// ****************************
// ۴. راه‌اندازی و گوش دادن به پورت
// ****************************
setupDatabase().then(() => {
    app.listen(PORT, () => {
        console.log(`🌐 Express Server is running on port ${PORT}`);
    });
});

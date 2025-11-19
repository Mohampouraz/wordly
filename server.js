// server.js - شامل Express، ربات تلگرام، و مدیریت دیتابیس برای بازی‌ها و کلمات
const express = require('express');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');
const { Pool } = require('pg'); 
const crypto = require('crypto');

const app = express();
app.use(express.json()); // برای دریافت داده‌های JSON از سمت کلاینت (Web App)

// ****************************
// تنظیمات و کانفیگ محیطی ⚙️
// ****************************
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || "8217028556:AAFDNQfmRYuUnto4gb2dAUNyWjKanRZldfA";
const DATABASE_URL = process.env.DATABASE_URL || "postgresql://abolfazl:uADpBikvq08jFXFWHURmINea1L5oz389@dpg-d4bn1mer433s73d1tiug-a.frankfurt-postgres.render.com/wordlygame_yqt5";
const WEB_APP_URL = process.env.WEB_APP_URL || "https://wordlygame.onrender.com";
const PORT = process.env.PORT || 3000;


// ****************************
// ۱. توابع کمکی منطق بازی
// ****************************

/**
 * محاسبه تعداد فرصت‌ها، زمان کل و هزینه راهنمایی بر اساس طول کلمه و سختی
 */
function calculateGameParameters(wordLength, difficulty) {
    let multiplier = 1;
    let hintCost = 1;
    let baseTime = 90; // 1.5 دقیقه زمان پایه

    if (difficulty === 'متوسط') {
        multiplier = 1.2;
        hintCost = 2;
    } else if (difficulty === 'سخت') {
        multiplier = 1.4;
        hintCost = 3;
    }
    
    // تعداد فرصت‌ها: ۱.۵ برابر طول کلمه (گرد شده به بالا)
    const attempts = Math.ceil(wordLength * 1.5);
    
    // زمان کل (بر حسب ثانیه): (زمان پایه + طول کلمه * ضریب ۱۰) * ضریب سختی
    const totalTimeSeconds = Math.round((baseTime + (wordLength * 10)) / multiplier);

    return { attempts, totalTimeSeconds, hintCost };
}

function generateGameCode() {
    return crypto.randomBytes(3).toString('hex').toUpperCase(); 
}


// ****************************
// ۲. تنظیمات دیتابیس PostgreSQL
// ****************************

const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// تابع برای اتصال و ایجاد جداول
async function setupDatabase() {
    try {
        const client = await pool.connect();
        // 1. جدول Users
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id VARCHAR(255) PRIMARY KEY,
                full_name VARCHAR(255) NOT NULL,
                score INTEGER DEFAULT 1000,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);
        // 2. جدول Words
        await client.query(`
            CREATE TABLE IF NOT EXISTS words (
                id SERIAL PRIMARY KEY,
                word VARCHAR(50) UNIQUE NOT NULL,
                category VARCHAR(50) NOT NULL,
                difficulty VARCHAR(20) NOT NULL, 
                creator_id VARCHAR(255)
            );
        `);
        // 3. جدول Games (با فیلدهای جدید برای مدیریت وضعیت بازی)
        await client.query(`
            CREATE TABLE IF NOT EXISTS games (
                id SERIAL PRIMARY KEY,
                game_code VARCHAR(10) UNIQUE NOT NULL,
                word_id INTEGER REFERENCES words(id) NOT NULL,
                creator_id VARCHAR(255) REFERENCES users(id) NOT NULL,
                player_id VARCHAR(255) REFERENCES users(id), -- کاربر بازی کننده
                status VARCHAR(20) DEFAULT 'waiting', -- waiting, active, finished, lost, won
                start_time TIMESTAMP WITH TIME ZONE, -- زمان شروع بازی
                attempts_left INTEGER, -- فرصت‌های باقی‌مانده
                guessed_letters TEXT DEFAULT '', -- حروف حدس زده شده (مثلا: "ا,ب,ت")
                hints_used INTEGER DEFAULT 0, -- تعداد راهنمایی‌ها
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);
        client.release();
        console.log('✅ PostgreSQL: All database tables (Users, Words, Games) ensured.');
    } catch (err) {
        console.error('❌ PostgreSQL: Error setting up database:', err.message);
    }
}

// ... (getUserScoreAndUpsert و bot.onText /start بدون تغییر) ...
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
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
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
// ۳. API های مدیریت بازی
// ****************************

app.use(express.static(path.join(__dirname, 'public')));

// API ایجاد بازی (بدون تغییر منطق هسته، فقط ذخیره کلمه)
app.post('/api/game/create', async (req, res) => {
    const { word, category, difficulty, creatorId } = req.body;
    
    if (!word || !category || !difficulty || !creatorId) {
        return res.status(400).json({ success: false, message: "Missing required fields." });
    }

    try {
        let wordResult = await pool.query(
            `INSERT INTO words (word, category, difficulty, creator_id) 
             VALUES ($1, $2, $3, $4) 
             ON CONFLICT (word) 
             DO UPDATE SET category = $2, difficulty = $3
             RETURNING id, word`, 
            [word.toLowerCase().replace(/\s/g, ''), category, difficulty, creatorId]
        );
        const wordId = wordResult.rows[0].id;
        const actualWord = wordResult.rows[0].word;
        
        const { attempts, totalTimeSeconds } = calculateGameParameters(actualWord.length, difficulty);
        
        let gameCode;
        let codeExists = true;
        while(codeExists) {
            gameCode = generateGameCode();
            const check = await pool.query('SELECT game_code FROM games WHERE game_code = $1', [gameCode]);
            if (check.rows.length === 0) {
                codeExists = false;
            }
        }

        // در زمان ساخت، attempts_left پر می‌شود. start_time, player_id خالی می‌مانند.
        await pool.query(
            `INSERT INTO games (game_code, word_id, creator_id, attempts_left) 
             VALUES ($1, $2, $3, $4)`,
            [gameCode, wordId, creatorId, attempts]
        );
        
        return res.json({ 
            success: true, 
            gameCode: gameCode,
            word: actualWord,
            difficulty: difficulty
        });

    } catch (error) {
        console.error('❌ Error creating game:', error.message);
        return res.status(500).json({ success: false, message: "Internal server error during game creation." });
    }
});

// API پیوستن به بازی
app.post('/api/game/join', async (req, res) => {
    const { gameCode, playerId } = req.body;

    try {
        const client = await pool.connect();
        
        const gameQuery = await client.query(`
            SELECT g.*, w.word, w.difficulty 
            FROM games g 
            JOIN words w ON g.word_id = w.id
            WHERE g.game_code = $1 AND g.status = 'waiting' AND g.creator_id != $2
        `, [gameCode, playerId]);

        if (gameQuery.rows.length === 0) {
            client.release();
            return res.status(404).json({ success: false, message: "Game not found or already started/full." });
        }

        const game = gameQuery.rows[0];
        
        // محاسبه پارامترهای زمان و تلاش‌ها بر اساس کلمه
        const { totalTimeSeconds } = calculateGameParameters(game.word.length, game.difficulty);
        
        // بروزرسانی وضعیت بازی: تعیین player_id، زمان شروع و وضعیت active
        await client.query(`
            UPDATE games 
            SET player_id = $1, status = 'active', start_time = NOW()
            WHERE game_code = $2
        `, [playerId, gameCode]);

        client.release();
        
        return res.json({ 
            success: true, 
            message: "Joined game successfully.",
            status: 'active',
            totalTimeSeconds: totalTimeSeconds
        });

    } catch (error) {
        console.error('❌ Error joining game:', error.message);
        return res.status(500).json({ success: false, message: "Internal server error during join." });
    }
});

// API مشاهده وضعیت بازی (برای سازنده و بازی‌کننده)
app.get('/api/game/status/:code', async (req, res) => {
    const gameCode = req.params.code;
    const userId = req.query.userId; // برای تأیید دسترسی و نقش

    try {
        const gameQuery = await pool.query(`
            SELECT 
                g.*, 
                w.word, 
                w.difficulty, 
                w.category,
                u_creator.full_name AS creator_name,
                u_player.full_name AS player_name
            FROM games g
            JOIN words w ON g.word_id = w.id
            JOIN users u_creator ON g.creator_id = u_creator.id
            LEFT JOIN users u_player ON g.player_id = u_player.id
            WHERE g.game_code = $1
        `, [gameCode]);

        if (gameQuery.rows.length === 0) {
            return res.status(404).json({ success: false, message: "Game not found." });
        }

        const game = gameQuery.rows[0];
        const isCreator = game.creator_id === userId;
        const isPlayer = game.player_id === userId;
        const { totalTimeSeconds, hintCost } = calculateGameParameters(game.word.length, game.difficulty);
        
        // محاسبه زمان سپری شده
        let timeElapsedSeconds = 0;
        if (game.start_time) {
            const startTime = new Date(game.start_time);
            timeElapsedSeconds = Math.floor((Date.now() - startTime.getTime()) / 1000);
        }
        
        // محاسبه زمان باقیمانده
        const timeRemainingSeconds = totalTimeSeconds - timeElapsedSeconds;

        // تعیین کلمه پنهان شده (فقط برای بازی‌کننده)
        const wordToDisplay = isCreator || game.status !== 'active' 
            ? game.word // نمایش کامل برای سازنده یا وقتی بازی شروع نشده
            : game.word.replace(/./g, '_'); // پنهان کردن برای بازیکن

        // اگر زمان تمام شده باشد، وضعیت بازی را به‌روزرسانی کنید
        if (game.status === 'active' && timeRemainingSeconds <= 0) {
             await pool.query(`UPDATE games SET status = 'lost' WHERE game_code = $1`, [gameCode]);
             game.status = 'lost';
        }

        res.json({
            success: true,
            gameData: {
                gameCode: game.game_code,
                status: game.status,
                isCreator,
                isPlayer,
                wordLength: game.word.length,
                wordToDisplay: wordToDisplay,
                difficulty: game.difficulty,
                category: game.category,
                creatorName: game.creator_name,
                playerName: game.player_name || 'منتظر بازیکن',
                attemptsLeft: game.attempts_left,
                guessedLetters: game.guessed_letters ? game.guessed_letters.split(',') : [],
                hintsUsed: game.hints_used,
                hintCost: hintCost,
                totalTimeSeconds: totalTimeSeconds,
                timeRemainingSeconds: Math.max(0, timeRemainingSeconds)
            }
        });

    } catch (error) {
        console.error('❌ Error getting game status:', error.message);
        return res.status(500).json({ success: false, message: "Internal server error." });
    }
});


// API برای دریافت لیست بازی‌های فعال و قابل پیوستن (بدون تغییر)
app.get('/api/games/active', async (req, res) => {
    const userId = req.query.userId;
    if (!userId) {
        return res.status(400).json({ success: false, message: "User ID is required." });
    }

    try {
        const gamesResult = await pool.query(`
            SELECT 
                g.game_code, 
                g.status, 
                g.created_at,
                w.difficulty,
                w.word,
                u.full_name AS creator_name,
                CASE WHEN g.creator_id = $1 THEN TRUE ELSE FALSE END AS is_creator
            FROM games g
            JOIN words w ON g.word_id = w.id
            JOIN users u ON g.creator_id = u.id
            WHERE g.creator_id = $1 OR (g.status = 'waiting' AND g.creator_id != $1)
            ORDER BY g.created_at DESC
        `, [userId]);

        return res.json({ success: true, games: gamesResult.rows });

    } catch (error) {
        console.error('❌ Error fetching active games:', error.message);
        return res.status(500).json({ success: false, message: "Internal server error fetching active games." });
    }
});

// ... (API /api/user/score بدون تغییر) ...

// ****************************
// ۴. راه‌اندازی و گوش دادن به پورت
// ****************************
setupDatabase().then(() => {
    app.listen(PORT, () => {
        console.log(`🌐 Express Server is running on port ${PORT}`);
    });
});

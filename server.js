const express = require('express');
const { Telegraf } = require('telegraf');
const { Client } = require('pg');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 10000;

// تنظیمات
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const DATABASE_URL = process.env.DATABASE_URL;
const WEB_APP_URL = process.env.WEB_APP_URL;

const bot = new Telegraf(TELEGRAM_TOKEN);
const dbClient = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// middleware
app.use(express.json());
app.use(express.static('public'));

// ذخیره بازی‌های فعال
const activeGames = new Map();

// اتصال به دیتابیس
dbClient.connect()
    .then(() => console.log('✅ Connected to PostgreSQL'))
    .catch(err => console.error('❌ Database connection error:', err));

// ایجاد جداول
async function createTables() {
    try {
        await dbClient.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                telegram_id BIGINT UNIQUE NOT NULL,
                full_name VARCHAR(255),
                username VARCHAR(255),
                first_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                is_active BOOLEAN DEFAULT true,
                game_score INTEGER DEFAULT 0,
                total_games INTEGER DEFAULT 0,
                wins INTEGER DEFAULT 0
            )
        `);

        await dbClient.query(`
            CREATE TABLE IF NOT EXISTS games (
                id SERIAL PRIMARY KEY,
                game_id VARCHAR(50) UNIQUE NOT NULL,
                creator_id BIGINT NOT NULL,
                word VARCHAR(100) NOT NULL,
                category VARCHAR(100) NOT NULL,
                max_attempts INTEGER NOT NULL,
                time_limit INTEGER NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                is_active BOOLEAN DEFAULT true,
                players_count INTEGER DEFAULT 1
            )
        `);

        await dbClient.query(`
            CREATE TABLE IF NOT EXISTS game_sessions (
                id SERIAL PRIMARY KEY,
                game_id VARCHAR(50) NOT NULL,
                player_id BIGINT NOT NULL,
                attempts INTEGER DEFAULT 0,
                score INTEGER DEFAULT 0,
                completed BOOLEAN DEFAULT false,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        console.log('✅ Database tables ready');
    } catch (error) {
        console.error('❌ Error creating tables:', error);
    }
}

createTables();

// تابع ارسال نوتیفیکیشن
async function sendNotificationToActiveUsers(message, excludeUserId = null) {
    try {
        const result = await dbClient.query(
            'SELECT telegram_id FROM users WHERE is_active = true AND telegram_id != $1',
            [excludeUserId || 0]
        );
        
        const users = result.rows;
        let successCount = 0;

        for (const user of users) {
            try {
                await bot.telegram.sendMessage(user.telegram_id, message, {
                    parse_mode: 'HTML'
                });
                successCount++;
                await new Promise(resolve => setTimeout(resolve, 100));
            } catch (error) {
                if (error.description && error.description.includes('blocked')) {
                    await dbClient.query(
                        'UPDATE users SET is_active = false WHERE telegram_id = $1',
                        [user.telegram_id]
                    );
                }
            }
        }
        
        return { success: successCount };
        
    } catch (error) {
        console.error('💥 Error sending notification:', error);
        return { success: 0 };
    }
}

// هندلر کامند /start
bot.command('start', async (ctx) => {
    const userId = ctx.from.id;
    const fullName = `${ctx.from.first_name || ''} ${ctx.from.last_name || ''}`.trim();
    const username = ctx.from.username;

    const existingUser = await dbClient.query(
        'SELECT * FROM users WHERE telegram_id = $1',
        [userId]
    );
    
    const isNewUser = existingUser.rows.length === 0;

    try {
        await dbClient.query(
            `INSERT INTO users (telegram_id, full_name, username, last_seen) 
             VALUES ($1, $2, $3, CURRENT_TIMESTAMP) 
             ON CONFLICT (telegram_id) 
             DO UPDATE SET last_seen = CURRENT_TIMESTAMP, full_name = $2, username = $3, is_active = true`,
            [userId, fullName, username]
        );
    } catch (error) {
        console.error('❌ Error saving user:', error);
    }

    if (isNewUser) {
        const userCount = await getUserCount();
        const welcomeMessage = `🎉 <b>کاربر جدید به ربات پیوست!</b>\n\n👤 <b>نام:</b> ${fullName}\n🆔 <b>آی‌دی:</b> <code>${userId}</code>\n📊 <b>تعداد کل کاربران:</b> ${userCount}`;
        
        sendNotificationToActiveUsers(welcomeMessage, userId);
    }

    const keyboard = {
        inline_keyboard: [
            [{
                text: '🚀 باز کردن پنل کاربری',
                web_app: { url: `${WEB_APP_URL}?tgid=${userId}` }
            }]
        ]
    };

    await ctx.reply(`سلام ${fullName}! 👋\n\nبرای مشاهده پنل کاربری و بازی روی دکمه زیر کلیک کنید:`, {
        reply_markup: keyboard
    });
});

// API برای ایجاد بازی جدید
app.post('/api/games/create', async (req, res) => {
    try {
        const { creator_id, word, category } = req.body;
        
        const gameId = generateGameId();
        const maxAttempts = Math.floor(word.length * 1.5);
        const timeLimit = word.length * 30; // 30 ثانیه به ازای هر حرف

        const result = await dbClient.query(
            `INSERT INTO games (game_id, creator_id, word, category, max_attempts, time_limit) 
             VALUES ($1, $2, $3, $4, $5, $6) 
             RETURNING *`,
            [gameId, creator_id, word.toUpperCase(), category, maxAttempts, timeLimit]
        );

        // ذخیره بازی در حافظه
        activeGames.set(gameId, {
            ...result.rows[0],
            players: [creator_id],
            startTime: new Date()
        });

        res.json({
            success: true,
            game_id: gameId,
            max_attempts: maxAttempts,
            time_limit: timeLimit
        });

    } catch (error) {
        console.error('❌ Error creating game:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// API برای پیوستن به بازی
app.post('/api/games/:gameId/join', async (req, res) => {
    try {
        const { gameId } = req.params;
        const { player_id } = req.body;

        const game = activeGames.get(gameId);
        if (!game) {
            return res.status(404).json({ error: 'Game not found' });
        }

        if (game.players.includes(player_id)) {
            return res.status(400).json({ error: 'Player already in game' });
        }

        game.players.push(player_id);
        game.players_count += 1;

        await dbClient.query(
            'UPDATE games SET players_count = $1 WHERE game_id = $2',
            [game.players_count, gameId]
        );

        res.json({ success: true, players_count: game.players_count });

    } catch (error) {
        console.error('❌ Error joining game:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// API برای ثبت حدس
app.post('/api/games/:gameId/guess', async (req, res) => {
    try {
        const { gameId } = req.params;
        const { player_id, guess, time_spent } = req.body;

        const game = activeGames.get(gameId);
        if (!game) {
            return res.status(404).json({ error: 'Game not found' });
        }

        const word = game.word;
        const guessUpper = guess.toUpperCase();
        
        // محاسبه نتیجه حدس
        const result = calculateGuessResult(word, guessUpper);
        
        // محاسبه امتیاز
        const score = calculateScore(result, time_spent, word.length);

        // ذخیره در دیتابیس
        await dbClient.query(
            `INSERT INTO game_sessions (game_id, player_id, attempts, score, completed) 
             VALUES ($1, $2, 1, $3, $4)`,
            [gameId, player_id, score, result.correct]
        );

        // به‌روزرسانی آمار کاربر
        await dbClient.query(
            `UPDATE users SET 
                total_games = total_games + 1,
                wins = wins + $1,
                game_score = game_score + $2
             WHERE telegram_id = $3`,
            [result.correct ? 1 : 0, score, player_id]
        );

        res.json({
            success: true,
            result: result,
            score: score,
            game_completed: result.correct
        });

    } catch (error) {
        console.error('❌ Error processing guess:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
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
            last_seen: user.last_seen,
            game_score: user.game_score,
            total_games: user.total_games,
            wins: user.wins,
            is_active: user.is_active
        });
    } catch (error) {
        console.error('❌ Error fetching user:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// API برای دریافت آمار
app.get('/api/stats', async (req, res) => {
    try {
        const userCount = await getUserCount();
        const activeCount = await getActiveUserCount();
        
        res.json({
            total_users: parseInt(userCount),
            active_users: parseInt(activeCount)
        });
    } catch (error) {
        console.error('❌ Error getting stats:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// توابع کمکی
function generateGameId() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function calculateGuessResult(word, guess) {
    const result = {
        correct: guess === word,
        positions: [],
        correct_letters: 0,
        wrong_positions: 0
    };

    const wordLetters = word.split('');
    const guessLetters = guess.split('');
    
    // بررسی موقعیت‌های صحیح
    for (let i = 0; i < wordLetters.length; i++) {
        if (guessLetters[i] === wordLetters[i]) {
            result.positions.push('correct');
            result.correct_letters++;
        } else if (wordLetters.includes(guessLetters[i])) {
            result.positions.push('wrong-position');
            result.wrong_positions++;
        } else {
            result.positions.push('wrong');
        }
    }

    return result;
}

function calculateScore(result, timeSpent, wordLength) {
    let score = 0;
    
    if (result.correct) {
        // امتیاز پایه
        score = wordLength * 100;
        
        // پاداش سرعت (هر ثانیه سریع‌تر = 10 امتیاز بیشتر)
        const timeBonus = Math.max(0, (wordLength * 30 - timeSpent) * 10);
        score += timeBonus;
        
        // پاداش دقت (بر اساس تعداد حروف صحیح)
        const accuracyBonus = result.correct_letters * 50;
        score += accuracyBonus;
    } else {
        // جریمه حدس غلط
        score = -50;
    }
    
    return Math.max(0, score);
}

async function getUserCount() {
    const result = await dbClient.query('SELECT COUNT(*) FROM users');
    return result.rows[0].count;
}

async function getActiveUserCount() {
    const result = await dbClient.query('SELECT COUNT(*) FROM users WHERE is_active = true');
    return result.rows[0].count;
}

// هندلر برای سرو فایل‌های استاتیک
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// راه‌اندازی سرور
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🌐 Web App URL: ${WEB_APP_URL}`);
});

// راه‌اندازی ربات
bot.launch()
    .then(() => console.log('🤖 Bot is running'))
    .catch(err => console.error('❌ Bot error:', err));

process.once('SIGINT', () => {
    console.log('🛑 Shutting down gracefully...');
    bot.stop('SIGINT');
    process.exit(0);
});

const express = require('express');
const bodyParser = require('body-parser');
const { Pool } = require('pg');
const TelegramBot = require('node-telegram-bot-api');
const path = require('path');

// --- تنظیمات اولیه ---
const PORT = process.env.PORT || 3000;
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const WEB_APP_URL = process.env.WEB_APP_URL || `https://wordlygame.onrender.com`;
const HOST_URL = WEB_APP_URL;

// بررسی متغیرهای محیطی
if (!TOKEN) {
    console.error("❌ خطا: TELEGRAM_BOT_TOKEN تنظیم نشده است.");
    process.exit(1);
}

if (!process.env.DATABASE_URL) {
    console.error("❌ خطا: DATABASE_URL تنظیم نشده است.");
    process.exit(1);
}

console.log('✅ تنظیمات اولیه بارگذاری شد');

const bot = new TelegramBot(TOKEN);
const app = express();

// --- اتصال به دیتابیس ---
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// تست اتصال به دیتابیس
pool.on('connect', () => {
    console.log('✅ connected to database');
});

pool.on('error', (err) => {
    console.error('❌ database error:', err);
});

// --- Middleware ---
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// CORS middleware
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    next();
});

// --- ایجاد جداول دیتابیس ---
async function initDatabase() {
    try {
        console.log('📦 در حال ایجاد جداول دیتابیس...');
        
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                full_name TEXT NOT NULL,
                score INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS games (
                game_code TEXT PRIMARY KEY,
                creator_id TEXT NOT NULL,
                player_id TEXT,
                word TEXT NOT NULL,
                category TEXT,
                difficulty TEXT,
                attempts_left INTEGER DEFAULT 10,
                guessed_letters TEXT[] DEFAULT '{}',
                word_to_display TEXT NOT NULL,
                status TEXT DEFAULT 'waiting',
                time_limit_seconds INTEGER DEFAULT 120,
                start_time TIMESTAMP,
                end_time TIMESTAMP,
                created_at TIMESTAMP DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS game_moves (
                id SERIAL PRIMARY KEY,
                game_code TEXT REFERENCES games(game_code),
                player_id TEXT,
                guess_letter TEXT,
                is_correct BOOLEAN,
                created_at TIMESTAMP DEFAULT NOW()
            );
        `);
        
        console.log('✅ جداول دیتابیس آماده هستند');
    } catch (error) {
        console.error('❌ خطا در ایجاد جداول:', error);
        throw error;
    }
}

// --- توابع کمکی ---
function generateGameCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function createDisplayWord(word, guessedLetters = []) {
    return word.split('').map(char => {
        if (char === ' ') return ' ';
        return guessedLetters.includes(char.toLowerCase()) ? char : '_';
    }).join(' ');
}

function getInitialDisplayWord(word) {
    return word.split('').map(char => char === ' ' ? ' ' : '_').join(' ');
}

function calculateTimeRemaining(startTime, timeLimit) {
    if (!startTime) return timeLimit;
    const elapsed = Math.floor((new Date() - new Date(startTime)) / 1000);
    return Math.max(0, timeLimit - elapsed);
}

// --- API Routes ---

// دریافت اطلاعات کاربر
app.get('/api/user/score', async (req, res) => {
    try {
        const { userId, fullName } = req.query;
        
        console.log('📥 دریافت اطلاعات کاربر:', { userId, fullName });

        if (!userId) {
            return res.status(400).json({ 
                success: false, 
                message: 'شناسه کاربری الزامی است' 
            });
        }

        // ایجاد یا به‌روزرسانی کاربر
        const result = await pool.query(
            `INSERT INTO users (id, full_name, score) 
             VALUES ($1, $2, 0) 
             ON CONFLICT (id) 
             DO UPDATE SET full_name = EXCLUDED.full_name
             RETURNING id, full_name, score`,
            [userId, fullName || 'کاربر']
        );

        const user = result.rows[0];
        
        // محاسبه آمار کاربر
        const statsResult = await pool.query(`
            SELECT 
                COUNT(*) FILTER (WHERE status = 'active' AND (creator_id = $1 OR player_id = $1)) as active_games,
                COUNT(*) FILTER (WHERE status = 'won' AND player_id = $1) as won_games,
                COUNT(*) FILTER (WHERE status = 'lost' AND player_id = $1) as lost_games
            FROM games
        `, [userId]);

        res.json({
            success: true,
            score: user.score,
            fullName: user.full_name,
            stats: statsResult.rows[0]
        });
        
    } catch (error) {
        console.error('❌ خطا در /api/user/score:', error);
        res.status(500).json({ 
            success: false, 
            message: 'خطای سرور' 
        });
    }
});

// دریافت بازی‌های در انتظار
app.get('/api/games/waiting', async (req, res) => {
    try {
        const { userId } = req.query;

        console.log('📋 دریافت بازی‌های در انتظار');

        const result = await pool.query(
            `SELECT g.*, u.full_name as creator_name
             FROM games g 
             JOIN users u ON g.creator_id = u.id
             WHERE g.status = 'waiting' AND g.creator_id != $1
             ORDER BY g.created_at DESC
             LIMIT 20`,
            [userId || '']
        );

        res.json({
            success: true,
            games: result.rows.map(game => ({
                game_code: game.game_code,
                creator_name: game.creator_name,
                category: game.category,
                difficulty: game.difficulty,
                created_at: game.created_at
            }))
        });

    } catch (error) {
        console.error('❌ خطا در دریافت بازی‌های در انتظار:', error);
        res.status(500).json({
            success: false,
            message: 'خطای سرور'
        });
    }
});

// ایجاد بازی جدید
app.post('/api/game/create', async (req, res) => {
    try {
        const { word, category, difficulty, creatorId } = req.body;
        
        console.log('🎮 ایجاد بازی جدید:', { word, category, difficulty, creatorId });

        if (!word || !category || !difficulty || !creatorId) {
            return res.status(400).json({
                success: false,
                message: 'همه فیلدها را پر کنید'
            });
        }

        // ایجاد کد بازی منحصر به فرد
        let gameCode;
        let isUnique = false;
        let attempts = 0;
        
        while (!isUnique && attempts < 10) {
            gameCode = generateGameCode();
            const check = await pool.query('SELECT 1 FROM games WHERE game_code = $1', [gameCode]);
            if (check.rows.length === 0) {
                isUnique = true;
            }
            attempts++;
        }

        if (!isUnique) {
            return res.status(500).json({
                success: false,
                message: 'خطا در ایجاد کد بازی'
            });
        }

        const wordToDisplay = getInitialDisplayWord(word);
        
        // ذخیره بازی در دیتابیس
        await pool.query(
            `INSERT INTO games (game_code, creator_id, word, category, difficulty, word_to_display) 
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [gameCode, creatorId, word, category, difficulty, wordToDisplay]
        );

        console.log('✅ بازی ایجاد شد با کد:', gameCode);

        res.json({
            success: true,
            message: 'بازی ایجاد شد',
            gameCode: gameCode,
            word: word,
            difficulty: difficulty
        });

    } catch (error) {
        console.error('❌ خطا در ایجاد بازی:', error);
        res.status(500).json({
            success: false,
            message: 'خطای سرور در ایجاد بازی'
        });
    }
});

// پیوستن به بازی
app.post('/api/game/join', async (req, res) => {
    try {
        const { gameCode, playerId } = req.body;

        console.log('🔗 درخواست پیوستن به بازی:', { gameCode, playerId });

        if (!gameCode || !playerId) {
            return res.status(400).json({
                success: false,
                message: 'کد بازی و شناسه کاربری الزامی است'
            });
        }

        // پیدا کردن بازی
        const gameResult = await pool.query(
            `SELECT g.*, u.full_name as creator_name 
             FROM games g 
             JOIN users u ON g.creator_id = u.id 
             WHERE g.game_code = $1`,
            [gameCode.toUpperCase()]
        );

        if (gameResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'بازی پیدا نشد'
            });
        }

        const game = gameResult.rows[0];

        // بررسی شرایط
        if (game.creator_id === playerId) {
            return res.status(400).json({
                success: false,
                message: 'شما سازنده این بازی هستید'
            });
        }

        if (game.player_id && game.player_id !== playerId) {
            return res.status(400).json({
                success: false,
                message: 'این بازی قبلاً توسط بازیکن دیگری شروع شده است'
            });
        }

        if (game.status !== 'waiting') {
            return res.status(400).json({
                success: false,
                message: 'این بازی قابل پیوستن نیست'
            });
        }

        // به‌روزرسانی بازی
        const updateResult = await pool.query(
            `UPDATE games 
             SET player_id = $1, status = 'active', start_time = NOW() 
             WHERE game_code = $2 
             RETURNING *`,
            [playerId, gameCode.toUpperCase()]
        );

        const updatedGame = updateResult.rows[0];
        
        // دریافت نام بازیکن
        const playerResult = await pool.query('SELECT full_name FROM users WHERE id = $1', [playerId]);
        const playerName = playerResult.rows[0]?.full_name || 'بازیکن';

        res.json({
            success: true,
            message: 'به بازی پیوستید',
            gameData: {
                gameCode: updatedGame.game_code,
                creatorName: game.creator_name,
                playerName: playerName,
                category: updatedGame.category,
                difficulty: updatedGame.difficulty,
                wordToDisplay: updatedGame.word_to_display,
                attemptsLeft: updatedGame.attempts_left,
                correctGuessedLetters: updatedGame.guessed_letters.filter(l => updatedGame.word.includes(l)),
                incorrectGuessedLetters: updatedGame.guessed_letters.filter(l => !updatedGame.word.includes(l)),
                status: updatedGame.status,
                timeRemainingSeconds: calculateTimeRemaining(updatedGame.start_time, updatedGame.time_limit_seconds)
            }
        });

    } catch (error) {
        console.error('❌ خطا در پیوستن به بازی:', error);
        res.status(500).json({
            success: false,
            message: 'خطای سرور'
        });
    }
});

// حدس زدن حرف
app.post('/api/game/guess', async (req, res) => {
    try {
        const { gameCode, playerId, guess } = req.body;
        const normalizedGuess = guess.trim().toLowerCase();

        console.log('🎯 حدس زدن:', { gameCode, playerId, guess: normalizedGuess });

        if (!gameCode || !playerId || !normalizedGuess) {
            return res.status(400).json({
                success: false,
                message: 'داده‌های ناقص'
            });
        }

        // پیدا کردن بازی
        const gameResult = await pool.query(
            'SELECT * FROM games WHERE game_code = $1',
            [gameCode]
        );

        if (gameResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'بازی پیدا نشد'
            });
        }

        let game = gameResult.rows[0];

        // بررسی مجوزها
        if (game.player_id !== playerId && game.creator_id !== playerId) {
            return res.status(403).json({
                success: false,
                message: 'شما مجاز به بازی در این اتاق نیستید'
            });
        }

        if (game.status !== 'active') {
            return res.status(400).json({
                success: false,
                message: 'این بازی فعال نیست'
            });
        }

        // فقط بازیکن می‌تواند حدس بزند
        if (game.player_id !== playerId) {
            return res.status(400).json({
                success: false,
                message: 'فقط بازیکن می‌تواند حدس بزند'
            });
        }

        // بررسی زمان
        const timeRemaining = calculateTimeRemaining(game.start_time, game.time_limit_seconds);
        if (timeRemaining <= 0) {
            await pool.query(
                'UPDATE games SET status = $1, end_time = NOW() WHERE game_code = $2',
                ['lost', gameCode]
            );
            return res.status(400).json({
                success: false,
                message: 'زمان بازی به پایان رسیده است'
            });
        }

        // بررسی حدس تکراری
        if (game.guessed_letters.includes(normalizedGuess)) {
            return res.status(400).json({
                success: false,
                message: 'این حرف قبلاً حدس زده شده'
            });
        }

        // پردازش حدس
        const guessedLetters = [...game.guessed_letters, normalizedGuess];
        let attemptsLeft = game.attempts_left;
        let isCorrect = game.word.toLowerCase().includes(normalizedGuess);
        let message = isCorrect ? 'حدس درست!' : 'حدس اشتباه!';
        let newStatus = 'active';
        let scoreChange = 0;

        if (!isCorrect) {
            attemptsLeft--;
        }

        // ایجاد نمایش جدید کلمه
        const newWordToDisplay = createDisplayWord(game.word, guessedLetters);

        // بررسی پایان بازی
        if (!newWordToDisplay.includes('_')) {
            newStatus = 'won';
            scoreChange = 50;
            message = 'برنده شدید! 🎉';
        } else if (attemptsLeft <= 0) {
            newStatus = 'lost';
            scoreChange = -25;
            message = 'باختید!';
        }

        // به‌روزرسانی بازی
        const updateResult = await pool.query(
            `UPDATE games 
             SET attempts_left = $1, 
                 guessed_letters = $2, 
                 word_to_display = $3, 
                 status = $4,
                 end_time = CASE WHEN $4 != 'active' THEN NOW() ELSE end_time END
             WHERE game_code = $5 
             RETURNING *`,
            [attemptsLeft, guessedLetters, newWordToDisplay, newStatus, gameCode]
        );

        const updatedGame = updateResult.rows[0];

        // ذخیره حرکت در تاریخچه
        await pool.query(
            `INSERT INTO game_moves (game_code, player_id, guess_letter, is_correct)
             VALUES ($1, $2, $3, $4)`,
            [gameCode, playerId, normalizedGuess, isCorrect]
        );

        // به‌روزرسانی امتیاز
        if (newStatus !== 'active') {
            await pool.query(
                'UPDATE users SET score = score + $1 WHERE id = $2',
                [scoreChange, playerId]
            );
        }

        // دریافت نام‌ها
        const creatorResult = await pool.query('SELECT full_name FROM users WHERE id = $1', [game.creator_id]);
        const playerResult = await pool.query('SELECT full_name FROM users WHERE id = $1', [playerId]);
        
        const creatorName = creatorResult.rows[0]?.full_name || 'سازنده';
        const playerName = playerResult.rows[0]?.full_name || 'بازیکن';

        res.json({
            success: true,
            message: message,
            isCorrect: isCorrect,
            gameData: {
                gameCode: updatedGame.game_code,
                creatorName: creatorName,
                playerName: playerName,
                category: updatedGame.category,
                difficulty: updatedGame.difficulty,
                wordToDisplay: updatedGame.word_to_display,
                attemptsLeft: updatedGame.attempts_left,
                correctGuessedLetters: updatedGame.guessed_letters.filter(l => updatedGame.word.includes(l)),
                incorrectGuessedLetters: updatedGame.guessed_letters.filter(l => !updatedGame.word.includes(l)),
                status: updatedGame.status,
                timeRemainingSeconds: calculateTimeRemaining(updatedGame.start_time, updatedGame.time_limit_seconds),
                finalScoreChange: scoreChange,
                actualWord: newStatus !== 'active' ? game.word : undefined
            }
        });

    } catch (error) {
        console.error('❌ خطا در حدس زدن:', error);
        res.status(500).json({
            success: false,
            message: 'خطای سرور'
        });
    }
});

// دریافت تاریخچه حرکات بازی
app.get('/api/game/moves/:gameCode', async (req, res) => {
    try {
        const { gameCode } = req.params;
        const { userId } = req.query;

        console.log('📜 دریافت تاریخچه حرکات:', { gameCode, userId });

        if (!userId) {
            return res.status(400).json({
                success: false,
                message: 'شناسه کاربری الزامی است'
            });
        }

        // بررسی دسترسی کاربر به بازی
        const gameCheck = await pool.query(
            'SELECT 1 FROM games WHERE game_code = $1 AND (creator_id = $2 OR player_id = $2)',
            [gameCode, userId]
        );

        if (gameCheck.rows.length === 0) {
            return res.status(403).json({
                success: false,
                message: 'دسترسی غیرمجاز'
            });
        }

        const movesResult = await pool.query(
            `SELECT gm.*, u.full_name as player_name
             FROM game_moves gm
             JOIN users u ON gm.player_id = u.id
             WHERE gm.game_code = $1
             ORDER BY gm.created_at ASC`,
            [gameCode]
        );

        res.json({
            success: true,
            moves: movesResult.rows
        });

    } catch (error) {
        console.error('❌ خطا در دریافت تاریخچه حرکات:', error);
        res.status(500).json({
            success: false,
            message: 'خطای سرور'
        });
    }
});

// دریافت بازی‌های فعال کاربر
app.get('/api/games/active', async (req, res) => {
    try {
        const { userId } = req.query;

        console.log('📋 دریافت بازی‌های فعال برای کاربر:', userId);

        if (!userId) {
            return res.status(400).json({
                success: false,
                message: 'شناسه کاربری الزامی است'
            });
        }

        const result = await pool.query(
            `SELECT g.*, u.full_name as creator_name
             FROM games g 
             JOIN users u ON g.creator_id = u.id
             WHERE g.creator_id = $1 OR g.player_id = $1
             ORDER BY g.created_at DESC`,
            [userId]
        );

        res.json({
            success: true,
            games: result.rows.map(game => ({
                game_code: game.game_code,
                creator_name: game.creator_name,
                difficulty: game.difficulty,
                status: game.status,
                is_creator: game.creator_id === userId,
                category: game.category,
                player_id: game.player_id
            }))
        });

    } catch (error) {
        console.error('❌ خطا در دریافت بازی‌های فعال:', error);
        res.status(500).json({
            success: false,
            message: 'خطای سرور'
        });
    }
});

// دریافت وضعیت بازی
app.get('/api/game/status/:gameCode', async (req, res) => {
    try {
        const { gameCode } = req.params;
        const { userId } = req.query;

        console.log('📊 دریافت وضعیت بازی:', { gameCode, userId });

        if (!userId) {
            return res.status(400).json({
                success: false,
                message: 'شناسه کاربری الزامی است'
            });
        }

        const result = await pool.query(
            `SELECT g.*, u1.full_name as creator_name, u2.full_name as player_name
             FROM games g 
             JOIN users u1 ON g.creator_id = u1.id
             LEFT JOIN users u2 ON g.player_id = u2.id
             WHERE g.game_code = $1 AND (g.creator_id = $2 OR g.player_id = $2)`,
            [gameCode.toUpperCase(), userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'بازی پیدا نشد'
            });
        }

        const game = result.rows[0];

        // دریافت آخرین حرکات
        const movesResult = await pool.query(
            `SELECT gm.*, u.full_name as player_name
             FROM game_moves gm
             JOIN users u ON gm.player_id = u.id
             WHERE gm.game_code = $1
             ORDER BY gm.created_at DESC
             LIMIT 10`,
            [gameCode]
        );

        res.json({
            success: true,
            gameData: {
                gameCode: game.game_code,
                creatorName: game.creator_name,
                playerName: game.player_name || 'منتظر بازیکن',
                category: game.category,
                difficulty: game.difficulty,
                wordToDisplay: game.word_to_display,
                attemptsLeft: game.attempts_left,
                correctGuessedLetters: game.guessed_letters.filter(l => game.word.includes(l)),
                incorrectGuessedLetters: game.guessed_letters.filter(l => !game.word.includes(l)),
                status: game.status,
                timeRemainingSeconds: calculateTimeRemaining(game.start_time, game.time_limit_seconds),
                actualWord: game.status !== 'active' ? game.word : undefined,
                isPlayer: game.player_id === userId,
                isCreator: game.creator_id === userId,
                recentMoves: movesResult.rows.reverse()
            }
        });

    } catch (error) {
        console.error('❌ خطا در دریافت وضعیت بازی:', error);
        res.status(500).json({
            success: false,
            message: 'خطای سرور'
        });
    }
});

// --- Telegram Bot Routes ---

// Route ساده برای وب‌هوک
app.post(`/webhook/${TOKEN}`, (req, res) => {
    console.log('📨 دریافت به‌روزرسانی از تلگرام');
    bot.processUpdate(req.body);
    res.sendStatus(200);
});

app.get(`/webhook/${TOKEN}`, (req, res) => {
    res.json({ 
        status: 'Webhook is active', 
        timestamp: new Date().toISOString() 
    });
});

// دستور /start
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    
    const keyboard = {
        reply_markup: {
            inline_keyboard: [[
                {
                    text: '🎮 شروع بازی در Wordly Arena',
                    web_app: { url: WEB_APP_URL }
                }
            ]]
        }
    };

    bot.sendMessage(
        chatId, 
        `👋 به **Wordly Arena** خوش آمدید!\n\n` +
        `🎯 **یک بازی حدس کلمه هیجان‌انگیز!**\n\n` +
        `• ایجاد اتاق بازی خصوصی\n` +
        `• بازی با دوستان با کد دعوت\n` +
        `• سیستم امتیاز و رقابت\n\n` +
        `روی دکمه زیر کلیک کنید و بازی را شروع کنید:`, 
        { 
            parse_mode: 'Markdown',
            ...keyboard 
        }
    );
});

// --- Route های عمومی ---

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        service: 'Wordly Arena',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development'
    });
});

// Route پیش‌فرض برای SPA
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- راه‌اندازی سرور ---
async function startServer() {
    try {
        // ایجاد جداول
        await initDatabase();
        
        // تنظیم وب‌هوک
        await bot.setWebHook(`${HOST_URL}/webhook/${TOKEN}`);
        console.log(`✅ Webhook تنظیم شد: ${HOST_URL}/webhook/${TOKEN}`);
        
        // شروع سرور
        app.listen(PORT, () => {
            console.log(`🚀 سرور روی پورت ${PORT} راه‌اندازی شد`);
            console.log(`🌐 آدرس: ${WEB_APP_URL}`);
            console.log(`❤️  Health check: ${WEB_APP_URL}/health`);
        });
        
    } catch (error) {
        console.error('❌ خطا در راه‌اندازی سرور:', error);
        process.exit(1);
    }
}

// شروع برنامه
startServer();

// مدیریت graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down gracefully...');
    await pool.end();
    process.exit(0);
});

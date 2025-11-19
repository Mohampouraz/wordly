const express = require('express');
const bodyParser = require('body-parser');
const { Pool } = require('pg');
const TelegramBot = require('node-telegram-bot-api');
const path = require('path');
const crypto = require('crypto');

// --- 1. تنظیمات اولیه ---
const PORT = process.env.PORT || 3000;
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const WEB_APP_URL = process.env.WEB_APP_URL;
const HOST_URL = process.env.HOST_URL || WEB_APP_URL;

if (!TOKEN || !WEB_APP_URL || !process.env.DATABASE_URL) {
    console.error("خطا: متغیرهای محیطی حیاتی تنظیم نشده‌اند.");
    process.exit(1);
}

const bot = new TelegramBot(TOKEN);
const app = express();

// --- 2. اتصال به دیتابیس PostgreSQL ---
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// --- 3. Middleware ---
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Middleware برای لاگ درخواست‌ها
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
});

// --- 4. توابع کمکی ---
const generateCode = () => Math.random().toString(36).substring(2, 8).toUpperCase();

const calculateDisplayWord = (word, guessedLetters) => {
    return word.split('').map(char => {
        if (char === ' ') return ' ';
        return guessedLetters.includes(char.toLowerCase()) ? char : '_';
    }).join(' ');
};

const getInitialWordToDisplay = (word) => {
    return word.split('').map(char => char === ' ' ? ' ' : '_').join(' ');
};

const calculateTimeRemaining = (startTime, timeLimit) => {
    if (!startTime) return timeLimit;
    const elapsed = Math.floor((new Date() - new Date(startTime)) / 1000);
    return Math.max(0, timeLimit - elapsed);
};

// تابع برای اعتبارسنجی داده‌های تلگرام
function validateTelegramData(initData) {
    try {
        const urlParams = new URLSearchParams(initData);
        const hash = urlParams.get('hash');
        const dataToCheck = [];
        
        urlParams.sort();
        urlParams.forEach((val, key) => {
            if (key !== 'hash') {
                dataToCheck.push(`${key}=${val}`);
            }
        });
        
        const dataCheckString = dataToCheck.join('\n');
        const secretKey = crypto.createHmac('sha256', 'WebAppData').update(TOKEN).digest();
        const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
        
        return calculatedHash === hash;
    } catch (error) {
        console.error('Error validating Telegram data:', error);
        return false;
    }
}

// --- 5. ایجاد جداول دیتابیس ---
async function ensureTablesExist() {
    console.log('در حال بررسی و ایجاد جداول دیتابیس...');
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                full_name TEXT NOT NULL,
                score INTEGER DEFAULT 0,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS games (
                game_code CHAR(6) PRIMARY KEY,
                creator_id TEXT REFERENCES users(id) ON DELETE CASCADE,
                player_id TEXT REFERENCES users(id) ON DELETE SET NULL,
                word TEXT NOT NULL,
                category TEXT,
                difficulty TEXT,
                attempts_left INTEGER DEFAULT 10,
                guessed_letters TEXT[] DEFAULT ARRAY[]::TEXT[],
                word_to_display TEXT NOT NULL,
                status TEXT DEFAULT 'waiting',
                time_limit_seconds INTEGER DEFAULT 120,
                start_time TIMESTAMP WITH TIME ZONE,
                end_time TIMESTAMP WITH TIME ZONE,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );

            CREATE INDEX IF NOT EXISTS idx_games_creator_id ON games(creator_id);
            CREATE INDEX IF NOT EXISTS idx_games_player_id ON games(player_id);
            CREATE INDEX IF NOT EXISTS idx_games_status ON games(status);
        `);
        console.log('جداول دیتابیس با موفقیت ایجاد یا تأیید شدند.');
    } catch (err) {
        console.error('خطا در ایجاد جداول دیتابیس:', err);
        throw err;
    }
}

// --- 6. API Routes ---

// دریافت اطلاعات کاربر
app.get('/api/user/score', async (req, res) => {
    try {
        const { userId, fullName } = req.query;
        
        if (!userId) {
            return res.status(400).json({ 
                success: false, 
                message: 'شناسه کاربری الزامی است.' 
            });
        }

        // استفاده از fullName در صورت ارسال، در غیر این صورت از مقدار موجود استفاده می‌شود
        const userResult = await pool.query(
            `INSERT INTO users (id, full_name) 
             VALUES ($1, $2) 
             ON CONFLICT (id) 
             DO UPDATE SET 
                 full_name = COALESCE($2, users.full_name),
                 updated_at = NOW()
             RETURNING id, full_name, score`,
            [userId, fullName || 'کارگران']
        );

        const user = userResult.rows[0];
        
        // محاسبه آمار کاربر
        const statsResult = await pool.query(`
            SELECT 
                COUNT(*) FILTER (WHERE status = 'active' AND (creator_id = $1 OR player_id = $1)) as active_games,
                COUNT(*) FILTER (WHERE status = 'won' AND player_id = $1) as won_games
            FROM games
        `, [userId]);

        res.json({
            success: true,
            score: user.score,
            stats: statsResult.rows[0]
        });
        
    } catch (error) {
        console.error('Error in /api/user/score:', error);
        res.status(500).json({ 
            success: false, 
            message: 'خطا در سرور' 
        });
    }
});

// ایجاد بازی جدید
app.post('/api/game/create', async (req, res) => {
    try {
        const { word, category, difficulty, creatorId } = req.body;
        
        if (!word || !category || !difficulty || !creatorId) {
            return res.status(400).json({
                success: false,
                message: 'تمام فیلدهای ضروری را پر کنید.'
            });
        }

        // بررسی وجود کاربر
        const userCheck = await pool.query('SELECT id FROM users WHERE id = $1', [creatorId]);
        if (userCheck.rows.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'کاربر یافت نشد.'
            });
        }

        // تولید کد منحصر به فرد
        let gameCode;
        let attempts = 0;
        do {
            gameCode = generateCode();
            const codeCheck = await pool.query('SELECT 1 FROM games WHERE game_code = $1', [gameCode]);
            if (codeCheck.rows.length === 0) break;
            attempts++;
        } while (attempts < 10);

        if (attempts >= 10) {
            return res.status(500).json({
                success: false,
                message: 'خطا در تولید کد بازی'
            });
        }

        const wordToDisplay = getInitialWordToDisplay(word);
        
        await pool.query(
            `INSERT INTO games (game_code, creator_id, word, category, difficulty, word_to_display) 
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [gameCode, creatorId, word, category, difficulty, wordToDisplay]
        );

        res.json({
            success: true,
            message: 'بازی با موفقیت ایجاد شد.',
            gameCode,
            word,
            difficulty
        });

    } catch (error) {
        console.error('Error in /api/game/create:', error);
        res.status(500).json({
            success: false,
            message: 'خطا در سرور'
        });
    }
});

// پیوستن به بازی
app.post('/api/game/join', async (req, res) => {
    try {
        const { gameCode, playerId } = req.body;

        if (!gameCode || !playerId) {
            return res.status(400).json({
                success: false,
                message: 'کد بازی و شناسه کاربری الزامی است.'
            });
        }

        // دریافت اطلاعات بازی
        const gameResult = await pool.query(
            `SELECT g.*, u1.full_name as creator_name 
             FROM games g 
             JOIN users u1 ON g.creator_id = u1.id 
             WHERE g.game_code = $1`,
            [gameCode.toUpperCase()]
        );

        if (gameResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'بازی یافت نشد.'
            });
        }

        const game = gameResult.rows[0];

        // بررسی مجاز بودن کاربر برای پیوستن
        if (game.creator_id === playerId) {
            return res.status(400).json({
                success: false,
                message: 'شما سازنده این بازی هستید.'
            });
        }

        if (game.player_id && game.player_id !== playerId) {
            return res.status(400).json({
                success: false,
                message: 'این بازی قبلاً توسط بازیکن دیگری شروع شده است.'
            });
        }

        // بررسی وضعیت بازی
        if (game.status !== 'waiting') {
            return res.status(400).json({
                success: false,
                message: `این بازی در وضعیت "${game.status}" است و قابل پیوستن نیست.`
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
            message: 'با موفقیت به بازی پیوستید!',
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
        console.error('Error in /api/game/join:', error);
        res.status(500).json({
            success: false,
            message: 'خطا در سرور'
        });
    }
});

// حدس زدن حرف
app.post('/api/game/guess', async (req, res) => {
    try {
        const { gameCode, playerId, guess } = req.body;
        const normalizedGuess = guess.trim().toLowerCase();

        if (!gameCode || !playerId || !normalizedGuess) {
            return res.status(400).json({
                success: false,
                message: 'داده‌های ورودی ناقص است.'
            });
        }

        // دریافت اطلاعات بازی
        const gameResult = await pool.query(
            `SELECT g.*, u1.full_name as creator_name 
             FROM games g 
             JOIN users u1 ON g.creator_id = u1.id 
             WHERE g.game_code = $1`,
            [gameCode]
        );

        if (gameResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'بازی یافت نشد.'
            });
        }

        let game = gameResult.rows[0];

        // بررسی مجاز بودن کاربر
        if (game.player_id !== playerId) {
            return res.status(403).json({
                success: false,
                message: 'شما مجاز به بازی در این اتاق نیستید.'
            });
        }

        // بررسی وضعیت بازی
        if (game.status !== 'active') {
            return res.status(400).json({
                success: false,
                message: 'این بازی فعال نیست.'
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
                message: 'زمان بازی به پایان رسیده است.'
            });
        }

        // بررسی تکراری نبودن حدس
        if (game.guessed_letters.includes(normalizedGuess)) {
            return res.status(400).json({
                success: false,
                message: 'این حرف قبلاً حدس زده شده است.'
            });
        }

        // پردازش حدس
        const guessedLetters = [...game.guessed_letters, normalizedGuess];
        let attemptsLeft = game.attempts_left;
        let isCorrect = game.word.toLowerCase().includes(normalizedGuess);
        let message = isCorrect ? 'حدس صحیح!' : 'حدس اشتباه!';
        let newStatus = 'active';
        let scoreChange = 0;

        if (!isCorrect) {
            attemptsLeft--;
            message += ' یک فرصت از دست رفت.';
        }

        // محاسبه وضعیت جدید کلمه
        const newWordToDisplay = calculateDisplayWord(game.word, guessedLetters);

        // بررسی پایان بازی
        if (!newWordToDisplay.includes('_')) {
            newStatus = 'won';
            scoreChange = 50;
            message = 'تبریک! شما برنده شدید!';
        } else if (attemptsLeft <= 0) {
            newStatus = 'lost';
            scoreChange = -25;
            message = 'متاسفم، فرصت‌ها تمام شد.';
        }

        // به‌روزرسانی بازی
        const updateResult = await pool.query(
            `UPDATE games 
             SET attempts_left = $1, 
                 guessed_letters = $2, 
                 word_to_display = $3, 
                 status = $4,
                 end_time = CASE WHEN $4 != 'active' THEN NOW() ELSE NULL END
             WHERE game_code = $5 
             RETURNING *`,
            [attemptsLeft, guessedLetters, newWordToDisplay, newStatus, gameCode]
        );

        const updatedGame = updateResult.rows[0];

        // به‌روزرسانی امتیاز کاربر در صورت پایان بازی
        if (newStatus !== 'active') {
            await pool.query(
                'UPDATE users SET score = score + $1 WHERE id = $2',
                [scoreChange, playerId]
            );
        }

        // دریافت نام بازیکن
        const playerResult = await pool.query('SELECT full_name FROM users WHERE id = $1', [playerId]);
        const playerName = playerResult.rows[0]?.full_name || 'بازیکن';

        res.json({
            success: true,
            message,
            isCorrect,
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
                timeRemainingSeconds: calculateTimeRemaining(updatedGame.start_time, updatedGame.time_limit_seconds),
                finalScoreChange: scoreChange,
                actualWord: newStatus !== 'active' ? game.word : undefined
            }
        });

    } catch (error) {
        console.error('Error in /api/game/guess:', error);
        res.status(500).json({
            success: false,
            message: 'خطا در سرور'
        });
    }
});

// دریافت بازی‌های فعال کاربر
app.get('/api/games/active', async (req, res) => {
    try {
        const { userId } = req.query;

        if (!userId) {
            return res.status(400).json({
                success: false,
                message: 'شناسه کاربری الزامی است.'
            });
        }

        const result = await pool.query(
            `SELECT g.*, u.full_name as creator_name,
                    (g.creator_id = $1) as is_creator
             FROM games g 
             JOIN users u ON g.creator_id = u.id
             WHERE (g.creator_id = $1 OR g.player_id = $1)
             ORDER BY 
                 CASE WHEN g.status = 'active' THEN 1
                      WHEN g.status = 'waiting' THEN 2
                      ELSE 3 END,
                 g.created_at DESC`,
            [userId]
        );

        res.json({
            success: true,
            games: result.rows.map(game => ({
                game_code: game.game_code,
                creator_name: game.creator_name,
                difficulty: game.difficulty,
                status: game.status,
                is_creator: game.is_creator,
                created_at: game.created_at
            }))
        });

    } catch (error) {
        console.error('Error in /api/games/active:', error);
        res.status(500).json({
            success: false,
            message: 'خطا در سرور'
        });
    }
});

// دریافت وضعیت بازی
app.get('/api/game/status/:gameCode', async (req, res) => {
    try {
        const { gameCode } = req.params;
        const { userId } = req.query;

        if (!userId) {
            return res.status(400).json({
                success: false,
                message: 'شناسه کاربری الزامی است.'
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
                message: 'بازی یافت نشد یا شما مجاز نیستید.'
            });
        }

        const game = result.rows[0];

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
                actualWord: game.status !== 'active' ? game.word : undefined
            }
        });

    } catch (error) {
        console.error('Error in /api/game/status:', error);
        res.status(500).json({
            success: false,
            message: 'خطا در سرور'
        });
    }
});

// --- 7. Telegram Bot Routes ---

// Route برای بررسی وضعیت Webhook
app.get(`/webhook/${TOKEN}`, (req, res) => {
    res.json({ 
        status: 'Webhook is active', 
        timestamp: new Date().toISOString(),
        url: `${HOST_URL}/webhook/${TOKEN}`
    });
});

// Route اصلی برای دریافت به‌روزرسانی‌های تلگرام
app.post(`/webhook/${TOKEN}`, (req, res) => {
    try {
        bot.processUpdate(req.body);
        res.sendStatus(200);
    } catch (error) {
        console.error('Error processing Telegram update:', error);
        res.sendStatus(200); // Still return 200 to prevent retries
    }
});

// دستور /start
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    
    const keyboard = {
        reply_markup: {
            inline_keyboard: [
                [
                    {
                        text: '🎮 شروع بازی در Wordly Arena',
                        web_app: { 
                            url: WEB_APP_URL
                        }
                    }
                ],
                [
                    {
                        text: '📊 مشاهده راهنما',
                        callback_data: 'help'
                    }
                ]
            ]
        }
    };

    bot.sendMessage(
        chatId, 
        `👋 به **Wordly Arena** خوش آمدید!\n\n` +
        `با این ربات می‌توانید بازی‌های حدس کلمه آنلاین را با دوستان خود انجام دهید.\n\n` +
        `🎯 **امکانات:**\n` +
        `• ایجاد اتاق بازی خصوصی\n` +
        `• پیوستن با کد دعوت\n` +
        `• رقابت آنلاین با دوستان\n` +
        `• سیستم امتیاز و رتبه‌بندی\n\n` +
        `روی دکمه زیر کلیک کنید تا بازی شروع شود:`, 
        { 
            parse_mode: 'Markdown',
            ...keyboard 
        }
    );
});

// مدیریت callback queries
bot.on('callback_query', (callbackQuery) => {
    const message = callbackQuery.message;
    const data = callbackQuery.data;

    if (data === 'help') {
        bot.editMessageText(
            `📖 **راهنمای Wordly Arena**\n\n` +
            `🎮 **نحوه بازی:**\n` +
            `1. روی "شروع بازی" کلیک کنید\n` +
            `2. یک کلمه و موضوع انتخاب کنید\n` +
            `3. کد دعوت را برای دوست خود بفرستید\n` +
            `4. دوست شما با کد دعوت به بازی می‌پیوندد\n` +
            `5. بازیکن باید حروف کلمه را حدس بزند\n\n` +
            `🏆 **قوانین:**\n` +
            `• هر بازیکن 10 فرصت دارد\n` +
            `• زمان هر بازی 2 دقیقه است\n` +
            `• برنده +50 امتیاز می‌گیرد\n` +
            `• بازنده -25 امتیاز می‌گیرد\n\n` +
            `برای شروع بازی روی منوی وب اپ کلیک کنید.`,
            {
                chat_id: message.chat.id,
                message_id: message.message_id,
                parse_mode: 'Markdown'
            }
        );
    }
});

// --- 8. Routeهای کمکی ---

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        service: 'Wordly Arena API'
    });
});

// Route پیش‌فرض برای SPA
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- 9. راه‌اندازی سرور ---
async function startServer() {
    try {
        // اطمینان از وجود جداول
        await ensureTablesExist();
        
        // تنظیم Webhook
        await bot.setWebHook(`${HOST_URL}/webhook/${TOKEN}`);
        console.log(`🤖 Telegram Bot Webhook set up: ${HOST_URL}/webhook/${TOKEN}`);
        
        // راه‌اندازی سرور
        app.listen(PORT, () => {
            console.log(`🚀 Server running on port ${PORT}`);
            console.log(`🌐 Web App URL: ${WEB_APP_URL}`);
            console.log(`📊 Health check: ${HOST_URL}/health`);
        });
    } catch (error) {
        console.error('❌ Failed to start server:', error);
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

process.on('SIGTERM', async () => {
    console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
    await pool.end();
    process.exit(0);
});

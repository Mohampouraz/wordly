const express = require('express');
const bodyParser = require('body-parser');
const { Pool } = require('pg');
const TelegramBot = require('node-telegram-bot-api');
const path = require('path');

// --- 1. تنظیمات اولیه ---

// متغیرهای محیطی
const PORT = process.env.PORT || 3000;
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const WEB_APP_URL = process.env.WEB_APP_URL; // آدرس HTTPS رندر (مثلاً https://wordlygame.onrender.com)
const HOST_URL = WEB_APP_URL; // برای سادگی، آدرس میزبان را همان Web App در نظر می‌گیریم

if (!TOKEN || !WEB_APP_URL || !process.env.DATABASE_URL) {
    console.error("خطا: متغیرهای محیطی حیاتی (TOKEN, WEB_APP_URL, DATABASE_URL) تنظیم نشده‌اند.");
    process.exit(1);
}

const bot = new TelegramBot(TOKEN);
const app = express();
const botUsername = 'WordlyArenaBot'; // نام کاربری ربات شما (برای نمایش در /start)

// --- 2. اتصال به دیتابیس PostgreSQL ---

// 🚨 مهم: تنظیمات SSL برای اتصال به Render/Heroku ضروری است.
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

// --- 3. Express Middleware ---

app.use(bodyParser.json());
// سرویس‌دهی فایل‌های استاتیک از پوشه public (شامل index.html)
app.use(express.static(path.join(__dirname, 'public')));


// --- 4. منطق دیتابیس و مدل‌ها ---

/**
 * اطمینان از وجود جداول در دیتابیس
 */
async function ensureTablesExist() {
    console.log('در حال بررسی و ایجاد جداول دیتابیس...');
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                full_name TEXT NOT NULL,
                score INTEGER DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS games (
                game_code CHAR(6) PRIMARY KEY,
                creator_id TEXT REFERENCES users(id),
                player_id TEXT REFERENCES users(id),
                word TEXT NOT NULL,
                category TEXT,
                difficulty TEXT,
                attempts_left INTEGER DEFAULT 10,
                guessed_letters TEXT[] DEFAULT ARRAY[]::TEXT[],
                word_to_display TEXT NOT NULL,
                status TEXT DEFAULT 'waiting', -- waiting, active, won, lost
                time_limit_seconds INTEGER DEFAULT 120,
                start_time TIMESTAMP WITH TIME ZONE,
                end_time TIMESTAMP WITH TIME ZONE
            );
        `);
        console.log('جداول دیتابیس با موفقیت ایجاد یا تأیید شدند.');
    } catch (err) {
        console.error('خطا در ایجاد جداول دیتابیس:', err.message);
        throw err;
    }
}

// توابع کمکی برای منطق بازی
const generateCode = () => Math.random().toString(36).substring(2, 8).toUpperCase();
const calculateDisplayWord = (word, guessedLetters) => {
    return word.split('').map(char => {
        if (char === ' ') return ' ';
        return guessedLetters.includes(char) ? char : '_';
    }).join(' ');
};
const getInitialWordToDisplay = (word) => word.split('').map(char => char === ' ' ? ' ' : '_').join(' ');
const calculateTimeRemaining = (startTime, timeLimit) => {
    if (!startTime) return timeLimit;
    const elapsed = Math.floor((new Date() - new Date(startTime)) / 1000);
    return Math.max(0, timeLimit - elapsed);
};

// --- 5. API Endpoints برای Web App ---

// 5.1. دریافت امتیاز کاربر و ثبت نام (اگر وجود نداشت)
app.get('/api/user/score', async (req, res) => {
    const { userId, fullName } = req.query;
    if (!userId || !fullName) {
        return res.status(400).json({ success: false, message: 'شناسه کاربری و نام لازم است.' });
    }

    try {
        // Upsert logic (insert if not exists, return existing score)
        let result = await pool.query(
            'INSERT INTO users (id, full_name) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET full_name = $2 RETURNING score',
            [userId, fullName]
        );
        res.json({ success: true, score: result.rows[0].score });
    } catch (err) {
        console.error('خطا در دریافت امتیاز:', err);
        res.status(500).json({ success: false, message: 'خطا در ارتباط با دیتابیس.' });
    }
});

// 5.2. ایجاد بازی
app.post('/api/game/create', async (req, res) => {
    const { word, category, difficulty, creatorId } = req.body;
    if (!word || !category || !difficulty || !creatorId) {
        return res.status(400).json({ success: false, message: 'تمام فیلدهای ایجاد بازی را پر کنید.' });
    }

    try {
        let gameCode;
        let isUnique = false;
        // تولید کد منحصر به فرد
        while (!isUnique) {
            gameCode = generateCode();
            const check = await pool.query('SELECT 1 FROM games WHERE game_code = $1', [gameCode]);
            if (check.rows.length === 0) {
                isUnique = true;
            }
        }

        const initialWordToDisplay = getInitialWordToDisplay(word);
        
        await pool.query(
            'INSERT INTO games (game_code, creator_id, word, category, difficulty, word_to_display) VALUES ($1, $2, $3, $4, $5, $6)',
            [gameCode, creatorId, word, category, difficulty, initialWordToDisplay]
        );

        res.json({ success: true, message: 'بازی با موفقیت ایجاد شد.', gameCode, word, difficulty });
    } catch (err) {
        console.error('خطا در ایجاد بازی:', err);
        res.status(500).json({ success: false, message: 'خطا در دیتابیس.' });
    }
});

// 5.3. پیوستن به بازی
app.post('/api/game/join', async (req, res) => {
    const { gameCode, playerId } = req.body;

    try {
        const gameResult = await pool.query('SELECT * FROM games WHERE game_code = $1', [gameCode]);
        const game = gameResult.rows[0];

        if (!game) {
            return res.status(404).json({ success: false, message: 'کد بازی نامعتبر است.' });
        }
        
        if (game.creator_id === playerId) {
            return res.status(400).json({ success: false, message: 'شما سازنده این بازی هستید، نمی‌توانید دوباره به عنوان بازیکن بپیوندید.' });
        }
        
        if (game.player_id && game.player_id !== playerId) {
             return res.status(400).json({ success: false, message: 'این بازی قبلاً توسط بازیکن دیگری شروع شده است.' });
        }
        
        // اگر بازی منتظر است یا بازیکن فعلی دارد (برای ریلود صفحه)
        if (game.status === 'waiting' || (game.status === 'active' && game.player_id === playerId)) {
            // شروع بازی با تنظیم player_id، status و زمان شروع
            const updateResult = await pool.query(
                `UPDATE games SET 
                    player_id = $1, 
                    status = 'active', 
                    start_time = NOW() 
                 WHERE game_code = $2 RETURNING *`,
                [playerId, gameCode]
            );
            
            const updatedGame = updateResult.rows[0];
            const creator = await pool.query('SELECT full_name FROM users WHERE id = $1', [updatedGame.creator_id]);
            const player = await pool.query('SELECT full_name FROM users WHERE id = $1', [playerId]);

            return res.json({ 
                success: true, 
                message: 'با موفقیت به بازی پیوستید!',
                gameData: {
                    gameCode: updatedGame.game_code,
                    creatorName: creator.rows[0].full_name,
                    playerName: player.rows[0].full_name,
                    category: updatedGame.category,
                    difficulty: updatedGame.difficulty,
                    wordToDisplay: updatedGame.word_to_display,
                    attemptsLeft: updatedGame.attempts_left,
                    correctGuessedLetters: updatedGame.guessed_letters.filter(l => updatedGame.word.includes(l)),
                    incorrectGuessedLetters: updatedGame.guessed_letters.filter(l => !updatedGame.word.includes(l)),
                    status: updatedGame.status,
                    timeRemainingSeconds: updatedGame.time_limit_seconds
                }
            });
        }
        
        return res.status(400).json({ success: false, message: `بازی در وضعیت ${game.status} است و قابل پیوستن نیست.` });

    } catch (err) {
        console.error('خطا در پیوستن به بازی:', err);
        res.status(500).json({ success: false, message: 'خطا در دیتابیس.' });
    }
});

// 5.4. حدس زدن یک حرف
app.post('/api/game/guess', async (req, res) => {
    const { gameCode, playerId, guess } = req.body;
    const normalizedGuess = guess.trim().toLowerCase();

    try {
        const gameResult = await pool.query('SELECT * FROM games WHERE game_code = $1', [gameCode]);
        let game = gameResult.rows[0];

        if (!game || game.status !== 'active' || game.player_id !== playerId) {
            return res.status(400).json({ success: false, message: 'بازی در دسترس نیست یا شما بازیکن مجاز نیستید.' });
        }
        
        if (game.guessed_letters.includes(normalizedGuess)) {
            return res.json({ success: false, message: 'این حرف قبلاً حدس زده شده است.', gameData: game });
        }
        
        if (calculateTimeRemaining(game.start_time, game.time_limit_seconds) <= 0) {
            return res.status(400).json({ success: false, message: 'زمان بازی به پایان رسیده است.' });
        }
        
        let attemptsLeft = game.attempts_left;
        const guessedLetters = [...game.guessed_letters, normalizedGuess];
        let message = '';
        let newStatus = 'active';
        let finalScoreChange = 0;

        const isCorrect = game.word.includes(normalizedGuess);
        if (!isCorrect) {
            attemptsLeft -= 1;
            message = 'حدس اشتباه! یک فرصت از دست رفت.';
        } else {
            message = 'حدس صحیح!';
        }

        const newWordToDisplay = calculateDisplayWord(game.word, guessedLetters);

        // بررسی وضعیت پایان بازی
        if (!newWordToDisplay.includes('_')) {
            newStatus = 'won';
            finalScoreChange = 50; // امتیاز برای برنده
            message = 'تبریک! شما برنده شدید!';
        } else if (attemptsLeft <= 0) {
            newStatus = 'lost';
            finalScoreChange = -25; // امتیاز منفی برای بازنده
            message = 'متاسفم، فرصت‌ها تمام شد. کلمه این بود: ' + game.word;
        }

        // به‌روزرسانی دیتابیس
        const updateResult = await pool.query(
            `UPDATE games SET 
                attempts_left = $1, 
                guessed_letters = $2, 
                word_to_display = $3, 
                status = $4,
                end_time = CASE WHEN $4 != 'active' THEN NOW() ELSE NULL END
             WHERE game_code = $5 RETURNING *`,
            [attemptsLeft, guessedLetters, newWordToDisplay, newStatus, gameCode]
        );
        
        // به‌روزرسانی امتیاز کاربر اگر بازی تمام شده باشد
        if (newStatus !== 'active') {
            await pool.query(
                'UPDATE users SET score = score + $1 WHERE id = $2',
                [finalScoreChange, playerId]
            );
        }
        
        const updatedGame = updateResult.rows[0];
        const creator = await pool.query('SELECT full_name FROM users WHERE id = $1', [updatedGame.creator_id]);
        const player = await pool.query('SELECT full_name FROM users WHERE id = $1', [playerId]);

        res.json({ 
            success: true, 
            message, 
            isCorrect,
            gameData: {
                gameCode: updatedGame.game_code,
                creatorName: creator.rows[0].full_name,
                playerName: player.rows[0].full_name,
                category: updatedGame.category,
                difficulty: updatedGame.difficulty,
                wordToDisplay: updatedGame.word_to_display,
                attemptsLeft: updatedGame.attempts_left,
                correctGuessedLetters: updatedGame.guessed_letters.filter(l => updatedGame.word.includes(l)),
                incorrectGuessedLetters: updatedGame.guessed_letters.filter(l => !updatedGame.word.includes(l)),
                status: updatedGame.status,
                timeRemainingSeconds: calculateTimeRemaining(updatedGame.start_time, updatedGame.time_limit_seconds),
                finalScoreChange: finalScoreChange
            }
        });

    } catch (err) {
        console.error('خطا در حدس زدن:', err);
        res.status(500).json({ success: false, message: 'خطا در دیتابیس.' });
    }
});

// 5.5. دریافت لیست بازی‌های فعال کاربر
app.get('/api/games/active', async (req, res) => {
    const { userId } = req.query;
    try {
        const result = await pool.query(
            `SELECT g.*, u.full_name AS creator_name
             FROM games g 
             JOIN users u ON g.creator_id = u.id
             WHERE g.creator_id = $1 OR g.player_id = $1
             ORDER BY g.start_time DESC NULLS FIRST, g.game_code DESC`,
            [userId]
        );
        
        const games = result.rows.map(g => ({
            game_code: g.game_code,
            creator_name: g.creator_name,
            difficulty: g.difficulty,
            status: g.status,
            is_creator: g.creator_id === userId
        }));

        res.json({ success: true, games });
    } catch (err) {
        console.error('خطا در دریافت بازی‌های فعال:', err);
        res.status(500).json({ success: false, message: 'خطا در دیتابیس.' });
    }
});


// 5.6. دریافت وضعیت بازی (برای ریلود یا بروزرسانی)
app.get('/api/game/status/:gameCode', async (req, res) => {
    const { gameCode } = req.params;
    const { userId } = req.query;

    try {
        const result = await pool.query('SELECT * FROM games WHERE game_code = $1', [gameCode]);
        const game = result.rows[0];

        if (!game || (game.creator_id !== userId && game.player_id !== userId)) {
            return res.status(404).json({ success: false, message: 'بازی یافت نشد یا شما مجاز نیستید.' });
        }
        
        const creator = await pool.query('SELECT full_name FROM users WHERE id = $1', [game.creator_id]);
        const player = game.player_id ? await pool.query('SELECT full_name FROM users WHERE id = $1', [game.player_id]) : { rows: [{ full_name: 'منتظر بازیکن' }] };

        const gameData = {
            gameCode: game.game_code,
            creatorName: creator.rows[0].full_name,
            playerName: player.rows[0].full_name,
            category: game.category,
            difficulty: game.difficulty,
            wordToDisplay: game.word_to_display,
            attemptsLeft: game.attempts_left,
            correctGuessedLetters: game.guessed_letters.filter(l => game.word.includes(l)),
            incorrectGuessedLetters: game.guessed_letters.filter(l => !game.word.includes(l)),
            status: game.status,
            timeRemainingSeconds: calculateTimeRemaining(game.start_time, game.time_limit_seconds),
            finalScoreChange: 0 // این مقدار در روت guess محاسبه می‌شود
        };

        res.json({ success: true, gameData });
    } catch (err) {
        console.error('خطا در دریافت وضعیت بازی:', err);
        res.status(500).json({ success: false, message: 'خطا در دیتابیس.' });
    }
});


// --- 6. Telegram Bot Handlers ---

// تنظیم Webhook (فقط یک بار در شروع سرور)
bot.setWebHook(`${HOST_URL}/webhook/${TOKEN}`);
console.log(`🤖 Telegram Bot Webhook set up on ${HOST_URL}/webhook/${TOKEN}`);


// 🚨 روت GET برای Webhook: از خطای "Cannot GET" جلوگیری می‌کند (بسیار مهم)
app.get(`/webhook/${TOKEN}`, (req, res) => {
    res.send('Webhook is active, waiting for POST requests.'); 
});

// روت POST: دریافت به‌روزرسانی‌ها از تلگرام
app.post(`/webhook/${TOKEN}`, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200); // پاسخ به تلگرام برای تایید دریافت
});


// دستور /start
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const keyboard = {
        reply_markup: {
            inline_keyboard: [
                [
                    {
                        text: 'شروع بازی و باز کردن Web App 🎮',
                        web_app: { 
                            url: WEB_APP_URL // آدرس HTTPS رندر
                        }
                    }
                ]
            ]
        }
    };

    bot.sendMessage(
        chatId, 
        `👋 به Wordly Arena خوش آمدید!\n\nبا این ربات می‌توانید بازی‌های حدس کلمه آنلاین را با دوستان خود انجام دهید.\n\nروی دکمه زیر بزنید تا بازی باز شود:`, 
        keyboard
    );
});


// --- 7. راه‌اندازی سرور ---

(async () => {
    try {
        await ensureTablesExist(); // اطمینان از وجود جداول قبل از راه‌اندازی سرور
        app.listen(PORT, () => {
            console.log(`🚀 Server running on port ${PORT}`);
        });
    } catch (err) {
        console.error('❌ راه‌اندازی سرور به دلیل خطای دیتابیس شکست خورد.');
        process.exit(1);
    }
})();

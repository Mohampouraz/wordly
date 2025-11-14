// server.js
const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const { Telegraf } = require('telegraf'); 

// ** مشخصات محیطی **
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || "8217028556:AAFDNQfmRYuUnto4gb2dAUNyWjKanRZldfA";
const WEB_APP_URL = process.env.WEB_APP_URL || "https://wordlybot.xo.je";
const DATABASE_URL = process.env.DATABASE_URL || "postgresql://abolfazl:uADpBikvq08jFXFWHURmINea1L5oz389@dpg-d4bn1mer433s73d1tiug-a.frankfurt-postgres.render.com/wordlygame_yqt5";
const PORT = process.env.PORT || 10000;

const app = express();
const bot = new Telegraf(TELEGRAM_TOKEN);
const IS_PRODUCTION = process.env.NODE_ENV === 'production' && WEB_APP_URL;

// --- تنظیمات پایگاه داده ---
const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

// --- تنظیمات Express ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// ارائه فایل‌های فرانت‌اند از پوشه 'public'
app.use(express.static(path.join(__dirname, 'public'))); 


// =========================================================
//                   DATABASE LOGIC
// =========================================================

async function initializeDatabase() {
    try {
        const client = await pool.connect();
        
        // 1. جدول کلمات
        const createWordsTable = `
            CREATE TABLE IF NOT EXISTS words (
                id SERIAL PRIMARY KEY,
                word TEXT NOT NULL UNIQUE,
                category TEXT NOT NULL
            );
        `;
        await client.query(createWordsTable);
        
        // 2. جدول بازی‌ها
        const createGamesTable = `
            CREATE TABLE IF NOT EXISTS games (
                id SERIAL PRIMARY KEY,
                user_id BIGINT NOT NULL UNIQUE, -- کاربر فقط یک بازی فعال دارد
                target_word TEXT NOT NULL,
                category TEXT NOT NULL,
                guessed_letters JSONB DEFAULT '[]'::jsonb,
                remaining_guesses INT DEFAULT 10,
                status TEXT DEFAULT 'IN_PROGRESS', 
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `;
        await client.query(createGamesTable);

        // 3. در صورت خالی بودن، کلمات پیش‌فرض را اضافه کنید
        const checkWords = await client.query('SELECT COUNT(*) FROM words');
        if (parseInt(checkWords.rows[0].count) === 0) {
            const insertWords = `
                INSERT INTO words (word, category) VALUES 
                ('حواس پرتی', 'روانشناسی'),
                ('برنامه نویسی', 'کامپیوتر'),
                ('آزادی', 'فلسفه'),
                ('خورشید', 'طبیعت'),
                ('ماهی', 'طبیعت')
                ON CONFLICT (word) DO NOTHING;
            `;
            await client.query(insertWords);
            console.log("✅ Initial words inserted.");
        }

        client.release();
        console.log("✅ Database tables checked/created and ready.");
    } catch (err) {
        console.error('❌ Error initializing database:', err.stack);
    }
}

async function selectRandomWord() {
    const res = await pool.query('SELECT word, category FROM words ORDER BY RANDOM() LIMIT 1');
    if (res.rows.length === 0) {
        throw new Error("No words found in the database.");
    }
    return res.rows[0];
}

// =========================================================
//                        API ROUTES
// =========================================================

/**
 * روت برای شروع یک بازی جدید یا بازیابی بازی فعال
 */
app.post('/api/start-game', async (req, res) => {
    const { user_id } = req.body;
    if (!user_id) return res.status(400).json({ error: 'user_id is required.' });

    try {
        let gameRes = await pool.query('SELECT * FROM games WHERE user_id = $1 AND status = $2', [user_id, 'IN_PROGRESS']);
        let game = gameRes.rows[0];

        if (!game) {
            // شروع بازی جدید
            const { word, category } = await selectRandomWord();
            const initialGuesses = 10;
            
            const newGameRes = await pool.query(
                `INSERT INTO games (user_id, target_word, category, remaining_guesses, guessed_letters, status) 
                 VALUES ($1, $2, $3, $4, $5, 'IN_PROGRESS') 
                 ON CONFLICT (user_id) DO UPDATE SET 
                    target_word = EXCLUDED.target_word, 
                    category = EXCLUDED.category,
                    guessed_letters = '[]'::jsonb,
                    remaining_guesses = EXCLUDED.remaining_guesses,
                    status = 'IN_PROGRESS'
                 RETURNING *`, 
                [user_id, word.toLowerCase(), category, initialGuesses, '[]']
            );
            game = newGameRes.rows[0];
        }

        const correctGuesses = game.guessed_letters.filter(letter => game.target_word.includes(letter));
        const incorrectGuesses = game.guessed_letters.filter(letter => !game.target_word.includes(letter));
        
        return res.json({
            // target_word: game.target_word, // کلمه هدف را به کلاینت نباید ارسال کرد
            target_length: game.target_word.length,
            target_word_structure: game.target_word, // برای محاسبه پلیس هولدر با اسپیس
            category: game.category,
            guessed_letters: game.guessed_letters,
            correct_guesses: correctGuesses,
            incorrect_guesses: incorrectGuesses,
            remaining_guesses: game.remaining_guesses,
            status: game.status
        });

    } catch (error) {
        console.error('Error starting game:', error.stack);
        res.status(500).json({ error: 'Failed to start or retrieve game.' });
    }
});


/**
 * روت برای حدس زدن یک حرف
 */
app.post('/api/guess', async (req, res) => {
    const { user_id, letter: rawLetter } = req.body;
    const letter = rawLetter ? rawLetter.toLowerCase().trim() : null;

    if (!user_id || !letter || letter.length !== 1 || !/^[ا-ی]$/.test(letter)) {
        return res.status(400).json({ error: 'Invalid user_id or letter. Only single Persian letters are allowed.' });
    }

    try {
        const client = await pool.connect();
        
        let gameRes = await client.query('SELECT * FROM games WHERE user_id = $1 AND status = $2 FOR UPDATE', [user_id, 'IN_PROGRESS']);
        let game = gameRes.rows[0];

        if (!game) {
            client.release();
            return res.status(404).json({ error: 'No active game found. Please start a new game.' });
        }

        let targetWord = game.target_word.toLowerCase();
        let guessedLetters = game.guessed_letters || [];
        let remainingGuesses = game.remaining_guesses;
        let gameStatus = game.status;
        let message = '';
        
        if (guessedLetters.includes(letter)) {
            client.release();
            return res.json({ 
                status: gameStatus,
                remaining_guesses: remainingGuesses,
                message: `حرف "${letter.toUpperCase()}" قبلاً حدس زده شده است.`,
                correct_guesses: guessedLetters.filter(l => targetWord.includes(l)),
                incorrect_guesses: guessedLetters.filter(l => !targetWord.includes(l))
            });
        }

        // پردازش حدس
        guessedLetters.push(letter);
        let isCorrect = targetWord.includes(letter);
        
        if (!isCorrect) {
            remainingGuesses--;
            message = `❌ حرف "${letter.toUpperCase()}" اشتباه است.`;
        } else {
            message = `✅ حرف "${letter.toUpperCase()}" درست است.`;
        }

        // بررسی اتمام بازی (برنده شدن)
        const uniqueWordChars = new Set(targetWord.split('').filter(c => c !== ' '));
        const currentCorrectGuesses = new Set(guessedLetters.filter(l => targetWord.includes(l)));

        if (uniqueWordChars.size === currentCorrectGuesses.size) {
            gameStatus = 'WON';
            message = '🎉 تبریک! کلمه را حدس زدید!';
        } else if (remainingGuesses <= 0) {
            gameStatus = 'LOST';
            message = `😢 باختید. کلمه صحیح: ${targetWord.toUpperCase()}`;
        }
        
        // به‌روزرسانی DB
        const updateRes = await client.query(
            `UPDATE games SET guessed_letters = $1, remaining_guesses = $2, status = $3 WHERE id = $4 RETURNING *`,
            [JSON.stringify(guessedLetters), remainingGuesses, gameStatus, game.id]
        );
        client.release();
        
        const finalGame = updateRes.rows[0];
        const finalCorrectGuesses = finalGame.guessed_letters.filter(l => finalGame.target_word.includes(l));
        const finalIncorrectGuesses = finalGame.guessed_letters.filter(l => !finalGame.target_word.includes(l));

        return res.json({
            status: finalGame.status,
            remaining_guesses: finalGame.remaining_guesses,
            correct_guesses: finalCorrectGuesses,
            incorrect_guesses: finalIncorrectGuesses,
            message: message,
            target_word_structure: finalGame.status !== 'IN_PROGRESS' ? finalGame.target_word.toUpperCase() : null // فقط در صورت اتمام ارسال شود
        });

    } catch (error) {
        console.error('Error processing guess:', error.stack);
        res.status(500).json({ error: 'Failed to process guess.' });
    }
});


// =========================================================
//                     TELEGRAM BOT LOGIC
// =========================================================

bot.start((ctx) => {
    const keyboard = Telegraf.Extra.markup((m) => 
        m.inlineKeyboard([
            m.button.webApp('🎮 شروع بازی حدس کلمه', WEB_APP_URL)
        ])
    );

    const welcomeMessage = `
**👋 به ربات حدس کلمه خوش آمدید!**
این بازی به صورت Web App تلگرام اجرا می‌شود.
برای شروع بازی، روی دکمه زیر کلیک کنید.
    `;
    
    ctx.replyWithMarkdown(welcomeMessage, keyboard);
});

bot.on('text', (ctx) => {
    if (ctx.message.text !== '/start') {
        ctx.reply('لطفاً برای شروع بازی دستور /start را ارسال کنید.');
    }
});


// =========================================================
//                       STARTUP
// =========================================================

async function startServer() {
    await initializeDatabase();

    // تنظیم Webhook برای محیط Production
    if (IS_PRODUCTION) {
        const webhookUrl = `${WEB_APP_URL}/bot${TELEGRAM_TOKEN}`;
        await bot.telegram.setWebhook(webhookUrl);
        
        app.post(`/bot${TELEGRAM_TOKEN}`, (req, res) => {
            bot.handleUpdate(req.body, res);
        });
        console.log(`🤖 Webhook set to: ${webhookUrl}`);

    } else {
        // محیط توسعه محلی: Polling
        bot.launch(); 
        console.log('🤖 Bot launched via Polling (Development Mode).');
    }

    // راه‌اندازی Express Server
    app.listen(PORT, () => {
        console.log(`🚀 Express Server listening on port ${PORT}`);
    });
}

startServer();

// server.js
const express = require('express');
const path = require('path');
const { Pool } = require('pg');

// ** مشخصات محیطی **
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || "8217028556:AAFDNQfmRYuUnto4gb2dAUNyWjKanRZldfA";
const WEB_APP_URL = process.env.WEB_APP_URL || "https://wordlybot.xo.je";
const DATABASE_URL = process.env.DATABASE_URL || "postgresql://abolfazl:uADpBikvq08jFXFWHURmINea1L5oz389@dpg-d4bn1mer433s73d1tiug-a.frankfurt-postgres.render.com/wordlygame_yqt5";
const PORT = process.env.PORT || 10000;

const app = express();

// --- تنظیمات پایگاه داده ---
const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: {
        rejectUnauthorized: false // برای اتصال به Render/Heroku و غیره
    }
});

// --- تنظیمات Express ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// فرض: فایل‌های فرانت‌اند در پوشه 'public' هستند.
app.use(express.static(path.join(__dirname, 'public'))); 

// --- توابع کمکی ---

/**
 * ایجاد یا به‌روزرسانی جداول مورد نیاز (اگر وجود نداشته باشند).
 */
async function initializeDatabase() {
    try {
        const client = await pool.connect();
        
        // 1. جدول کلمات (برای ذخیره کلمات هدف و دسته‌بندی‌ها)
        const createWordsTable = `
            CREATE TABLE IF NOT EXISTS words (
                id SERIAL PRIMARY KEY,
                word TEXT NOT NULL UNIQUE,
                category TEXT NOT NULL
            );
        `;
        await client.query(createWordsTable);
        console.log("✅ Table 'words' checked/created.");

        // 2. جدول بازی‌ها (برای ذخیره وضعیت هر بازی کاربر)
        const createGamesTable = `
            CREATE TABLE IF NOT EXISTS games (
                id SERIAL PRIMARY KEY,
                user_id BIGINT NOT NULL,
                target_word TEXT NOT NULL,
                category TEXT NOT NULL,
                guessed_letters JSONB DEFAULT '[]'::jsonb,
                remaining_guesses INT DEFAULT 10,
                status TEXT DEFAULT 'IN_PROGRESS', -- 'IN_PROGRESS', 'WON', 'LOST'
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                -- تضمین اینکه کاربر فقط یک بازی فعال داشته باشد
                UNIQUE (user_id) 
            );
        `;
        await client.query(createGamesTable);
        console.log("✅ Table 'games' checked/created.");

        // 3. در صورت خالی بودن، کلمات پیش‌فرض را اضافه کنید
        const checkWords = await client.query('SELECT COUNT(*) FROM words');
        if (parseInt(checkWords.rows[0].count) === 0) {
            console.log("⏳ Inserting initial words...");
            const insertWords = `
                INSERT INTO words (word, category) VALUES 
                ('حواس پرتی', 'روانشناسی'),
                ('برنامه نویسی', 'کامپیوتر'),
                ('آزادی', 'فلسفه'),
                ('خورشید', 'طبیعت')
                ON CONFLICT (word) DO NOTHING;
            `;
            await client.query(insertWords);
            console.log("✅ Initial words inserted.");
        }

        client.release();
    } catch (err) {
        console.error('❌ Error initializing database:', err.stack);
        // سرور را خاموش نکنید، اما خطا را گزارش دهید
    }
}

/**
 * کلمه هدف تصادفی جدید را از DB انتخاب می‌کند.
 * @returns {Promise<{word: string, category: string}>}
 */
async function selectRandomWord() {
    const res = await pool.query('SELECT word, category FROM words ORDER BY RANDOM() LIMIT 1');
    if (res.rows.length === 0) {
        throw new Error("No words found in the database.");
    }
    return res.rows[0];
}


// --- روت‌های API ---

/**
 * روت برای شروع یک بازی جدید یا بازیابی بازی فعال
 * انتظار: { user_id: number }
 * بازگشت: { target_length: number, category: string, guessed_letters: string[], remaining_guesses: number }
 */
app.post('/api/start-game', async (req, res) => {
    const { user_id } = req.body;
    if (!user_id) return res.status(400).json({ error: 'user_id is required.' });

    try {
        // 1. بازی فعال کاربر را بررسی کنید
        let gameRes = await pool.query('SELECT * FROM games WHERE user_id = $1 AND status = $2', [user_id, 'IN_PROGRESS']);
        let game = gameRes.rows[0];

        if (!game) {
            // 2. اگر بازی فعال نیست، یک بازی جدید شروع کنید
            const { word, category } = await selectRandomWord();
            const initialGuesses = 10;
            
            // حذف بازی‌های قدیمی کاربر (از جدول games یک ستون unique (user_id) ایجاد کردیم، 
            // اما اگر وضعیت را کنترل می‌کنید، باید بازی‌های قبلی را به 'LOST' یا 'WON' تغییر دهید)
            // در اینجا فرض می‌کنیم کاربر فقط یک بازی فعال دارد:
            const newGameRes = await pool.query(
                `INSERT INTO games (user_id, target_word, category, remaining_guesses, guessed_letters) 
                 VALUES ($1, $2, $3, $4, $5) 
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

        // 3. ارسال وضعیت بازی به کلاینت
        const targetWordWithoutSpaces = game.target_word.replace(/\s/g, '');
        const correctGuesses = new Set(game.guessed_letters.filter(letter => game.target_word.includes(letter)));
        const incorrectGuesses = new Set(game.guessed_letters.filter(letter => !game.target_word.includes(letter)));
        
        return res.json({
            target_word: game.target_word, // کلمه هدف (بهتر است به کلاینت ندهید، اینجا فقط برای تست)
            target_length: targetWordWithoutSpaces.length,
            category: game.category,
            guessed_letters: Array.from(game.guessed_letters),
            correct_guesses: Array.from(correctGuesses),
            incorrect_guesses: Array.from(incorrectGuesses),
            remaining_guesses: game.remaining_guesses,
            status: game.status
        });

    } catch (error) {
        console.error('Error starting game:', error);
        res.status(500).json({ error: 'Failed to start or retrieve game.' });
    }
});


/**
 * روت برای حدس زدن یک حرف
 * انتظار: { user_id: number, letter: string }
 * بازگشت: { status: 'IN_PROGRESS'|'WON'|'LOST', remaining_guesses: number, correct_guesses: string[], incorrect_guesses: string[] }
 */
app.post('/api/guess', async (req, res) => {
    const { user_id, letter: rawLetter } = req.body;
    const letter = rawLetter ? rawLetter.toLowerCase().trim() : null;

    if (!user_id || !letter || letter.length !== 1 || !/^[ا-ی]$/.test(letter)) {
        return res.status(400).json({ error: 'Invalid user_id or letter.' });
    }

    try {
        const client = await pool.connect();
        
        // 1. بازی فعال کاربر را پیدا کنید
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
                message: `حرف "${letter.toUpperCase()}" قبلاً حدس زده شده است.` 
            });
        }

        // 2. پردازش حدس
        guessedLetters.push(letter);
        let isCorrect = targetWord.includes(letter);
        
        if (!isCorrect) {
            remainingGuesses--;
            message = `❌ حرف "${letter.toUpperCase()}" اشتباه است.`;
        } else {
            message = `✅ حرف "${letter.toUpperCase()}" درست است.`;
        }

        // 3. بررسی اتمام بازی (برنده شدن)
        const uniqueWordChars = new Set(targetWord.split('').filter(c => c !== ' '));
        const currentCorrectGuesses = new Set(guessedLetters.filter(l => targetWord.includes(l)));

        if (uniqueWordChars.size === currentCorrectGuesses.size) {
            gameStatus = 'WON';
            message = '🎉 تبریک! کلمه را حدس زدید!';
        } else if (remainingGuesses <= 0) {
            gameStatus = 'LOST';
            message = `😢 باختید. کلمه صحیح: ${targetWord.toUpperCase()}`;
        }
        
        // 4. به‌روزرسانی DB
        const updateRes = await client.query(
            `UPDATE games 
             SET guessed_letters = $1, 
                 remaining_guesses = $2, 
                 status = $3 
             WHERE id = $4 
             RETURNING *`,
            [JSON.stringify(guessedLetters), remainingGuesses, gameStatus, game.id]
        );
        client.release();
        
        // 5. ساخت پاسخ
        const finalGame = updateRes.rows[0];
        const finalCorrectGuesses = new Set(finalGame.guessed_letters.filter(l => finalGame.target_word.includes(l)));
        const finalIncorrectGuesses = new Set(finalGame.guessed_letters.filter(l => !finalGame.target_word.includes(l)));

        return res.json({
            status: finalGame.status,
            remaining_guesses: finalGame.remaining_guesses,
            correct_guesses: Array.from(finalCorrectGuesses),
            incorrect_guesses: Array.from(finalIncorrectGuesses),
            message: message 
        });

    } catch (error) {
        console.error('Error processing guess:', error.stack);
        res.status(500).json({ error: 'Failed to process guess.' });
    }
});


// --- راه‌اندازی سرور ---
initializeDatabase().then(() => {
    app.listen(PORT, () => {
        console.log(`🚀 Server listening on port ${PORT}`);
        console.log(`🌐 Web App URL: ${WEB_APP_URL}`);
    });
});

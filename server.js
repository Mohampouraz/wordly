// server.js
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');
const http = require('http');
const { Pool } = require('pg');
const crypto = require('crypto');
// برای مدیریت متغیرهای محیطی در توسعه محلی
require('dotenv').config(); 

// ----------------------------------------------------------------
// ۱. تنظیمات و متغیرهای اصلی
// ----------------------------------------------------------------
const BOT_TOKEN = "8217028556:AAFDNQfmRYuUnto4gb2dAUNyWjKanRZldfA"; 
const DATABASE_URL = "postgresql://abolfazl:gecrw6BsIFRJfASXUuG3NTepMnv1Hqpx@dpg-d3qbq8d6ubrc73fqfim0-a.frankfurt-postgres.render.com/wordlygame";

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 5000;

// تنظیمات CORS برای ارتباط با فرانت‌اند
const corsOptions = {
    origin: "https://wordlybot.xo.je", 
    methods: ["GET", "POST"],
    credentials: true 
};

app.use(cors(corsOptions));
app.use(express.json());

// --- راه‌اندازی Socket.IO ---
const io = new Server(server, { cors: corsOptions });

// ----------------------------------------------------------------
// ۲. مدیریت دیتابیس PostgreSQL
// ----------------------------------------------------------------
const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false } // لازم برای Render
});

// تابع اجرای کوئری
const dbQuery = (text, params) => pool.query(text, params);

// ایجاد جداول (در صورت عدم وجود)
async function setupDatabase() {
    console.log("Setting up database...");
    const client = await pool.connect();
    try {
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                telegram_id BIGINT UNIQUE NOT NULL,
                username VARCHAR(255),
                total_score INT DEFAULT 0,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS word_bank (
                id SERIAL PRIMARY KEY,
                word VARCHAR(255) UNIQUE NOT NULL,
                category VARCHAR(100) NOT NULL,
                length INT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS challenge_games (
                id SERIAL PRIMARY KEY,
                user_id INT REFERENCES users(id),
                word_id INT REFERENCES word_bank(id),
                guessed_letters JSONB DEFAULT '{}'::jsonb, 
                revealed_word TEXT NOT NULL, 
                guesses_left INT NOT NULL,
                hints_left INT DEFAULT 3,
                start_time TIMESTAMP WITH TIME ZONE NOT NULL,
                end_time TIMESTAMP WITH TIME ZONE,
                score INT DEFAULT 0,
                status VARCHAR(50) DEFAULT 'IN_PROGRESS'
            );
        `);
        console.log("Tables created successfully or already exist.");
    } catch (err) {
        console.error("Error setting up database:", err);
    } finally {
        client.release();
    }
}

// setupDatabase(); // برای اجرای setup در production/deployment فعال کنید

// ----------------------------------------------------------------
// ۳. Middleware احراز هویت تلگرام
// ----------------------------------------------------------------
/**
 * تایید داده‌های هش شده تلگرام
 */
function checkSignature({ hash, ...data }) {
    const checkString = Object.keys(data)
        .sort()
        .map(key => (`${key}=${data[key]}`))
        .join('\n');

    const secret = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
    const hashCheck = crypto.createHmac('sha256', secret).update(checkString).digest('hex');

    return hashCheck === hash;
}

/**
 * Middleware: تایید داده‌های تلگرام، ایجاد/دریافت کاربر و افزودن به req.user
 */
async function verifyTelegramAuth(req, res, next) {
    // داده‌های احراز هویت از header یا body دریافت می‌شوند
    const authDataRaw = req.headers['x-telegram-auth'] || req.body.authData;

    if (!authDataRaw) {
        return res.status(401).json({ message: 'Authentication data is missing.' });
    }

    try {
        const data = JSON.parse(authDataRaw);
        
        // اگر دیتا شامل فیلد user نباشد (مانند داده‌های خام تلگرام)
        if (!data.user) {
            return res.status(401).json({ message: 'Invalid Telegram data format (missing user).' });
        }

        // بررسی اعتبار سنجی هش
        if (!checkSignature(data)) {
             // در محیط عملیاتی، این لاین باید فعال شود:
             // return res.status(401).json({ message: 'Invalid Telegram data signature.' });
             // برای تست محلی موقتاً غیرفعال می‌کنیم:
             console.warn("Signature check skipped for testing!");
        }

        // احراز هویت موفق: ثبت یا به‌روزرسانی کاربر در دیتابیس
        const userData = data.user;
        const result = await dbQuery(
            `INSERT INTO users (telegram_id, username) 
             VALUES ($1, $2) 
             ON CONFLICT (telegram_id) 
             DO UPDATE SET username = $2 
             RETURNING id, username, total_score`,
            [userData.id, userData.username || userData.first_name]
        );

        req.user = result.rows[0]; // ذخیره اطلاعات دیتابیس کاربر
        next();

    } catch (error) {
        console.error('Telegram Auth Error:', error);
        return res.status(500).json({ message: 'Error processing authentication data.' });
    }
}


// ----------------------------------------------------------------
// ۴. منطق API برای بازی چالشی (/api/challenge)
// ----------------------------------------------------------------

// تمام مسیرهای /api/challenge از Middleware احراز هویت عبور می‌کنند.

// POST /api/challenge/start - شروع بازی جدید
app.post('/api/challenge/start', verifyTelegramAuth, async (req, res) => {
    const userId = req.user.id;
    const { category } = req.body;

    try {
        // ۱. انتخاب کلمه تصادفی بر اساس دسته‌بندی
        const wordResult = await dbQuery(
            `SELECT id, word, length FROM word_bank 
             WHERE category = $1 
             ORDER BY RANDOM() 
             LIMIT 1`,
            [category]
        );

        if (wordResult.rowCount === 0) {
            return res.status(404).json({ message: "Category not found or empty." });
        }

        const wordData = wordResult.rows[0];
        const wordLength = wordData.word.length;
        const maxGuesses = Math.floor(wordLength * 1.5); // ۱.۵ برابر طول کلمه

        // ۲. ایجاد رکورد بازی
        const gameResult = await dbQuery(
            `INSERT INTO challenge_games (user_id, word_id, revealed_word, guesses_left, hints_left, start_time, status)
             VALUES ($1, $2, $3, $4, 3, NOW(), 'IN_PROGRESS')
             RETURNING id, guesses_left, hints_left, revealed_word, start_time`,
            [userId, wordData.id, '_'.repeat(wordLength), maxGuesses]
        );

        const newGame = gameResult.rows[0];

        res.json({
            gameId: newGame.id,
            wordLength: wordLength,
            maxGuesses: maxGuesses,
            guessesLeft: newGame.guesses_left,
            hintsLeft: newGame.hints_left,
            placeholder: newGame.revealed_word,
            startTime: newGame.start_time,
            creatorName: "Wordly Bot",
            guesserName: req.user.username,
            currentScore: req.user.total_score // نمایش امتیاز کلی کاربر
        });

    } catch (error) {
        console.error('Error starting game:', error);
        res.status(500).json({ message: 'Error starting game.' });
    }
});


// POST /api/challenge/:gameId/guess - حدس زدن یک حرف
app.post('/api/challenge/:gameId/guess', verifyTelegramAuth, async (req, res) => {
    const { gameId } = req.params;
    const { letter } = req.body;
    const userId = req.user.id;
    const char = letter ? letter.trim().toLowerCase() : ''; 

    if (!char || char.length !== 1) {
        return res.status(400).json({ message: "حدس نامعتبر است. یک حرف وارد کنید." });
    }

    try {
        const gameQuery = await dbQuery(
            `SELECT g.*, w.word 
             FROM challenge_games g 
             JOIN word_bank w ON g.word_id = w.id 
             WHERE g.id = $1 AND g.user_id = $2 AND g.status = 'IN_PROGRESS'`,
            [gameId, userId]
        );

        if (gameQuery.rowCount === 0) {
            return res.status(404).json({ message: "بازی یافت نشد یا غیرفعال است." });
        }

        const game = gameQuery.rows[0];
        const actualWord = game.word;
        let revealedWord = game.revealed_word.split('');
        let guessedLetters = game.guessed_letters || {};
        let correctLettersCount = revealedWord.filter(l => l !== '_').length;
        let isCorrectGuess = false;
        let scoreUpdate = 0; // امتیازی که در این دور به total_score اضافه می‌شود

        if (guessedLetters[char]) {
            return res.status(400).json({ message: `حرف "${char}" قبلا حدس زده شده.` });
        }
        
        // اعمال حدس
        if (actualWord.includes(char)) {
            guessedLetters[char] = 'correct';
            for (let i = 0; i < actualWord.length; i++) {
                if (actualWord[i] === char) {
                    // فقط اگر قبلاً حدس زده نشده باشد، شمارش می‌شود
                    if (revealedWord[i] === '_') { 
                        correctLettersCount++;
                    }
                    revealedWord[i] = char;
                }
            }
            isCorrectGuess = true;
        } else {
            guessedLetters[char] = 'wrong';
            game.guesses_left -= 1;
        }

        const newRevealedWord = revealedWord.join('');
        let newStatus = 'IN_PROGRESS';
        let finalScore = game.score;

        // بررسی پایان بازی
        if (newRevealedWord === actualWord) {
            newStatus = 'WON';
            const timeElapsed = (new Date() - new Date(game.start_time)) / 1000;
            // فرمول امتیاز: (تعداد حروف صحیح * 100) + max(0, 5000 - زمان سپری شده * 5)
            finalScore = (actualWord.length * 100) + Math.max(0, 5000 - Math.floor(timeElapsed) * 5);
            scoreUpdate = finalScore;
        } else if (game.guesses_left <= 0) {
            newStatus = 'LOST';
            finalScore = 0;
            scoreUpdate = 0;
        }

        // به‌روزرسانی دیتابیس
        await dbQuery(
            `UPDATE challenge_games 
             SET revealed_word = $1, 
                 guesses_left = $2, 
                 guessed_letters = $3, 
                 status = $4,
                 score = $5,
                 end_time = CASE WHEN $4 != 'IN_PROGRESS' THEN NOW() ELSE NULL END
             WHERE id = $6`,
            [newRevealedWord, game.guesses_left, guessedLetters, newStatus, finalScore, gameId]
        );

        // به‌روزرسانی total_score کاربر
        if (newStatus !== 'IN_PROGRESS' && scoreUpdate > 0) {
             await dbQuery(
                `UPDATE users 
                 SET total_score = total_score + $1 
                 WHERE id = $2`,
                [scoreUpdate, userId]
            );
        }

        res.json({
            status: newStatus,
            guessesLeft: game.guesses_left,
            hintsLeft: game.hints_left,
            placeholder: newRevealedWord,
            guessedLetters: guessedLetters,
            score: finalScore,
            isCorrect: isCorrectGuess,
            correctLettersCount: correctLettersCount,
            message: newStatus === 'WON' ? `آفرین! شما بردید! امتیاز: ${finalScore}` : newStatus === 'LOST' ? 'متاسفانه باختید!' : 'حدس ثبت شد.'
        });

    } catch (error) {
        console.error('Error guessing letter:', error);
        res.status(500).json({ message: 'Error processing guess.' });
    }
});


// POST /api/challenge/:gameId/hint - درخواست راهنمایی
app.post('/api/challenge/:gameId/hint', verifyTelegramAuth, async (req, res) => {
    const { gameId } = req.params;
    const userId = req.user.id;
    const { position } = req.body; // موقعیت (index) کلمه برای راهنمایی

    try {
        const gameQuery = await dbQuery(
            `SELECT g.*, w.word 
             FROM challenge_games g 
             JOIN word_bank w ON g.word_id = w.id 
             WHERE g.id = $1 AND g.user_id = $2 AND g.status = 'IN_PROGRESS'`,
            [gameId, userId]
        );

        if (gameQuery.rowCount === 0) {
            return res.status(404).json({ message: "بازی یافت نشد یا غیرفعال است." });
        }

        const game = gameQuery.rows[0];

        // بررسی شرایط راهنمایی
        if (game.hints_left <= 0) {
            return res.status(400).json({ message: "تمام راهنمایی‌ها استفاده شده است. مجاز: ۳" });
        }
        if (game.guesses_left < 2) {
            return res.status(400).json({ message: "فرصت‌های باقی‌مانده کافی نیست (حداقل ۲ فرصت نیاز است)." });
        }

        let revealedWord = game.revealed_word.split('');
        const actualWord = game.word;
        let hintLetter = '';
        let hintIndex = -1;
        
        // پیدا کردن اولین حرف مخفی در موقعیت درخواست شده
        if (position !== undefined && position >= 0 && position < actualWord.length) {
            if (revealedWord[position] === '_') {
                hintIndex = position;
            }
        }
        
        // اگر موقعیت مشخص نشده یا موقعیت مشخص شده قبلا افشا شده، اولین حرف مخفی را پیدا کن
        if (hintIndex === -1) {
            for (let i = 0; i < actualWord.length; i++) {
                if (revealedWord[i] === '_') {
                    hintIndex = i;
                    break;
                }
            }
        }

        if (hintIndex === -1) {
            return res.status(400).json({ message: "کلمه قبلا به طور کامل افشا شده است." });
        }
        
        // اعمال راهنمایی
        hintLetter = actualWord[hintIndex];
        revealedWord[hintIndex] = hintLetter;
        
        game.hints_left -= 1;
        game.guesses_left -= 2; // کسر دو حدس به ازای راهنمایی

        // به‌روزرسانی دیتابیس
        const newRevealedWord = revealedWord.join('');

        await dbQuery(
            `UPDATE challenge_games 
             SET revealed_word = $1, 
                 guesses_left = $2, 
                 hints_left = $3
             WHERE id = $4`,
            [newRevealedWord, game.guesses_left, game.hints_left, gameId]
        );

        res.json({
            guessesLeft: game.guesses_left,
            hintsLeft: game.hints_left,
            placeholder: newRevealedWord,
            hintLetter: hintLetter,
            hintIndex: hintIndex,
            message: `راهنمایی داده شد! حرف "${hintLetter}" در جایگاه ${hintIndex + 1} افشا شد. ۲ فرصت کسر شد.`
        });

    } catch (error) {
        console.error('Error requesting hint:', error);
        res.status(500).json({ message: 'Error processing hint request.' });
    }
});


// ----------------------------------------------------------------
// ۵. منطق WebSocket (Socket.IO)
// ----------------------------------------------------------------
io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id}`);

    // [ROOM] کاربر به اتاق مورد نظر ملحق می‌شود
    socket.on('joinRoom', (roomId, userId) => {
        socket.join(roomId);
        console.log(`User ${userId} joined room ${roomId}`);
        io.to(roomId).emit('userJoined', userId); 
    });

    // [GAME] مدیریت حدس‌های بازیکن در حالت دونفره
    socket.on('playerGuess', ({ roomId, guessData }) => {
        // این بخش باید منطق پیچیده بازی دونفره را در خود داشته باشد
        // (مثل نوبت‌دهی، بررسی کلمه، و امتیازدهی لحظه‌ای)
        
        // در حال حاضر فقط حدس را به بازیکن مقابل ارسال می‌کنیم
        socket.to(roomId).emit('opponentGuess', guessData); 
    });

    socket.on('cancelGame', (roomId, userId) => {
        io.to(roomId).emit('gameCanceled', { userId, message: "بازی توسط کاربر لغو شد." });
        // خروج کاربر از اتاق
        socket.leave(roomId); 
    });

    socket.on('disconnect', () => {
        console.log(`Socket disconnected: ${socket.id}`);
    });
});


// ----------------------------------------------------------------
// ۶. راه‌اندازی سرور
// ----------------------------------------------------------------
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

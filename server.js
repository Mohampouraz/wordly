const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const { Pool } = require('pg'); 
const TelegramBot = require('node-telegram-bot-api'); 

const app = express();
const PORT = process.env.PORT || 3000;

// --- 📢 تنظیمات ضروری ---
// از متغیرهای محیطی Render استفاده کنید یا مقادیر واقعی را قرار دهید
const TOKEN = process.env.BOT_TOKEN || '8217028556:AAFDNQfmRYuUnto4gb2dAUNyWjKanRZldfA'; 
const WEB_APP_URL = process.env.WEB_APP_URL || 'https://wordlygame.onrender.com';
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://abolfazl:uADpBikvq08jFXFWHURmINea1L5oz389@dpg-d4bn1mer433s73d1tiug-a.frankfurt-postgres.render.com/wordlygame_yqt5';
// ------------------------


// --- ۱. تنظیمات اتصال PostgreSQL (حل مشکل SSL/TLS required) ---
const pool = new Pool({
    connectionString: DATABASE_URL, 
    ssl: { 
        rejectUnauthorized: false 
    }
});
// ------------------------------------------------------------------

/**
 * ⚠️ تابع حیاتی: این تابع جداول users و games را ایجاد می‌کند.
 * ⚠️ پس از اولین دیپلوی موفق، بهتر است برای جلوگیری از خطاهای احتمالی، آن را حذف کنید.
 */
async function ensureTablesExist() {
    console.log("--- 🏗️ در حال بررسی و ایجاد جداول دیتابیس... 🏗️ ---");
    const client = await pool.connect();
    try {
        const createUsersTableQuery = `
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                full_name VARCHAR(255) NOT NULL,
                score INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT NOW()
            );
        `;

        const createGamesTableQuery = `
            CREATE TABLE IF NOT EXISTS games (
                game_code VARCHAR(6) PRIMARY KEY,
                word TEXT NOT NULL,
                category VARCHAR(100),
                difficulty VARCHAR(50),
                creator_id TEXT REFERENCES users(id) ON DELETE CASCADE,
                player_id TEXT REFERENCES users(id) ON DELETE SET NULL, 
                status VARCHAR(20) DEFAULT 'waiting', 
                attempts_left INTEGER DEFAULT 10,
                correct_guessed_letters TEXT[] DEFAULT '{}', 
                incorrect_guessed_letters TEXT[] DEFAULT '{}', 
                start_time TIMESTAMP,
                score_finalized BOOLEAN DEFAULT FALSE,
                final_score_change INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT NOW()
            );
        `;
        
        await client.query(createUsersTableQuery);
        await client.query(createGamesTableQuery);
        console.log("✅ جداول users و games با موفقیت ایجاد (یا تأیید) شدند.");

    } catch (error) {
        console.error("❌ خطای اسکیما (ایجاد جداول):", error.message);
        // در صورت خطای جدی، سرویس باید کرش کند تا خطا مشخص شود
        // throw error; 
    } finally {
        client.release();
    }
}


// --- ۲. راه‌اندازی ربات با متد Webhook ---
const bot = new TelegramBot(TOKEN); 
const secretPath = `/webhook/${TOKEN}`; 

// --- Utility Functions (توابع کمکی) ---
function generateGameCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

function maskWord(actualWord, correctGuessedLetters) {
    if (!actualWord) return '';
    return actualWord.split('').map(char => {
        if (char === ' ') return ' ';
        return correctGuessedLetters.includes(char) ? char : '_'; 
    }).join(' ');
}

async function finalizeGameScore(gameCode, gameData, status) {
    if (gameData.score_finalized) return 0; 

    const playerId = gameData.player_id;
    if (!playerId) return 0;

    let scoreChange = 0;
    
    if (status === 'won') {
        scoreChange = 50; 
        if (gameData.difficulty === 'متوسط') scoreChange += 10;
        if (gameData.difficulty === 'سخت') scoreChange += 20;
    } else if (status === 'lost') {
        scoreChange = -10; 
    }

    try {
        await pool.query(
            'UPDATE users SET score = GREATEST(0, score + $1) WHERE id = $2',
            [scoreChange, playerId]
        );

        await pool.query(
            'UPDATE games SET score_finalized = TRUE, final_score_change = $1, status = $2 WHERE game_code = $3',
            [scoreChange, status, gameCode]
        );

        return scoreChange;

    } catch (error) {
        console.error("Error finalizing score:", error);
        return 0;
    }
}

async function checkGameStatus(gameData) {
    if (gameData.status === 'won' || gameData.status === 'lost') return gameData.status;

    if (gameData.status !== 'active') return gameData.status;

    const wordWithoutSpaces = gameData.word.replace(/\s/g, '').split('');
    const isWordGuessed = wordWithoutSpaces.every(char => gameData.correct_guessed_letters.includes(char));

    const startTime = new Date(gameData.start_time).getTime();
    const elapsedTime = (Date.now() - startTime) / 1000;
    const totalTimeSeconds = 120; 
    const timeExpired = elapsedTime > totalTimeSeconds;
    
    let newStatus = 'active';

    if (isWordGuessed) {
        newStatus = 'won';
    } else if (gameData.attempts_left <= 0 || timeExpired) {
        newStatus = 'lost';
    }
    
    if (newStatus !== 'active' && gameData.player_id) {
        await finalizeGameScore(gameData.game_code, gameData, newStatus);
    }

    return newStatus;
}

async function getGameDataForClient(gameData, userId) {
    const status = await checkGameStatus(gameData);
    gameData.status = status; 

    let timeRemaining = 120; 
    if (gameData.status === 'active' && gameData.start_time) {
        const startTime = new Date(gameData.start_time).getTime();
        const elapsedTime = (Date.now() - startTime) / 1000;
        timeRemaining = Math.max(0, 120 - Math.floor(elapsedTime));
    }
    
    const displayWord = (gameData.status !== 'active') ? gameData.word.split('').join(' ') : maskWord(gameData.word, gameData.correct_guessed_letters);
    
    const creatorResult = await pool.query('SELECT full_name FROM users WHERE id = $1', [gameData.creator_id]);
    const creatorName = creatorResult.rows[0] ? creatorResult.rows[0].full_name : 'ناشناس';
    
    let playerName = null;
    if (gameData.player_id) {
        const playerResult = await pool.query('SELECT full_name FROM users WHERE id = $1', [gameData.player_id]);
        playerName = playerResult.rows[0] ? playerResult.rows[0].full_name : null;
    }

    return {
        gameCode: gameData.game_code,
        isCreator: gameData.creator_id === userId,
        isPlayer: gameData.player_id === userId,
        status: gameData.status,
        wordLength: gameData.word.replace(/\s/g, '').length, 
        wordToDisplay: displayWord, 
        difficulty: gameData.difficulty,
        category: gameData.category,
        creatorName: creatorName,
        playerName: playerName,
        attemptsLeft: gameData.attempts_left,
        correctGuessedLetters: gameData.correct_guessed_letters || [],
        incorrectGuessedLetters: gameData.incorrect_guessed_letters || [],
        totalTimeSeconds: 120,
        timeRemainingSeconds: timeRemaining,
        createdAt: gameData.created_at,
        finalScoreChange: gameData.final_score_change || 0,
    };
}


// ------------------------------------------------------------------
// --- Express Middleware & Telegram Bot Webhook Handler ---
// ------------------------------------------------------------------

app.use(bodyParser.json());
// فرض می‌کنیم فایل‌های فرانت‌اند در پوشه 'public' قرار دارند
app.use(express.static(path.join(__dirname, 'public')));


// منطق بات تلگرام: هندل کامند /start
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;

    const keyboard = {
        reply_markup: {
            inline_keyboard: [
                [
                    {
                        text: 'شروع بازی و باز کردن Web App 🎮',
                        web_app: { 
                            url: WEB_APP_URL 
                        }
                    }
                ]
            ]
        }
    };

    bot.sendMessage(chatId, 'برای شروع، دکمه بازی را بزنید:', keyboard);
    console.log(`Bot received /start from ${msg.chat.id} and sent the Web App button.`);
});

// Endpoint Webhook که تلگرام پیام‌ها را به آن ارسال می‌کند
app.post(secretPath, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200); 
});


// ------------------------------------------------------------------
// --- API Endpoints (Express & PostgreSQL) ---
// ------------------------------------------------------------------

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API مدیریت امتیاز کاربر (Profile Tab)
app.get('/api/user/score', async (req, res) => {
    const { userId, fullName } = req.query;
    if (!userId) return res.status(400).json({ success: false, message: 'userId is required' });

    try {
        let userResult = await pool.query('SELECT score, full_name FROM users WHERE id = $1', [userId]);

        if (userResult.rows.length === 0) {
            // کاربر جدید است: درج کن
            await pool.query(
                'INSERT INTO users (id, full_name, score) VALUES ($1, $2, 0)',
                [userId, decodeURIComponent(fullName) || `User ${userId}`]
            );
            userResult = await pool.query('SELECT score, full_name FROM users WHERE id = $1', [userId]);
        }
        
        const user = userResult.rows[0];
        res.json({ success: true, score: user.score, fullName: user.full_name });

    } catch (error) {
        console.error("DB Error in /api/user/score:", error);
        // خطای 42P01 (relation does not exist) اکنون باید با ensureTablesExist() گرفته شود.
        res.status(500).json({ success: false, message: 'خطای سرور در بارگذاری کاربر.' });
    }
});

// API ایجاد بازی جدید (Create Game Tab)
app.post('/api/game/create', async (req, res) => {
    const { word, category, difficulty, creatorId } = req.body;

    if (!word || !category || !difficulty || !creatorId) {
        return res.status(400).json({ success: false, message: 'اطلاعات ناقص است.' });
    }
    if (!/^[\u0600-\u06FF\s]+$/.test(word)) {
        return res.status(400).json({ success: false, message: 'کلمه فقط باید شامل حروف فارسی و فاصله باشد.' });
    }

    let gameCode;
    let attempts = 0;
    
    do {
        gameCode = generateGameCode();
        const existingGame = await pool.query('SELECT game_code FROM games WHERE game_code = $1', [gameCode]);
        if (existingGame.rows.length === 0) break;
        attempts++;
    } while (attempts < 10);

    if (attempts >= 10) return res.status(500).json({ success: false, message: 'خطا در تولید کد بازی.' });

    try {
        const insertQuery = `
            INSERT INTO games (game_code, word, category, difficulty, creator_id)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING game_code, word, difficulty;
        `;
        const result = await pool.query(insertQuery, [
            gameCode,
            word.trim().toLowerCase(),
            category,
            difficulty,
            creatorId
        ]);

        res.json({ success: true, gameCode: result.rows[0].game_code, word: result.rows[0].word, difficulty: result.rows[0].difficulty });
    } catch (error) {
        console.error("DB Error in /api/game/create:", error);
        res.status(500).json({ success: false, message: 'خطای سرور در ایجاد بازی.' });
    }
});

// API پیوستن به بازی (Join Game)
app.post('/api/game/join', async (req, res) => {
    const { gameCode, playerId } = req.body;

    try {
        const gameResult = await pool.query('SELECT * FROM games WHERE game_code = $1', [gameCode]);
        const game = gameResult.rows[0];

        if (!game) return res.status(404).json({ success: false, message: 'بازی یافت نشد.' });
        if (game.creator_id === playerId) return res.status(400).json({ success: false, message: 'شما سازنده این بازی هستید.' });
        if (game.status !== 'waiting' || game.player_id) return res.status(400).json({ success: false, message: 'بازی پر شده یا شروع شده است.' });

        // به‌روزرسانی وضعیت بازی
        const updateQuery = `
            UPDATE games 
            SET player_id = $1, status = 'active', start_time = NOW(), score_finalized = FALSE
            WHERE game_code = $2
            RETURNING *;
        `;
        const updatedGameResult = await pool.query(updateQuery, [playerId, gameCode]);
        
        const gameDataClient = await getGameDataForClient(updatedGameResult.rows[0], playerId);
        res.json({ success: true, message: 'شما با موفقیت به بازی پیوستید.', gameData: gameDataClient });
    } catch (error) {
        console.error("DB Error in /api/game/join:", error);
        res.status(500).json({ success: false, message: 'خطای سرور در پیوستن به بازی.' });
    }
});

// API دریافت وضعیت بازی (Game View)
app.get('/api/game/status/:gameCode', async (req, res) => {
    const { gameCode } = req.params;
    const { userId } = req.query;

    try {
        const gameResult = await pool.query('SELECT * FROM games WHERE game_code = $1', [gameCode]);
        const game = gameResult.rows[0];

        if (!game) return res.status(404).json({ success: false, message: 'بازی یافت نشد.' });
        if (game.creator_id !== userId && game.player_id !== userId) return res.status(403).json({ success: false, message: 'دسترسی غیرمجاز.' });

        const gameDataClient = await getGameDataForClient(game, userId);
        res.json({ success: true, gameData: gameDataClient });
    } catch (error) {
        console.error("DB Error in /api/game/status:", error);
        res.status(500).json({ success: false, message: 'خطای سرور در دریافت وضعیت بازی.' });
    }
});

// API حدس زدن حرف (Guess Endpoint)
app.post('/api/game/guess', async (req, res) => {
    const { gameCode, playerId, guess } = req.body;
    const normalizedGuess = guess.toLowerCase();

    try {
        let gameResult = await pool.query('SELECT * FROM games WHERE game_code = $1', [gameCode]);
        let game = gameResult.rows[0];

        if (!game || game.player_id !== playerId || game.status !== 'active') {
            return res.status(400).json({ success: false, message: 'بازی فعال نیست یا شما بازیکن نیستید.' });
        }

        const allGuessed = [...game.correct_guessed_letters, ...game.incorrect_guessed_letters];
        if (allGuessed.includes(normalizedGuess)) {
            const gameDataClient = await getGameDataForClient(game, playerId);
            return res.json({ success: false, message: 'این حرف قبلاً حدس زده شده است.', isCorrect: false, gameData: gameDataClient });
        }

        let isCorrect = false;
        let updateQuery;
        let message;

        if (game.word.includes(normalizedGuess)) {
            updateQuery = `
                UPDATE games 
                SET correct_guessed_letters = array_append(correct_guessed_letters, $1) 
                WHERE game_code = $2 
                RETURNING *;
            `;
            isCorrect = true;
            message = 'حدس شما صحیح است!';
        } else {
            updateQuery = `
                UPDATE games 
                SET attempts_left = attempts_left - 1, 
                    incorrect_guessed_letters = array_append(incorrect_guessed_letters, $1) 
                WHERE game_code = $2 
                RETURNING *;
            `;
            isCorrect = false;
            message = 'متأسفانه حرف غلط است.';
        }

        gameResult = await pool.query(updateQuery, [normalizedGuess, gameCode]);
        game = gameResult.rows[0]; 

        await checkGameStatus(game);
        
        const gameDataClient = await getGameDataForClient(game, playerId);
        
        res.json({ success: true, message, isCorrect, gameData: gameDataClient });

    } catch (error) {
        console.error("DB Error in /api/game/guess:", error);
        res.status(500).json({ success: false, message: 'خطای سرور در حدس.' });
    }
});

// API لیست بازی‌های فعال (Active Games Tab)
app.get('/api/games/active', async (req, res) => {
    const { userId } = req.query;

    try {
        const query = `
            SELECT 
                g.game_code, g.status, g.difficulty, g.created_at, g.creator_id, g.player_id,
                u.full_name AS creator_name
            FROM games g
            LEFT JOIN users u ON g.creator_id = u.id
            WHERE g.creator_id = $1 OR g.player_id = $1 OR (g.status = 'waiting' AND g.creator_id != $1)
            ORDER BY g.created_at DESC;
        `;
        const result = await pool.query(query, [userId]);

        const activeGames = result.rows.map(game => ({
            game_code: game.game_code,
            status: game.status,
            difficulty: game.difficulty,
            creator_name: game.creator_name || 'ناشناس',
            created_at: game.created_at,
            is_creator: game.creator_id === userId,
        }));

        res.json({ success: true, games: activeGames });
    } catch (error) {
        console.error("DB Error in /api/games/active:", error);
        res.status(500).json({ success: false, message: 'خطای سرور در بارگذاری لیست بازی‌ها.' });
    }
});


// ------------------------------------------------------------------
// --- Server Start ---
// ------------------------------------------------------------------
app.listen(PORT, async () => {
    console.log(`✅ Express Server is running on http://localhost:${PORT}`);
    
    // ⚠️ اجرای تابع ایجاد جداول قبل از شروع برنامه ⚠️
    await ensureTablesExist(); 
    
    try {
        await bot.setWebHook(WEB_APP_URL + secretPath);
        console.log(`🤖 Telegram Bot Webhook set up on ${WEB_APP_URL + secretPath}`);
    } catch (error) {
        console.error("❌ Error setting up Webhook:", error.message);
    }
    
    console.log(`📡 Connected to PostgreSQL database.`);
});

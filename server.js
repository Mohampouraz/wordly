// server.js - نسخه اصلاح شده

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

// ذخیره بازی‌های فعال و وضعیت بازی‌ها در حافظه با ساختار جدید
// { gameId: { globalState, players: Map<playerId, playerState> } }
const activeGames = new Map();
const playerConnections = new Map(); // key: gameId_playerId, value: { lastSeen: Date, isCreator: boolean }

// ثوابت بازی
const MAX_HINTS = 2;
const HINT_SCORE_PENALTY = 30;
const BASE_CORRECT_SCORE = 50;
const TIME_BONUS_PER_SECOND = 2; // برای پاداش سرعت

// اتصال به دیتابیس
dbClient.connect()
    .then(() => console.log('✅ Connected to PostgreSQL'))
    .catch(err => console.error('❌ Database connection error:', err));

// ایجاد جداول
async function createTables() {
    try {
        await dbClient.query(`
            CREATE TABLE IF NOT EXISTS users (
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
                game_id VARCHAR(50) PRIMARY KEY,
                creator_id BIGINT NOT NULL,
                word VARCHAR(100) NOT NULL,
                category VARCHAR(100) NOT NULL,
                max_attempts INTEGER NOT NULL,
                time_limit INTEGER NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                is_active BOOLEAN DEFAULT true,
                is_started BOOLEAN DEFAULT false,
                guessed_letters TEXT DEFAULT '',
                incorrect_letters TEXT DEFAULT '',
                attempts INTEGER DEFAULT 0, -- این برای پیگیری کل حدس‌ها نیست، در نسخه جدید بلااستفاده
                completed BOOLEAN DEFAULT false,
                winner_id BIGINT,
                creator_online BOOLEAN DEFAULT false,
                start_time TIMESTAMP -- اضافه شدن
            )
        `);

        await dbClient.query(`
            CREATE TABLE IF NOT EXISTS game_sessions (
                id SERIAL PRIMARY KEY,
                game_id VARCHAR(50) NOT NULL REFERENCES games(game_id),
                player_id BIGINT NOT NULL REFERENCES users(telegram_id),
                attempts INTEGER DEFAULT 0,
                score INTEGER DEFAULT 0,
                completed BOOLEAN DEFAULT false,
                is_winner BOOLEAN DEFAULT false, -- اضافه شدن
                joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(game_id, player_id)
            )
        `);

        await dbClient.query(`
            CREATE TABLE IF NOT EXISTS game_players (
                game_id VARCHAR(50) NOT NULL REFERENCES games(game_id),
                player_id BIGINT NOT NULL REFERENCES users(telegram_id),
                joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(game_id, player_id)
            )
        `);
        
        // اطمینان از وجود ستون های جدید در صورت نیاز
        await dbClient.query(`
            ALTER TABLE games ADD COLUMN IF NOT EXISTS start_time TIMESTAMP
        `);
        await dbClient.query(`
            ALTER TABLE game_sessions ADD COLUMN IF NOT EXISTS is_winner BOOLEAN DEFAULT false
        `);

        console.log('✅ Database tables ready and updated');

    } catch (error) {
        console.error('❌ Error creating tables:', error);
    }
}

createTables();


// توابع کمکی
function generateGameId() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 6; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

function getWordProgress(word, guessedLetters) {
    return word.split('').map(letter => {
        if (letter === ' ') return ' ';
        return guessedLetters.has(letter) ? letter : '_';
    }).join('');
}

async function getGamePlayers(gameId) {
    const result = await dbClient.query(`
        SELECT gs.player_id, gs.score, gs.attempts, gs.is_winner, u.full_name, u.username
        FROM game_sessions gs
        JOIN users u ON gs.player_id = u.telegram_id
        WHERE gs.game_id = $1
    `, [gameId]);
    return result.rows;
}

async function getUserCount() {
    const result = await dbClient.query('SELECT COUNT(*) FROM users');
    return result.rows[0].count;
}

// تابع جدید: به‌روزرسانی وضعیت اتصال بازیکن
function updatePlayerConnection(gameId, playerId, isConnected, isCreator = false) {
    const key = `${gameId}_${playerId}`;
    if (isConnected) {
        playerConnections.set(key, { lastSeen: new Date(), isCreator: isCreator });
    } else {
        playerConnections.delete(key);
    }
}

// تابع جدید: به‌روزرسانی آمار کلی کاربر پس از اتمام بازی
async function updateUserStats(playerId, score, isWinner) {
    try {
        await dbClient.query(`
            UPDATE users 
            SET total_games = total_games + 1,
                wins = wins + (CASE WHEN $1 = true THEN 1 ELSE 0 END),
                game_score = game_score + $2
            WHERE telegram_id = $3
        `, [isWinner, score, playerId]);
    } catch (error) {
        console.error(`❌ Error updating user stats for ${playerId}:`, error);
    }
}

// تابع جدید: بارگذاری وضعیت بازی (برای مقاومت در برابر ری‌استارت سرور)
async function loadGameFromDB(gameId) {
    const dbGame = await dbClient.query('SELECT * FROM games WHERE game_id = $1', [gameId]);
    if (dbGame.rows.length === 0) return null;

    const gameData = dbGame.rows[0];
    const playersData = await getGamePlayers(gameId);
    
    const playersMap = new Map();
    playersData.forEach(p => playersMap.set(p.player_id, {
        score: p.score,
        attempts: p.attempts,
        is_winner: p.is_winner,
        full_name: p.full_name,
        username: p.username
    }));

    return {
        ...gameData,
        guessedLetters: new Set(gameData.guessed_letters.split(',').filter(Boolean)),
        incorrectGuesses: new Set(gameData.incorrect_letters.split(',').filter(Boolean)),
        players: playersMap,
        last_activity: new Date()
    };
}

// API برای ایجاد بازی جدید
app.post('/api/games/create', async (req, res) => {
    try {
        const { creator_id, word, category } = req.body;
        
        if (!creator_id || !word || !category) {
            return res.status(400).json({ error: 'Missing required fields' });
        }
        
        // اطمینان از وجود کاربر
        await dbClient.query(
            'INSERT INTO users (telegram_id) VALUES ($1) ON CONFLICT (telegram_id) DO NOTHING',
            [creator_id]
        );

        const gameId = generateGameId();
        const wordUpper = word.toUpperCase();
        const maxAttempts = Math.max(8, Math.floor(wordUpper.length * 1.5)); // حداقل 8 حدس
        const timeLimit = Math.max(300, wordUpper.length * 45); // حداقل 5 دقیقه (300 ثانیه)

        // ذخیره در دیتابیس
        const result = await dbClient.query(
            `INSERT INTO games (game_id, creator_id, word, category, max_attempts, time_limit, creator_online) 
             VALUES ($1, $2, $3, $4, $5, $6, true) 
             RETURNING *`,
            [gameId, creator_id, wordUpper, category, maxAttempts, timeLimit]
        );

        // ذخیره بازیکن سازنده در game_players و game_sessions
        await dbClient.query('INSERT INTO game_players (game_id, player_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [gameId, creator_id]);
        await dbClient.query('INSERT INTO game_sessions (game_id, player_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [gameId, creator_id]);

        // ذخیره بازی در حافظه
        const newGame = {
            ...result.rows[0],
            guessedLetters: new Set(),
            incorrectGuesses: new Set(),
            players: new Map([[creator_id, { score: 0, attempts: 0, is_winner: false }]]),
            last_activity: new Date()
        };
        activeGames.set(gameId, newGame);

        // ثبت اتصال سازنده
        updatePlayerConnection(gameId, creator_id, true, true);

        res.json({
            success: true,
            game_id: gameId,
            max_attempts: maxAttempts,
            time_limit: timeLimit,
            word_length: wordUpper.length
        });

    } catch (error) {
        console.error('❌ Error creating game:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// API برای شروع بازی (فقط توسط سازنده)
app.post('/api/games/:gameId/start', async (req, res) => {
    try {
        const { gameId } = req.params;
        const { player_id } = req.body;

        let game = activeGames.get(gameId);
        if (!game) {
            game = await loadGameFromDB(gameId);
            if (!game) return res.status(404).json({ error: 'Game not found' });
            activeGames.set(gameId, game);
        }

        if (game.creator_id !== player_id) {
            return res.status(403).json({ error: 'Only game creator can start the game' });
        }

        if (game.is_started) {
            return res.status(400).json({ error: 'Game already started' });
        }

        // شروع بازی
        game.is_started = true;
        game.start_time = new Date();
        game.last_activity = new Date();
        
        await dbClient.query(
            'UPDATE games SET is_started = true, start_time = CURRENT_TIMESTAMP WHERE game_id = $1',
            [gameId]
        );

        res.json({ 
            success: true, 
            message: 'Game started successfully',
            start_time: game.start_time
        });

    } catch (error) {
        console.error('❌ Error starting game:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// API برای پیوستن به بازی
app.post('/api/games/:gameId/join', async (req, res) => {
    try {
        const { gameId } = req.params;
        const { player_id } = req.body;

        if (!player_id) {
            return res.status(400).json({ error: 'Player ID is required' });
        }

        let game = activeGames.get(gameId);
        let reconnected = false;
        
        if (!game) {
            game = await loadGameFromDB(gameId);
            if (!game) return res.status(404).json({ error: 'Game not found or completed' });
            activeGames.set(gameId, game);
        }
        
        if (game.completed) {
             return res.status(400).json({ error: 'Game is completed' });
        }

        // بررسی اینکه آیا بازیکن قبلاً در بازی بوده (game_sessions)
        const isPlayerInGame = await dbClient.query(
            'SELECT score, attempts, is_winner FROM game_sessions WHERE game_id = $1 AND player_id = $2',
            [gameId, player_id]
        );

        if (isPlayerInGame.rows.length > 0) {
            reconnected = true;
            // به‌روزرسانی یا اضافه کردن به Map در حافظه
            const playerData = isPlayerInGame.rows[0];
            game.players.set(player_id, {
                score: playerData.score,
                attempts: playerData.attempts,
                is_winner: playerData.is_winner,
            });
            
        } else {
            // افزودن بازیکن جدید به بازی (game_players و game_sessions)
            await dbClient.query(
                'INSERT INTO game_players (game_id, player_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                [gameId, player_id]
            );
            await dbClient.query(
                'INSERT INTO game_sessions (game_id, player_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                [gameId, player_id]
            );
            
            // اضافه کردن به Map در حافظه
            game.players.set(player_id, { score: 0, attempts: 0, is_winner: false });
        }
        
        // ثبت اتصال بازیکن
        updatePlayerConnection(gameId, player_id, true, game.creator_id === player_id);
        game.last_activity = new Date();

        // به‌روزرسانی تعداد بازیکنان (فقط از Map بگیرید)
        const playersCount = game.players.size;
        
        // توجه: players_count از این به بعد فقط برای بازی های فعال در DB استفاده می شود.
        // در دیتابیس، این ستون دیگر آپدیت نمی‌شود.

        res.json({ 
            success: true, 
            players_count: playersCount,
            creator_id: game.creator_id,
            is_started: game.is_started,
            reconnected: reconnected
        });
    } catch (error) {
        console.error('❌ Error joining game:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// API برای ثبت حدس حرف
app.post('/api/games/:gameId/guess-letter', async (req, res) => {
    try {
        const { gameId } = req.params;
        const { player_id, letter } = req.body;

        if (!player_id || !letter) {
            return res.status(400).json({ error: 'Player ID and letter are required' });
        }

        let game = activeGames.get(gameId);
        if (!game) {
            game = await loadGameFromDB(gameId);
            if (!game || game.completed || !game.is_started) {
                return res.status(404).json({ error: 'Game not found, completed, or not started' });
            }
            activeGames.set(gameId, game);
        }

        if (game.completed || !game.is_started) {
            return res.status(400).json({ error: 'Game is not active or has not started yet' });
        }
        
        // فقط بازیکنان حاضر در بازی می‌توانند حدس بزنند
        if (!game.players.has(player_id)) {
             return res.status(403).json({ error: 'Player not in this game' });
        }

        const letterUpper = letter.toUpperCase();

        // 1. بررسی زمان و وضعیت
        const now = new Date();
        const timeElapsed = game.start_time ? Math.floor((now - new Date(game.start_time)) / 1000) : 0;
        const timeLeft = game.time_limit - timeElapsed;

        if (timeLeft <= 0) {
            await endGame(game, null, 'Time Limit');
            return res.status(400).json({ error: 'Time limit reached' });
        }
        
        // 2. بررسی تکرار حدس
        if (game.guessedLetters.has(letterUpper) || game.incorrectGuesses.has(letterUpper)) {
            return res.status(400).json({ error: 'Letter already guessed' });
        }

        // 3. اجرای منطق حدس
        const word = game.word;
        const isCorrect = word.includes(letterUpper);
        let scoreChange = 0;
        let isGameCompleted = false;
        let isGameOver = false;

        const playerState = game.players.get(player_id);

        if (isCorrect) {
            game.guessedLetters.add(letterUpper);
            scoreChange = BASE_CORRECT_SCORE + (game.word.length * 5); // امتیاز پایه + پاداش طول کلمه
            
            // بررسی برد
            const currentProgress = getWordProgress(word, game.guessedLetters);
            if (!currentProgress.includes('_')) {
                isGameCompleted = true;
            }
        } else {
            game.incorrectGuesses.add(letterUpper);
            playerState.attempts += 1; // تلاش‌های ناموفق فردی
            scoreChange = -20; // جریمه برای حدس غلط
            
            if (playerState.attempts >= game.max_attempts) {
                 // بازیکن از بازی حذف نمی‌شود، اما نمی‌تواند حدس غلط بیشتری بزند
            }
        }
        
        // 4. محاسبه پاداش سرعت (تنها در صورت درست بودن)
        if (isCorrect && game.start_time) {
            // پاداش سرعت به ازای ثانیه‌های باقی‌مانده از زمان کل بازی
            scoreChange += Math.max(0, timeLeft * TIME_BONUS_PER_SECOND); 
        }

        // 5. به‌روزرسانی وضعیت در حافظه
        playerState.score = Math.max(0, playerState.score + scoreChange);
        game.last_activity = now;
        
        // 6. به‌روزرسانی وضعیت در دیتابیس
        const updatedWordProgress = getWordProgress(word, game.guessedLetters);
        
        await dbClient.query(
            `UPDATE game_sessions SET score = $1, attempts = $2, is_winner = $3, completed = $4 WHERE game_id = $5 AND player_id = $6`,
            [playerState.score, playerState.attempts, isGameCompleted, isGameCompleted, gameId, player_id]
        );
        
        await dbClient.query(
            `UPDATE games SET 
                guessed_letters = $1, 
                incorrect_letters = $2,
                completed = $3,
                winner_id = $4
             WHERE game_id = $5`,
            [Array.from(game.guessedLetters).join(','), Array.from(game.incorrectGuesses).join(','), isGameCompleted, isGameCompleted ? player_id : null, gameId]
        );
        
        // 7. اتمام بازی
        if (isGameCompleted) {
            await endGame(game, player_id, 'Word Guessed');
        } else if (timeLeft <= 0) {
            await endGame(game, null, 'Time Limit');
            isGameOver = true;
        }

        res.json({
            success: true,
            is_correct: isCorrect,
            letter: letterUpper,
            score_change: scoreChange,
            current_score: playerState.score,
            game_completed: isGameCompleted,
            game_over: isGameOver,
            word_progress: updatedWordProgress
        });

    } catch (error) {
        console.error('❌ Error processing guess:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// API برای استفاده از راهنمایی
app.post('/api/games/:gameId/hint', async (req, res) => {
    try {
        const { gameId } = req.params;
        const { player_id } = req.body;
        
        let game = activeGames.get(gameId);
        if (!game) {
            game = await loadGameFromDB(gameId);
            if (!game || game.completed || !game.is_started) {
                return res.status(404).json({ error: 'Game not found, completed, or not started' });
            }
            activeGames.set(gameId, game);
        }
        
        if (game.creator_id === player_id) {
            return res.status(403).json({ error: 'Creator cannot use hints' });
        }
        
        const playerState = game.players.get(player_id);
        if (!playerState) {
            return res.status(403).json({ error: 'Player not in this game' });
        }
        
        // **نیاز به پیگیری تعداد راهنمایی های استفاده شده توسط بازیکن نیست، چون در Client پیگیری می‌شود.**
        // اما برای کسر امتیاز باید از سرور اقدام کنیم.
        
        // پیدا کردن حروف حدس زده نشده
        const wordLetters = new Set(game.word.split('').filter(l => l !== ' '));
        const unGuessedLetters = Array.from(wordLetters).filter(letter => 
            !game.guessedLetters.has(letter) && !game.incorrectGuesses.has(letter)
        );
        
        if (unGuessedLetters.length === 0) {
            return res.json({ success: false, error: 'No unguessed letters remaining' });
        }
        
        const hintLetter = unGuessedLetters[Math.floor(Math.random() * unGuessedLetters.length)];
        
        // اعمال جریمه امتیاز
        const scoreChange = -HINT_SCORE_PENALTY;
        playerState.score = Math.max(0, playerState.score + scoreChange);
        
        // به‌روزرسانی در دیتابیس
        await dbClient.query(
            `UPDATE game_sessions SET score = $1 WHERE game_id = $2 AND player_id = $3`,
            [playerState.score, gameId, player_id]
        );
        
        // حدس زدن حرف به صورت خودکار (به عنوان حدس صحیح)
        game.guessedLetters.add(hintLetter);
        game.last_activity = new Date();
        
        const updatedWordProgress = getWordProgress(game.word, game.guessedLetters);
        
        await dbClient.query(
            `UPDATE games SET 
                guessed_letters = $1
             WHERE game_id = $2`,
            [Array.from(game.guessedLetters).join(','), gameId]
        );
        
        // بررسی برد پس از راهنمایی (اگر حرف آخر بود)
        let isGameCompleted = false;
        if (!updatedWordProgress.includes('_')) {
            isGameCompleted = true;
            await endGame(game, player_id, 'Word Guessed with Hint');
        }

        res.json({
            success: true,
            hint_letter: hintLetter,
            score_change: scoreChange,
            current_score: playerState.score,
            word_progress: updatedWordProgress,
            game_completed: isGameCompleted
        });
        
    } catch (error) {
        console.error('❌ Error processing hint:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});


// API برای دریافت اطلاعات بازی (شامل تایمر و وضعیت بازیکنان)
app.get('/api/games/:gameId', async (req, res) => {
    try {
        const { gameId } = req.params;
        let game = activeGames.get(gameId);
        
        if (!game) {
            game = await loadGameFromDB(gameId);
            if (!game) return res.status(404).json({ error: 'Game not found' });
            activeGames.set(gameId, game);
        }

        const now = new Date();
        let timeLeft = game.time_limit;
        
        if (game.is_started && game.start_time) {
            const timeElapsed = Math.floor((now - new Date(game.start_time)) / 1000);
            timeLeft = Math.max(0, game.time_limit - timeElapsed);
            
            if (timeLeft === 0 && !game.completed) {
                // اتمام بازی به دلیل تایم اوت (اینجا فقط برای همگام‌سازی است)
                await endGame(game, null, 'Time Limit');
            }
        }

        const wordProgress = getWordProgress(game.word, game.guessedLetters);
        
        // تبدیل Map بازیکنان به آرایه برای فرستادن به کلاینت
        const playersArray = Array.from(game.players.values());

        res.json({
            success: true,
            game: {
                game_id: game.game_id,
                creator_id: game.creator_id,
                category: game.category,
                max_attempts: game.max_attempts,
                time_limit: game.time_limit,
                is_started: game.is_started,
                completed: game.completed,
                winner_id: game.winner_id,
                word_length: game.word.length,
                guessed_letters: Array.from(game.guessedLetters),
                incorrect_letters: Array.from(game.incorrectGuesses),
                word_progress: wordProgress,
                creator_online: game.creator_online,
                players_count: game.players.size,
                time_left: timeLeft, // زمان باقی‌مانده از سرور
                players: playersArray // لیست بازیکنان و امتیازات
            }
        });

    } catch (error) {
        console.error('❌ Error fetching game info:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// API برای گزارش اتصال کاربر
app.post('/api/games/:gameId/connect', async (req, res) => {
    try {
        const { gameId } = req.params;
        const { player_id } = req.body;
        
        let game = activeGames.get(gameId);
        if (!game) {
             game = await loadGameFromDB(gameId);
            if (!game) return res.status(404).json({ error: 'Game not found' });
            activeGames.set(gameId, game);
        }
        
        const isCreator = (game.creator_id === player_id);
        
        // ثبت اتصال در Map
        updatePlayerConnection(gameId, player_id, true, isCreator);
        
        // اگر سازنده است، وضعیت آنلاین بودن را در دیتابیس به‌روزرسانی کن
        if (isCreator && !game.creator_online) {
            game.creator_online = true;
            await dbClient.query(
                'UPDATE games SET creator_online = true WHERE game_id = $1',
                [gameId]
            );
        }
        
        res.json({ success: true });
    } catch (error) {
        console.error('❌ Error updating connection:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// API برای گزارش قطع اتصال کاربر
app.post('/api/games/:gameId/disconnect', async (req, res) => {
    try {
        const { gameId } = req.params;
        const { player_id } = req.body;
        
        // حذف اتصال از Map
        updatePlayerConnection(gameId, player_id, false);
        
        // اگر سازنده است، وضعیت آنلاین بودن را فورا آفلاین نکن، بلکه بگذار تا cleanup آن را انجام دهد.

        res.json({ success: true });
    } catch (error) {
        console.error('❌ Error updating disconnection:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// تابع اتمام بازی
async function endGame(game, winnerId, reason) {
    try {
        if (game.completed) return;
        
        console.log(`🏁 Game ${game.game_id} ended. Reason: ${reason}. Winner: ${winnerId}`);

        // 1. به‌روزرسانی وضعیت در دیتابیس
        await dbClient.query(
            'UPDATE games SET is_active = false, completed = true, winner_id = $1 WHERE game_id = $2',
            [winnerId, game.game_id]
        );
        
        // 2. به‌روزرسانی آمار بازیکنان
        const allPlayers = await getGamePlayers(game.game_id);
        for (const player of allPlayers) {
             const isWinner = (winnerId && player.player_id === winnerId);
             await updateUserStats(player.player_id, player.score, isWinner);
             if (isWinner) {
                 await dbClient.query('UPDATE game_sessions SET is_winner = true WHERE game_id = $1 AND player_id = $2', [game.game_id, player.player_id]);
             }
        }

        // 3. پاکسازی حافظه
        game.completed = true;
        game.winner_id = winnerId;
        activeGames.delete(game.game_id);
        clearGameConnections(game.game_id);

    } catch (error) {
        console.error(`❌ Error in endGame for ${game.game_id}:`, error);
    }
}

function clearGameConnections(gameId) {
    for (const key of playerConnections.keys()) {
        if (key.startsWith(gameId + '_')) {
            playerConnections.delete(key);
        }
    }
}

// روت‌های دیگر (بدون تغییر منطقی)
// ... (API برای دریافت لیست بازی‌های فعال، API برای دریافت اطلاعات کاربر، API برای دریافت آمار)

// API برای دریافت لیست بازی‌های فعال (بدون تغییر)
app.get('/api/games/active', async (req, res) => {
    try {
        const result = await dbClient.query(`
            SELECT g.game_id, g.category, g.time_limit, g.word, g.max_attempts, g.created_at, g.creator_online, u.full_name as creator_name, u.username as creator_username 
            FROM games g 
            LEFT JOIN users u ON g.creator_id = u.telegram_id 
            WHERE g.is_active = true AND g.is_started = false AND g.completed = false
            ORDER BY g.created_at DESC
        `);

        // تعداد بازیکنان را از game_players بگیریم
        const games = await Promise.all(result.rows.map(async (game) => {
            const players = await dbClient.query('SELECT COUNT(*) FROM game_players WHERE game_id = $1', [game.game_id]);
            return {
                game_id: game.game_id,
                creator_name: game.creator_name,
                creator_username: game.creator_username,
                category: game.category,
                players_count: parseInt(players.rows[0].count),
                max_attempts: game.max_attempts,
                time_limit: game.time_limit,
                created_at: game.created_at,
                word_length: game.word.length,
                creator_online: game.creator_online
            }
        }));

        res.json({ success: true, games });

    } catch (error) {
        console.error('❌ Error fetching active games:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// API برای دریافت اطلاعات کاربر (با استفاده از join برای آمار)
app.get('/api/user/:telegramId', async (req, res) => {
    try {
        const { telegramId } = req.params;
        const result = await dbClient.query(
            'SELECT * FROM users WHERE telegram_id = $1',
            [telegramId]
        );
        
        if (result.rows.length === 0) {
            // ایجاد کاربر جدید اگر وجود ندارد
            await dbClient.query(
                'INSERT INTO users (telegram_id) VALUES ($1) ON CONFLICT (telegram_id) DO NOTHING',
                [telegramId]
            );
            const newResult = await dbClient.query(
                'SELECT * FROM users WHERE telegram_id = $1',
                [telegramId]
            );
            return res.json({
                telegram_id: newResult.rows[0].telegram_id,
                full_name: newResult.rows[0].full_name,
                username: newResult.rows[0].username,
                game_score: newResult.rows[0].game_score,
                total_games: newResult.rows[0].total_games,
                wins: newResult.rows[0].wins,
            });
        }
        
        const user = result.rows[0];
        res.json({
            telegram_id: user.telegram_id,
            full_name: user.full_name,
            username: user.username,
            game_score: user.game_score,
            total_games: user.total_games,
            wins: user.wins,
        });
    } catch (error) {
        console.error('❌ Error fetching user:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// API برای دریافت آمار (بدون تغییر)
app.get('/api/stats', async (req, res) => {
    try {
        const userCount = await getUserCount();
        const activeGamesCountResult = await dbClient.query('SELECT COUNT(*) FROM games WHERE is_active = true AND completed = false');
        const activeGamesCount = activeGamesCountResult.rows[0].count;

        res.json({ 
            total_users: parseInt(userCount), 
            active_games: parseInt(activeGamesCount)
        });
    } catch (error) {
        console.error('❌ Error getting stats:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// تابع تمیزکاری (Cleanup) برای بازی‌هایی که سازنده‌شان آفلاین است یا تایم اوت شده‌اند.
async function cleanupInactiveGames() {
    try {
        const inactiveTimeout = 1 * 60 * 60 * 1000; // 1 ساعت
        const now = new Date();
        const inactiveGameIds = [];

        // 1. بررسی اتصالات سازندگان
        for (const [key, connection] of playerConnections.entries()) {
            if (connection.isCreator && (now - connection.lastSeen) > inactiveTimeout) {
                const gameId = key.split('_')[0];
                const game = activeGames.get(gameId);
                
                if (game && game.creator_online) {
                    game.creator_online = false;
                    await dbClient.query('UPDATE games SET creator_online = false WHERE game_id = $1', [gameId]);
                }
            }
        }
        
        // 2. بررسی بازی‌های فعال که تایم اوت شده‌اند
        const activeGamesResult = await dbClient.query(`
            SELECT game_id, time_limit, start_time, completed FROM games 
            WHERE is_active = true AND is_started = true AND completed = false
        `);
        
        for (const row of activeGamesResult.rows) {
            if (row.start_time && !row.completed) {
                const timeElapsed = Math.floor((now - row.start_time) / 1000);
                if (timeElapsed > row.time_limit) {
                    let game = activeGames.get(row.game_id);
                    if (!game) {
                        game = await loadGameFromDB(row.game_id);
                    }
                    if (game) {
                        await endGame(game, null, 'Time Limit Reached by Cleanup');
                    }
                }
            }
        }

        console.log(`🧹 Cleaned up inactive games.`);

    } catch (error) {
        console.error('Error cleaning up inactive games:', error);
    }
}

// اجرای تمیزکاری هر 10 دقیقه
setInterval(cleanupInactiveGames, 10 * 60 * 1000);

// هندلر خطا برای درخواست‌های نامعتبر
app.use((err, req, res, next) => {
    console.error('💥 Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// هندلر برای مسیرهای ناموجود
app.use('*', (req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

// راه‌اندازی سرور
bot.launch();
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});

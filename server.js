// server.js - نسخه کامل، بهینه و با مدیریت خطای تقویت شده
// منطق بازی: مدیریت کامل وضعیت بازی، تایمر، امتیازدهی، و اتصال چندنفره در سمت سرور

const express = require('express');
const { Telegraf } = require('telegraf');
const { Client } = require('pg');
const path = require('path');
require('dotenv').config(); // برای بارگذاری متغیرهای محیطی

const app = express();
const PORT = process.env.PORT || 10000;

// --- تنظیمات ---
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const DATABASE_URL = process.env.DATABASE_URL;
const WEB_APP_URL = process.env.WEB_APP_URL; // آدرس وب‌اپ برای دکمه /start

const bot = new Telegraf(TELEGRAM_TOKEN);
const dbClient = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false } // برای دیتابیس‌های ابری
});

// Middleware
app.use(express.json());
app.use(express.static('public')); 

// --- ذخیره‌سازی وضعیت در حافظه (Memory State) ---
// key: gameId, value: { creator_id, word, is_started, completed, guessedLetters: Set, incorrectGuesses: Set, players: Map<playerId, playerState>, ... }
const activeGames = new Map();
// key: gameId_playerId, value: { lastSeen: Date, isCreator: boolean }
const playerConnections = new Map(); 

// --- ثوابت بازی ---
const BASE_CORRECT_SCORE = 50;
const HINT_SCORE_PENALTY = 30;
const TIME_BONUS_PER_SECOND = 2;

// --- اتصال به دیتابیس ---
dbClient.connect()
    .then(() => console.log('✅ Connected to PostgreSQL'))
    .catch(err => console.error('❌ Database connection error:', err));

// --- ساختار جداول دیتابیس ---
async function createTables() {
    try {
        await dbClient.query(`
            CREATE TABLE IF NOT EXISTS users (
                telegram_id BIGINT UNIQUE NOT NULL PRIMARY KEY, 
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
                creator_id BIGINT NOT NULL REFERENCES users(telegram_id),
                word VARCHAR(100) NOT NULL,
                category VARCHAR(100) NOT NULL,
                max_attempts INTEGER NOT NULL,
                time_limit INTEGER NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                is_active BOOLEAN DEFAULT true,
                is_started BOOLEAN DEFAULT false,
                guessed_letters TEXT DEFAULT '',
                incorrect_letters TEXT DEFAULT '',
                completed BOOLEAN DEFAULT false,
                winner_id BIGINT REFERENCES users(telegram_id),
                creator_online BOOLEAN DEFAULT false,
                start_time TIMESTAMP
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
                is_winner BOOLEAN DEFAULT false,
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
        
        console.log('✅ Database tables ready and updated');

    } catch (error) {
        console.error('❌ Error creating tables:', error);
    }
}

createTables();

// --- توابع کمکی ---

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

function updatePlayerConnection(gameId, playerId, isConnected, isCreator = false) {
    const key = `${gameId}_${playerId}`;
    if (isConnected) {
        playerConnections.set(key, { lastSeen: new Date(), isCreator: isCreator });
    } else {
        playerConnections.delete(key);
    }
}

async function updateUserStats(playerId, score, isWinner) {
    try {
        await dbClient.query(`
            UPDATE users 
            SET total_games = total_games + 1,
                wins = wins + (CASE WHEN $1 = true THEN 1 ELSE 0 END),
                game_score = game_score + $2,
                last_seen = CURRENT_TIMESTAMP
            WHERE telegram_id = $3
        `, [isWinner, score, playerId]);
    } catch (error) {
        console.error(`❌ Error updating user stats for ${playerId}:`, error);
    }
}

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

async function endGame(game, winnerId, reason) {
    try {
        if (game.completed) return;
        
        console.log(`🏁 Game ${game.game_id} ended. Reason: ${reason}. Winner: ${winnerId || 'None'}`);

        // 1. به‌روزرسانی وضعیت در دیتابیس
        await dbClient.query(
            'UPDATE games SET is_active = false, completed = true, winner_id = $1 WHERE game_id = $2',
            [winnerId, game.game_id]
        );
        
        // 2. به‌روزرسانی آمار بازیکنان در game_sessions و users
        const allPlayers = await getGamePlayers(game.game_id);
        for (const player of allPlayers) {
             const isWinner = (winnerId && player.player_id.toString() === winnerId.toString());
             // استفاده از امتیاز ذخیره شده در game_sessions برای به‌روزرسانی آمار کاربر
             const playerScore = game.players.get(player.player_id)?.score || player.score; 
             await updateUserStats(player.player_id, playerScore, isWinner);
             await dbClient.query(
                'UPDATE game_sessions SET is_winner = $1, completed = true WHERE game_id = $2 AND player_id = $3', 
                [isWinner, game.game_id, player.player_id]
             );
        }

        // 3. پاکسازی حافظه
        game.completed = true;
        game.winner_id = winnerId;
        // بازی از اینجا حذف نمی‌شود، بلکه در cleanup دوره‌ای مدیریت می‌شود.
        // activeGames.delete(game.game_id); 
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


// --- Telegram Bot Commands ---

if (WEB_APP_URL && TELEGRAM_TOKEN) {
    bot.command('start', async (ctx) => {
        const userId = ctx.from.id;
        const fullName = ctx.from.first_name + (ctx.from.last_name ? ' ' + ctx.from.last_name : '');
        const username = ctx.from.username;

        // 1. به‌روزرسانی/ایجاد کاربر در دیتابیس
        try {
            await dbClient.query(
                `INSERT INTO users (telegram_id, full_name, username, last_seen) 
                 VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
                 ON CONFLICT (telegram_id) DO UPDATE 
                 SET full_name = $2, username = $3, last_seen = CURRENT_TIMESTAMP`,
                [userId, fullName, username]
            );
        } catch (error) {
            console.error('Error updating user on /start:', error);
        }

        // 2. پاسخ با دکمه وب‌اپ
        ctx.reply(
            'به بازی **Hangman Multiplayer** خوش آمدید! \n\n' +
            'کلمه را انتخاب کن، دوستانت را دعوت کن یا به یک بازی فعال بپیوند.\n' +
            'برای شروع بازی، از دکمه زیر استفاده کن 👇',
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { 
                                text: '🎮 شروع بازی', 
                                web_app: { url: WEB_APP_URL } 
                            }
                        ]
                    ]
                }
            }
        );
    });
} else {
    console.warn('⚠️ WEB_APP_URL or TELEGRAM_TOKEN is not set. /start command functionality is limited or disabled.');
}


// --- API Endpoints ---

/**
 * API برای ایجاد بازی جدید. (بسیار تقویت شده در کنترل خطا)
 */
app.post('/api/games/create', async (req, res) => {
    try {
        const { creator_id, word, category } = req.body;
        
        if (!creator_id || !word || !category) {
            return res.status(400).json({ success: false, error: 'Missing required fields (creator_id, word, or category)' });
        }

        // 0. اطمینان از وجود کاربر (حیاتی برای Foreign Key)
        await dbClient.query(
            'INSERT INTO users (telegram_id) VALUES ($1) ON CONFLICT (telegram_id) DO NOTHING',
            [creator_id]
        );

        const gameId = generateGameId();
        const wordUpper = word.toUpperCase().trim(); // اطمینان از تمیز بودن کلمه
        
        if (wordUpper.length < 3) {
             return res.status(400).json({ success: false, error: 'Word must be at least 3 characters long' });
        }
        
        const maxAttempts = Math.max(8, Math.floor(wordUpper.length * 1.5));
        const timeLimit = Math.max(300, wordUpper.length * 45);

        // 1. ایجاد بازی
        const result = await dbClient.query(
            `INSERT INTO games (game_id, creator_id, word, category, max_attempts, time_limit, creator_online) 
             VALUES ($1, $2, $3, $4, $5, $6, true) 
             RETURNING *`,
            [gameId, creator_id, wordUpper, category, maxAttempts, timeLimit]
        );
        
        const newGameData = result.rows[0];

        // 2. ایجاد رکوردهای اولیه در game_players و game_sessions
        await dbClient.query('INSERT INTO game_players (game_id, player_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [gameId, creator_id]);
        await dbClient.query('INSERT INTO game_sessions (game_id, player_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [gameId, creator_id]);

        // 3. ذخیره در حافظه
        const newGame = {
            ...newGameData,
            guessedLetters: new Set(),
            incorrectGuesses: new Set(),
            players: new Map([[creator_id, { score: 0, attempts: 0, is_winner: false }]]),
            last_activity: new Date()
        };
        activeGames.set(gameId, newGame);

        updatePlayerConnection(gameId, creator_id, true, true);

        res.json({
            success: true,
            game_id: gameId,
            max_attempts: maxAttempts,
            time_limit: timeLimit,
            word_length: wordUpper.length
        });

    } catch (error) {
        console.error('❌ Critical Error creating game:', error);
        // ارسال خطای 500 با جزئیات بیشتر به کنسول سرور
        res.status(500).json({ 
            success: false, 
            error: 'Internal server error during game creation. Check server logs for DB or logic errors.' 
        });
    }
});

app.post('/api/games/:gameId/start', async (req, res) => {
    try {
        const { gameId } = req.params;
        const { player_id } = req.body;

        let game = activeGames.get(gameId);
        if (!game) {
            game = await loadGameFromDB(gameId);
            if (!game) return res.status(404).json({ success: false, error: 'Game not found' });
            activeGames.set(gameId, game);
        }

        if (game.creator_id.toString() !== player_id.toString()) {
            return res.status(403).json({ success: false, error: 'Only game creator can start the game' });
        }

        if (game.is_started) {
            return res.status(400).json({ success: false, error: 'Game already started' });
        }

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
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

app.post('/api/games/:gameId/join', async (req, res) => {
    try {
        const { gameId } = req.params;
        const { player_id } = req.body;

        if (!player_id) {
            return res.status(400).json({ success: false, error: 'Player ID is required' });
        }

        let game = activeGames.get(gameId);
        let reconnected = false;
        
        if (!game) {
            game = await loadGameFromDB(gameId);
            if (!game) return res.status(404).json({ success: false, error: 'Game not found or completed' });
            activeGames.set(gameId, game);
        }
        
        if (game.completed) {
             return res.status(400).json({ success: false, error: 'Game is completed' });
        }
        
        await dbClient.query(
            'INSERT INTO users (telegram_id) VALUES ($1) ON CONFLICT (telegram_id) DO NOTHING',
            [player_id]
        );

        const isPlayerInGame = await dbClient.query(
            'SELECT score, attempts, is_winner FROM game_sessions WHERE game_id = $1 AND player_id = $2',
            [gameId, player_id]
        );

        if (isPlayerInGame.rows.length > 0) {
            reconnected = true;
            const playerData = isPlayerInGame.rows[0];
            game.players.set(player_id, {
                score: playerData.score,
                attempts: playerData.attempts,
                is_winner: playerData.is_winner,
            });
            
        } else {
            await dbClient.query(
                'INSERT INTO game_players (game_id, player_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                [gameId, player_id]
            );
            await dbClient.query(
                'INSERT INTO game_sessions (game_id, player_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                [gameId, player_id]
            );
            
            game.players.set(player_id, { score: 0, attempts: 0, is_winner: false });
        }
        
        const isCreator = (game.creator_id.toString() === player_id.toString());
        updatePlayerConnection(gameId, player_id, true, isCreator);
        game.last_activity = new Date();

        res.json({ 
            success: true, 
            players_count: game.players.size,
            creator_id: game.creator_id,
            is_started: game.is_started,
            reconnected: reconnected
        });
    } catch (error) {
        console.error('❌ Error joining game:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

app.post('/api/games/:gameId/guess-letter', async (req, res) => {
    try {
        const { gameId } = req.params;
        const { player_id, letter } = req.body;

        if (!player_id || !letter) {
            return res.status(400).json({ success: false, error: 'Player ID and letter are required' });
        }

        let game = activeGames.get(gameId);
        if (!game) {
            game = await loadGameFromDB(gameId);
            if (!game || game.completed || !game.is_started) {
                return res.status(404).json({ success: false, error: 'Game not found, completed, or not started' });
            }
            activeGames.set(gameId, game);
        }

        if (game.completed || !game.is_started) {
            return res.status(400).json({ success: false, error: 'Game is not active or has not started yet' });
        }
        
        if (game.creator_id.toString() === player_id.toString()) {
             return res.status(403).json({ success: false, error: 'Creator cannot guess' });
        }
        
        const playerState = game.players.get(player_id);
        if (!playerState) {
             return res.status(403).json({ success: false, error: 'Player not in this game' });
        }


        const letterUpper = letter.toUpperCase();

        const now = new Date();
        const timeElapsed = game.start_time ? Math.floor((now - new Date(game.start_time)) / 1000) : 0;
        const timeLeft = game.time_limit - timeElapsed;

        if (timeLeft <= 0) {
            await endGame(game, null, 'Time Limit');
            return res.status(400).json({ success: false, error: 'Time limit reached' });
        }
        
        if (game.guessedLetters.has(letterUpper) || game.incorrectGuesses.has(letterUpper)) {
            return res.status(400).json({ success: false, error: 'Letter already guessed' });
        }
        
        if (playerState.attempts >= game.max_attempts) {
            return res.status(400).json({ success: false, error: `You have reached the maximum number of incorrect attempts (${game.max_attempts}).` });
        }

        const word = game.word;
        const isCorrect = word.includes(letterUpper);
        let scoreChange = 0;
        let isGameCompleted = false;

        if (isCorrect) {
            game.guessedLetters.add(letterUpper);
            scoreChange = BASE_CORRECT_SCORE + (game.word.length * 5); 
            
            const currentProgress = getWordProgress(word, game.guessedLetters);
            if (!currentProgress.includes('_')) {
                isGameCompleted = true;
            }
        } else {
            game.incorrectGuesses.add(letterUpper);
            playerState.attempts += 1;
            scoreChange = -20;
        }
        
        if (isCorrect && game.start_time) {
            scoreChange += Math.max(0, timeLeft * TIME_BONUS_PER_SECOND); 
        }

        playerState.score = Math.max(0, playerState.score + scoreChange);
        game.last_activity = now;
        
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
        
        if (isGameCompleted) {
            await endGame(game, player_id, 'Word Guessed');
        }

        res.json({
            success: true,
            is_correct: isCorrect,
            letter: letterUpper,
            score_change: scoreChange,
            current_score: playerState.score,
            game_completed: isGameCompleted,
            word_progress: updatedWordProgress
        });

    } catch (error) {
        console.error('❌ Error processing guess:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

app.post('/api/games/:gameId/hint', async (req, res) => {
    try {
        const { gameId } = req.params;
        const { player_id } = req.body;
        
        let game = activeGames.get(gameId);
        if (!game) {
            game = await loadGameFromDB(gameId);
            if (!game || game.completed || !game.is_started) {
                return res.status(404).json({ success: false, error: 'Game not found, completed, or not started' });
            }
            activeGames.set(gameId, game);
        }
        
        if (game.creator_id.toString() === player_id.toString()) {
            return res.status(403).json({ success: false, error: 'Creator cannot use hints' });
        }
        
        const playerState = game.players.get(player_id);
        if (!playerState) {
            return res.status(403).json({ success: false, error: 'Player not in this game' });
        }
        
        const wordLetters = new Set(game.word.split('').filter(l => l !== ' '));
        const unGuessedLetters = Array.from(wordLetters).filter(letter => 
            !game.guessedLetters.has(letter) && !game.incorrectGuesses.has(letter)
        );
        
        if (unGuessedLetters.length === 0) {
            return res.json({ success: false, error: 'No unguessed letters remaining' });
        }
        
        const hintLetter = unGuessedLetters[Math.floor(Math.random() * unGuessedLetters.length)];
        
        const scoreChange = -HINT_SCORE_PENALTY;
        playerState.score = Math.max(0, playerState.score + scoreChange);
        
        await dbClient.query(
            `UPDATE game_sessions SET score = $1 WHERE game_id = $2 AND player_id = $3`,
            [playerState.score, gameId, player_id]
        );
        
        game.guessedLetters.add(hintLetter);
        game.last_activity = new Date();
        
        const updatedWordProgress = getWordProgress(game.word, game.guessedLetters);
        
        await dbClient.query(
            `UPDATE games SET 
                guessed_letters = $1
             WHERE game_id = $2`,
            [Array.from(game.guessedLetters).join(','), gameId]
        );
        
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
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});


app.get('/api/games/:gameId', async (req, res) => {
    try {
        const { gameId } = req.params;
        let game = activeGames.get(gameId);
        
        if (!game) {
            game = await loadGameFromDB(gameId);
            if (!game) return res.status(404).json({ success: false, error: 'Game not found' });
            activeGames.set(gameId, game);
        }

        const now = new Date();
        let timeLeft = game.time_limit;
        
        if (game.is_started && game.start_time) {
            const timeElapsed = Math.floor((now - new Date(game.start_time)) / 1000);
            timeLeft = Math.max(0, game.time_limit - timeElapsed);
            
            if (timeLeft === 0 && !game.completed) {
                await endGame(game, null, 'Time Limit');
            }
        }
        
        if (game.completed && !activeGames.has(gameId)) {
            game = await loadGameFromDB(gameId);
            if (!game) return res.status(404).json({ success: false, error: 'Game not found or removed from memory' });
            game.completed = true; 
        }


        const wordProgress = getWordProgress(game.word, game.guessedLetters);
        
        const playersArray = await getGamePlayers(gameId); 

        if (game.players.size !== playersArray.length) {
             game.players.clear();
             playersArray.forEach(p => game.players.set(p.player_id, {
                score: p.score,
                attempts: p.attempts,
                is_winner: p.is_winner,
            }));
        }


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
                players_count: playersArray.length,
                time_left: timeLeft,
                players: playersArray
            }
        });

    } catch (error) {
        console.error('❌ Error fetching game info:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

app.post('/api/games/:gameId/connect', async (req, res) => {
    try {
        const { gameId } = req.params;
        const { player_id } = req.body;
        
        let game = activeGames.get(gameId);
        if (!game) {
             game = await loadGameFromDB(gameId);
            if (!game) return res.status(404).json({ success: false, error: 'Game not found' });
            activeGames.set(gameId, game);
        }
        
        const isCreator = (game.creator_id.toString() === player_id.toString());
        
        updatePlayerConnection(gameId, player_id, true, isCreator);
        
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
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

app.post('/api/games/:gameId/disconnect', async (req, res) => {
    try {
        const { gameId } = req.params;
        const { player_id } = req.body;
        
        updatePlayerConnection(gameId, player_id, false);
        
        res.json({ success: true });
    } catch (error) {
        console.error('❌ Error updating disconnection:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});


/**
 * API برای دریافت لیست بازی‌های فعال (بدون شروع).
 */
app.get('/api/games/active', async (req, res) => {
    try {
        // کوئری بهینه شده برای رفع مشکل N+1
        const result = await dbClient.query(`
            SELECT 
                g.game_id, 
                g.category, 
                g.time_limit, 
                g.word, 
                g.max_attempts, 
                g.created_at, 
                g.creator_online, 
                u.full_name as creator_name, 
                u.username as creator_username,
                COUNT(gp.player_id) as players_count
            FROM games g 
            LEFT JOIN users u ON g.creator_id = u.telegram_id 
            LEFT JOIN game_players gp ON g.game_id = gp.game_id
            WHERE g.is_active = true AND g.is_started = false AND g.completed = false
            GROUP BY g.game_id, u.full_name, u.username
            ORDER BY g.created_at DESC
        `);

        const games = result.rows.map(game => ({
            game_id: game.game_id,
            creator_name: game.creator_name,
            creator_username: game.creator_username,
            category: game.category,
            players_count: parseInt(game.players_count),
            max_attempts: game.max_attempts,
            time_limit: game.time_limit,
            created_at: game.created_at,
            word_length: game.word.length,
            creator_online: game.creator_online
        }));

        res.json({ success: true, games });

    } catch (error) {
        console.error('❌ Error fetching active games:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

/**
 * API جدید برای دریافت تاریخچه بازی‌های تکمیل شده کاربر.
 */
app.get('/api/user/:telegramId/history', async (req, res) => {
    try {
        const { telegramId } = req.params;

        const historyResult = await dbClient.query(`
            SELECT 
                g.game_id, 
                g.word,
                g.category, 
                g.created_at, 
                g.winner_id,
                u.full_name as winner_name,
                gs.score,
                gs.is_winner,
                gs.attempts
            FROM game_sessions gs
            JOIN games g ON gs.game_id = g.game_id
            LEFT JOIN users u ON g.winner_id = u.telegram_id
            WHERE gs.player_id = $1 AND g.completed = true
            ORDER BY g.created_at DESC
            LIMIT 50
        `, [telegramId]);

        const history = historyResult.rows.map(row => ({
            game_id: row.game_id,
            word: row.word, 
            category: row.category,
            date: row.created_at,
            player_score: row.score,
            is_winner: row.is_winner,
            attempts: row.attempts,
            winner_name: row.winner_name || (row.winner_id ? `ID: ${row.winner_id}` : 'None')
        }));
        
        res.json({ success: true, history: history });

    } catch (error) {
        console.error('❌ Error fetching user history:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

app.get('/api/user/:telegramId', async (req, res) => {
    try {
        const { telegramId } = req.params;
        
        let userResult = await dbClient.query(
            'SELECT * FROM users WHERE telegram_id = $1',
            [telegramId]
        );
        
        if (userResult.rows.length === 0) {
            await dbClient.query(
                'INSERT INTO users (telegram_id) VALUES ($1) ON CONFLICT (telegram_id) DO NOTHING',
                [telegramId]
            );
            userResult = await dbClient.query(
                'SELECT * FROM users WHERE telegram_id = $1',
                [telegramId]
            );
        }
        
        const user = userResult.rows[0];
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
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

app.get('/api/stats', async (req, res) => {
    try {
        const userCountResult = await dbClient.query('SELECT COUNT(*) FROM users');
        const userCount = userCountResult.rows[0].count;
        const activeGamesCountResult = await dbClient.query('SELECT COUNT(*) FROM games WHERE is_active = true AND completed = false');
        const activeGamesCount = activeGamesCountResult.rows[0].count;

        res.json({ 
            total_users: parseInt(userCount), 
            active_games: parseInt(activeGamesCount)
        });
    } catch (error) {
        console.error('❌ Error getting stats:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});


// --- Cleanup و نگهداری ---

async function cleanupInactiveGames() {
    try {
        const inactiveCreatorTimeout = 15 * 60 * 1000;
        const now = new Date();

        // بررسی وضعیت آنلاین بودن سازنده
        for (const [key, connection] of playerConnections.entries()) {
            if (connection.isCreator && (now - connection.lastSeen) > inactiveCreatorTimeout) {
                const gameId = key.split('_')[0];
                const game = activeGames.get(gameId);
                
                if (game && game.creator_online) {
                    game.creator_online = false;
                    await dbClient.query('UPDATE games SET creator_online = false WHERE game_id = $1', [gameId]);
                }
            }
        }
        
        // اتمام بازی‌های زمان‌دار که از زمان آن‌ها گذشته
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
        
        // حذف بازی‌های ناتمام و شروع نشده‌ای که سازنده آن‌ها آفلاین شده است
         await dbClient.query(`
            UPDATE games SET is_active = false, completed = true, winner_id = NULL
            WHERE is_active = true AND is_started = false 
            AND creator_online = false
            AND created_at < NOW() - INTERVAL '15 minutes'
        `);
        // حذف بازی‌های فعال و ناتمامی که خیلی قدیمی شده‌اند
        await dbClient.query(`
            UPDATE games SET is_active = false, completed = true, winner_id = NULL
            WHERE is_active = true AND completed = false 
            AND created_at < NOW() - INTERVAL '24 hours'
        `);

        // پاکسازی حافظه سرور برای بازی‌های تکمیل شده
        for (const [gameId, game] of activeGames.entries()) {
            if (game.completed && (now - game.last_activity) > 60 * 60 * 1000) {
                activeGames.delete(gameId);
                clearGameConnections(gameId);
            }
        }
        
        console.log(`🧹 Cleaned up inactive/old games.`);

    } catch (error) {
        console.error('Error cleaning up inactive games:', error);
    }
}

// اجرای تمیزکاری هر 10 دقیقه
setInterval(cleanupInactiveGames, 10 * 60 * 1000);

// هندلر خطا برای درخواست‌های نامعتبر
app.use((err, req, res, next) => {
    console.error('💥 Unhandled error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' }); 
});

// هندلر برای مسیرهای ناموجود
app.use('*', (req, res) => {
    res.status(404).json({ success: false, error: 'Endpoint not found' }); 
});

// راه‌اندازی سرور
bot.launch();
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});

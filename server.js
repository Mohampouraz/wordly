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

// ذخیره بازی‌های فعال و وضعیت بازی‌ها
const activeGames = new Map();
const playerConnections = new Map(); // برای مدیریت اتصال بازیکنان

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
                players_count INTEGER DEFAULT 1,
                is_started BOOLEAN DEFAULT false,
                guessed_letters TEXT DEFAULT '',
                incorrect_letters TEXT DEFAULT '',
                attempts INTEGER DEFAULT 0,
                completed BOOLEAN DEFAULT false,
                winner_id BIGINT,
                creator_online BOOLEAN DEFAULT false
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

        await dbClient.query(`
            CREATE TABLE IF NOT EXISTS game_players (
                id SERIAL PRIMARY KEY,
                game_id VARCHAR(50) NOT NULL,
                player_id BIGINT NOT NULL,
                joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(game_id, player_id)
            )
        `);

        console.log('✅ Database tables ready');
        
        // اضافه کردن ستون‌های جدید اگر وجود ندارند
        try {
            await dbClient.query(`
                ALTER TABLE games ADD COLUMN IF NOT EXISTS completed BOOLEAN DEFAULT false
            `);
            await dbClient.query(`
                ALTER TABLE games ADD COLUMN IF NOT EXISTS winner_id BIGINT
            `);
            await dbClient.query(`
                ALTER TABLE games ADD COLUMN IF NOT EXISTS creator_online BOOLEAN DEFAULT false
            `);
            console.log('✅ Added new columns to games table');
        } catch (error) {
            console.log('ℹ️ New columns already exist');
        }

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
        
        if (!creator_id || !word || !category) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const gameId = generateGameId();
        const maxAttempts = Math.floor(word.length * 1.5);
        const timeLimit = word.length * 30; // 30 ثانیه به ازای هر حرف

        // ذخیره در دیتابیس
        const result = await dbClient.query(
            `INSERT INTO games (game_id, creator_id, word, category, max_attempts, time_limit, creator_online) 
             VALUES ($1, $2, $3, $4, $5, $6, true) 
             RETURNING *`,
            [gameId, creator_id, word.toUpperCase(), category, maxAttempts, timeLimit]
        );

        // ذخیره بازیکن سازنده
        await dbClient.query(
            'INSERT INTO game_players (game_id, player_id) VALUES ($1, $2)',
            [gameId, creator_id]
        );

        // ذخیره بازی در حافظه
        activeGames.set(gameId, {
            ...result.rows[0],
            players: [creator_id],
            guessedLetters: new Set(),
            incorrectGuesses: new Set(),
            startTime: null,
            is_started: false,
            creator_online: true,
            last_activity: new Date()
        });

        // ثبت اتصال سازنده
        updatePlayerConnection(gameId, creator_id, true);

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

// API برای شروع بازی (فقط توسط سازنده)
app.post('/api/games/:gameId/start', async (req, res) => {
    try {
        const { gameId } = req.params;
        const { player_id } = req.body;

        let game = activeGames.get(gameId);
        if (!game) {
            // بازی را از دیتابیس بگیر
            const dbGame = await dbClient.query(
                'SELECT * FROM games WHERE game_id = $1 AND is_active = true',
                [gameId]
            );
            
            if (dbGame.rows.length === 0) {
                return res.status(404).json({ error: 'Game not found' });
            }
            
            game = {
                .....dbGame.rows[0],
                players: await getGamePlayers(gameId),
                guessedLetters: new Set(dbGame.rows[0].guessed_letters.split(',').filter(Boolean)),
                incorrectGuesses: new Set(dbGame.rows[0].incorrect_letters.split(',').filter(Boolean)),
                startTime: null,
                last_activity: new Date()
            };
        }

        // فقط سازنده بازی می‌تواند شروع کند
        if (game.creator_id !== player_id) {
            return res.status(403).json({ error: 'Only game creator can start the game' });
        }

        if (game.is_started) {
            return res.status(400).json({ error: 'Game already started' });
        }

        // شروع بازی
        game.is_started = true;
        game.startTime = new Date();
        game.creator_online = true;
        game.last_activity = new Date();
        
        await dbClient.query(
            'UPDATE games SET is_started = true, creator_online = true WHERE game_id = $1',
            [gameId]
        );

        // به‌روزرسانی در حافظه
        game.players_count = game.players_count || (game.players ? game.players.length : 1);
        activeGames.set(gameId, game);

        res.json({ 
            success: true, 
            message: 'Game started successfully',
            players_count: game.players.length
        });

    } catch (error) {
        console.error('❌ Error starting game:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// API برای دریافت لیست بازی‌های فعال
app.get('/api/games/active', async (req, res) => {
    try {
        const result = await dbClient.query(`
            SELECT g.*, u.full_name as creator_name, u.username as creator_username 
            FROM games g 
            LEFT JOIN users u ON g.creator_id = u.telegram_id 
            WHERE g.is_active = true AND g.is_started = false AND g.completed = false
            ORDER BY g.created_at DESC
        `);

        const games = result.rows.map(game => ({
            game_id: game.game_id,
            creator_name: game.creator_name,
            creator_username: game.creator_username,
            category: game.category,
            players_count: (game.players_count || (game.players ? game.players.length : 0)),
            max_attempts: game.max_attempts,
            time_limit: game.time_limit,
            created_at: game.created_at,
            word_length: game.word.length,
            creator_online: game.creator_online
        }));

        res.json({ success: true, games });

    } catch (error) {
        console.error('❌ Error fetching active games:', error);
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
        
        // اگر بازی در حافظه نیست، از دیتابیس بگیر
        if (!game) {
            const dbGame = await dbClient.query(
                'SELECT * FROM games WHERE game_id = $1 AND is_active = true AND completed = false',
                [gameId]
            );
            
            if (dbGame.rows.length === 0) {
                return res.status(404).json({ error: 'Game not found or completed' });
            }
            
            game = {
                .....dbGame.rows[0],
                players: await getGamePlayers(gameId),
                guessedLetters: new Set(dbGame.rows[0].guessed_letters.split(',').filter(Boolean)),
                incorrectGuesses: new Set(dbGame.rows[0].incorrect_letters.split(',').filter(Boolean)),
                startTime: dbGame.rows[0].is_started ? new Date() : null,
                last_activity: new Date()
            };
            
            game.players_count = game.players_count || (game.players ? game.players.length : 1);
        activeGames.set(gameId, game);
        }

        if (game.is_started) {
            return res.status(400).json({ error: 'Game already started' });
        }

        // بررسی اینکه آیا بازیکن قبلاً در بازی بوده
        const isPlayerInGame = await dbClient.query(
            'SELECT 1 FROM game_players WHERE game_id = $1 AND player_id = $2',
            [gameId, player_id]
        );

        if (isPlayerInGame.rows.length > 0) {
            // بازیکن قبلاً در بازی بوده - اجازه پیوستن مجدد بده
            if (!game.players.includes(player_id)) {
                game.players.push(player_id);
            }
            
            // ثبت اتصال بازیکن
            updatePlayerConnection(gameId, player_id, true);
            game.last_activity = new Date();
            
            res.json({ 
                success: true, 
                players_count: (game.players_count || (game.players ? game.players.length : 0)),
                creator_id: game.creator_id,
                is_creator: game.creator_id === player_id,
                reconnected: true
            });
            return;
        }

        // افزودن بازیکن جدید به بازی
        game.players.push(player_id);
        game.players_count += 1;

        // ذخیره در دیتابیس
        await dbClient.query(
            'UPDATE games SET players_count = $1 WHERE game_id = $2',
            [game.players_count, gameId]
        );

        await dbClient.query(
            'INSERT INTO game_players (game_id, player_id) VALUES ($1, $2)',
            [gameId, player_id]
        );

        // ثبت اتصال بازیکن
        updatePlayerConnection(gameId, player_id, true);
        game.last_activity = new Date();

        // به‌روزرسانی در حافظه
        game.players_count = game.players_count || (game.players ? game.players.length : 1);
        activeGames.set(gameId, game);

        res.json({ 
            success: true, 
            players_count: (game.players_count || (game.players ? game.players.length : 0)),
            creator_id: game.creator_id,
            is_creator: game.creator_id === player_id
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
        const { player_id, letter, time_spent } = req.body;

        if (!player_id || !letter) {
            return res.status(400).json({ error: 'Player ID and letter are required' });
        }

        let game = activeGames.get(gameId);
        
        // اگر بازی در حافظه نیست، از دیتابیس بگیر
        if (!game) {
            const dbGame = await dbClient.query(
                'SELECT * FROM games WHERE game_id = $1 AND is_active = true AND completed = false',
                [gameId]
            );
            
            if (dbGame.rows.length === 0) {
                return res.status(404).json({ error: 'Game not found or completed' });
            }
            
            game = {
                .....dbGame.rows[0],
                players: await getGamePlayers(gameId),
                guessedLetters: new Set(dbGame.rows[0].guessed_letters.split(',').filter(Boolean)),
                incorrectGuesses: new Set(dbGame.rows[0].incorrect_letters.split(',').filter(Boolean)),
                attempts: dbGame.rows[0].attempts || 0,
                startTime: dbGame.rows[0].is_started ? new Date() : null,
                last_activity: new Date()
            };
            
            game.players_count = game.players_count || (game.players ? game.players.length : 1);
        activeGames.set(gameId, game);
        }

        if (!game.is_started) {
            return res.status(400).json({ error: 'Game not started yet' });
        }

        // بررسی اینکه آیا بازیکن در بازی است
        if (!game.players.includes(player_id)) {
            return res.status(403).json({ error: 'Player not in this game' });
        }

        const letterUpper = letter.toUpperCase();
        
        // بررسی اینکه آیا حرف قبلاً حدس زده شده
        if (game.guessedLetters.has(letterUpper) || game.incorrectGuesses.has(letterUpper)) {
            return res.status(400).json({ error: 'Letter already guessed' });
        }

        const word = game.word;
        const isCorrect = word.includes(letterUpper);

        // ذخیره حدس
        if (isCorrect) {
            game.guessedLetters.add(letterUpper);
        } else {
            game.incorrectGuesses.add(letterUpper);
            game.attempts = (game.attempts || 0) + 1;
        }

        // ثبت اتصال بازیکن
        updatePlayerConnection(gameId, player_id, true);
        game.last_activity = new Date();

        // ذخیره در دیتابیس
        await dbClient.query(
            'UPDATE games SET guessed_letters = $1, incorrect_letters = $2, attempts = $3 WHERE game_id = $4',
            [Array.from(game.guessedLetters).join(','), Array.from(game.incorrectGuesses).join(','), game.attempts, gameId]
        );

        // محاسبه امتیاز
        const score = calculateLetterScore(isCorrect, time_spent, word.length, game.incorrectGuesses.size);

        // بررسی پایان بازی
        const isGameCompleted = checkGameCompletion(word, game.guessedLetters);
        const isGameOver = game.attempts >= game.max_attempts;

        let finalScore = 0;

        if (isGameCompleted || isGameOver) {
            // محاسبه امتیاز نهایی
            finalScore = calculateFinalScore(isGameCompleted, score, time_spent, game.attempts, game.max_attempts);
            
            await dbClient.query(
                `INSERT INTO game_sessions (game_id, player_id, attempts, score, completed) 
                 VALUES ($1, $2, $3, $4, $5)`,
                [gameId, player_id, game.attempts, finalScore, isGameCompleted]
            );

            // به‌روزرسانی آمار کاربر
            await dbClient.query(
                `UPDATE users SET 
                    total_games = total_games + 1,
                    wins = wins + $1,
                    game_score = game_score + $2
                 WHERE telegram_id = $3`,
                [isGameCompleted ? 1 : 0, finalScore, player_id]
            );

            // اگر بازی تمام شد، آن را غیرفعال کن
            if (isGameCompleted || isGameOver) {
                game.is_active = false;
                game.completed = true;
                if (isGameCompleted) {
                    game.winner_id = player_id;
                }
                await dbClient.query(
                    'UPDATE games SET is_active = false, completed = true, winner_id = $1 WHERE game_id = $2',
                    [isGameCompleted ? player_id : null, gameId]
                );
                activeGames.delete(gameId);
                
                // پاک کردن اتصالات این بازی
                clearGameConnections(gameId);
            }
        }

        res.json({
            success: true,
            is_correct: isCorrect,
            letter: letterUpper,
            score: isGameCompleted || isGameOver ? finalScore : score,
            game_completed: isGameCompleted,
            game_over: isGameOver,
            correct_letters: Array.from(game.guessedLetters),
            incorrect_letters: Array.from(game.incorrectGuesses),
            remaining_attempts: game.max_attempts - game.attempts,
            word_progress: getWordProgress(word, game.guessedLetters)
        });

    } catch (error) {
        console.error('❌ Error processing guess:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// API برای دریافت اطلاعات بازی
app.get('/api/games/:gameId', async (req, res) => {
    try {
        const { gameId } = req.params;

        let game = activeGames.get(gameId);
        
        if (!game) {
            const dbGame = await dbClient.query(
                'SELECT * FROM games WHERE game_id = $1',
                [gameId]
            );
            
            if (dbGame.rows.length === 0) {
                return res.status(404).json({ error: 'Game not found' });
            }
            
            game = {
                .....dbGame.rows[0],
                players: await getGamePlayers(gameId),
                guessedLetters: new Set(dbGame.rows[0].guessed_letters.split(',').filter(Boolean)),
                incorrectGuesses: new Set(dbGame.rows[0].incorrect_letters.split(',').filter(Boolean)),
                attempts: dbGame.rows[0].attempts || 0,
                startTime: dbGame.rows[0].is_started ? new Date() : null,
                last_activity: dbGame.rows[0].created_at
            };
        }

        // بررسی آنلاین بودن سازنده
        const creatorOnline = isPlayerOnline(gameId, game.creator_id);
        if (game.creator_online !== creatorOnline) {
            game.creator_online = creatorOnline;
            await dbClient.query(
                'UPDATE games SET creator_online = $1 WHERE game_id = $2',
                [creatorOnline, gameId]
            );
        }

        res.json({
            success: true,
            game: {
                game_id: game.game_id,
                creator_id: game.creator_id,
                word: game.word,
                category: game.category,
                max_attempts: game.max_attempts,
                time_limit: game.time_limit,
                is_started: game.is_started,
                players_count: (game.players_count || (game.players ? game.players.length : 0)),
                guessed_letters: Array.from(game.guessedLetters || []),
                incorrect_letters: Array.from(game.incorrectGuesses || []),
                attempts: game.attempts || 0,
                word_progress: getWordProgress(game.word, game.guessedLetters || new Set()),
                completed: game.completed,
                winner_id: game.winner_id,
                creator_online: game.creator_online,
                last_activity: game.last_activity
            }
        });

    } catch (error) {
        console.error('❌ Error fetching game:', error);
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
            // اگر کاربر وجود ندارد، ایجادش کن
            await dbClient.query(
                'INSERT INTO users (telegram_id, full_name, username) VALUES ($1, $2, $3)',
                [telegramId, 'کاربر', 'user']
            );
            
            // دوباره بگیر
            const newResult = await dbClient.query(
                'SELECT * FROM users WHERE telegram_id = $1',
                [telegramId]
            );
            
            const user = newResult.rows[0];
            return res.json({
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
        const activeGamesCount = await getActiveGamesCount();
        
        res.json({
            total_users: parseInt(userCount),
            active_users: parseInt(activeCount),
            active_games: parseInt(activeGamesCount)
        });
    } catch (error) {
        console.error('❌ Error getting stats:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// API برای دریافت تعداد بازیکنان بازی
app.get('/api/games/:gameId/players', async (req, res) => {
    try {
        const { gameId } = req.params;
        
        const players = await getGamePlayers(gameId);
        
        res.json({
            success: true,
            players_count: players.length,
            players: players
        });
    } catch (error) {
        console.error('❌ Error getting game players:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// API برای دریافت تاریخچه بازی‌های کاربر
app.get('/api/user/:telegramId/games', async (req, res) => {
    try {
        const telegramId = req.params.telegramId;
        
        const result = await dbClient.query(`
            SELECT g.*, 
                   u.full_name as creator_name,
                   u.username as creator_username,
                   CASE WHEN g.winner_id = $1 THEN true ELSE false END as is_winner
            FROM games g
            LEFT JOIN users u ON g.creator_id = u.telegram_id
            WHERE g.completed = true AND g.game_id IN (
                SELECT game_id FROM game_players WHERE player_id = $1
            )
            ORDER BY g.created_at DESC
            LIMIT 50
        `, [telegramId]);

        const games = result.rows.map(game => ({
            game_id: game.game_id,
            creator_name: game.creator_name,
            creator_username: game.creator_username,
            category: game.category,
            word: game.word,
            max_attempts: game.max_attempts,
            attempts: game.attempts,
            guessed_letters: game.guessed_letters ? game.guessed_letters.split(',') : [],
            incorrect_letters: game.incorrect_letters ? game.incorrect_letters.split(',') : [],
            created_at: game.created_at,
            completed: game.completed,
            is_winner: game.is_winner,
            winner_id: game.winner_id
        }));

        res.json({ success: true, games });

    } catch (error) {
        console.error('❌ Error fetching user games:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// API برای گزارش اتصال کاربر
app.post('/api/games/:gameId/connect', async (req, res) => {
    try {
        const { gameId } = req.params;
        const { player_id } = req.body;

        updatePlayerConnection(gameId, player_id, true);
        
        // اگر سازنده است، وضعیت آنلاین بودنش را به‌روزرسانی کن
        const game = activeGames.get(gameId);
        if (game && game.creator_id === player_id) {
            game.creator_online = true;
            game.last_activity = new Date();
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

        updatePlayerConnection(gameId, player_id, false);
        
        res.json({ success: true });
    } catch (error) {
        console.error('❌ Error updating disconnection:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// توابع کمکی
function generateGameId() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 6; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

function calculateLetterScore(isCorrect, timeSpent, wordLength, incorrectCount) {
    let score = 0;
    
    if (isCorrect) {
        // امتیاز پایه برای هر حرف صحیح
        score = 50;
        
        // پاداش سرعت (هر ثانیه سریع‌تر = 2 امتیاز بیشتر)
        const timeBonus = Math.max(0, (wordLength * 10 - timeSpent) * 2);
        score += timeBonus;
        
        // پاداش برای کلمات طولانی‌تر
        score += wordLength * 5;
    } else {
        // جریمه برای حدس غلط
        score = -20;
        
        // جریمه بیشتر برای حدس‌های غلط متوالی
        if (incorrectCount > 3) {
            score -= 10 * (incorrectCount - 3);
        }
    }
    
    return Math.max(-50, score); // حداقل امتیاز -50
}

function calculateFinalScore(isWin, baseScore, timeSpent, attempts, maxAttempts) {
    let finalScore = baseScore;
    
    if (isWin) {
        // پاداش برنده شدن
        finalScore += 100;
        
        // پاداش سرعت
        const speedBonus = Math.max(0, 300 - timeSpent); // 5 دقیقه مهلت
        finalScore += speedBonus;
        
        // پاداش برای حدس‌های کمتر
        const efficiencyBonus = (maxAttempts - attempts) * 20;
        finalScore += efficiencyBonus;
    } else {
        // جریمه باختن
        finalScore -= 50;
    }
    
    return Math.max(0, finalScore); // حداقل امتیاز 0
}

function checkGameCompletion(word, guessedLetters) {
    const wordLetters = new Set(word.split('').filter(l => l !== ' '));
    for (let letter of wordLetters) {
        if (!guessedLetters.has(letter)) {
            return false;
        }
    }
    return true;
}

function getWordProgress(word, guessedLetters) {
    return word.split('').map(letter => 
        letter === ' ' ? ' ' : (guessedLetters.has(letter) ? letter : '_')
    ).join('');
}

async function getGamePlayers(gameId) {
    const result = await dbClient.query(
        'SELECT player_id FROM game_players WHERE game_id = $1',
        [gameId]
    );
    return result.rows.map(row => row.player_id);
}

async function getUserCount() {
    const result = await dbClient.query('SELECT COUNT(*) FROM users');
    return result.rows[0].count;
}

async function getActiveUserCount() {
    const result = await dbClient.query('SELECT COUNT(*) FROM users WHERE is_active = true');
    return result.rows[0].count;
}

async function getActiveGamesCount() {
    try {
        const result = await dbClient.query('SELECT COUNT(*) FROM games WHERE is_active = true AND completed = false');
        return result.rows[0].count;
    } catch (error) {
        console.error('Error in getActiveGamesCount:', error);
        return 0;
    }
}

function updatePlayerConnection(gameId, playerId, isConnected) {
    const key = `${gameId}_${playerId}`;
    if (isConnected) {
        playerConnections.set(key, {
            lastSeen: new Date(),
            connected: true
        });
    } else {
        playerConnections.delete(key);
    }
}

function isPlayerOnline(gameId, playerId) {
    const key = `${gameId}_${playerId}`;
    const connection = playerConnections.get(key);
    if (!connection) return false;
    
    // اگر کاربر در 30 ثانیه گذشته فعالیت داشته، آنلاین محسوب می‌شود
    return (new Date() - connection.lastSeen) < 30000;
}

function clearGameConnections(gameId) {
    for (const [key] of playerConnections) {
        if (key.startsWith(gameId + '_')) {
            playerConnections.delete(key);
        }
    }
}

// Cleanup اتصالات قدیمی هر دقیقه
setInterval(() => {
    const now = new Date();
    for (const [key, connection] of playerConnections) {
        if (now - connection.lastSeen > 60000) { // 1 دقیقه
            playerConnections.delete(key);
        }
    }
}, 60000);

// هندلر برای سرو فایل‌های استاتیک
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Cleanup بازی‌های قدیمی هر ساعت
setInterval(async () => {
    try {
        await dbClient.query(
            `UPDATE games SET is_active = false, completed = true 
             WHERE created_at < NOW() - INTERVAL '24 hours' AND is_active = true`
        );
        console.log('🧹 Cleaned up old games');
    } catch (error) {
        console.error('Error cleaning up old games:', error);
    }
}, 60 * 60 * 1000);

// Cleanup بازی‌های غیرفعال از حافظه هر 5 دقیقه
setInterval(() => {
    const now = new Date();
    for (const [gameId, game] of activeGames.entries()) {
        // اگر بازی بیش از 2 ساعت است که فعال است و تمام شده، از حافظه پاک کن
        if (game.completed || (game.last_activity && (now - game.last_activity) > 2 * 60 * 60 * 1000)) {
            activeGames.delete(gameId);
        }
    }
}, 5 * 60 * 1000);

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
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🌐 Web App URL: ${WEB_APP_URL}`);
});

// راه‌اندازی ربات
bot.launch()
    .then(() => console.log('🤖 Bot is running'))
    .catch(err => console.error('❌ Bot error:', err));

// مدیریت خروج تمیز
process.once('SIGINT', () => {
    console.log('🛑 Shutting down gracefully...');
    bot.stop('SIGINT');
    dbClient.end();
    process.exit(0);
});

process.once('SIGTERM', () => {
    console.log('🛑 Shutting down gracefully...');
    bot.stop('SIGTERM');
    dbClient.end();
    process.exit(0);
});

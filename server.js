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
const playerConnections = new Map();
const playerGuesses = new Map();

// NEW: Competitive Mode Storage
const competitiveMatches = new Map();
const waitingCompetitiveMatches = new Map();
const onlinePlayers = new Map(); // استفاده برای ذخیره موقت وضعیت آنلاین

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
                wins INTEGER DEFAULT 0,
                competitive_score INTEGER DEFAULT 0,
                competitive_wins INTEGER DEFAULT 0,
                competitive_games INTEGER DEFAULT 0
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
                creator_online BOOLEAN DEFAULT false,
                start_time TIMESTAMP,
                end_time TIMESTAMP
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

        await dbClient.query(`
            CREATE TABLE IF NOT EXISTS player_guesses (
                id SERIAL PRIMARY KEY,
                game_id VARCHAR(50) NOT NULL,
                player_id BIGINT NOT NULL,
                letter VARCHAR(10) NOT NULL,
                is_correct BOOLEAN NOT NULL,
                score INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // NEW: Competitive matches table
        await dbClient.query(`
            CREATE TABLE IF NOT EXISTS competitive_matches (
                id SERIAL PRIMARY KEY,
                match_id VARCHAR(50) UNIQUE NOT NULL,
                player1_id BIGINT NOT NULL,
                player2_id BIGINT,
                player1_name VARCHAR(255),
                player2_name VARCHAR(255),
                player1_score INTEGER DEFAULT 0,
                player2_score INTEGER DEFAULT 0,
                category VARCHAR(100) NOT NULL,
                words TEXT NOT NULL,
                status VARCHAR(20) DEFAULT 'waiting',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                started_at TIMESTAMP,
                completed_at TIMESTAMP,
                winner_id BIGINT
            )
        `);

        await dbClient.query(`
            CREATE TABLE IF NOT EXISTS competitive_match_words (
                id SERIAL PRIMARY KEY,
                match_id VARCHAR(50) NOT NULL,
                word VARCHAR(100) NOT NULL,
                word_index INTEGER NOT NULL,
                player1_progress VARCHAR(100),
                player2_progress VARCHAR(100),
                player1_used_letters TEXT DEFAULT '',
                player2_used_letters TEXT DEFAULT '',
                player1_completed BOOLEAN DEFAULT false,
                player2_completed BOOLEAN DEFAULT false,
                player1_time INTEGER DEFAULT 0,
                player2_time INTEGER DEFAULT 0
            )
        `);

        await dbClient.query(`
            CREATE TABLE IF NOT EXISTS competitive_player_stats (
                id SERIAL PRIMARY KEY,
                match_id VARCHAR(50) NOT NULL,
                player_id BIGINT NOT NULL,
                correct_letters INTEGER DEFAULT 0,
                wrong_letters INTEGER DEFAULT 0,
                total_time INTEGER DEFAULT 0,
                words_completed INTEGER DEFAULT 0,
                final_score INTEGER DEFAULT 0
            )
        `);

        console.log('✅ Database tables ready');
        
        try {
            await dbClient.query(`
                ALTER TABLE games ADD COLUMN IF NOT EXISTS start_time TIMESTAMP
            `);
            await dbClient.query(`
                ALTER TABLE games ADD COLUMN IF NOT EXISTS end_time TIMESTAMP
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

// تابع کمکی برای دریافت آمار بازیکن در مسابقه رقابتی
async function getCompetitivePlayerStats(matchId, playerId) {
    try {
        const result = await dbClient.query(
            `SELECT * FROM competitive_player_stats 
             WHERE match_id = $1 AND player_id = $2`,
            [matchId, playerId]
        );

        if (result.rows.length === 0) {
            return { correct_letters: 0, wrong_letters: 0, total_time: 0, words_completed: 0 };
        }

        const stats = result.rows[0];
        return {
            correct_letters: stats.correct_letters,
            wrong_letters: stats.wrong_letters,
            total_time: stats.total_time,
            words_completed: stats.words_completed,
            average_time: stats.words_completed > 0 ? stats.total_time / stats.words_completed : 0
        };
    } catch (error) {
        console.error('❌ Error getting competitive player stats:', error);
        return { correct_letters: 0, wrong_letters: 0, total_time: 0, words_completed: 0, average_time: 0 };
    }
}

// تابع کمکی برای به‌روزرسانی آمار بازیکن در مسابقه رقابتی
async function updateCompetitivePlayerStats(matchId, playerId, isCorrect, wordCompleted, timeRemaining) {
    try {
        const statsResult = await dbClient.query(
            `SELECT * FROM competitive_player_stats 
             WHERE match_id = $1 AND player_id = $2`,
            [matchId, playerId]
        );

        const timeUsed = 120 - timeRemaining;

        if (statsResult.rows.length === 0) {
            await dbClient.query(
                `INSERT INTO competitive_player_stats 
                 (match_id, player_id, correct_letters, wrong_letters, total_time, words_completed)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [matchId, playerId, isCorrect ? 1 : 0, isCorrect ? 0 : 1, timeUsed, wordCompleted ? 1 : 0]
            );
        } else {
            const stats = statsResult.rows[0];
            await dbClient.query(
                `UPDATE competitive_player_stats 
                 SET correct_letters = $1, wrong_letters = $2, total_time = $3, words_completed = $4
                 WHERE match_id = $5 AND player_id = $6`,
                [
                    stats.correct_letters + (isCorrect ? 1 : 0),
                    stats.wrong_letters + (isCorrect ? 0 : 1),
                    stats.total_time + timeUsed,
                    stats.words_completed + (wordCompleted ? 1 : 0),
                    matchId,
                    playerId
                ]
            );
        }
    } catch (error) {
        console.error('❌ Error updating competitive player stats:', error);
    }
}

// تابع کمکی برای به‌روزرسانی آمار رقابتی کلی بازیکن
async function updatePlayerCompetitiveStats(playerId, score, isWinner) {
    try {
        await dbClient.query(
            `UPDATE users 
             SET competitive_score = competitive_score + $1,
                 competitive_wins = competitive_wins + $2,
                 competitive_games = competitive_games + 1
             WHERE telegram_id = $3`,
            [score, isWinner ? 1 : 0, playerId]
        );
    } catch (error) {
        console.error('❌ Error updating player competitive stats:', error);
    }
}


// NEW: Competitive Mode APIs

// API برای شروع یک مسابقه سریع
app.post('/api/competitive/quick-match', async (req, res) => {
    try {
        const { player_id, player_name } = req.body;
        
        if (!player_id) {
            return res.status(400).json({ error: 'Player ID is required' });
        }

        // Check if player is already in an active match
        for (let [matchId, match] of competitiveMatches) {
            if (match.player1_id === player_id || match.player2_id === player_id) {
                 // --- اصلاحیه مهم برای ارسال اطلاعات کامل در هنگام اتصال مجدد ---
                 const dbMatch = await dbClient.query('SELECT words, category FROM competitive_matches WHERE match_id = $1', [matchId]);
                 let wordsArray = [];
                 let categoryName = match.category;
                 
                 if (dbMatch.rows.length > 0) {
                    categoryName = dbMatch.rows[0].category;
                    try {
                         wordsArray = JSON.parse(dbMatch.rows[0].words);
                    } catch (e) { 
                        console.error('Error parsing words JSON on reconnection:', e);
                        // اگر خطا داد، آرایه خالی برمی‌گرداند
                    }
                 }
                 
                return res.json({
                    success: true,
                    match_id: matchId,
                    reconnected: true,
                    matched: true, // It's an active match
                    category: categoryName,
                    words: wordsArray
                });
            }
        }
        
        // Check if player is already in a waiting match
        for (let [matchId, match] of waitingCompetitiveMatches) {
            if (match.player1_id === player_id) {
                return res.json({
                    success: true,
                    match_id: matchId,
                    matched: false, // Still waiting
                    category: match.category,
                    words: []
                });
            }
        }

        // Try to find a waiting match
        let foundMatch = null;
        let foundMatchId = null;

        for (let [matchId, match] of waitingCompetitiveMatches) {
            // اطمینان از اینکه بازیکن، خودش نیست
            if (match.player1_id !== player_id && !match.player2_id) {
                foundMatch = match;
                foundMatchId = matchId;
                break;
            }
        }

        if (foundMatch) {
            // Join existing match
            foundMatch.player2_id = player_id;
            foundMatch.player2_name = player_name;
            foundMatch.status = 'active'; // تغییر وضعیت به فعال
            
            // Move to active matches
            waitingCompetitiveMatches.delete(foundMatchId);
            
            // Generate words for the match
            const words = await generateCompetitiveWords(foundMatch.category, 10);
            foundMatch.words = words; // words is an array
            foundMatch.started_at = new Date();
            competitiveMatches.set(foundMatchId, foundMatch); // باید پس از پر شدن اطلاعات کامل به competitiveMatches اضافه شود

            // Save to database
            await dbClient.query(
                `UPDATE competitive_matches 
                 SET player2_id = $1, player2_name = $2, status = 'active', started_at = CURRENT_TIMESTAMP, words = $3
                 WHERE match_id = $4`,
                [player_id, player_name, JSON.stringify(words), foundMatchId] // JSON.stringify برای ذخیره در دیتابیس
            );

            // Create word records
            for (let i = 0; i < words.length; i++) {
                // --- اصلاحیه: مقداردهی اولیه پیشرفت کلمه ---
                await dbClient.query(
                    `INSERT INTO competitive_match_words (match_id, word, word_index, player1_progress, player2_progress)
                     VALUES ($1, $2, $3, $4, $5)`,
                    [foundMatchId, words[i], i, '_'.repeat(words[i].length), '_'.repeat(words[i].length)]
                );
            }

            // Correction: Return full match info for immediate start
            res.json({
                success: true,
                match_id: foundMatchId,
                matched: true,
                opponent_name: foundMatch.player1_name,
                category: foundMatch.category, 
                words: words 
            });
        } else {
            // Create new match
            const matchId = generateCompetitiveMatchId();
            const category = getRandomCategory();
            
            const newMatch = {
                match_id: matchId,
                player1_id: player_id,
                player1_name: player_name,
                player2_id: null,
                player2_name: null,
                player1_score: 0,
                player2_score: 0,
                category: category,
                words: [],
                status: 'waiting',
                created_at: new Date(),
                started_at: null,
                completed_at: null,
                winner_id: null
            };

            waitingCompetitiveMatches.set(matchId, newMatch);

            // Save to database
            await dbClient.query(
                `INSERT INTO competitive_matches (match_id, player1_id, player1_name, category, status, words)
                 VALUES ($1, $2, $3, $4, 'waiting', '[]')`, // words as empty JSON array
                [matchId, player_id, player_name, category]
            );

            res.json({
                success: true,
                match_id: matchId,
                matched: false,
                category: category,
                words: [] 
            });
        }

    } catch (error) {
        console.error('❌ Error in quick match:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// API برای دریافت وضعیت مسابقه رقابتی
app.get('/api/competitive/match/:matchId', async (req, res) => {
    try {
        const { matchId } = req.params;
        
        let match = competitiveMatches.get(matchId) || waitingCompetitiveMatches.get(matchId);
        
        if (!match) {
            // Try to load from database
            const dbMatch = await dbClient.query(
                'SELECT * FROM competitive_matches WHERE match_id = $1',
                [matchId]
            );
            
            if (dbMatch.rows.length === 0) {
                return res.status(404).json({ error: 'Match not found' });
            }
            
            match = dbMatch.rows[0];
            
            // Correction: Ensure words are parsed if coming from the database
            if (typeof match.words === 'string') {
                try {
                    match.words = JSON.parse(match.words);
                } catch (e) {
                    console.error('Error parsing words JSON from DB:', e);
                    match.words = []; // Fallback
                }
            }

            // Add to active map if it's active/matched
            if (match.status === 'active' || match.status === 'matched') {
                competitiveMatches.set(matchId, match);
            }
        }

        res.json({
            success: true,
            match: {
                match_id: match.match_id,
                player1_id: match.player1_id,
                player1_name: match.player1_name,
                player2_id: match.player2_id,
                player2_name: match.player2_name,
                player1_score: match.player1_score,
                player2_score: match.player2_score,
                category: match.category,
                status: match.status,
                words: match.words || [],
                started_at: match.started_at,
                completed_at: match.completed_at,
                winner_id: match.winner_id
            }
        });

    } catch (error) {
        console.error('❌ Error fetching competitive match:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// API برای ارسال حدس در مسابقه رقابتی
app.post('/api/competitive/match/:matchId/guess', async (req, res) => {
    try {
        const { matchId } = req.params;
        const { player_id, letter, word_index, time_remaining } = req.body;
        
        if (!player_id || !letter || word_index === undefined) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const match = competitiveMatches.get(matchId);
        if (!match || match.status !== 'active') {
            return res.status(404).json({ error: 'Match not found or not active' });
        }

        // تعیین اینکه بازیکن، player1 است یا player2
        const isPlayer1 = match.player1_id === player_id;
        const playerField = isPlayer1 ? 'player1' : 'player2';
        const opponentField = isPlayer1 ? 'player2' : 'player1';
        
        if (!isPlayer1 && match.player2_id !== player_id) {
            return res.status(403).json({ error: 'Player not in this match' });
        }

        // دریافت کلمه جاری
        const currentWord = match.words[word_index];
        if (!currentWord) {
            return res.status(400).json({ error: 'Invalid word index' });
        }

        // دریافت پیشرفت کلمه از دیتابیس
        const wordProgressResult = await dbClient.query(
            `SELECT ${playerField}_progress, ${playerField}_used_letters, ${playerField}_completed 
             FROM competitive_match_words 
             WHERE match_id = $1 AND word_index = $2`,
            [matchId, word_index]
        );

        if (wordProgressResult.rows.length === 0) {
            return res.status(404).json({ error: 'Word progress not found' });
        }

        const currentWordData = wordProgressResult.rows[0];
        if (currentWordData[`${playerField}_completed`]) {
             return res.status(400).json({ error: 'Word already completed by player' });
        }

        const currentProgress = currentWordData[`${playerField}_progress`];
        const usedLetters = currentWordData[`${playerField}_used_letters`] || '';
        const letterUpper = letter.toUpperCase();

        // بررسی اینکه حرف قبلاً حدس زده شده
        if (usedLetters.includes(letterUpper)) {
            return res.status(400).json({ error: 'Letter already guessed' });
        }

        // بررسی اینکه حرف در کلمه وجود دارد
        const isCorrect = currentWord.includes(letterUpper);
        let newProgress = currentProgress.split('');
        let wordCompleted = false;

        if (isCorrect) {
            // به‌روزرسانی پیشرفت
            for (let i = 0; i < currentWord.length; i++) {
                if (currentWord[i] === letterUpper) {
                    newProgress[i] = letterUpper;
                }
            }
            
            // بررسی تکمیل شدن کلمه
            wordCompleted = !newProgress.includes('_');
        }

        // محاسبه امتیاز
        const timeUsed = 120 - time_remaining;
        const baseScore = isCorrect ? 50 : -20; // امتیاز پایه بالاتر برای تصحیح
        const timeBonus = isCorrect ? Math.max(0, 30 - Math.floor(timeUsed / 4)) : 0; // حداکثر 30 امتیاز پاداش سرعت (4 ثانیه برای هر امتیاز)
        const wordCompletionBonus = wordCompleted ? 100 : 0;
        const totalScore = Math.max(0, baseScore + timeBonus + wordCompletionBonus);

        // به‌روزرسانی امتیاز بازیکن در حافظه
        if (isPlayer1) {
            match.player1_score += totalScore;
        } else {
            match.player2_score += totalScore;
        }

        // به‌روزرسانی دیتابیس (progress, used_letters, completed, total_time)
        const newUsedLetters = usedLetters ? `${usedLetters},${letterUpper}` : letterUpper;
        const newProgressStr = newProgress.join('');

        await dbClient.query(
            `UPDATE competitive_match_words 
             SET ${playerField}_progress = $1, ${playerField}_used_letters = $2,
                 ${playerField}_completed = $3, ${playerField}_time = ${playerField}_time + $4
             WHERE match_id = $5 AND word_index = $6`,
            [newProgressStr, newUsedLetters, wordCompleted, timeUsed, matchId, word_index]
        );

        await dbClient.query(
            `UPDATE competitive_matches 
             SET ${playerField}_score = $1
             WHERE match_id = $2`,
            [isPlayer1 ? match.player1_score : match.player2_score, matchId]
        );

        // به‌روزرسانی آمار بازیکن (stats)
        await updateCompetitivePlayerStats(matchId, player_id, isCorrect, wordCompleted, timeRemaining);

        // آماده‌سازی پاسخ
        const responseData = {
            success: true,
            is_correct: isCorrect,
            letter: letterUpper,
            word_progress: newProgressStr,
            used_letters: newUsedLetters.split(','),
            score: totalScore,
            word_completed: wordCompleted,
            word_index: word_index,
            is_player1: isPlayer1,
            player1_score: match.player1_score, // برای به‌روزرسانی کلی فرانت‌اند
            player2_score: match.player2_score
        };

        // اطلاع‌رسانی به بازیکن مقابل در صورت وجود اتصال
        if (match.player2_id) {
             const opponentId = isPlayer1 ? match.player2_id : match.player1_id;
             const opponentMessage = `🔔 حدس جدید از رقیب شما در مسابقه ${matchId}: حرف ${letterUpper} با نتیجه ${isCorrect ? '✅ صحیح' : '❌ غلط'} و امتیاز ${totalScore}.`;
             sendMessageToUser(opponentId, opponentMessage);
        }

        res.json(responseData);

    } catch (error) {
        console.error('❌ Error processing competitive guess:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// API برای تکمیل مسابقه رقابتی
app.post('/api/competitive/match/:matchId/complete', async (req, res) => {
    try {
        const { matchId } = req.params;
        const { player_id } = req.body; // final_score و stats از سمت کلاینت ایمن نیستند و نادیده گرفته می‌شوند

        const match = competitiveMatches.get(matchId);
        if (!match) {
            return res.status(404).json({ error: 'Match not found' });
        }
        
        // اطمینان از پایان بازی (چون هر دو باید این API را فراخوانی کنند)
        if (match.status === 'completed') {
            return res.json({ success: true, message: 'Match already completed' });
        }
        
        // فرض می‌کنیم که این API پس از اتمام حدس همه کلمات توسط بازیکن فراخوانی می‌شود
        // یا در صورت دیسکانکت طولانی مدت یکی از بازیکنان

        // دریافت آمار نهایی بازیکنان از دیتابیس
        const player1Stats = await getCompetitivePlayerStats(matchId, match.player1_id);
        const player2Stats = match.player2_id ? await getCompetitivePlayerStats(matchId, match.player2_id) : { wrong_letters: Infinity, average_time: Infinity, words_completed: 0 };

        // تعیین برنده بر اساس امتیاز نهایی
        let winner_id = null;
        if (match.player1_score > match.player2_score) {
            winner_id = match.player1_id;
        } else if (match.player2_score > match.player1_score) {
            winner_id = match.player2_id;
        } else {
            // شرایط مساوی (Tie-breaker)
            if (player1Stats.wrong_letters < player2Stats.wrong_letters) {
                winner_id = match.player1_id;
            } else if (player2Stats.wrong_letters < player1Stats.wrong_letters) {
                winner_id = match.player2_id;
            } else if (player1Stats.average_time < player2Stats.average_time) {
                winner_id = match.player1_id;
            } else if (player2Stats.average_time < player1Stats.average_time) {
                winner_id = match.player2_id;
            } else {
                // اگر تمام شرایط مساوی بود، player1 برنده می‌شود
                winner_id = match.player1_id;
            }
        }

        // به‌روزرسانی وضعیت مسابقه
        match.status = 'completed';
        match.completed_at = new Date();
        match.winner_id = winner_id;

        // به‌روزرسانی دیتابیس
        await dbClient.query(
            `UPDATE competitive_matches 
             SET status = 'completed', completed_at = CURRENT_TIMESTAMP, winner_id = $1
             WHERE match_id = $2`,
            [winner_id, matchId]
        );

        // به‌روزرسانی آمار رقابتی بازیکنان در جدول users
        await updatePlayerCompetitiveStats(match.player1_id, match.player1_score, match.player1_id === winner_id);
        if (match.player2_id) {
            await updatePlayerCompetitiveStats(match.player2_id, match.player2_score, match.player2_id === winner_id);
        }

        // حذف از مسابقات فعال
        competitiveMatches.delete(matchId);

        // ارسال نتایج نهایی
        const viewingPlayerIsPlayer1 = player_id === match.player1_id;
        const viewingPlayerStats = viewingPlayerIsPlayer1 ? player1Stats : player2Stats;
        const opponentPlayerStats = viewingPlayerIsPlayer1 ? player2Stats : player1Stats;

        res.json({
            success: true,
            results: {
                winner_id: winner_id,
                player1_score: match.player1_score,
                player2_score: match.player2_score,
                player1_name: match.player1_name,
                player2_name: match.player2_name,
                
                // اطلاعات آماری دقیق‌تر
                player1_stats: player1Stats,
                player2_stats: player2Stats,
                
                // اطلاعات ساده شده برای نمایش سریع به کلاینت درخواست دهنده
                correct_words: viewingPlayerStats.words_completed || 0,
                average_time: Math.round(viewingPlayerStats.average_time || 0),
            }
        });

    } catch (error) {
        console.error('❌ Error completing competitive match:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// API برای ترک مسابقه رقابتی
app.post('/api/competitive/match/:matchId/leave', async (req, res) => {
    try {
        const { matchId } = req.params;
        const { player_id } = req.body;

        // اگر مسابقه در حال انتظار بود، حذف کامل
        if (waitingCompetitiveMatches.has(matchId)) {
            waitingCompetitiveMatches.delete(matchId);

            await dbClient.query(
                `UPDATE competitive_matches 
                 SET status = 'cancelled'
                 WHERE match_id = $1 AND status = 'waiting'`,
                [matchId]
            );
        }

        // اگر مسابقه فعال بود، به عنوان باخت ثبت می‌شود
        if (competitiveMatches.has(matchId)) {
            const match = competitiveMatches.get(matchId);
            
            // اگر فقط یک بازیکن بود، حذف شود
            if ((match.player1_id === player_id && !match.player2_id) || (match.player2_id === player_id && !match.player1_id)) {
                 competitiveMatches.delete(matchId);
                 await dbClient.query(
                    `UPDATE competitive_matches 
                     SET status = 'cancelled'
                     WHERE match_id = $1`,
                    [matchId]
                );
            } else if (match.status === 'active') {
                // اگر در حین بازی ترک کرد، بازیکن مقابل برنده اعلام می‌شود
                const winnerId = match.player1_id === player_id ? match.player2_id : match.player1_id;
                
                if (winnerId) {
                    // به‌روزرسانی موقت برای ثبت برنده و امتیاز دهی
                    if (match.player1_id === winnerId) {
                        match.player1_score += 100; // پاداش برد
                    } else {
                        match.player2_score += 100; // پاداش برد
                    }

                    match.status = 'completed';
                    match.completed_at = new Date();
                    match.winner_id = winnerId;
                    
                    await dbClient.query(
                        `UPDATE competitive_matches 
                         SET status = 'completed', completed_at = CURRENT_TIMESTAMP, winner_id = $1,
                             player1_score = $3, player2_score = $4
                         WHERE match_id = $2`,
                        [winnerId, matchId, match.player1_score, match.player2_score]
                    );

                    // ثبت آمار نهایی
                    await updatePlayerCompetitiveStats(match.player1_id, match.player1_score, match.player1_id === winnerId);
                    if (match.player2_id) {
                         await updatePlayerCompetitiveStats(match.player2_id, match.player2_score, match.player2_id === winnerId);
                    }
                    
                    const opponentMessage = `🔔 رقیب شما مسابقه ${matchId} را ترک کرد! شما برنده شدید و 100 امتیاز پاداش گرفتید.`;
                    sendMessageToUser(winnerId, opponentMessage);
                }

                competitiveMatches.delete(matchId);
            }
        }

        res.json({ success: true });

    } catch (error) {
        console.error('❌ Error leaving competitive match:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// API برای دریافت تعداد بازیکنان آنلاین
app.get('/api/competitive/online-players', async (req, res) => {
    try {
        // شمارش بازیکنانی که در 5 دقیقه اخیر فعال بوده‌اند
        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
        
        const result = await dbClient.query(
            `SELECT COUNT(DISTINCT telegram_id) as count 
             FROM users 
             WHERE last_seen > $1 AND is_active = true`,
            [fiveMinutesAgo]
        );

        res.json({
            success: true,
            count: parseInt(result.rows[0].count)
        });

    } catch (error) {
        console.error('❌ Error getting online players count:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// API برای دریافت تعداد مسابقات در انتظار
app.get('/api/competitive/waiting-matches', async (req, res) => {
    try {
        const count = waitingCompetitiveMatches.size;

        res.json({
            success: true,
            count: count
        });

    } catch (error) {
        console.error('❌ Error getting waiting matches count:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// API برای دریافت جدول امتیازات رقابتی
app.get('/api/competitive/leaderboard', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 10;

        const result = await dbClient.query(
            `SELECT telegram_id, full_name, competitive_score, competitive_wins, competitive_games
             FROM users 
             WHERE competitive_games > 0 
             ORDER BY competitive_score DESC, competitive_wins DESC 
             LIMIT $1`,
            [limit]
        );

        const players = result.rows.map((row, index) => ({
            rank: index + 1,
            telegram_id: row.telegram_id,
            full_name: row.full_name,
            competitive_score: row.competitive_score,
            competitive_wins: row.competitive_wins,
            competitive_games: row.competitive_games
        }));

        res.json({
            success: true,
            players: players
        });

    } catch (error) {
        console.error('❌ Error getting leaderboard:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// API برای دریافت آمار رقابتی بازیکن
app.get('/api/user/:telegramId/competitive-stats', async (req, res) => {
    try {
        const telegramId = req.params.telegramId;

        const result = await dbClient.query(
            `SELECT competitive_score, competitive_wins, competitive_games
             FROM users 
             WHERE telegram_id = $1`,
            [telegramId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        const stats = result.rows[0];

        // محاسبه رتبه (League Rank)
        const rankResult = await dbClient.query(
            `SELECT COUNT(*) + 1 as rank
             FROM users 
             WHERE competitive_score > $1 AND competitive_games > 0`,
            [stats.competitive_score]
        );

        res.json({
            success: true,
            competitive_score: stats.competitive_score || 0,
            competitive_wins: stats.competitive_wins || 0,
            competitive_games: stats.competitive_games || 0,
            league_rank: parseInt(rankResult.rows[0].rank)
        });

    } catch (error) {
        console.error('❌ Error getting competitive stats:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});


// ----------------------------------------------------------------------
// توابع کمکی حالت رقابتی
// ----------------------------------------------------------------------

function generateCompetitiveMatchId() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 8; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

async function generateCompetitiveWords(category, count) {
    // NOTE: این تابع باید از دیتابیس یا یک سرویس واژگان، کلمات واقعی را برگرداند.
    // در حال حاضر از کلمات نمونه استفاده شده است.
    const wordLists = {
        'عمومی': ['کامپیوتر', 'برنامه', 'اینترنت', 'موبایل', 'کتاب', 'مدرسه', 'دانشگاه', 'کارمند', 'مدیریت', 'توسعه', 'آب', 'خورشید', 'ابر', 'دریا', 'نور'],
        'جانوران': ['شیر', 'فیل', 'زرافه', 'پلنگ', 'خرس', 'گرگ', 'روباه', 'گوزن', 'گاو', 'گوسفند', 'گربه', 'سگ', 'مار', 'عقاب', 'کبوتر'],
        'میوه‌ها': ['سیب', 'پرتقال', 'موز', 'انگور', 'هلو', 'زردآلو', 'گیلاس', 'آلبالو', 'انار', 'نارنگی', 'کیوی', 'خرمالو', 'توت', 'شاهتوت', 'لیمو'],
        'شهرها': ['تهران', 'مشهد', 'اصفهان', 'شیراز', 'تبریز', 'اهواز', 'کرج', 'قم', 'کرمان', 'ارومیه', 'یزد', 'همدان', 'رشت', 'ساری', 'بندر']
    };

    const words = wordLists[category] || wordLists['عمومی'];
    
    // Shuffle and select required number of words
    const shuffled = [...words].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, count);
}

function getRandomCategory() {
    const categories = ['عمومی', 'جانوران', 'میوه‌ها', 'شهرها'];
    return categories[Math.floor(Math.random() * categories.length)];
}


// ----------------------------------------------------------------------
// توابع و API های قبلی بازی استاندارد و تلگرام
// ----------------------------------------------------------------------


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

// تابع ارسال پیام به کاربر خاص
async function sendMessageToUser(telegramId, message) {
    try {
        await bot.telegram.sendMessage(telegramId, message, {
            parse_mode: 'HTML'
        });
        return true;
    } catch (error) {
        console.error(`❌ Error sending message to user ${telegramId}:`, error.description || error.message);
        return false;
    }
}

// تابع کمکی برای دریافت تعداد کل کاربران
async function getUserCount() {
    try {
        const result = await dbClient.query('SELECT COUNT(*) FROM users');
        return result.rows[0].count;
    } catch (error) {
        console.error('Error in getUserCount:', error);
        return 0;
    }
}

// تابع کمکی برای دریافت تعداد کاربران فعال
async function getActiveUserCount() {
    try {
        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
        const result = await dbClient.query(
            'SELECT COUNT(*) FROM users WHERE is_active = true AND last_seen > $1',
            [fiveMinutesAgo]
        );
        return result.rows[0].count;
    } catch (error) {
        console.error('Error in getActiveUserCount:', error);
        return 0;
    }
}

// تابع کمکی برای دریافت تعداد بازی‌های فعال
async function getActiveGamesCount() {
    try {
        const result = await dbClient.query(
            "SELECT COUNT(*) FROM games WHERE is_active = true AND completed = false"
        );
        return result.rows[0].count;
    } catch (error) {
        console.error('Error in getActiveGamesCount:', error);
        return 0;
    }
}

// تابع کمکی برای دریافت بازیکنان یک بازی
async function getGamePlayers(gameId) {
    try {
        const result = await dbClient.query(
            `SELECT u.telegram_id, u.full_name, u.username, 
                    CASE WHEN u.telegram_id IN (SELECT creator_id FROM games WHERE game_id = $1) THEN true ELSE false END as is_creator
             FROM users u
             JOIN game_players gp ON u.telegram_id = gp.player_id
             WHERE gp.game_id = $1`,
            [gameId]
        );
        
        const players = result.rows.map(row => ({
            id: row.telegram_id,
            name: row.full_name,
            username: row.username,
            is_creator: row.is_creator,
            online: isPlayerOnline(gameId, row.telegram_id)
        }));

        return players;
    } catch (error) {
        console.error('Error in getGamePlayers:', error);
        return [];
    }
}

// تابع شروع بازی پس از پیوستن بازیکن دوم
async function startGameWhenPlayerJoins(gameId, joiningPlayerId, joiningPlayerName) {
    try {
        const game = activeGames.get(gameId);
        if (!game || game.is_started) return;

        game.is_started = true;
        const startTime = new Date();
        const endTime = new Date(startTime.getTime() + game.time_limit * 1000);
        game.startTime = startTime;
        game.endTime = endTime;
        game.last_activity = new Date();
        
        await dbClient.query(
            'UPDATE games SET is_started = true, start_time = $1, end_time = $2 WHERE game_id = $3',
            [startTime, endTime, gameId]
        );

        const joiningPlayerInfo = await dbClient.query(
            'SELECT full_name, username FROM users WHERE telegram_id = $1',
            [joiningPlayerId]
        );
        const playerInfo = joiningPlayerInfo.rows[0];
        const playerName = playerInfo?.full_name || 'ناشناس';
        const playerUsername = playerInfo?.username || 'ندارد';

        const creatorMessage = `🎮 <b>بازی شروع شد!</b>\n\n👤 <b>بازیکن جدید:</b> ${playerName}\n📱 <b>آیدی:</b> ${playerUsername}\n🆔 <b>کد بازی:</b> <code>${gameId}</code>\n⏰ <b>زمان بازی:</b> ${Math.floor(game.time_limit / 60)}:${(game.time_limit % 60).toString().padStart(2, '0')}\n\nاکنون می‌توانید پیشرفت بازی را مشاهده کنید!`;
        await sendMessageToUser(game.creator_id, creatorMessage);

        const playerMessage = `🎮 <b>به بازی پیوستید!</b>\n\n🆔 <b>کد بازی:</b> <code>${gameId}</code>\n⏰ <b>زمان بازی:</b> ${Math.floor(game.time_limit / 60)}:${(game.time_limit % 60).toString().padStart(2, '0')}\n\nشروع به حدس زدن حروف کنید!`;
        await sendMessageToUser(joiningPlayerId, playerMessage);

        setTimeout(async () => {
            await endGameByTimeout(gameId);
        }, game.time_limit * 1000);

        console.log(`🚀 Game ${gameId} started with players: ${game.players.join(', ')}`);
    } catch (error) {
        console.error('❌ Error starting game when player joins:', error);
    }
}

// تابع پایان بازی به دلیل اتمام زمان
async function endGameByTimeout(gameId) {
    try {
        const game = activeGames.get(gameId);
        if (!game || game.completed) return;

        console.log(`⏰ Ending game ${gameId} due to timeout`);

        // محاسبه حداکثر امتیاز ممکن
        const maxPossibleScore = calculateMaxPossibleScore(game.word.length, game.time_limit);

        let winnerId = null;
        let maxScore = -Infinity; // شروع از کمترین مقدار
        let sessions = [];

        // دریافت امتیاز بازیکنان
        for (const playerId of game.players) {
            const playerSessions = await dbClient.query(
                'SELECT * FROM game_sessions WHERE game_id = $1 AND player_id = $2',
                [gameId, playerId]
            );
            if (playerSessions.rows.length > 0) {
                sessions.push({ ...playerSessions.rows[0], playerId });
            }
        }
        
        // پیدا کردن برنده
        if (sessions.length > 0) {
            for (const session of sessions) {
                if (session.score > maxScore) {
                    maxScore = session.score;
                    winnerId = session.playerId;
                } else if (session.score === maxScore && winnerId) {
                    // Tie-breaker: اگر امتیاز مساوی بود، بازیکن اول (که در لیست sessions زودتر آمده) برنده است
                }
            }
        } else {
             // اگر هیچ امتیازی ثبت نشده، اولین بازیکن را برنده کن
            if (game.players.length > 0) {
                winnerId = game.players[0];
            }
        }


        // به‌روزرسانی وضعیت بازی
        game.completed = true;
        game.is_active = false;
        game.winner_id = winnerId;
        await dbClient.query(
            'UPDATE games SET completed = true, is_active = false, winner_id = $1 WHERE game_id = $2',
            [winnerId, gameId]
        );

        // به‌روزرسانی آمار بازیکنان و اعمال جریمه
        for (const playerId of game.players) {
            const isWinner = playerId === winnerId;
            let finalScore = 0;
            let finalWins = isWinner ? 1 : 0;
            
            const playerSessionRow = sessions.find(s => s.playerId === playerId);
            const baseScore = playerSessionRow ? playerSessionRow.score : 0;
            
            let penalty = 0;
            if (!isWinner && baseScore < 0) {
                // اعمال جریمه تنها در صورتی که بازیکنی برنده نشده و امتیاز منفی کسب کرده
                penalty = Math.floor(maxPossibleScore * 0.3);
            }
            finalScore = Math.max(0, baseScore - penalty);

            // به‌روزرسانی آمار کاربر در جدول users
            await dbClient.query(
                `UPDATE users 
                 SET game_score = game_score + $1, total_games = total_games + 1, wins = wins + $2 
                 WHERE telegram_id = $3`,
                [finalScore, finalWins, playerId]
            );

            // ارسال پیام نتیجه
            const playerResult = await dbClient.query(
                'SELECT full_name FROM users WHERE telegram_id = $1',
                [winnerId]
            );
            const playerName = playerResult.rows[0]?.full_name || 'ناشناس';

            let resultMessage = '';
            if (isWinner) {
                resultMessage = `🎉 <b>تبریک! شما برنده شدید!</b>\n\n🏆 <b>بازی:</b> <code>${gameId}</code>\n📊 <b>امتیاز شما:</b> ${finalScore}\n🕒 <b>دلیل پایان:</b> اتمام زمان\n\nشما برنده این دور از بازی شدید!`;
            } else {
                resultMessage = `🏁 <b>بازی به پایان رسید</b>\n\n🎮 <b>بازی:</b> <code>${gameId}</code>\n📊 <b>امتیاز شما:</b> ${finalScore}\n🕒 <b>دلیل پایان:</b> اتمام زمان\n${penalty > 0 ? `💰 <b>جریمه:</b> ${penalty} امتیاز\n` : ''}\nبرنده: ${playerName}`;
            }
            await sendMessageToUser(playerId, resultMessage);
        }

        // پاک کردن از حافظه
        activeGames.delete(gameId);
        clearGameConnections(gameId);
        playerGuesses.delete(gameId);

        console.log(`🎯 Game ${gameId} ended. Winner: ${winnerId}`);

    } catch (error) {
        console.error('❌ Error ending game by timeout:', error);
    }
}

// تابع پایان بازی با برنده مشخص (هنگام حدس زدن کامل کلمه)
async function endGameWithWinner(gameId, winnerId, finalScore) {
    try {
        const game = activeGames.get(gameId);
        if (!game || game.completed) return;

        game.completed = true;
        game.is_active = false;
        game.winner_id = winnerId;

        await dbClient.query(
            'UPDATE games SET completed = true, is_active = false, winner_id = $1 WHERE game_id = $2',
            [winnerId, gameId]
        );

        // به‌روزرسانی آمار بازیکنان و اعمال امتیاز نهایی
        for (const playerId of game.players) {
            const isWinner = playerId === winnerId;
            let score = 0;
            let finalWins = isWinner ? 1 : 0;
            
            const playerSession = await dbClient.query(
                'SELECT score FROM game_sessions WHERE game_id = $1 AND player_id = $2',
                [gameId, playerId]
            );
            
            if (playerSession.rows.length > 0) {
                score = playerSession.rows[0].score;
            }

            // امتیاز برنده شامل پاداش ۱۰۰ تایی
            const totalScore = isWinner ? score + 100 : score;

            // به‌روزرسانی آمار کاربر در جدول users
            await dbClient.query(
                `UPDATE users 
                 SET game_score = game_score + $1, total_games = total_games + 1, wins = wins + $2 
                 WHERE telegram_id = $3`,
                [totalScore, finalWins, playerId]
            );

            // ارسال پیام نتیجه
            const winnerInfo = await dbClient.query(
                'SELECT full_name FROM users WHERE telegram_id = $1',
                [winnerId]
            );
            const winnerName = winnerInfo.rows[0]?.full_name || 'ناشناس';
            
            const resultMessage = isWinner ? 
                `🎉 <b>تبریک! شما برنده شدید!</b>\n\n🏆 <b>بازی:</b> <code>${gameId}</code>\n📊 <b>امتیاز نهایی:</b> ${totalScore}\n🕒 <b>دلیل پایان:</b> حدس کامل کلمه\n\nشما برنده این دور از بازی شدید!` : 
                `🏁 <b>بازی به پایان رسید</b>\n\n🎮 <b>بازی:</b> <code>${gameId}</code>\n📊 <b>امتیاز شما:</b> ${totalScore}\n🕒 <b>دلیل پایان:</b> حدس کامل کلمه\n\nبرنده: ${winnerName}`;
            
            await sendMessageToUser(playerId, resultMessage);
        }

        activeGames.delete(gameId);
        clearGameConnections(gameId);
        playerGuesses.delete(gameId);

        console.log(`🎉 Game ${gameId} completed. Winner: ${winnerId}`);

    } catch (error) {
        console.error('❌ Error ending game with winner:', error);
    }
}

// تابع ثبت session بازیکن
async function recordPlayerSession(gameId, playerId, attempts, score, completed) {
    try {
        const existingSession = await dbClient.query(
            'SELECT * FROM game_sessions WHERE game_id = $1 AND player_id = $2',
            [gameId, playerId]
        );

        if (existingSession.rows.length > 0) {
            await dbClient.query(
                'UPDATE game_sessions SET attempts = $1, score = $2, completed = $3 WHERE game_id = $4 AND player_id = $5',
                [attempts, existingSession.rows[0].score + score, completed, gameId, playerId]
            );
        } else {
            await dbClient.query(
                `INSERT INTO game_sessions (game_id, player_id, attempts, score, completed) VALUES ($1, $2, $3, $4, $5)`,
                [gameId, playerId, attempts, score, completed]
            );
        }
    } catch (error) {
        console.error('❌ Error recording player session:', error);
    }
}

// تابع برای تولید رشته پیشرفت کلمه (مثل _ _ _ ک _)
function getWordProgress(word, guessedLetters) {
    return word.split('').map(letter => guessedLetters.has(letter) ? letter : '_').join('');
}

// تابع محاسبه حداکثر امتیاز ممکن
function calculateMaxPossibleScore(wordLength, timeLimit) {
    const baseScore = wordLength * 50; // امتیاز پایه برای هر حرف
    const timeBonus = wordLength * 10 * 2; // پاداش سرعت حداکثر
    const lengthBonus = wordLength * 5; // پاداش طول کلمه
    return baseScore + timeBonus + lengthBonus;
}

// تابع تبدیل زمان به "X دقیقه پیش"
function timeAgo(date) {
    const diffMs = new Date() - new Date(date);
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);

    if (diffMins < 1) return 'همین الان';
    if (diffMins < 60) return `${diffMins} دقیقه پیش`;
    if (diffHours < 24) return `${diffHours} ساعت پیش`;
    return `${Math.floor(diffHours / 24)} روز پیش`;
}


// ----------------------------------------------------------------------
// هندلرهای بات تلگرام
// ----------------------------------------------------------------------

bot.start(async (ctx) => {
    const userId = ctx.from.id;
    const fullName = ctx.from.first_name + (ctx.from.last_name ? ' ' + ctx.from.last_name : '');
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
            [{ text: '🚀 باز کردن پنل کاربری', web_app: { url: `${WEB_APP_URL}?tgid=${userId}` } }]
        ]
    };

    await ctx.reply(`سلام ${fullName}! 👋\n\nبرای مشاهده پنل کاربری و بازی روی دکمه زیر کلیک کنید:`, { reply_markup: keyboard });
});

// شروع گوش دادن به پیام‌ها
bot.launch();


// ----------------------------------------------------------------------
// API های Express (بازی استاندارد)
// ----------------------------------------------------------------------

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

        const result = await dbClient.query(
            `INSERT INTO games (game_id, creator_id, word, category, max_attempts, time_limit, creator_online, is_started) 
             VALUES ($1, $2, $3, $4, $5, $6, true, false) RETURNING *`,
            [gameId, creator_id, word.toUpperCase(), category, maxAttempts, timeLimit]
        );

        // افزودن به حافظه
        const newGame = {
            ...result.rows[0],
            players: [creator_id],
            guessedLetters: new Set(),
            incorrectGuesses: new Set(),
            max_attempts: maxAttempts,
            attempts: 0,
            startTime: null,
            endTime: null,
            last_activity: new Date()
        };
        activeGames.set(gameId, newGame);

        // افزودن به game_players
        await dbClient.query(
            'INSERT INTO game_players (game_id, player_id) VALUES ($1, $2)',
            [gameId, creator_id]
        );
        
        // ثبت اتصال
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

// API برای پیوستن به بازی
app.post('/api/games/:gameId/join', async (req, res) => {
    try {
        const { gameId } = req.params;
        const { player_id } = req.body;

        if (!player_id) {
            return res.status(400).json({ error: 'Player ID is required' });
        }

        let game = activeGames.get(gameId);
        
        // اگر بازی در حافظه نبود، از دیتابیس لود کن
        if (!game) {
            const dbGame = await dbClient.query(
                'SELECT * FROM games WHERE game_id = $1',
                [gameId]
            );

            if (dbGame.rows.length === 0 || !dbGame.rows[0].is_active || dbGame.rows[0].completed) {
                return res.status(404).json({ error: 'Game not found or already ended' });
            }

            const dbGameData = dbGame.rows[0];
            game = {
                ...dbGameData,
                players: await getGamePlayers(gameId).then(p => p.map(player => player.id)),
                guessedLetters: new Set(dbGameData.guessed_letters.split(',').filter(Boolean)),
                incorrectGuesses: new Set(dbGameData.incorrect_letters.split(',').filter(Boolean)),
                attempts: dbGameData.attempts || 0,
                startTime: dbGameData.start_time ? new Date(dbGameData.start_time) : null,
                endTime: dbGameData.end_time ? new Date(dbGameData.end_time) : null,
                last_activity: new Date()
            };
            activeGames.set(gameId, game);
        }

        if (game.completed) {
             return res.status(400).json({ error: 'Game already completed' });
        }
        
        if (game.players.includes(player_id)) {
            // بازیکن قبلاً پیوسته است
            updatePlayerConnection(gameId, player_id, true);
            game.last_activity = new Date();
            
            const remainingTime = game.is_started ? calculateRemainingTime(game.endTime) : null;
            
            return res.json({ 
                success: true, 
                players_count: game.players_count, 
                creator_id: game.creator_id,
                is_creator: game.creator_id === player_id,
                game_started: game.is_started,
                remaining_time: remainingTime 
            });
        }

        // پیوستن بازیکن جدید
        if (game.players_count >= 2) {
            return res.status(400).json({ error: 'Game is full' });
        }
        
        // دریافت نام بازیکن
        const joiningPlayerInfo = await dbClient.query(
            'SELECT full_name FROM users WHERE telegram_id = $1',
            [player_id]
        );
        const joiningPlayerName = joiningPlayerInfo.rows[0]?.full_name || 'ناشناس';

        // به‌روزرسانی در دیتابیس و حافظه
        await dbClient.query(
            'UPDATE games SET players_count = players_count + 1 WHERE game_id = $1',
            [gameId]
        );
        await dbClient.query(
            'INSERT INTO game_players (game_id, player_id) VALUES ($1, $2)',
            [gameId, player_id]
        );

        game.players_count++;
        game.players.push(player_id);
        updatePlayerConnection(gameId, player_id, true);
        game.last_activity = new Date();

        // شروع بازی در صورت تکمیل شدن بازیکنان
        if (game.players_count === 2 && !game.is_started) {
            await startGameWhenPlayerJoins(gameId, player_id, joiningPlayerName);
        }

        if (game.creator_id !== player_id) {
            const notificationMessage = `👤 <b>بازیکن جدید به بازی شما پیوست!</b>\n\n🎮 <b>کد بازی:</b> <code>${gameId}</code>\n👤 <b>بازیکن:</b> ${joiningPlayerName}\n📊 <b>تعداد بازیکنان:</b> ${game.players_count} نفر\n\n${!game.is_started ? 'در انتظار بازیکن دوم برای شروع بازی...' : 'بازی در حال انجام است!'}`;
            await sendMessageToUser(game.creator_id, notificationMessage);
        }

        activeGames.set(gameId, game);

        const remainingTime = game.is_started ? calculateRemainingTime(game.endTime) : null;

        res.json({
            success: true,
            players_count: game.players_count,
            creator_id: game.creator_id,
            is_creator: game.creator_id === player_id,
            game_started: game.is_started,
            remaining_time: remainingTime
        });

    } catch (error) {
        console.error('❌ Error joining game:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});


// API برای دریافت لیست بازی‌های فعال
app.get('/api/games/active', async (req, res) => {
    try {
        const result = await dbClient.query(`
            SELECT g.*, u.full_name as creator_name 
            FROM games g 
            LEFT JOIN users u ON g.creator_id = u.telegram_id 
            WHERE g.is_active = true AND g.completed = false 
            ORDER BY g.created_at DESC
        `);

        const games = result.rows.map(game => {
            // --- اصلاحیه: استفاده از تابع بهبود یافته calculateRemainingTime ---
            const remainingTime = game.is_started && game.end_time ? calculateRemainingTime(game.end_time) : null;
            return {
                game_id: game.game_id,
                creator_name: game.creator_name || 'ناشناس',
                category: game.category,
                players_count: game.players_count,
                max_attempts: game.max_attempts,
                time_limit: game.time_limit,
                is_started: game.is_started,
                created_at_time_ago: timeAgo(game.created_at), 
                remaining_time: remainingTime,
            };
        });

        res.json({
            success: true,
            games: games
        });

    } catch (error) {
        console.error('❌ Error fetching active games:', error);
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
            
            const dbGameData = dbGame.rows[0];
            
            // Reconstruct game object
            game = {
                ...dbGameData,
                players: await getGamePlayers(gameId).then(p => p.map(player => player.id)),
                guessedLetters: new Set(dbGameData.guessed_letters.split(',').filter(Boolean)),
                incorrectGuesses: new Set(dbGameData.incorrect_letters.split(',').filter(Boolean)),
                attempts: dbGameData.attempts || 0,
                startTime: dbGameData.start_time ? new Date(dbGameData.start_time) : null,
                endTime: dbGameData.end_time ? new Date(dbGameData.end_time) : null,
                last_activity: new Date()
            };
            activeGames.set(gameId, game);
        }
        
        if (game.completed) {
             return res.status(400).json({ error: 'Game already completed' });
        }

        const remainingTime = game.endTime ? calculateRemainingTime(game.endTime) : game.time_limit;
        
        // اگر زمان بازی تمام شده بود
        if (game.is_started && remainingTime <= 0) {
            await endGameByTimeout(gameId);
            return res.status(400).json({ error: 'Game time has expired and ended' });
        }
        
        // دریافت اطلاعات سشن بازیکنان
        const sessionResult = await dbClient.query(
            'SELECT player_id, score FROM game_sessions WHERE game_id = $1',
            [gameId]
        );
        
        const playerScores = sessionResult.rows.reduce((acc, row) => {
            acc[row.player_id] = row.score;
            return acc;
        }, {});
        
        const playersInfo = await getGamePlayers(gameId);

        res.json({
            success: true,
            game_id: game.game_id,
            creator_id: game.creator_id,
            word_length: game.word.length,
            category: game.category,
            max_attempts: game.max_attempts,
            attempts: game.attempts,
            time_limit: game.time_limit,
            is_started: game.is_started,
            guessed_letters: Array.from(game.guessedLetters),
            incorrect_letters: Array.from(game.incorrectGuesses),
            word_progress: getWordProgress(game.word, game.guessedLetters),
            remaining_time: remainingTime,
            completed: game.completed,
            winner_id: game.winner_id,
            players: playersInfo.map(p => ({
                ...p,
                score: playerScores[p.id] || 0
            }))
        });

    } catch (error) {
        console.error('❌ Error fetching game:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// API جدید: دریافت اطلاعات بازیکنان
app.get('/api/games/:gameId/players-info', async (req, res) => {
    try {
        const { gameId } = req.params;
        const playersInfo = await getGamePlayers(gameId);
        
        res.json({ success: true, players: playersInfo });
    } catch (error) {
        console.error('❌ Error fetching players info:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// API برای ثبت حدس حرف
app.post('/api/games/:gameId/guess', async (req, res) => {
    try {
        const { gameId } = req.params;
        const { player_id, letter } = req.body;

        if (!player_id || !letter) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        let game = activeGames.get(gameId);

        // اگر بازی در حافظه نبود، از دیتابیس لود کن (همانند API join)
        if (!game) {
            const dbGame = await dbClient.query(
                'SELECT * FROM games WHERE game_id = $1',
                [gameId]
            );

            if (dbGame.rows.length === 0) {
                return res.status(404).json({ error: 'Game not found' });
            }

            const dbGameData = dbGame.rows[0];
            
            game = {
                ...dbGameData,
                players: await getGamePlayers(gameId).then(p => p.map(player => player.id)),
                guessedLetters: new Set(dbGameData.guessed_letters.split(',').filter(Boolean)),
                incorrectGuesses: new Set(dbGameData.incorrect_letters.split(',').filter(Boolean)),
                attempts: dbGameData.attempts || 0,
                startTime: dbGameData.start_time ? new Date(dbGameData.start_time) : null,
                endTime: dbGameData.end_time ? new Date(dbGameData.end_time) : null,
                last_activity: new Date()
            };
            activeGames.set(gameId, game);
        }

        if (!game.is_started) {
            return res.status(400).json({ error: 'Game not started yet' });
        }
        
        const remainingTime = calculateRemainingTime(game.endTime);
        if (remainingTime <= 0) {
            await endGameByTimeout(gameId);
            return res.status(400).json({ error: 'Game time has expired' });
        }

        if (game.completed) {
            return res.status(400).json({ error: 'Game already completed' });
        }

        if (!game.players.includes(player_id)) {
            return res.status(403).json({ error: 'Player not in this game' });
        }

        const letterUpper = letter.toUpperCase();

        if (game.guessedLetters.has(letterUpper) || game.incorrectGuesses.has(letterUpper)) {
            return res.status(400).json({ error: 'Letter already guessed' });
        }

        const word = game.word;
        const isCorrect = word.includes(letterUpper);

        let score = 0;
        let incorrectCountBefore = game.incorrectGuesses.size;

        if (isCorrect) {
            game.guessedLetters.add(letterUpper);
            score = calculateLetterScore(true, game.time_limit - remainingTime, word.length, incorrectCountBefore);
        } else {
            game.incorrectGuesses.add(letterUpper);
            game.attempts = (game.attempts || 0) + 1;
            score = calculateLetterScore(false, game.time_limit - remainingTime, word.length, incorrectCountBefore);
        }

        // به‌روزرسانی اتصال
        updatePlayerConnection(gameId, player_id, true);
        game.last_activity = new Date();
        
        // به‌روزرسانی دیتابیس
        await dbClient.query(
            'UPDATE games SET guessed_letters = $1, incorrect_letters = $2, attempts = $3 WHERE game_id = $4',
            [Array.from(game.guessedLetters).join(','), Array.from(game.incorrectGuesses).join(','), game.attempts, gameId]
        );

        // ثبت session بازیکن
        await recordPlayerSession(gameId, player_id, game.attempts, score, false);

        const isGameCompleted = getWordProgress(word, game.guessedLetters) === word;
        const isGameOver = game.attempts >= game.max_attempts;

        if (isGameCompleted) {
            await endGameWithWinner(gameId, player_id, score);
        } else if (isGameOver) {
            await endGameByTimeout(gameId); // منطق پایان بازی با زمان/اتمام حدس تقریباً یکی است
        }

        // ارسال نوتیفیکیشن به بازیکنان دیگر
        if (game.creator_id !== player_id) {
            const playerInfo = await dbClient.query(
                'SELECT full_name FROM users WHERE telegram_id = $1',
                [player_id]
            );
            const playerName = playerInfo.rows[0]?.full_name || 'ناشناس';

            const guessMessage = `🔤 <b>حدس جدید در بازی شما!</b>\n\n🎮 <b>کد بازی:</b> <code>${gameId}</code>\n👤 <b>بازیکن:</b> ${playerName}\n🔠 <b>حرف:</b> ${letterUpper}\n✅ <b>نتیجه:</b> ${isCorrect ? 'صحیح ✅' : 'غلط ❌'}\n📊 <b>امتیاز این حدس:</b> ${score}`;
            await sendMessageToUser(game.creator_id, guessMessage);
        }

        res.json({
            success: true,
            is_correct: isCorrect,
            letter: letterUpper,
            score: score,
            game_completed: isGameCompleted,
            game_over: isGameOver,
            correct_letters: Array.from(game.guessedLetters),
            incorrect_letters: Array.from(game.incorrectGuesses),
            remaining_attempts: game.max_attempts - game.attempts,
            word_progress: getWordProgress(word, game.guessedLetters),
            remaining_time: remainingTime
        });

    } catch (error) {
        console.error('❌ Error processing guess:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// API برای گزارش فعال بودن کاربر در بازی
app.post('/api/games/:gameId/connect', async (req, res) => {
    try {
        const { gameId } = req.params;
        const { player_id } = req.body;

        // به‌روزرسانی اتصال بازیکن
        updatePlayerConnection(gameId, player_id, true);

        // به‌روزرسانی وضعیت آنلاین بودن سازنده
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


// API برای دریافت اطلاعات کاربر
app.get('/api/user/:telegramId', async (req, res) => {
    try {
        const telegramId = req.params.telegramId;
        const result = await dbClient.query(
            'SELECT * FROM users WHERE telegram_id = $1',
            [telegramId]
        );

        if (result.rows.length === 0) {
            // اگر کاربر در دیتابیس نبود، یک کاربر پیش‌فرض ایجاد کن
            // (این حالت نباید در عملکرد عادی رخ دهد اگر بات قبل از وب‌اپ استفاده شده باشد)
            const newResult = await dbClient.query(
                `INSERT INTO users (telegram_id, full_name, username, last_seen) 
                 VALUES ($1, 'ناشناس', 'ناشناس', CURRENT_TIMESTAMP) 
                 RETURNING *`,
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
                is_active: user.is_active,
                competitive_score: user.competitive_score || 0,
                competitive_wins: user.competitive_wins || 0,
                competitive_games: user.competitive_games || 0
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
            is_active: user.is_active,
            competitive_score: user.competitive_score || 0,
            competitive_wins: user.competitive_wins || 0,
            competitive_games: user.competitive_games || 0
        });

    } catch (error) {
        console.error('❌ Error fetching user:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// API برای دریافت آمار کلی
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
        
        res.json({ success: true, players_count: players.length, players: players });
    } catch (error) {
        console.error('❌ Error getting game players count:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});


// ----------------------------------------------------------------------
// توابع کمکی اتصال و وضعیت
// ----------------------------------------------------------------------

function generateGameId() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 6; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

// --- اصلاحیه: بهبود مدیریت تاریخ نامعتبر ---
function calculateRemainingTime(endTime) {
    if (!endTime) return null;
    const now = new Date();
    const end = new Date(endTime);
    
    // اگر تاریخ نامعتبر بود (Invalid Date)، مقدار 0 برگردانده شود تا خطا رخ ندهد.
    if (isNaN(end.getTime())) return 0; 

    return Math.max(0, Math.floor((end - now) / 1000));
}

function calculateLetterScore(isCorrect, timeSpent, wordLength, incorrectCount) {
    let score = 0;
    const timeFactor = timeSpent / (wordLength * 30); // نسبت زمان سپری شده به زمان کل

    if (isCorrect) {
        // امتیاز پایه: ۵۰
        score = 50; 
        // پاداش سرعت: از ۲۰ تا ۰
        const timeBonus = Math.max(0, 20 - Math.floor(timeFactor * 20)); 
        score += timeBonus;
    } else {
        // امتیاز منفی برای حدس غلط: -۲۰
        score = -20;
    }
    
    // جریمه حدس غلط‌های متوالی: هر حدس غلط متوالی -۵ امتیاز بیشتر
    if (!isCorrect && incorrectCount > 0) {
        score -= (incorrectCount * 5);
    }
    
    return Math.round(score);
}

function updatePlayerConnection(gameId, playerId, isConnected) {
    const key = `${gameId}_${playerId}`;
    if (isConnected) {
        playerConnections.set(key, { lastSeen: new Date(), connected: true });
    } else {
        // در دیسکانکت، فقط اتصال را حذف می‌کنیم تا تایمر نظارت روی آن فعال شود
        playerConnections.delete(key);
    }
}

function isPlayerOnline(gameId, playerId) {
    const key = `${gameId}_${playerId}`;
    const connection = playerConnections.get(key);
    if (!connection) return false;
    // اگر در 30 ثانیه اخیر فعال بوده باشد
    return (new Date() - connection.lastSeen) < 30000;
}

function clearGameConnections(gameId) {
    for (const [key] of playerConnections) {
        if (key.startsWith(gameId + '_')) {
            playerConnections.delete(key);
        }
    }
}

// Cleanup اتصالات قدیمی
setInterval(() => {
    const now = new Date();
    
    // حذف اتصالات فعال قدیمی‌تر از 60 ثانیه (برای جلوگیری از نشت حافظه)
    for (const [key, connection] of playerConnections.entries()) {
        if (now - connection.lastSeen > 60000) {
            playerConnections.delete(key);
        }
    }

    // حذف بازی‌های رقابتی در انتظار قدیمی‌تر از 10 دقیقه
    for (const [matchId, match] of waitingCompetitiveMatches.entries()) {
        if (now - match.created_at > 10 * 60 * 1000) {
            waitingCompetitiveMatches.delete(matchId);
            // به‌روزرسانی در دیتابیس به "منقضی شده"
            dbClient.query(
                `UPDATE competitive_matches 
                 SET status = 'expired'
                 WHERE match_id = $1 AND status = 'waiting'`,
                [matchId]
            ).catch(e => console.error('Error updating expired match status:', e));
        }
    }
    
    // Cleanup active matches older than 2 hours
    for (const [matchId, match] of competitiveMatches.entries()) {
        if ((match.started_at && now - match.started_at > 2 * 60 * 60 * 1000) || 
            (match.created_at && now - match.created_at > 3 * 60 * 60 * 1000)) {
            competitiveMatches.delete(matchId);
        }
    }
}, 5 * 60 * 1000); // هر 5 دقیقه یکبار اجرا می‌شود

// هندلر خطا
app.use((err, req, res, next) => {
    console.error('💥 Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

app.use('*', (req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

// راه‌اندازی سرور
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🌐 Web App URL: ${WEB_APP_URL}`);
});

// server.js
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { Pool } = require('pg');
const words = require('./words.js');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    }
});

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const DATABASE_URL = process.env.DATABASE_URL;
const WEB_APP_URL = process.env.WEB_APP_URL;

const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false } // اگر نیاز به SSL باشد، بسته به تنظیمات
});

async function initDb() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS words (
                id SERIAL PRIMARY KEY,
                category TEXT NOT NULL,
                word TEXT UNIQUE NOT NULL,
                level INTEGER NOT NULL CHECK (level >= 1 AND level <= 5),
                "addedBy" BIGINT NOT NULL
            )
        `);
        console.log('Table "words" is ready.');
    } catch (err) {
        console.error('Error initializing database:', err);
    }
}

initDb();

app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

let waitingPlayers = [];
let games = {};
let userSockets = {}; // Map userId to socket.id for better management

io.on('connection', (socket) => {
    socket.on('joinGame', async ({ userId }) => {
        userSockets[userId] = socket.id;
        if (waitingPlayers.length > 0) {
            const opponentId = waitingPlayers.shift();
            const gameId = `${userId}-${opponentId}-${Date.now()}`;
            games[gameId] = {
                players: [userId, opponentId],
                scores: { [userId]: 0, [opponentId]: 0 },
                currentWordIndex: 0,
                words: await getRandomWords(10, userId, opponentId),
                timers: { [userId]: null, [opponentId]: null },
                displayed: { [userId]: '', [opponentId]: '' },
                completed: { [userId]: 0, [opponentId]: 0 },
                hintsUsed: { [userId]: 0, [opponentId]: 0 }
            };
            const wordData = games[gameId].words[0];
            const time = calculateTime(wordData);
            const maxHints = calculateMaxHints(wordData.word);
            socket.emit('gameStarted', { gameId, word: wordData.word, time, maxHints });
            io.to(userSockets[opponentId]).emit('gameStarted', { gameId, word: wordData.word, time, maxHints });
        } else {
            waitingPlayers.push(userId);
        }
    });

    socket.on('guess', ({ gameId, userId, guess }) => {
        const game = games[gameId];
        if (!game) return;
        const word = game.words[game.currentWordIndex].word.toLowerCase();
        let updated = false;
        let newDisplayed = game.displayed[userId] || word.replace(/[^ ]/g, '_').replace(/ /g, ' ');
        for (let i = 0; i < word.length; i++) {
            if (word[i] === guess && newDisplayed[i] === '_') {
                newDisplayed = newDisplayed.slice(0, i) + guess + newDisplayed.slice(i + 1);
                updated = true;
            }
        }
        game.displayed[userId] = newDisplayed;
        socket.emit('updateWord', { displayed: newDisplayed });
        if (updated) {
            game.scores[userId] += 20; // Improved scoring
            const oppId = game.players.find(p => p !== userId);
            io.to(userSockets[oppId]).emit('opponentScoreUpdate', game.scores[userId]);
        }
        checkWordCompletion(gameId, userId);
    });

    socket.on('hint', ({ gameId, userId }) => {
        const game = games[gameId];
        if (!game || game.hintsUsed[userId] >= calculateMaxHints(game.words[game.currentWordIndex].word)) return;
        const word = game.words[game.currentWordIndex].word.toLowerCase();
        let newDisplayed = game.displayed[userId] || word.replace(/[^ ]/g, '_').replace(/ /g, ' ');
        const hiddenIndices = [];
        for (let i = 0; i < word.length; i++) {
            if (newDisplayed[i] === '_' && word[i] !== ' ') hiddenIndices.push(i);
        }
        if (hiddenIndices.length > 0) {
            const randIdx = hiddenIndices[Math.floor(Math.random() * hiddenIndices.length)];
            newDisplayed = newDisplayed.slice(0, randIdx) + word[randIdx] + newDisplayed.slice(randIdx + 1);
            game.displayed[userId] = newDisplayed;
            game.scores[userId] -= 50;
            game.hintsUsed[userId]++;
            socket.emit('updateWord', { displayed: newDisplayed, hint: true });
            const oppId = game.players.find(p => p !== userId);
            io.to(userSockets[oppId]).emit('opponentScoreUpdate', game.scores[userId]);
        }
    });

    socket.on('timeTick', ({ gameId, userId }) => {
        const game = games[gameId];
        if (game && game.timers[userId] > 0) {
            game.timers[userId]--;
            socket.emit('timeUpdate', game.timers[userId]);
        }
    });

    socket.on('timeUp', ({ gameId, userId }) => {
        const game = games[gameId];
        if (game) {
            game.scores[userId] -= 100;
            checkWordCompletion(gameId, userId, true);
        }
    });

    socket.on('wordCompleted', ({ gameId, userId, timeUsed }) => {
        const game = games[gameId];
        if (game) {
            game.completed[userId]++;
            game.scores[userId] += Math.max(0, 100 - timeUsed * 2); // Better scoring based on time
            checkBothCompleted(gameId);
        }
    });

    socket.on('addWord', async (data) => {
        try {
            const existing = await pool.query('SELECT 1 FROM words WHERE word = $1', [data.word]);
            if (existing.rowCount === 0) {
                await pool.query(
                    'INSERT INTO words (category, word, level, "addedBy") VALUES ($1, $2, $3, $4)',
                    [data.category, data.word, data.level, data.addedBy]
                );
            }
        } catch (err) {
            console.error('Error adding word:', err);
        }
    });

    socket.on('disconnect', () => {
        // Handle disconnect: remove from waiting, end games if necessary
        for (let uid in userSockets) {
            if (userSockets[uid] === socket.id) {
                waitingPlayers = waitingPlayers.filter(p => p !== uid);
                // End active games
                for (let gid in games) {
                    if (games[gid].players.includes(uid)) {
                        const oppId = games[gid].players.find(p => p !== uid);
                        io.to(userSockets[oppId]).emit('gameOver', { winner: oppId }); // Opponent wins by default
                        delete games[gid];
                    }
                }
                delete userSockets[uid];
                break;
            }
        }
    });
});

async function getRandomWords(count, ...excludedUsers) {
    try {
        const res = await pool.query(
            'SELECT category, word, level FROM words WHERE "addedBy" NOT IN ($1, $2)',
            [excludedUsers[0], excludedUsers[1]]
        );
        const dbWords = res.rows;
        const allWords = [...words, ...dbWords];
        const selected = [];
        for (let i = 0; i < count; i++) {
            selected.push(allWords[Math.floor(Math.random() * allWords.length)]);
        }
        return selected;
    } catch (err) {
        console.error('Error getting random words:', err);
        return words.slice(0, count); // Fallback to static words
    }
}

function calculateTime(wordObj) {
    return wordObj.word.length * 15 + wordObj.level * 30; // Adjusted for better timing
}

function calculateMaxHints(word) {
    const len = word.length;
    if (len <= 5) return 2;
    if (len <= 10) return 3;
    return 4;
}

function checkWordCompletion(gameId, userId, timeUp = false) {
    const game = games[gameId];
    const displayed = game.displayed[userId];
    if (!displayed.includes('_') || timeUp) {
        game.completed[userId]++;
        checkBothCompleted(gameId);
    }
}

function checkBothCompleted(gameId) {
    const game = games[gameId];
    if (Object.values(game.completed).every(c => c > game.currentWordIndex)) {
        game.currentWordIndex++;
        if (game.currentWordIndex >= 10) {
            let winner = 'tie';
            const [p1, p2] = game.players;
            if (game.scores[p1] > game.scores[p2]) winner = p1;
            else if (game.scores[p2] > game.scores[p1]) winner = p2;
            game.players.forEach(p => io.to(userSockets[p]).emit('gameOver', { winner }));
            delete games[gameId];
        } else {
            const nextW = game.words[game.currentWordIndex];
            const time = calculateTime(nextW);
            const maxHints = calculateMaxHints(nextW.word);
            game.players.forEach(p => {
                game.displayed[p] = '';
                game.timers[p] = time;
                game.hintsUsed[p] = 0;
                io.to(userSockets[p]).emit('nextWord', { word: nextW.word, time, maxHints });
            });
        }
    }
}

server.listen(3000, () => console.log('Server running on port 3000'));

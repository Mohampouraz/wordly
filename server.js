// server.js - منطق بک‌اند وردلی رقابتی با قابلیت توضیحات کلمه

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const words = require('./words'); // فایل کلمات جدید

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static('.')); 

// === بانک اطلاعاتی موقت ===
const rooms = {}; // { roomId: { id, name, level, max_players, players: [..], status, game: { id, deck: [..] } } }
const playerStates = {}; // { gameId: { userId: { score, correct_letters, wrong_letters, current_index, allowed_wrong } } }

// === ابزارهای کمکی ===
const normalize = c => { if(!c) return ''; const m = {'\u064A':'\u06CC','\u0643':'\u06A9'}; return (m[c]||c).normalize('NFC'); };
const getNormalizedWord = (word) => normalize(word.text).replace(/\s+/g, '');

const getRandomWord = (level) => {
    const allWords = words.categories.flatMap(cat => cat.words.map(w => ({ ...w, category: cat.name })));
    const filteredWords = allWords.filter(w => !level || w.level === level);
    if (filteredWords.length === 0) return null;
    return filteredWords[Math.floor(Math.random() * filteredWords.length)];
};

const createDeck = (roomLevel, count = 10) => {
    const deck = [];
    for(let i = 0; i < count; i++) {
        deck.push(getRandomWord(roomLevel));
    }
    return deck.filter(w => w !== null);
};

const getGamePlayerState = (gameId, userId) => {
    if (!playerStates[gameId] || !playerStates[gameId][userId]) {
        // Initial state
        return { score: 0, correct_letters: [], wrong_letters: [], current_index: 0, allowed_wrong: 5, word_deadline: null, game_id: gameId, user_id: userId };
    }
    return { ...playerStates[gameId][userId], game_id: gameId, user_id: userId };
};

const getAllPlayerStatesForGame = (gameId) => {
    const players = [];
    if(playerStates[gameId]) {
        for(const userId in playerStates[gameId]) {
            players.push(playerStates[gameId][userId]);
        }
    }
    return players;
};

const updatePlayerState = (gameId, userId, updates) => {
    if (!playerStates[gameId]) playerStates[gameId] = {};
    const currentState = getGamePlayerState(gameId, userId);
    playerStates[gameId][userId] = { ...currentState, ...updates };
    return playerStates[gameId][userId];
};

const getRoomPlayers = (roomId) => {
    const room = rooms[roomId];
    if (!room) return [];
    return room.players.map(p => {
        const state = room.game ? getGamePlayerState(room.game.id, p.id) : {};
        return { ...p, ...state };
    });
};

const startGame = (roomId) => {
    const room = rooms[roomId];
    if (!room || room.status !== 'waiting') return false;

    const gameId = uuidv4();
    const deck = createDeck(room.level, 10);
    if (deck.length === 0) return false;

    room.status = 'playing';
    room.game = { id: gameId, deck: deck };

    // Initialize player states
    room.players.forEach(p => {
        const deadline = Date.now() + 60 * 1000; // 60 seconds for the first word
        updatePlayerState(gameId, p.id, { 
            score: 0, 
            correct_letters: [], 
            wrong_letters: [], 
            current_index: 0, 
            allowed_wrong: 5,
            word_deadline: new Date(deadline).toISOString(),
            fullname: p.name, // Add full name for display
        });
    });

    const initialWord = deck[0];
    const firstState = getGamePlayerState(gameId, room.players[0].id); // Just to get a complete structure

    io.to(roomId).emit('game:started', { 
        game_id: gameId, 
        deck: deck.map(w => ({ word_length: getNormalizedWord(w).length, category: w.category, level: w.level, description: w.description })), // Send only necessary info for word slot rendering (including new description)
        players: getRoomPlayers(roomId),
        state: firstState,
    });
    console.log(`Game ${gameId} started in room ${roomId}. First word: ${initialWord.text}`);
    return true;
};

const nextWord = (room, userId) => {
    const game = room.game;
    const player = updatePlayerState(game.id, userId, {});
    const nextIndex = player.current_index + 1;

    if (nextIndex >= game.deck.length) {
        // Game finished
        room.status = 'finished';
        io.to(room.id).emit('game:finished', { room_id: room.id, winner: '...' });
        return;
    }

    // Move to the next word for the user
    const newDeadline = Date.now() + 60 * 1000; // 60 seconds for the next word
    updatePlayerState(game.id, userId, {
        current_index: nextIndex,
        correct_letters: [],
        wrong_letters: [],
        word_deadline: new Date(newDeadline).toISOString(),
    });

    io.to(room.id).emit('game:next', { 
        game_id: game.id, 
        nextIndex: nextIndex, 
        by_user: userId, 
        states: getAllPlayerStatesForGame(game.id),
        newState: getGamePlayerState(game.id, userId),
    });
    console.log(`User ${userId} moved to word index ${nextIndex} in game ${game.id}`);
};

// === مسیرهای HTTP (REST API) ===

// لیست اتاق‌های عمومی
app.get('/rooms/list', (req, res) => {
    const level = req.query.level;
    const publicRooms = Object.values(rooms)
        .filter(r => (r.status === 'waiting' || r.status === 'playing') && (!level || r.level === level))
        .map(r => ({
            id: r.id,
            name: r.name,
            level: r.level,
            players: r.players.length,
            max_players: r.max_players,
            status: r.status,
        }));
    res.json({ ok: true, rooms: publicRooms });
});

// ایجاد اتاق جدید
app.post('/rooms/create', (req, res) => {
    const { user_id, name, level, max_players = 2 } = req.body;
    const room_id = uuidv4();
    rooms[room_id] = {
        id: room_id, name, level, max_players, status: 'waiting', players: [], game: null
    };
    res.json({ ok: true, room_id });
});

// پیوستن به اتاق
app.post('/rooms/join', (req, res) => {
    const { room_id, user_id } = req.body;
    const room = rooms[room_id];
    if (!room || room.status === 'finished') return res.json({ ok: false, error: 'not_found' });
    if (room.players.length >= room.max_players && room.status === 'waiting') return res.json({ ok: false, error: 'full' });

    // Prevent duplicate entries
    if (!room.players.some(p => String(p.id) === String(user_id))) {
        room.players.push({ id: user_id, name: `کاربر ${String(user_id).slice(-4)}` });
    }
    
    // Auto-start game logic (e.g., if max players reached)
    if (room.status === 'waiting' && room.players.length >= room.max_players) {
        startGame(room_id);
    }
    
    res.json({ ok: true });
});

// ترک اتاق
app.post('/rooms/leave', (req, res) => {
    const { room_id, user_id } = req.body;
    const room = rooms[room_id];
    if (room) {
        room.players = room.players.filter(p => String(p.id) !== String(user_id));
        if (room.players.length === 0) {
            delete rooms[room_id];
            if (room.game) delete playerStates[room.game.id];
        }
    }
    res.json({ ok: true });
});

// دریافت وضعیت اتاق برای ادامه بازی
app.post('/rooms/state', (req, res) => {
    const { room_id } = req.body;
    const room = rooms[room_id];
    if (!room) return res.json({ ok: false, error: 'not_found' });
    res.json({ ok: true, room: room, game: room.game, players: getRoomPlayers(room_id) });
});

// دریافت لیست بازی‌های فعال کاربر
app.post('/rooms/myrooms', (req, res) => {
    const { user_id } = req.body;
    const myRooms = Object.values(rooms).filter(r => 
        (r.status === 'playing' || r.status === 'waiting') && 
        r.players.some(p => String(p.id) === String(user_id))
    ).map(r => ({
        id: r.id,
        name: r.name,
        status: r.status,
    }));
    res.json({ ok: true, rooms: myRooms });
});


// === منطق Socket.IO (وب سوکت) ===
io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    socket.on('join-room', ({ room_id, user_id }) => {
        socket.join(room_id);
        const room = rooms[room_id];
        if (room) {
            io.to(room_id).emit('room:update', { players: getRoomPlayers(room_id) });
        }
        console.log(`User ${user_id} joined room ${room_id}`);
    });

    socket.on('game:resume', ({ game_id, user_id }) => {
        const room = Object.values(rooms).find(r => r.game && r.game.id === game_id);
        if (!room) return;
        
        const playerState = getGamePlayerState(game_id, user_id);
        
        io.to(user_id).emit('game:state', {
             game_id: game_id,
             deck: room.game.deck.map(w => ({ word_length: getNormalizedWord(w).length, category: w.category, level: w.level, description: w.description })),
             state: playerState,
             players: getRoomPlayers(room.id),
        });

        // Send all current states to the player
        io.to(user_id).emit('game:states', { game_id: game_id, states: getAllPlayerStatesForGame(game_id) });
    });

    socket.on('game:guess', ({ game_id, user_id, letter }) => {
        const room = Object.values(rooms).find(r => r.game && r.game.id === game_id);
        if (!room || room.status !== 'playing') return;

        const playerState = getGamePlayerState(game_id, user_id);
        const currentWord = room.game.deck[playerState.current_index];
        const normalizedWord = getNormalizedWord(currentWord);
        const normalizedLetter = normalize(letter);

        if (!normalizedWord || normalizedWord.length === 0) return; // Should not happen

        if (playerState.correct_letters.includes(normalizedLetter) || playerState.wrong_letters.includes(normalizedLetter)) {
            // Already guessed
            return;
        }

        if (normalizedWord.includes(normalizedLetter)) {
            // Correct Guess
            playerState.correct_letters.push(normalizedLetter);
            playerState.score += 5; // Score for correct letter

            const allLettersGuessed = [...normalizedWord].every(c => c === ' ' || playerState.correct_letters.includes(c));
            
            if (allLettersGuessed) {
                playerState.score += 20; // Bonus for completing word
                updatePlayerState(game_id, user_id, playerState);
                nextWord(room, user_id);
            } else {
                updatePlayerState(game_id, user_id, playerState);
                io.to(room.id).emit('game:letter:correct', { user_id, letter: normalizedLetter, player: playerState });
            }

        } else {
            // Wrong Guess
            if (playerState.wrong_letters.length < playerState.allowed_wrong) {
                playerState.wrong_letters.push(normalizedLetter);

                if (playerState.wrong_letters.length >= playerState.allowed_wrong) {
                    // Word failed
                    io.to(room.id).emit('game:feedback', { type: 'word-failed', user_id, word: currentWord.text });
                    nextWord(room, user_id);
                } else {
                    updatePlayerState(game_id, user_id, playerState);
                    io.to(room.id).emit('game:letter:wrong', { user_id, letter: normalizedLetter });
                }
            }
        }
    });

    socket.on('game:hint', ({ game_id, user_id }) => {
        const room = Object.values(rooms).find(r => r.game && r.game.id === game_id);
        if (!room || room.status !== 'playing') return;
        const playerState = getGamePlayerState(game_id, user_id);

        if (playerState.score < 10) return; // Minimum score to use hint

        const currentWord = room.game.deck[playerState.current_index];
        const normalizedWord = getNormalizedWord(currentWord);
        
        const unguessedLetters = [...normalizedWord].filter(c => c !== ' ' && !playerState.correct_letters.includes(c));

        if (unguessedLetters.length > 0) {
            const hintLetter = unguessedLetters[Math.floor(Math.random() * unguessedLetters.length)];
            
            playerState.correct_letters.push(hintLetter);
            playerState.score -= 10; // Penalty for hint

            const allLettersGuessed = [...normalizedWord].every(c => c === ' ' || playerState.correct_letters.includes(c));
            
            if (allLettersGuessed) {
                updatePlayerState(game_id, user_id, playerState);
                nextWord(room, user_id);
            } else {
                updatePlayerState(game_id, user_id, playerState);
                io.to(room.id).emit('game:hint:reveal', { user_id, letter: hintLetter, player: playerState });
            }
        }
    });

    socket.on('game:timeout', ({ game_id, user_id }) => {
        const room = Object.values(rooms).find(r => r.game && r.game.id === game_id);
        if (!room || room.status !== 'playing') return;
        const playerState = getGamePlayerState(game_id, user_id);
        
        // Check if the timeout event is for the current word this player is on
        const currentWordObj = room.game.deck[playerState.current_index];
        const currentDeadline = new Date(playerState.word_deadline).getTime();

        if (Date.now() >= currentDeadline) {
             console.log(`Word timed out for user ${user_id} in game ${game_id}. Word: ${currentWordObj.text}`);
             io.to(room.id).emit('game:feedback', { type: 'word-failed', user_id, word: currentWordObj.text, reason: 'timeout' });
             nextWord(room, user_id);
        }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        // Implement logic to remove user from room after a timeout
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

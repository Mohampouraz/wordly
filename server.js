const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Mock Database (State Management) ---
const users = {}; // userId: { fullName, score }
const games = {}; // gameCode: { ...gameData }

// --- Utility Functions ---

/**
 * ایجاد یک کد بازی تصادفی ۶ رقمی
 */
function generateGameCode() {
    let code;
    do {
        code = Math.floor(100000 + Math.random() * 900000).toString();
    } while (games[code]);
    return code;
}

/**
 * ماسک کردن کلمه برای نمایش در فرانت‌اند
 */
function maskWord(actualWord, correctGuessedLetters) {
    if (!actualWord) return '';
    return actualWord.split('').map(char => {
        if (char === ' ') return ' ';
        // حرف را به صورت جداگانه برمی‌گرداند.
        return correctGuessedLetters.includes(char) ? char : '_';
    }).join(' ');
}

/**
 * بررسی وضعیت بازی (برنده/بازنده/درحال انجام)
 */
function checkGameStatus(gameData) {
    if (gameData.status !== 'active') return gameData.status;

    // کلمه ماسک شده را بدون فاصله بین حروف بررسی می‌کنیم
    const wordWithoutSpaces = gameData.word.replace(/\s/g, '').split('');
    const isWordGuessed = wordWithoutSpaces.every(char => gameData.correctGuessedLetters.includes(char));

    const timeExpired = (Date.now() - gameData.startTime) / 1000 > gameData.totalTimeSeconds;

    if (isWordGuessed) {
        return 'won';
    }

    if (gameData.attemptsLeft <= 0 || timeExpired) {
        return 'lost';
    }

    return 'active';
}

/**
 * بازیابی داده‌های بازی برای ارسال به فرانت‌اند
 */
function getGameDataForClient(gameData, userId) {
    const isCreator = gameData.creatorId === userId;
    const isPlayer = gameData.playerId === userId;
    
    // ۱. به‌روزرسانی وضعیت نهایی
    gameData.status = checkGameStatus(gameData);

    // ۲. محاسبه زمان باقی مانده
    let timeRemaining = gameData.totalTimeSeconds;
    if (gameData.status === 'active') {
        const elapsedTime = (Date.now() - gameData.startTime) / 1000;
        timeRemaining = Math.max(0, gameData.totalTimeSeconds - Math.floor(elapsedTime));
    }
    
    // ۳. آماده‌سازی کلمه برای نمایش
    const wordToDisplay = maskWord(gameData.word, gameData.correctGuessedLetters);
    const finalWordDisplay = (gameData.status !== 'active') ? gameData.word.split('').join(' ') : wordToDisplay;

    // ۴. تعیین کلمه نمایش داده شده:
    // - اگر بازی فعال است: همیشه کلمه ماسک شده را نشان می‌دهد تا پیشرفت حدس مشخص باشد.
    // - اگر بازی تمام شده: کلمه کامل را نشان می‌دهد.
    const displayWord = (gameData.status !== 'active') ? finalWordDisplay : wordToDisplay;

    return {
        gameCode: gameData.gameCode,
        isCreator: isCreator,
        isPlayer: isPlayer,
        status: gameData.status,
        wordLength: gameData.word.replace(/\s/g, '').length, 
        wordToDisplay: displayWord, 
        difficulty: gameData.difficulty,
        category: gameData.category,
        creatorName: users[gameData.creatorId] ? users[gameData.creatorId].fullName : 'ناشناس',
        // **رفع باگ نمایش نام بازیکن برای سازنده**
        playerName: gameData.playerId ? (users[gameData.playerId] ? users[gameData.playerId].fullName : 'ناشناس') : null,
        attemptsLeft: gameData.attemptsLeft,
        correctGuessedLetters: gameData.correctGuessedLetters,
        incorrectGuessedLetters: gameData.incorrectGuessedLetters,
        hintsUsed: gameData.hintsUsed,
        hintCost: gameData.hintCost,
        totalTimeSeconds: gameData.totalTimeSeconds,
        timeRemainingSeconds: timeRemaining,
        createdAt: gameData.createdAt,
    };
}

// --- API Endpoints ---

// ۱. API مدیریت امتیاز کاربر (Profile Tab)
app.get('/api/user/score', (req, res) => {
    const { userId, fullName } = req.query;

    if (!userId) {
        return res.status(400).json({ success: false, message: 'userId is required' });
    }

    if (!users[userId]) {
        users[userId] = { 
            fullName: decodeURIComponent(fullName) || `User ${userId}`, 
            score: 0 // **اصلاح: امتیاز پایه صفر شد.**
        };
    }

    res.json({ success: true, score: users[userId].score });
});

// ۲. API ایجاد بازی جدید (Create Game Tab)
app.post('/api/game/create', (req, res) => {
    const { word, category, difficulty, creatorId } = req.body;

    if (!word || !category || !difficulty || !creatorId) {
        return res.status(400).json({ success: false, message: 'اطلاعات ناقص است.' });
    }
    
    // **حذف شرط طول کلمه بر اساس سطح دشواری. فقط حداقل طول ۵ حرف اعمال می‌شود.**
    if (word.trim().replace(/\s/g, '').length < 5) {
         return res.status(400).json({ success: false, message: 'کلمه باید حداقل ۵ حرف (بدون احتساب فاصله) داشته باشد.' });
    }

    const gameCode = generateGameCode();
    const attemptsLimit = 10;
    const totalTime = 120; 

    const newGame = {
        gameCode,
        word: word.trim().toLowerCase(),
        category,
        difficulty,
        creatorId,
        playerId: null, 
        status: 'waiting',
        startTime: null,
        attemptsLeft: attemptsLimit,
        totalTimeSeconds: totalTime,
        hintsUsed: 0,
        hintCost: 1, 
        correctGuessedLetters: [],
        incorrectGuessedLetters: [],
        createdAt: new Date().toISOString(),
    };

    games[gameCode] = newGame;
    res.json({ success: true, gameCode: gameCode, word: newGame.word, difficulty: newGame.difficulty });
});

// ۳. API پیوستن به بازی (Join Game)
app.post('/api/game/join', (req, res) => {
    const { gameCode, playerId } = req.body;

    const game = games[gameCode];

    if (!game) {
        return res.status(404).json({ success: false, message: 'بازی یافت نشد.' });
    }
    if (game.creatorId === playerId) {
        return res.status(400).json({ success: false, message: 'شما سازنده این بازی هستید.' });
    }
    if (game.status !== 'waiting' || game.playerId) {
        return res.status(400).json({ success: false, message: 'بازی پر شده یا شروع شده است.' });
    }

    game.playerId = playerId;
    game.status = 'active';
    game.startTime = Date.now(); 

    const gameDataClient = getGameDataForClient(game, playerId);
    res.json({ success: true, message: 'شما با موفقیت به بازی پیوستید.', gameData: gameDataClient });
});

// ۴. API دریافت وضعیت بازی (Game View)
app.get('/api/game/status/:gameCode', (req, res) => {
    const { gameCode } = req.params;
    const { userId } = req.query;
    const game = games[gameCode];

    if (!game) {
        return res.status(404).json({ success: false, message: 'بازی یافت نشد.' });
    }
    if (game.creatorId !== userId && game.playerId !== userId) {
        return res.status(403).json({ success: false, message: 'دسترسی غیرمجاز.' });
    }

    const gameDataClient = getGameDataForClient(game, userId);
    res.json({ success: true, gameData: gameDataClient });
});

// ۵. API حدس زدن حرف (Guess Endpoint)
app.post('/api/game/guess', (req, res) => {
    const { gameCode, playerId, guess } = req.body;
    const game = games[gameCode];

    if (!game || game.playerId !== playerId || game.status !== 'active') {
        return res.status(400).json({ success: false, message: 'بازی فعال نیست یا شما بازیکن نیستید.' });
    }
    if (game.attemptsLeft <= 0) {
        game.status = 'lost';
        return res.json({ success: false, message: 'فرصت حدس شما تمام شده است.', gameData: getGameDataForClient(game, playerId) });
    }

    const normalizedGuess = guess.toLowerCase();
    const actualWord = game.word;
    let isCorrect = false;

    if (game.correctGuessedLetters.includes(normalizedGuess) || game.incorrectGuessedLetters.includes(normalizedGuess)) {
        return res.json({ success: false, message: 'این حرف قبلاً حدس زده شده است.', isCorrect: false, gameData: getGameDataForClient(game, playerId) });
    }

    if (actualWord.includes(normalizedGuess)) {
        game.correctGuessedLetters.push(normalizedGuess);
        isCorrect = true;
    } else {
        game.incorrectGuessedLetters.push(normalizedGuess);
        game.attemptsLeft--; 
        isCorrect = false;
    }

    game.status = checkGameStatus(game);
    const message = isCorrect ? 'حدس شما صحیح است!' : 'متأسفانه حرف غلط است.';
    
    if (game.status === 'won') {
        if (users[playerId]) users[playerId].score += 50; 
    } else if (game.status === 'lost') {
        if (users[playerId]) users[playerId].score -= 10;
    }

    res.json({ success: true, message, isCorrect, gameData: getGameDataForClient(game, playerId) });
});

// ۶. API لیست بازی‌های فعال (Active Games Tab)
app.get('/api/games/active', (req, res) => {
    const { userId } = req.query;

    const activeGames = Object.values(games)
        .filter(game => 
            (game.creatorId === userId) ||
            (game.playerId === userId) ||
            (game.status === 'waiting' && game.creatorId !== userId)
        )
        .map(game => ({
            game_code: game.gameCode,
            status: game.status,
            difficulty: game.difficulty,
            creator_name: users[game.creatorId] ? users[game.creatorId].fullName : 'ناشناس',
            created_at: game.createdAt,
            is_creator: game.creatorId === userId,
            word: game.word 
        }));

    res.json({ success: true, games: activeGames });
});


// --- Server Start ---
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});

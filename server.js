const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Mock Database (State Management) ---
// در یک پروژه واقعی، این داده‌ها باید در یک پایگاه داده (مانند MongoDB یا PostgreSQL) ذخیره شوند.

// Mock Users Database
const users = {}; // userId: { fullName, score }

// Mock Games Database
const games = {}; // gameCode: { ...gameData }

// --- Utility Functions ---

/**
 * ایجاد یک کد بازی تصادفی ۶ رقمی
 * @returns {string} کد بازی
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
 * @param {string} actualWord کلمه واقعی
 * @param {string[]} correctGuessedLetters آرایه حروف درست حدس زده شده
 * @returns {string} کلمه ماسک شده (مثال: "ب _ ر ن ا م ه")
 */
function maskWord(actualWord, correctGuessedLetters) {
    if (!actualWord) return '';
    return actualWord.split('').map(char => {
        if (char === ' ') return ' ';
        return correctGuessedLetters.includes(char) ? char : '_';
    }).join(' ');
}

/**
 * بررسی وضعیت بازی (برنده/بازنده/درحال انجام)
 * @param {object} gameData داده‌های فعلی بازی
 * @returns {string} وضعیت جدید ('won', 'lost', 'active')
 */
function checkGameStatus(gameData) {
    if (gameData.status !== 'active') return gameData.status;

    const masked = maskWord(gameData.word, gameData.correctGuessedLetters);
    const timeExpired = (Date.now() - gameData.startTime) / 1000 > gameData.totalTimeSeconds;

    // ۱. بررسی برنده شدن (همه حروف درست حدس زده شده‌اند)
    if (!masked.includes('_')) {
        return 'won';
    }

    // ۲. بررسی بازنده شدن (فرصت‌ها یا زمان تمام شده)
    if (gameData.attemptsLeft <= 0 || timeExpired) {
        return 'lost';
    }

    // ۳. در غیر این صورت، فعال است
    return 'active';
}

/**
 * بازیابی داده‌های بازی برای ارسال به فرانت‌اند
 * @param {object} gameData داده‌های کامل بازی از دیتابیس
 * @param {string} userId آیدی کاربری که درخواست را ارسال کرده است
 * @returns {object} داده‌های فیلتر و به‌روزرسانی شده برای فرانت‌اند
 */
function getGameDataForClient(gameData, userId) {
    const isCreator = gameData.creatorId === userId;
    const isPlayer = gameData.playerId === userId;
    
    // وضعیت نهایی را دوباره چک می‌کنیم
    gameData.status = checkGameStatus(gameData);

    let timeRemaining = gameData.totalTimeSeconds;
    if (gameData.status === 'active') {
        const elapsedTime = (Date.now() - gameData.startTime) / 1000;
        timeRemaining = Math.max(0, gameData.totalTimeSeconds - Math.floor(elapsedTime));
    }

    const wordToDisplay = maskWord(gameData.word, gameData.correctGuessedLetters);
    
    // اگر بازی تمام شده یا کاربر سازنده است، کل کلمه را نمایش می‌دهیم
    const finalWordDisplay = (gameData.status !== 'active' || isCreator) ? gameData.word.split('').join(' ') : wordToDisplay;

    return {
        gameCode: gameData.gameCode,
        isCreator: isCreator,
        isPlayer: isPlayer,
        status: gameData.status,
        wordLength: gameData.word.replace(/\s/g, '').length, // طول کلمه بدون فاصله
        wordToDisplay: finalWordDisplay, // کلمه ماسک شده/کامل
        difficulty: gameData.difficulty,
        category: gameData.category,
        creatorName: users[gameData.creatorId] ? users[gameData.creatorId].fullName : 'ناشناس',
        playerName: gameData.playerId ? (users[gameData.playerId] ? users[gameData.playerId].fullName : 'ناشناس') : null,
        attemptsLeft: gameData.attemptsLeft,
        
        // ** فیلدهای جدید برای جداسازی حروف درست و غلط **
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
            score: 1000 // امتیاز پایه برای کاربر جدید
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
    if (word.length < 5) {
         return res.status(400).json({ success: false, message: 'کلمه باید حداقل ۵ حرف داشته باشد.' });
    }

    const gameCode = generateGameCode();
    const attemptsLimit = 10;
    const totalTime = 120; // 2 دقیقه (120 ثانیه)

    const newGame = {
        gameCode,
        word: word.trim().toLowerCase(),
        category,
        difficulty,
        creatorId,
        playerId: null, // منتظر بازیکن
        status: 'waiting',
        startTime: null,
        attemptsLeft: attemptsLimit,
        totalTimeSeconds: totalTime,
        hintsUsed: 0,
        hintCost: 1, // هزینه راهنما
        
        // ** فیلدهای جدید برای نگهداری وضعیت حدس‌ها **
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

    // پیوستن بازیکن و شروع بازی
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

    // ۱. بررسی تکراری بودن حدس
    if (game.correctGuessedLetters.includes(normalizedGuess) || game.incorrectGuessedLetters.includes(normalizedGuess)) {
        return res.json({ success: false, message: 'این حرف قبلاً حدس زده شده است.', isCorrect: false, gameData: getGameDataForClient(game, playerId) });
    }

    // ۲. بررسی درست یا غلط بودن حدس
    if (actualWord.includes(normalizedGuess)) {
        game.correctGuessedLetters.push(normalizedGuess);
        isCorrect = true;
    } else {
        game.incorrectGuessedLetters.push(normalizedGuess);
        game.attemptsLeft--; // کاهش فرصت فقط برای حدس‌های غلط
        isCorrect = false;
    }

    // ۳. به‌روزرسانی وضعیت و ارسال پاسخ
    game.status = checkGameStatus(game);
    const message = isCorrect ? 'حدس شما صحیح است!' : 'متأسفانه حرف غلط است.';
    
    // اگر بازی تمام شده، امتیازات محاسبه و به‌روزرسانی می‌شوند (Mock)
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
            // بازی‌هایی که کاربر ساخته و در حال انجام/انتظار هستند
            (game.creatorId === userId && game.status !== 'finished') ||
            // بازی‌هایی که کاربر بازیکن آن است
            (game.playerId === userId) ||
            // بازی‌هایی که منتظر بازیکن هستند و کاربر سازنده آن نیست
            (game.status === 'waiting' && game.creatorId !== userId)
        )
        .map(game => ({
            game_code: game.gameCode,
            status: game.status,
            difficulty: game.difficulty,
            creator_name: users[game.creatorId] ? users[game.creatorId].fullName : 'ناشناس',
            created_at: game.createdAt,
            is_creator: game.creatorId === userId,
            word: game.word // کلمه برای نمایش به سازنده
        }));

    res.json({ success: true, games: activeGames });
});

// --- Server Start ---
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});

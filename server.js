// server.js - الگوی بک‌اند برای مدیریت ربات تلگرام و بازی دو نفره

const express = require('express');
const http = require('http');
const WebSocket = require('ws');

// --- تنظیمات (Placeholder) ---
// در محیط واقعی، این‌ها از طریق متغیرهای محیطی لود می‌شوند
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || "8217028556:AAFDNQfmRYuUnto4gb2dAUNyWjKanRZldfA";
const DATABASE_URL = process.env.DATABASE_URL || "postgresql://abolfazl:uADpBikvq08jFXFWHURmINea1L5oz389@dpg-d4bn1mer433s73d1tiug-a.frankfurt-postgres.render.com/wordlygame_yqt5";
const WEB_APP_URL = process.env.WEB_APP_URL || "https://wordlygame.onrender.com";

const PORT = process.env.PORT || 3000;

// --- Mock Database (شبیه‌سازی دیتابیس برای ذخیره کلمات سفارشی و وضعیت بازی) ---
const mockDatabase = {
    customWords: [],
    activeGames: new Map(), // Map<gameId, gameState>
    waitingPlayers: [] // Array of { userId, ws }
};

// --- توابع شبیه‌سازی دیتابیس واقعی (Firestore/MongoDB) ---

/**
 * ذخیره کلمه جدید پیشنهادی کاربر در دیتابیس
 * @param {string} word - کلمه پیشنهادی
 * @param {string} category - دسته بندی
 * @param {string} userId - شناسه کاربر سازنده
 */
async function saveCustomWord(word, category, userId) {
    console.log(`[DB MOCK] ذخیره کلمه سفارشی: ${word} توسط کاربر ${userId}`);
    mockDatabase.customWords.push({ text: word, category, level: 3, creator: userId, status: 'pending' });
    // در واقعیت: اتصال به DB و درج سند
}

/**
 * یافتن بازی فعال در انتظار بازیکن دوم
 * @returns {Object|null}
 */
function findWaitingGame() {
    // در واقعیت: کوئری به دیتابیس برای یافتن بازی با وضعیت 'waiting'
    const game = Array.from(mockDatabase.activeGames.values()).find(g => g.status === 'waiting' && g.players.length === 1);
    return game || null;
}


// --- منطق اصلی بازی و WebSocket ---

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.json());

// --- ۱. Webhook تلگرام ---
// این endpoint توسط تلگرام برای ارسال به‌روزرسانی‌ها فراخوانی می‌شود
app.post(`/bot${TELEGRAM_TOKEN}`, (req, res) => {
    const update = req.body;
    
    if (update.message && update.message.text === '/start') {
        const chatId = update.message.chat.id;
        console.log(`[Telegram] دریافت /start از چت ${chatId}`);

        // ارسال پیام حاوی دکمه Web App
        sendWebAppButton(chatId, "برای شروع بازی، اپلیکیشن وب را باز کنید.");
    }
    
    // پاسخ موفقیت آمیز به تلگرام
    res.sendStatus(200);
});

/**
 * تابع شبیه‌سازی ارسال دکمه Web App به تلگرام
 * @param {number} chatId - شناسه چت
 * @param {string} text - متن پیام
 */
function sendWebAppButton(chatId, text) {
    console.log(`[Telegram MOCK] ارسال دکمه Web App به چت ${chatId}. URL: ${WEB_APP_URL}`);
    // در واقعیت از کتابخانه node-telegram-bot-api استفاده می‌شود
    // مثال: bot.sendMessage(chatId, text, { reply_markup: { keyboard: [[{ text: 'شروع بازی', web_app: { url: WEB_APP_URL } }]] } });
}


// --- ۲. WebSocket Server برای ارتباط Real-time ---
wss.on('connection', (ws) => {
    let userId = null;
    let gameId = null;

    ws.on('message', (message) => {
        const data = JSON.parse(message);
        
        // تشخیص نوع پیام
        switch (data.type) {
            case 'REGISTER':
                // ثبت کاربر و اتصال آن به یک بازی
                userId = data.userId;
                handlePlayerRegistration(userId, ws);
                break;

            case 'GUESS':
                // هندل کردن حدس حرف/کلمه
                gameId = data.gameId;
                handleGuess(gameId, userId, data.guess);
                break;
            
            case 'HINT':
                // درخواست راهنمایی
                gameId = data.gameId;
                handleHintRequest(gameId, userId);
                break;

            case 'SUBMIT_WORD':
                // ساخت کلمه جدید
                saveCustomWord(data.word, data.category, userId);
                break;
        }
    });

    ws.on('close', () => {
        console.log(`[WS] اتصال کاربر ${userId} بسته شد.`);
        // حذف کاربر از لیست بازیکنان منتظر
        mockDatabase.waitingPlayers = mockDatabase.waitingPlayers.filter(p => p.userId !== userId);

        // اگر کاربر در یک بازی فعال بود، بازی را نامعتبر کن
        if (gameId && mockDatabase.activeGames.has(gameId)) {
            const game = mockDatabase.activeGames.get(gameId);
            game.status = 'interrupted';
            broadcast(gameId, { type: 'GAME_INTERRUPTED', message: 'بازیکن مقابل قطع اتصال کرد.' });
            mockDatabase.activeGames.delete(gameId);
        }
    });
});

// --- ۳. منطق مدیریت بازی (شبیه‌سازی) ---

function handlePlayerRegistration(userId, ws) {
    const waitingGame = findWaitingGame();
    
    if (waitingGame) {
        // پیوستن به بازی موجود
        waitingGame.players.push({ userId, ws, score: 0 });
        waitingGame.status = 'in_progress';
        waitingGame.currentWordIndex = 0;
        
        console.log(`[Game Manager] کاربر ${userId} به بازی ${waitingGame.id} پیوست.`);
        
        // شروع بازی و ارسال وضعیت اولیه به هر دو بازیکن
        startGame(waitingGame);

    } else {
        // ایجاد بازی جدید و انتظار برای بازیکن دوم
        const newGameId = `game_${Date.now()}`;
        mockDatabase.activeGames.set(newGameId, { 
            id: newGameId, 
            status: 'waiting',
            players: [{ userId, ws, score: 0 }],
            words: [], // بعدا لود می شود
        });
        
        console.log(`[Game Manager] بازی جدید ${newGameId} توسط کاربر ${userId} ایجاد شد.`);
        ws.send(JSON.stringify({ type: 'WAITING', gameId: newGameId, message: 'در انتظار بازیکن دوم...' }));
    }
}

function startGame(game) {
    // در محیط واقعی، کلمات از words.js لود و برای هر دو بازیکن یکسان تنظیم می‌شود.
    // اینجا به دلیل نبود words.js در Node، از یک Mock استفاده می‌کنیم.
    const mockWords = [
        { text: "آبشار", category: "اشیاء", level: 2 },
        { text: "انگور", category: "میوه", level: 1 }
    ];
    game.words = mockWords;

    const initialWord = game.words[0];
    const initialMask = initialWord.text.split('').map(char => (char === ' ' ? ' ' : '_')).join('');
    
    // ارسال وضعیت اولیه بازی
    game.players.forEach(p => {
        p.ws.send(JSON.stringify({
            type: 'GAME_STARTED',
            gameId: game.id,
            players: game.players.map(pl => ({ userId: pl.userId, score: pl.score })),
            currentWord: initialWord.text,
            currentMask: initialMask,
            category: initialWord.category,
            timeLimit: 30, // Mock time
            maxHints: 3, // Mock hints
        }));
    });
    console.log(`[Game Manager] بازی ${game.id} شروع شد.`);
}

/**
 * ارسال پیام به همه بازیکنان یک بازی
 */
function broadcast(gameId, data) {
    const game = mockDatabase.activeGames.get(gameId);
    if (game) {
        game.players.forEach(p => p.ws.send(JSON.stringify(data)));
    }
}


// --- ۴. تنظیم سرور HTTP و گوش دادن ---
app.get('/', (req, res) => {
    res.send('Word Guessing Game Backend Running...');
});

server.listen(PORT, () => {
    console.log(`سرور Node.js بر روی پورت ${PORT} اجرا شد.`);
    console.log(`Webhook URL: /bot${TELEGRAM_TOKEN}`);
});

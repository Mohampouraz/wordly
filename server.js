// server.js (Polling Implementation)
const express = require('express');
const { Telegraf } = require('telegraf');
const { Client } = require('pg');
const crypto = require('crypto');
const cors = require('cors'); // Needed for cross-origin polling requests

// --- پیکربندی محیطی (Environment Configuration) ---
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || "8217028556:AAFDNQfmRYuUnto4gb2dAUNyWjKanRZldfA";
const WEB_APP_URL = process.env.WEB_APP_URL || "https://wordlybot.xo.je";
const DATABASE_URL = process.env.DATABASE_URL || "postgresql://abolfazl:ZnczfHE6NUZWmPfYtPQjUdsuaseuFoHS@dpg-d3q9nrm3jp1c738f47pg-a.frankfurt-postgres.render.com/wordgame_lbh3";
const PORT = process.env.PORT || 3000;

// 1. تنظیم ربات تلگرام (Telegraf Setup)
const bot = new Telegraf(TELEGRAM_TOKEN);
const app = express();

// Middlewares
app.use(express.json());
// CORS is critical for the polling request from wordlybot.xo.je to wordlygame.onrender.com
app.use(cors({
    origin: WEB_APP_URL, // Allow requests only from the Telegram Mini App origin
    methods: ['POST'],
}));

// ----------------------------------------------------
// --- Polling State Management: Global Event Log ---
// ----------------------------------------------------
let eventCounter = 0;
// Structure: { id: number, type: string, username: string, timestamp: number }
const eventLog = []; 
// To track which users have joined *during this server run* to avoid re-broadcasting
const usersJoinedThisSession = new Set(); 

/**
 * اضافه کردن یک رخداد جدید به لاگ و افزایش شمارنده
 */
function addEvent(type, username, userId) {
    const newEvent = {
        id: ++eventCounter,
        type: type,
        username: username,
        userId: userId,
        timestamp: Date.now()
    };
    eventLog.push(newEvent);
    // نگهداری لاگ در یک حجم منطقی (مثلا 100 رخداد آخر)
    if (eventLog.length > 100) {
        eventLog.shift();
    }
    console.log(`[EVENT LOG] New event (ID ${newEvent.id}): ${type} by ${username}`);
    return newEvent;
}

// 2. تنظیم دیتابیس PostgreSQL
const pgClient = new Client({ connectionString: DATABASE_URL });

async function connectDb() {
    try {
        await pgClient.connect();
        console.log("PostgreSQL connected successfully.");
    } catch (err) {
        console.error("Database connection error:", err.message);
    }
}
connectDb();

// 3. هندل کردن Webhook تلگرام
app.post('/webhook', (req, res) => {
    bot.handleUpdate(req.body);
    res.sendStatus(200);
});

// 4. دستور /start ربات
bot.start(async (ctx) => {
    console.log(`User ${ctx.from.id} started the bot.`);

    const keyboard = {
        reply_markup: {
            inline_keyboard: [
                [{ text: "شروع بازی وردلی (Web App)", web_app: { url: WEB_APP_URL } }]
            ]
        }
    };

    await ctx.reply(`سلام ${ctx.from.first_name}! برای شروع، Web App را باز کنید:`, keyboard);
});

/**
 * تابع اعتبارسنجی initData تلگرام
 */
function validateInitData(initData) {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    params.delete('hash'); 

    const dataCheckArr = Array.from(params.entries())
        .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
        .map(([key, value]) => `${key}=${value}`);

    const dataCheckString = dataCheckArr.join('\n');

    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(TELEGRAM_TOKEN).digest();
    const calculatedHash = crypto.createHmac('sha256', secretKey)
        .update(dataCheckString)
        .digest('hex');

    if (calculatedHash !== hash) {
        console.log('--- AUTHENTICATION FAILURE DEBUG ---');
        console.log(`Expected Hash: ${hash}`);
        console.log(`Calculated Hash: ${calculatedHash}`);
        // Log Data String for better debugging
        console.log(`Data String: ${dataCheckString.replace(/\n/g, ' | ')}`);
        console.log('------------------------------------');
    }
    return calculatedHash === hash;
}

// ----------------------------------------------------------------------------------
// --- 5. Polling Endpoint (جایگزین WebSocket) ---
// کلاینت هر چند ثانیه یک بار این نقطه را برای احراز هویت و دریافت رخدادهای جدید صدا می‌زند.
// ----------------------------------------------------------------------------------
app.post('/poll/auth-and-events', (req, res) => {
    const { initData, lastEventId, userId, username } = req.body;
    let newEvents = [];
    let authenticated = false;

    if (!initData || !userId) {
        return res.status(400).json({ error: 'Missing required parameters.' });
    }

    if (validateInitData(initData)) {
        authenticated = true;
        
        const isNewJoin = !usersJoinedThisSession.has(userId);

        if (isNewJoin) {
            // فقط در اولین تماس کاربر (در این سشن سرور) رخداد پیوستن را اضافه می‌کنیم
            addEvent('new_user_joined', username, userId);
            usersJoinedThisSession.add(userId);
            console.log(`[AUTH] User joined: ${username} (${userId}).`);
        }
        
        // فیلتر کردن رخدادها: فقط رخدادهای جدیدتر از آخرین رخداد دریافتی توسط کلاینت
        const clientLastId = parseInt(lastEventId, 10) || 0;
        newEvents = eventLog.filter(event => event.id > clientLastId);

        // تعیین بالاترین ID ارسال شده به کلاینت
        const newLastEventId = newEvents.length > 0 ? newEvents[newEvents.length - 1].id : clientLastId;

        res.json({
            status: 'ok',
            authenticated: true,
            newEvents: newEvents,
            lastEventId: newLastEventId,
            serverTime: Date.now()
        });

    } else {
        res.status(401).json({ status: 'error', authenticated: false, error: 'Authentication failed.' });
    }
});


// 6. راه‌اندازی سرور
const server = app.listen(PORT, async () => {
    console.log(`Server running on port ${PORT}`);

    // پس از شروع سرور، Webhook تلگرام را تنظیم کنید
    try {
        const webhookUrl = `https://wordlygame.onrender.com/webhook`;
        await bot.telegram.setWebhook(webhookUrl);
        console.log(`Telegram Webhook set to: ${webhookUrl}`);
    } catch (err) {
        console.error("Error setting webhook:", err.message);
    }
});

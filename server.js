// server.js (Polling Implementation with DB Persistence and Security Fix)
const express = require('express');
const { Telegraf } = require('telegraf');
const { Client } = require('pg');
const crypto = require('crypto');
const cors = require('cors');

// --- پیکربندی محیطی (Environment Configuration) ---
// توجه: لطفاً این مقادیر را با مقادیر واقعی خود در سرور جایگزین کنید.
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || "YOUR_TELEGRAM_BOT_TOKEN_HERE"; 
const WEB_APP_URL = process.env.WEB_APP_URL || "https://wordlybot.xo.je"; 
const DATABASE_URL = process.env.DATABASE_URL || "postgresql://user:password@host:port/database"; 
const PORT = process.env.PORT || 3000;

// 1. تنظیم ربات تلگرام (Telegraf Setup)
const bot = new Telegraf(TELEGRAM_TOKEN);
const app = express();

// Middlewares
app.use(express.json());
// CORS برای اجازه دادن به درخواست‌های Polling از Mini App به سرور لازم است
app.use(cors({
    origin: WEB_APP_URL, // اجازه درخواست فقط از دامنه Mini App
    methods: ['POST'],
}));

// ----------------------------------------------------
// --- Polling State Management: Global Event Log ---
// ----------------------------------------------------
let eventCounter = 0;
// ساختار: { id: number, type: string, username: string, userId: string, timestamp: number }
const eventLog = []; 

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
const pgClient = new Client({ 
    connectionString: DATABASE_URL,
    // FIX: تنظیمات SSL برای رفع خطای "SSL/TLS required"
    ssl: {
        rejectUnauthorized: false // اجازه استفاده از گواهینامه‌های خودامضا (رایج در پلتفرم‌های ابری)
    }
});

/**
 * اتصال به دیتابیس و ایجاد جدول‌های لازم
 */
async function connectDb() {
    try {
        await pgClient.connect();
        console.log("PostgreSQL connected successfully (with SSL).");
        await createTables();
    } catch (err) {
        console.error("Database connection error:", err.message);
    }
}

/**
 * ایجاد جدول کاربران اگر وجود نداشته باشد
 */
async function createTables() {
    const query = `
        CREATE TABLE IF NOT EXISTS users (
            id VARCHAR(255) PRIMARY KEY,
            username VARCHAR(255),
            first_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    `;
    try {
        await pgClient.query(query);
        console.log("Table 'users' ensured to exist.");
    } catch (err) {
        console.error("Error creating tables:", err.message);
    }
}

/**
 * ثبت کاربر در دیتابیس اگر قبلاً ثبت نشده باشد
 * @returns {boolean} True if the user is a new join, false otherwise.
 */
async function ensureUserJoinedInDB(userId, username) {
    try {
        const checkQuery = 'SELECT id FROM users WHERE id = $1';
        const result = await pgClient.query(checkQuery, [userId]);

        if (result.rows.length === 0) {
            // User is new, insert them
            const insertQuery = 'INSERT INTO users (id, username) VALUES ($1, $2)';
            await pgClient.query(insertQuery, [userId, username]);
            return true; // New join
        }
        return false; // Existing user
    } catch (error) {
        console.error("Database error in ensureUserJoinedInDB:", error.message);
        // Fallback: Assume existing user on DB error to prevent excessive 'new_user_joined' events
        return false; 
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
 * تابع اعتبارسنجی initData تلگرام (FIXED: Security Enforced)
 */
function validateInitData(initData) {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    params.delete('hash'); 

    // حذف پارامترهای غیرلازم (مانند Auth_date و User) برای محاسبه hash
    const dataCheckArr = Array.from(params.entries())
        .filter(([key]) => key !== 'auth_date' && key !== 'user' && key !== 'query_id')
        .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
        .map(([key, value]) => `${key}=${value}`);

    const dataCheckString = dataCheckArr.join('\n');

    // استفاده از توکن ربات به عنوان کلید Secret
    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(TELEGRAM_TOKEN).digest();
    const calculatedHash = crypto.createHmac('sha256', secretKey)
        .update(dataCheckString)
        .digest('hex');

    if (calculatedHash !== hash) {
        console.warn('!!! SECURITY ALERT: TELEGRAM INIT DATA AUTHENTICATION FAILED !!!');
        // console.warn(`Expected Hash: ${hash}`);
        // console.warn(`Calculated Hash: ${calculatedHash}`);
        // console.warn(`Data String: ${dataCheckString.replace(/\n/g, ' | ')}`);
    }

    // FIX: بازگرداندن نتیجه واقعی برای امنیت
    return calculatedHash === hash; 
}

// ----------------------------------------------------------------------------------
// --- 5. Polling Endpoint (جایگزین WebSocket) ---
// کلاینت هر چند ثانیه یک بار این نقطه را برای احراز هویت و دریافت رخدادهای جدید صدا می‌زند.
// ----------------------------------------------------------------------------------
app.post('/poll/auth-and-events', async (req, res) => {
    const { initData, lastEventId, userId, username } = req.body;
    let newEvents = [];
    let authenticated = false;

    if (!initData || !userId) {
        return res.status(400).json({ status: 'error', authenticated: false, error: 'Missing required parameters.' });
    }

    if (validateInitData(initData)) {
        authenticated = true;
        
        // --- DB INTEGRATION: Check for first-time join ---
        // وضعیت کاربر جدید را در دیتابیس بررسی و ثبت می‌کند.
        const isNewJoin = await ensureUserJoinedInDB(userId, username);

        if (isNewJoin) {
            // رخداد پیوستن برای سایر کاربران
            addEvent('new_user_joined', username, userId);
            console.log(`[AUTH] NEW user joined (and logged to DB): ${username} (${userId}).`);
        }
        
        // فیلتر کردن رخدادها: فقط رخدادهای جدیدتر از آخرین رخداد دریافتی توسط کلاینت
        const clientLastId = parseInt(lastEventId, 10) || 0;
        newEvents = eventLog.filter(event => event.id > clientLastId);

        // تعیین بالاترین ID ارسال شده به کلاینت
        const newLastEventId = eventLog.length > 0 ? eventLog[eventLog.length - 1].id : clientLastId;

        res.json({
            status: 'ok',
            authenticated: true,
            newEvents: newEvents,
            lastEventId: newLastEventId, 
            serverTime: Date.now()
        });

    } else {
        // احراز هویت ناموفق
        res.status(401).json({ status: 'error', authenticated: false, error: 'Authentication failed.' });
    }
});


// 6. راه‌اندازی سرور
const server = app.listen(PORT, async () => {
    console.log(`Server running on port ${PORT}`);

    // پس از شروع سرور، Webhook تلگرام را تنظیم کنید
    try {
        // آدرس Webhook را در اینجا به آدرس واقعی خود در Render یا محیط دیگری به‌روز کنید
        const webhookUrl = `https://wordlygame.onrender.com/webhook`;
        await bot.telegram.setWebhook(webhookUrl);
        console.log(`Telegram Webhook set to: ${webhookUrl}`);
    } catch (err) {
        console.error("Error setting webhook:", err.message);
    }
});

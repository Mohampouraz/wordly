// server.js
const express = require('express');
const { Telegraf } = require('telegraf');
const { Client } = require('pg');
const WebSocket = require('ws');
const crypto = require('crypto');

// --- پیکربندی محیطی (Environment Configuration) ---
// از اطلاعاتی که شما در محیط واقعی دارید استفاده شده است
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || "8217028556:AAFDNQfmRYuUnto4gb2dAUNyWjKanRZldfA";
const WEB_APP_URL = process.env.WEB_APP_URL || "https://wordlybot.xo.je";
const DATABASE_URL = process.env.DATABASE_URL || "postgresql://abolfazl:ZnczfHE6NUZWmPfYtPQjUdsuaseuFoHS@dpg-d3q9nrm3jp1c738f47pg-a.frankfurt-postgres.render.com/wordgame_lbh3";
const PORT = process.env.PORT || 3000;

// 1. تنظیم ربات تلگرام (Telegraf Setup)
const bot = new Telegraf(TELEGRAM_TOKEN);
const app = express();

// Middlewares
app.use(express.json()); // برای پردازش JSON دریافتی از Webhook تلگرام

// 2. تنظیم دیتابیس PostgreSQL
const pgClient = new Client({ connectionString: DATABASE_URL });

async function connectDb() {
    try {
        await pgClient.connect();
        console.log("PostgreSQL connected successfully.");
        // می‌توانید جدول‌های مورد نیاز را در اینجا ایجاد کنید (مثال: جدول کاربران)
        // await pgClient.query('CREATE TABLE IF NOT EXISTS users (id BIGINT PRIMARY KEY, username VARCHAR(255), full_name VARCHAR(255), ...);');
    } catch (err) {
        console.error("Database connection error:", err.message);
    }
}
connectDb();

// 3. هندل کردن Webhook تلگرام
// تلگرام، به‌روزرسانی‌ها را به این مسیر POST می‌کند
app.post('/webhook', (req, res) => {
    bot.handleUpdate(req.body);
    res.sendStatus(200); // پاسخ به تلگرام برای جلوگیری از ارسال مجدد
});

// 4. دستور /start ربات
bot.start(async (ctx) => {
    console.log(`User ${ctx.from.id} started the bot.`);

    // ایجاد یک دکمه برای باز کردن Mini App
    const keyboard = {
        reply_markup: {
            inline_keyboard: [
                [{ text: "شروع بازی وردلی (Web App)", web_app: { url: WEB_APP_URL } }]
            ]
        }
    };

    await ctx.reply(`سلام ${ctx.from.first_name}! برای شروع، Web App را باز کنید:`, keyboard);
});

// --- 5. تنظیمات WebSocket Server برای Real-time ---
const server = app.listen(PORT, async () => {
    console.log(`Server running on port ${PORT}`);

    // پس از شروع سرور، Webhook تلگرام را تنظیم کنید
    // در محیط Render باید این کار انجام شود تا تلگرام بداند آپدیت‌ها را کجا بفرستد
    try {
        const webhookUrl = `https://wordlygame.onrender.com/webhook`;
        await bot.telegram.setWebhook(webhookUrl);
        console.log(`Telegram Webhook set to: ${webhookUrl}`);
    } catch (err) {
        console.error("Error setting webhook:", err.message);
    }
});

const wss = new WebSocket.Server({ server });
// یک نقشه برای نگهداری کاربران متصل (Key: user_id, Value: WebSocket object)
const connectedClients = new Map();

/**
 * تابع اعتبارسنجی initData تلگرام
 * این تابع امنیت اپلیکیشن شما را تضمین می‌کند.
 */
function validateInitData(initData) {
    // initData یک کوئری استرینگ است که باید به یک شی تبدیل شود
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    params.delete('hash'); // حذف هش برای محاسبه مجدد

    // مرتب‌سازی پارامترها بر اساس نام
    const dataCheckArr = Array.from(params.entries())
        .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
        .map(([key, value]) => `${key}=${value}`);

    const dataCheckString = dataCheckArr.join('\n');

    // محاسبه Secret Key
    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(TELEGRAM_TOKEN).digest();

    // محاسبه هش
    const calculatedHash = crypto.createHmac('sha256', secretKey)
        .update(dataCheckString)
        .digest('hex');

    // خطایابی برای تشخیص دقیق مشکل احراز هویت
    if (calculatedHash !== hash) {
        console.log('--- AUTHENTICATION FAILURE DEBUG ---');
        console.log(`Expected Hash: ${hash}`);
        console.log(`Calculated Hash: ${calculatedHash}`);
        console.log(`Data String: ${dataCheckString.replace(/\n/g, ' | ')}`);
        console.log('------------------------------------');
    }

    return calculatedHash === hash;
}


wss.on('connection', function connection(ws) {
    let isAuthenticated = false;
    let userId = null;
    let username = 'ناشناس';

    ws.on('message', function incoming(message) {
        try {
            const data = JSON.parse(message);

            // 1. مرحله اول: احراز هویت (Auth)
            if (data.type === 'auth' && data.initData) {
                if (validateInitData(data.initData)) {
                    isAuthenticated = true;
                    userId = data.userId;
                    username = data.username || 'ناشناس';
                    connectedClients.set(userId, ws); // اضافه کردن به لیست کاربران احراز هویت شده

                    console.log(`User connected and authenticated: ${username} (${userId}). Total active users: ${connectedClients.size}`);

                    // --- منطق Broadcast به‌روز شده ---
                    const joinMessage = JSON.stringify({
                        type: 'new_user_joined',
                        userId: userId,
                        username: username,
                        message: `${username} به بازی پیوست!`
                    });

                    // Broadcast (ارسال پیام به همه کاربران احراز هویت شده به جز خود کاربر جدید)
                    connectedClients.forEach((client, id) => {
                        // چک کردن: 1. کاربر جدید نباشد 2. اتصال باز باشد
                        if (id !== userId && client.readyState === WebSocket.OPEN) {
                            client.send(joinMessage);
                        }
                    });

                } else {
                    console.error('Authentication failed for connection. Closing WS.');
                    ws.close(1008, 'Invalid authentication data');
                }
            }

            // 2. هندل کردن سایر پیام‌های Real-time (مانند حرکت در بازی)
            // ... منطق بازی شما در اینجا قرار می‌گیرد ...

        } catch (e) {
            console.error('Error processing WS message:', e.message);
            ws.send(JSON.stringify({ type: 'error', message: 'فرمت پیام ارسالی نامعتبر است.' }));
        }
    });

    ws.on('close', function close() {
        if (isAuthenticated && userId) {
            console.log(`User disconnected: ${username} (${userId}). Total active users: ${connectedClients.size - 1}`);
            connectedClients.delete(userId);
            
            // در صورت نیاز، می‌توانید دیسکانکت شدن کاربر را نیز Broadcast کنید
        }
    });

    ws.on('error', (err) => {
        console.error('WS Error occurred:', err.message);
    });
});

// server.js
const express = require('express');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');
const { words } = require('./words'); 

const app = express();

// ****************************
// تنظیمات و کانفیگ
// ****************************
// برای سادگی، از متغیرهای محلی استفاده می‌کنیم. در محیط Production باید از process.env استفاده کنید.
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || "8217028556:AAFDNQfmRYuUnto4gb2dAUNyWjKanRZldfA";
const DATABASE_URL = process.env.DATABASE_URL || "postgresql://abolfazl:uADpBikvq08jFXFWHURmINea1L5oz389@dpg-d4bn1mer433s73d1tiug-a.frankfurt-postgres.render.com/wordlygame_yqt5";
const WEB_APP_URL = process.env.WEB_APP_URL || "https://wordlygame.onrender.com";
const PORT = process.env.PORT || 3000;


// ****************************
// ۱. راه‌اندازی ربات تلگرام 🤖
// ****************************

// حالت Polling برای توسعه (به جای Webhook برای محیط Production)
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
console.log('Telegram Bot is running in polling mode...');

// هندل کردن فرمان /start
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const userName = msg.from.first_name || "کاربر عزیز";

    // ساخت دکمه اینلاینی برای باز کردن Web App
    const keyboard = {
        inline_keyboard: [
            [
                { 
                    text: "🚀 باز کردن پنل بازی", 
                    web_app: { 
                        url: WEB_APP_URL 
                    } 
                }
            ]
        ]
    };

    bot.sendMessage(
        chatId, 
        `سلام ${userName} 👋! برای شروع بازی کلمات، دکمه زیر را فشار دهید:`, 
        { 
            reply_markup: keyboard 
        }
    );
});

// ****************************
// ۲. راه‌اندازی سرور Express 🌐
// ****************************

// ارائه فایل‌های استاتیک از پوشه 'public'
app.use(express.static(path.join(__dirname, 'public')));

// مسیر اصلی (/) که index.html را سرویس می‌دهد
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// مسیر API برای تست (اختیاری)
app.get('/api/words', (req, res) => {
    res.json({ count: words.length, sample: words.slice(0, 3) });
});


// ****************************
// ۳. راه‌اندازی سرور و گوش دادن به پورت
// ****************************

app.listen(PORT, () => {
    console.log(`Express Server is running on port ${PORT}`);
    console.log(`Web App URL: ${WEB_APP_URL}`);
    console.log(`-----------------------------------`);
});

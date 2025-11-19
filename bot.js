// bot.js - (فایلی مجزا که باید در کنار server.js اجرا شود)

const TelegramBot = require('node-telegram-bot-api');

// --- 📢 تنظیمات ضروری ---
const TOKEN = '8217028556:AAFDNQfmRYuUnto4gb2dAUNyWjKanRZldfA'; 
// آدرس URL عمومی سرور EXPRESS شما (مثلاً https://my-domain.com)
const WEB_APP_URL = 'https://wordlygame.onrender.com'; 
// ------------------------

const bot = new TelegramBot(TOKEN, { polling: true });

console.log('Telegram Bot Polling started...');

// این هندلر باعث می‌شود با زدن /start، دکمه Web App ظاهر شود
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;

    const keyboard = {
        reply_markup: {
            inline_keyboard: [
                [
                    {
                        text: 'شروع بازی و باز کردن Web App 🎮',
                        web_app: { 
                            url: WEB_APP_URL 
                        }
                    }
                ]
            ]
        }
    };

    bot.sendMessage(chatId, 'برای شروع، دکمه بازی را بزنید:', keyboard);
});

// برای اجرای این فایل: node bot.js

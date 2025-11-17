// server.js
// Simple Express server + Telegram bot that serves the web app and
// sends a Web App button when the user sends /start to the bot.

const express = require('express');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || "8217028556:AAFDNQfmRYuUnto4gb2dAUNyWjKanRZldfA";
const WEB_APP_URL = process.env.WEB_APP_URL || "https://wordlygame.onrender.com";
const PORT = process.env.PORT || 10000;

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Basic route to check server
app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// Optionally receive events from the WebApp (like a "hello" or analytics)
app.post('/webapp/event', (req, res) => {
  console.log('WebApp event:', req.body);
  res.json({ received: true });
});

// Start Express
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT} (PORT=${PORT})`);
});

// Telegram bot (polling mode). If you run on a public server you might prefer webhook mode.
if (TELEGRAM_TOKEN && TELEGRAM_TOKEN.length > 10) {
  const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    console.log('/start received from', chatId);

    // Send a message with a Web App button (opens the client as a Telegram Web App)
    const opts = {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: 'باز کردن اپ حرفه‌ای',
              web_app: { url: WEB_APP_URL }
            }
          ]
        ]
      }
    };

    try {
      await bot.sendMessage(chatId, 'برای ورود به اپ روی دکمه زیر کلیک کنید — این یک Web App است که داخل تلگرام باز می‌شود.', opts);
    } catch (err) {
      console.error('Failed to send Web App button:', err);
    }
  });

  bot.on('polling_error', (err) => console.error('Polling error', err));
} else {
  console.warn('TELEGRAM_TOKEN not defined or looks invalid; bot disabled.');
}

// Export app for testing if needed
module.exports = app;

// server.js — upgraded with Socket.io for real-time notifications

const express = require('express');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const TelegramBot = require('node-telegram-bot-api');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || "8217028556:AAFDNQfmRYuUnto4gb2dAUNyWjKanRZldfA";
const WEB_APP_URL = process.env.WEB_APP_URL || "https://wordlygame.onrender.com";
const PORT = process.env.PORT || 10000;

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

app.post('/webapp/event', (req, res) => {
  console.log('WebApp event:', req.body);
  res.json({ received: true });
});

// SOCKET.IO
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('user_join', (data) => {
    console.log('User joined:', data);
    socket.broadcast.emit('toast', {
      message: `${data.fullname} به اپ پیوست`,
      userId: data.userId,
      time: new Date().toISOString()
    });
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

// TELEGRAM BOT
if (TELEGRAM_TOKEN && TELEGRAM_TOKEN.length > 10) {
  const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;

    const opts = {
      reply_markup: {
        inline_keyboard: [[{ text: 'باز کردن اپ حرفه‌ای', web_app: { url: WEB_APP_URL } }]]
      }
    };

    try {
      await bot.sendMessage(chatId, 'برای ورود به اپ روی دکمه زیر کلیک کنید.', opts);
    } catch (err) {
      console.error('WebApp button error:', err);
    }
  });

  bot.on('polling_error', (err) => console.error('Polling error', err));
} else {
  console.warn('TELEGRAM_TOKEN invalid — bot disabled');
}

module.exports = app;

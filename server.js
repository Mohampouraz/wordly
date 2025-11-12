require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
const server = http.createServer(app);

const io = socketIo(server, {
    cors: {
        origin: ["https://wordlybot.xo.je", "http://localhost:3000"],
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 10000;

// Telegram Bot
const BOT_TOKEN = "8217028556:AAFDNQfmRYuUnto4gb2dAUNyWjKanRZldfA";
const bot = new TelegramBot(BOT_TOKEN, { 
    polling: true 
});

// دیتابیس ساده
const userDatabase = new Map();
const connectedSockets = new Map();

// Middleware
app.use(express.json());

// Routes
app.get('/health', (req, res) => {
    res.json({
        status: '✅ سرور فعال',
        usersOnline: connectedSockets.size,
        totalUsers: userDatabase.size
    });
});

// WebSocket
io.on('connection', (socket) => {
    console.log('🔗 کاربر متصل شد:', socket.id);

    socket.on('user_connected', (userData) => {
        const { id, first_name, username } = userData;
        
        const userInfo = {
            id,
            first_name,
            username,
            socketId: socket.id,
            connectedAt: new Date()
        };
        
        connectedSockets.set(socket.id, userInfo);
        userDatabase.set(id.toString(), userInfo);

        console.log(`👤 کاربر آنلاین: ${first_name}`);

        // ارسال اطلاعات به کاربر
        socket.emit('user_data', {
            success: true,
            user: userInfo
        });

        io.emit('users_online', { 
            count: connectedSockets.size
        });
    });

    socket.on('disconnect', () => {
        const user = connectedSockets.get(socket.id);
        if (user) {
            console.log(`👤 کاربر قطع شد: ${user.first_name}`);
            connectedSockets.delete(socket.id);
            io.emit('users_online', { count: connectedSockets.size });
        }
    });
});

// هندلر /start - با Web App
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const user = msg.from;
    
    console.log('🎯 /start از:', user.first_name);

    try {
        // ذخیره کاربر
        const userInfo = {
            id: user.id,
            first_name: user.first_name,
            last_name: user.last_name || '',
            username: user.username || '',
            language_code: user.language_code || 'fa',
            joined_at: new Date()
        };
        
        userDatabase.set(user.id.toString(), userInfo);

        // ایجاد دکمه Web App که صفحه رو مستقیماً باز میکنه
        const webAppUrl = `https://wordlybot.xo.je?tgWebAppStartParam=${user.id}`;
        
        const keyboard = {
            inline_keyboard: [
                [{
                    text: "📱 بازکردن داشبورد من",
                    web_app: { url: webAppUrl }
                }]
            ]
        };

        // پیام کوتاه
        const welcomeMessage = `👋 سلام ${user.first_name}!

برای مشاهده داشبورد کاربری، روی دکمه زیر کلیک کنید:`;

        await bot.sendMessage(chatId, welcomeMessage, {
            reply_markup: keyboard
        });

        console.log(`✅ دکمه Web App برای ${user.first_name} ارسال شد`);

    } catch (error) {
        console.error('❌ خطا:', error);
        await bot.sendMessage(chatId, 
            `سلام ${user.first_name}! 👋\n\n` +
            `🌐 برای مشاهده داشبورد به آدرس زیر برید:\n` +
            `https://wordlybot.xo.je`
        );
    }
});

// هندلر پیام‌ها
bot.on('message', async (msg) => {
    if (msg.text && !msg.text.startsWith('/')) {
        const user = msg.from;
        console.log('💬 پیام از:', user.first_name);
    }
});

// شروع سرور
server.listen(PORT, () => {
    console.log('🚀 سرور فعال روی پورت:', PORT);
});

require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const TelegramBot = require('node-telegram-bot-api');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: ["https://wordlybot.xo.je", "http://localhost:10000"],
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 10000;

// Telegram Bot
const BOT_TOKEN = process.env.BOT_TOKEN || "8217028556:AAFDNQfmRYuUnto4gb2dAUNyWjKanRZldfA";
const bot = new TelegramBot(BOT_TOKEN, { 
    polling: true 
});

// ذخیره کاربران متصل
const connectedUsers = new Map();
let totalUsers = 0;

// میدلور
app.use(express.json());
app.use(express.static('public'));

// routes
app.get('/health', (req, res) => {
    res.json({
        status: '✅ سرور فعال',
        timestamp: new Date().toISOString(),
        usersOnline: connectedUsers.size,
        totalUsers: totalUsers,
        bot: 'فعال'
    });
});

app.get('/api/stats', (req, res) => {
    res.json({
        online: connectedUsers.size,
        total: totalUsers
    });
});

// WebSocket connections
io.on('connection', (socket) => {
    console.log('🔗 کاربر متصل شد:', socket.id);

    socket.on('user_connected', (userData) => {
        connectedUsers.set(socket.id, {
            ...userData,
            socketId: socket.id,
            connectedAt: new Date()
        });

        console.log(`👤 کاربر ثبت شد: ${userData.first_name} (${userData.id})`);

        // اطلاع به سایر کاربران
        socket.broadcast.emit('user_joined', {
            username: userData.first_name,
            telegramId: userData.id,
            timestamp: new Date()
        });

        // آمار به‌روز
        io.emit('users_online', { count: connectedUsers.size });
    });

    socket.on('disconnect', () => {
        const user = connectedUsers.get(socket.id);
        if (user) {
            console.log(`👤 کاربر قطع شد: ${user.first_name}`);
            connectedUsers.delete(socket.id);
            io.emit('users_online', { count: connectedUsers.size });
        }
    });
});

// Telegram Bot Handlers
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const user = msg.from;

    console.log(`🎯 /start از: ${user.first_name} (${user.id})`);

    totalUsers++;

    const welcomeMessage = `🌟 به ربات Wordly خوش آمدید ${user.first_name}!

🆔 آیدی شما: <code>${user.id}</code>
👤 نام کاربری: @${user.username || 'ندارد'}

🔗 برای مشاهده داشبورد به لینک زیر مراجعه کنید:
https://wordlybot.xo.je

✅ ربات با موفقیت فعال شد!`;

    try {
        await bot.sendMessage(chatId, welcomeMessage, {
            parse_mode: 'HTML'
        });

        // اطلاع به فرانت‌اند
        io.emit('user_joined', {
            username: user.first_name,
            telegramId: user.id,
            timestamp: new Date()
        });

        io.emit('bot_stats', { totalUsers });

        console.log(`✅ پیام ارسال شد به ${user.first_name}`);

    } catch (error) {
        console.error('❌ خطا در ارسال پیام:', error);
    }
});

bot.onText(/\/stats/, (msg) => {
    const chatId = msg.chat.id;
    
    const statsMessage = `📊 آمار ربات:

👥 کاربران آنلاین: ${connectedUsers.size}
📈 کل کاربران: ${totalUsers}
🟢 وضعیت: فعال`;

    bot.sendMessage(chatId, statsMessage);
});

bot.on('message', (msg) => {
    if (msg.text && !msg.text.startsWith('/')) {
        console.log('📨 پیام معمولی:', {
            from: msg.from.first_name,
            text: msg.text.substring(0, 50)
        });
    }
});

// هندلر خطاها
bot.on('polling_error', (error) => {
    console.log('⚠️ خطای تلگرام:', error.code);
});

// شروع سرور
server.listen(PORT, () => {
    console.log('='.repeat(50));
    console.log('🚀 سرور Wordly Bot فعال شد!');
    console.log(`📍 پورت: ${PORT}`);
    console.log(`🤖 ربات: @WordlyGameBot`);
    console.log(`🌐 فرانت‌اند: https://wordlybot.xo.je`);
    console.log(`❤️ سلامت: https://wordlygame.onrender.com/health`);
    console.log('='.repeat(50));
});

process.on('SIGINT', () => {
    console.log('🛑 خاموش کردن سرور...');
    server.close();
    process.exit(0);
});

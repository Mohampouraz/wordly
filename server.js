require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const TelegramBot = require('node-telegram-bot-api');
const path = require('path');

const app = express();
const server = http.createServer(app);

// WebSocket Configuration
const io = socketIo(server, {
    cors: {
        origin: ["https://wordlybot.xo.je", "http://localhost:3000"],
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 10000;

// Telegram Bot
const BOT_TOKEN = process.env.BOT_TOKEN || "8217028556:AAFDNQfmRYuUnto4gb2dAUNyWjKanRZldfA";
const bot = new TelegramBot(BOT_TOKEN, { 
    polling: true 
});

// دیتابیس ساده
const userDatabase = new Map();
const connectedSockets = new Map();

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Routes
app.get('/health', (req, res) => {
    res.json({
        status: '✅ سرور فعال',
        timestamp: new Date().toISOString(),
        usersOnline: connectedSockets.size,
        totalUsers: userDatabase.size,
        bot: 'فعال'
    });
});

// Route اصلی
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API برای دریافت اطلاعات کاربر
app.get('/api/user/:userId', (req, res) => {
    const userId = req.params.userId;
    const userData = userDatabase.get(userId);
    
    if (userData) {
        res.json({
            success: true,
            user: userData
        });
    } else {
        res.status(404).json({
            success: false,
            message: 'کاربر یافت نشد'
        });
    }
});

// WebSocket Connection
io.on('connection', (socket) => {
    console.log('🔗 کاربر جدید متصل شد:', socket.id);

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

        // ارسال اطلاعات کاربر به خودش
        socket.emit('user_data', {
            success: true,
            user: userInfo,
            onlineCount: connectedSockets.size
        });

        // اطلاع به سایر کاربران
        socket.broadcast.emit('user_joined', {
            username: first_name,
            telegramId: id,
            timestamp: new Date()
        });

        // به‌روزرسانی آمار
        io.emit('users_online', { 
            count: connectedSockets.size
        });
    });

    socket.on('disconnect', () => {
        const user = connectedSockets.get(socket.id);
        if (user) {
            console.log(`👤 کاربر قطع شد: ${user.first_name}`);
            connectedSockets.delete(socket.id);
            
            io.emit('users_online', { 
                count: connectedSockets.size
            });
        }
    });
});

// تابع ایجاد دکمه وب اپ
function createWebAppKeyboard(userId) {
    const webAppUrl = `https://wordlybot.xo.je?tg_user_id=${userId}`;
    
    return {
        inline_keyboard: [
            [{
                text: "🚀 بازکردن داشبورد من",
                web_app: { url: webAppUrl }
            }]
        ]
    };
}

// هندلر /start
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const user = msg.from;
    
    console.log('🎯 /start از:', user.first_name, `(${user.id})`);

    try {
        // ذخیره اطلاعات کاربر
        const userInfo = {
            id: user.id,
            first_name: user.first_name,
            last_name: user.last_name || '',
            username: user.username || '',
            language_code: user.language_code || 'fa',
            is_bot: user.is_bot || false,
            joined_at: new Date(),
            last_activity: new Date()
        };
        
        userDatabase.set(user.id.toString(), userInfo);

        // پیام خوشآمدگویی
        const welcomeMessage = `👋 سلام ${user.first_name}!

🎉 به ربات Wordly خوش آمدید.

برای مشاهده داشبورد کاربری، روی دکمه زیر کلیک کنید:`;

        // ارسال پیام با دکمه وب اپ
        await bot.sendMessage(chatId, welcomeMessage, {
            reply_markup: createWebAppKeyboard(user.id)
        });

        console.log(`✅ دکمه وب اپ برای ${user.first_name} ارسال شد`);

        // اطلاع به وب‌سوکت
        io.emit('new_user_started', {
            userId: user.id,
            username: user.first_name,
            timestamp: new Date()
        });

    } catch (error) {
        console.error('❌ خطا در پردازش /start:', error);
        
        // پیام خطای جایگزین
        await bot.sendMessage(chatId,
            `سلام ${user.first_name}! 👋\n\n` +
            `🌐 برای مشاهده داشبورد به آدرس زیر برید:\n` +
            `https://wordlybot.xo.je`
        );
    }
});

// هندلر پیام‌های معمولی
bot.on('message', async (msg) => {
    if (msg.text && !msg.text.startsWith('/')) {
        const user = msg.from;
        console.log('💬 پیام از:', user.first_name);
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
    console.log(`🌐 وب اپ: https://wordlybot.xo.je`);
    console.log(`❤️ سلامت: https://wordlygame.onrender.com/health`);
    console.log('='.repeat(50));
});

process.on('SIGINT', () => {
    console.log('\n🛑 در حال خاموش کردن سرور...');
    server.close(() => {
        console.log('✅ سرور خاموش شد');
        process.exit(0);
    });
});

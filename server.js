require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);

// WebSocket Configuration
const io = socketIo(server, {
    cors: {
        origin: ["https://wordlybot.xo.je", "http://localhost:3000"],
        methods: ["GET", "POST"],
        credentials: true
    },
    pingTimeout: 60000,
    pingInterval: 25000
});

const PORT = process.env.PORT || 10000;

// Telegram Bot با تنظیمات بهینه
const BOT_TOKEN = "8217028556:AAFDNQfmRYuUnto4gb2dAUNyWjKanRZldfA";

// استفاده از polling با تنظیمات بهینه
const TelegramBot = require('node-telegram-bot-api');
const bot = new TelegramBot(BOT_TOKEN, {
    polling: {
        interval: 300,
        autoStart: true,
        params: {
            timeout: 10,
            limit: 100
        }
    },
    request: {
        timeout: 15000,
        agentOptions: {
            keepAlive: true,
            family: 4
        },
        gzip: true
    }
});

// دیتابیس ساده
const userDatabase = new Map();
const connectedSockets = new Map();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

        // به‌روزرسانی آمار
        io.emit('users_online', { 
            count: connectedSockets.size
        });
    });

    socket.on('disconnect', (reason) => {
        const user = connectedSockets.get(socket.id);
        if (user) {
            console.log(`👤 کاربر قطع شد: ${user.first_name}`);
            connectedSockets.delete(socket.id);
            
            io.emit('users_online', { 
                count: connectedSockets.size
            });
        }
    });

    // هندل خطای socket
    socket.on('error', (error) => {
        console.log('❌ خطای Socket:', error);
    });
});

// تابع ارسال پیام با retry
async function sendMessageWithRetry(chatId, text, options = {}, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            const result = await bot.sendMessage(chatId, text, options);
            return result;
        } catch (error) {
            console.log(`⚠️ تلاش ${i + 1} از ${retries} ناموفق بود:`, error.message);
            
            if (i === retries - 1) {
                throw error;
            }
            
            // انتظار قبل از تلاش مجدد
            await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
        }
    }
}

// هندلر /start بهینه شده
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

        // ایجاد کیبورد ساده
        const keyboard = {
            inline_keyboard: [[
                {
                    text: "📊 بازکردن داشبورد من",
                    url: "https://wordlybot.xo.je"
                }
            ]]
        };

        // پیام ساده و بهینه
        const welcomeMessage = `سلام ${user.first_name}! 👋

به ربات Wordly خوش آمدید.

🆔 آیدی شما: ${user.id}
👤 نام کاربری: @${user.username || 'ندارد'}

برای مشاهده داشبورد روی دکمه زیر کلیک کنید:`;

        // ارسال پیام با retry
        await sendMessageWithRetry(chatId, welcomeMessage, {
            reply_markup: keyboard
        });

        console.log(`✅ پیام برای ${user.first_name} ارسال شد`);

        // اطلاع به وب‌سوکت
        io.emit('new_user_joined', {
            userId: user.id,
            username: user.first_name,
            timestamp: new Date()
        });

    } catch (error) {
        console.error('❌ خطا در ارسال پیام:', error.message);
        
        // پیام خطای ساده
        try {
            await bot.sendMessage(chatId,
                `سلام ${user.first_name}! 👋\n\n` +
                `ربات فعال شد.\n` +
                `🌐 آدرس داشبورد: https://wordlybot.xo.je`
            );
        } catch (fallbackError) {
            console.error('❌ خطا در ارسال پیام جایگزین:', fallbackError.message);
        }
    }
});

// هندلر پیام‌های ساده
bot.on('message', async (msg) => {
    if (msg.text && !msg.text.startsWith('/')) {
        const user = msg.from;
        
        console.log('💬 پیام از:', user.first_name, '- متن:', msg.text.substring(0, 50));

        // به‌روزرسانی فعالیت
        const userInfo = userDatabase.get(user.id.toString());
        if (userInfo) {
            userInfo.last_activity = new Date();
        }

        // پاسخ به پیام‌های خاص
        if (msg.text.includes('داشبورد') || msg.text.includes('dashboard')) {
            try {
                await sendMessageWithRetry(msg.chat.id,
                    `📱 برای مشاهده داشبورد به این آدرس برید:\n` +
                    `https://wordlybot.xo.je\n\n` +
                    `یا از دستور /start استفاده کنید.`
                );
            } catch (error) {
                console.log('خطا در پاسخ به پیام:', error.message);
            }
        }
    }
});

// هندلر خطاهای تلگرام - ساده شده
bot.on('polling_error', (error) => {
    if (error.code === 'EFATAL' || error.code === 'ESOCKETTIMEDOUT') {
        console.log('⚠️ خطای اتصال تلگرام - در حال ادامه کار...');
    } else {
        console.log('⚠️ خطای تلگرام:', error.code);
    }
});

bot.on('webhook_error', (error) => {
    console.log('⚠️ خطای Webhook:', error.message);
});

// تابع بررسی سلامت بات
async function checkBotHealth() {
    try {
        const me = await bot.getMe();
        console.log('🤖 وضعیت بات:', me.first_name, '-', me.username);
        return true;
    } catch (error) {
        console.log('❌ بات به تلگرام متصل نیست:', error.message);
        return false;
    }
}

// شروع سرور
server.listen(PORT, async () => {
    console.log('='.repeat(50));
    console.log('🚀 سرور فعال شد روی پورت:', PORT);
    
    // بررسی سلامت بات
    const isHealthy = await checkBotHealth();
    if (isHealthy) {
        console.log('✅ بات به تلگرام متصل است');
    } else {
        console.log('❌ بات به تلگرام متصل نیست - بررسی کنید');
    }
    
    console.log('🌐 فرانت‌اند: https://wordlybot.xo.je');
    console.log('='.repeat(50));
});

// تمیز کردن منابع
process.on('SIGINT', () => {
    console.log('\n🛑 خاموش کردن سرور...');
    console.log(`📊 جمع‌بندی: ${userDatabase.size} کاربر`);
    server.close(() => {
        console.log('✅ سرور خاموش شد');
        process.exit(0);
    });
});

// بررسی دوره‌ی سلامت
setInterval(async () => {
    await checkBotHealth();
}, 300000); // هر 5 دقیقه

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
        origin: ["https://wordlybot.xo.je", "http://localhost:3000", "https://web.telegram.org"],
        methods: ["GET", "POST"],
        credentials: true
    }
});

const PORT = process.env.PORT || 10000;

// Telegram Bot Configuration
const BOT_TOKEN = process.env.BOT_TOKEN || "8217028556:AAFDNQfmRYuUnto4gb2dAUNyWjKanRZldfA";
const bot = new TelegramBot(BOT_TOKEN, { 
    polling: true,
    request: {
        timeout: 10000
    }
});

// Database Simulation (در صورت نیاز می‌تونی به PostgreSQL وصل شی)
const userDatabase = new Map();
const connectedSockets = new Map();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve Static Files (اگر فرانت‌اند همینجا باشه)
app.use(express.static('public'));

// Routes
app.get('/health', (req, res) => {
    res.json({
        status: '✅ سرور فعال',
        timestamp: new Date().toISOString(),
        usersOnline: connectedSockets.size,
        totalUsers: userDatabase.size,
        bot: 'فعال و در حال اجرا',
        platform: 'Telegram Bot Web App'
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

app.get('/api/online-users', (req, res) => {
    const onlineUsers = Array.from(connectedSockets.values()).map(user => ({
        id: user.id,
        username: user.username,
        first_name: user.first_name,
        last_seen: user.last_seen
    }));
    
    res.json({
        success: true,
        count: onlineUsers.length,
        users: onlineUsers
    });
});

// Web App Route
app.get('/webapp', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// WebSocket Connection Handling
io.on('connection', (socket) => {
    console.log('🔗 کاربر جدید متصل شد:', socket.id);

    socket.on('user_connected', (userData) => {
        const { id, first_name, username, last_name, language_code } = userData;
        
        // ذخیره اطلاعات کاربر
        const userInfo = {
            id,
            first_name,
            username,
            last_name,
            language_code,
            socketId: socket.id,
            connectedAt: new Date(),
            last_seen: new Date()
        };
        
        connectedSockets.set(socket.id, userInfo);
        userDatabase.set(id.toString(), userInfo);

        console.log(`👤 کاربر آنلاین: ${first_name} (@${username || 'no_username'})`);

        // اطلاع به سایر کاربران
        socket.broadcast.emit('user_joined', {
            username: first_name,
            telegramId: id,
            timestamp: new Date(),
            message: `کاربر جدید ${first_name} به ربات پیوست! 🎉`
        });

        // ارسال اطلاعات کاربر به خودش
        socket.emit('user_data', {
            success: true,
            user: userInfo,
            onlineCount: connectedSockets.size
        });

        // به‌روزرسانی آمار برای همه
        io.emit('users_online', { 
            count: connectedSockets.size,
            users: Array.from(connectedSockets.values()).map(u => ({
                id: u.id,
                name: u.first_name,
                username: u.username
            }))
        });

        // تأیید اتصال
        socket.emit('connection_confirmed', {
            message: 'اتصال شما تأیید شد',
            user: userInfo
        });
    });

    socket.on('disconnect', (reason) => {
        const user = connectedSockets.get(socket.id);
        if (user) {
            console.log(`👤 کاربر قطع شد: ${user.first_name} (${reason})`);
            connectedSockets.delete(socket.id);
            
            // به‌روزرسانی آمار
            io.emit('users_online', { 
                count: connectedSockets.size,
                users: Array.from(connectedSockets.values()).map(u => ({
                    id: u.id,
                    name: u.first_name,
                    username: u.username
                }))
            });
        }
    });

    socket.on('user_message', (data) => {
        console.log('📨 پیام از کاربر:', data);
        // می‌تونی این پیام‌ها رو به ربات تلگرام فوروارد کنی
    });

    socket.on('get_user_info', (userId) => {
        const userInfo = userDatabase.get(userId.toString());
        if (userInfo) {
            socket.emit('user_info_response', userInfo);
        }
    });
});

// Telegram Bot Handlers - بهینه شده
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const user = msg.from;
    
    console.log('🎯 دستور /start دریافت شد:', {
        userId: user.id,
        username: user.username,
        firstName: user.first_name,
        chatId: chatId
    });

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

        // ایجاد دکمه وب اپ
        const webAppUrl = `https://wordlybot.xo.je?startapp=${user.id}&ref=telegram_bot`;
        
        const keyboard = {
            inline_keyboard: [
                [{
                    text: "📊 مشاهده داشبورد من",
                    web_app: { url: webAppUrl }
                }],
                [{
                    text: "🔄 بروزرسانی اطلاعات",
                    callback_data: "refresh_info"
                }]
            ]
        };

        // پیام خوشآمدگویی با فرمت زیبا
        const welcomeMessage = `🌟 <b>به ربات Wordly خوش آمدید ${user.first_name}!</b>

👤 <b>اطلاعات حساب شما:</b>
🆔 <code>آیدی: ${user.id}</code>
📛 <code>نام: ${user.first_name} ${user.last_name || ''}</code>
🔗 <code>نام کاربری: @${user.username || 'ندارد'}</code>
🌐 <code>زبان: ${user.language_code || 'فارسی'}</code>

💫 <b>امکانات ربات:</b>
• نمایش اطلاعات حساب در وب اپ
• مشاهده آمار زنده
• اعلان‌های لحظه‌ای
• مدیریت فعالیت‌ها

📱 <b>برای مشاهده داشبورد کامل، روی دکمه زیر کلیک کنید:</b>`;

        // ارسال پیام اصلی
        await bot.sendMessage(chatId, welcomeMessage, {
            parse_mode: 'HTML',
            reply_markup: keyboard,
            disable_web_page_preview: true
        });

        console.log(`✅ پیام خوشآمدگویی برای ${user.first_name} ارسال شد`);

        // اطلاع به کاربران آنلاین
        io.emit('new_user_joined', {
            userId: user.id,
            username: user.first_name,
            telegramUsername: user.username,
            timestamp: new Date(),
            message: `کاربر جدید ${user.first_name} ربات را شروع کرد! 🎉`
        });

        // ارسال پیام تأیید
        setTimeout(async () => {
            await bot.sendMessage(chatId, 
                `✅ <b>اطلاعات شما با موفقیت ثبت شد!</b>\n\n` +
                `🌐 <b>آدرس داشبورد:</b>\n<code>https://wordlybot.xo.je</code>\n\n` +
                `📊 می‌تونی همیشه از طریق دکمه "مشاهده داشبورد من" اطلاعاتت رو ببینی!`,
                { parse_mode: 'HTML' }
            );
        }, 1000);

    } catch (error) {
        console.error('❌ خطا در پردازش /start:', error);
        
        // پیام خطای جایگزین
        await bot.sendMessage(chatId,
            `❌ متأسفانه خطایی رخ داد!\n\n` +
            `لطفاً دوباره تلاش کنید یا با پشتیبانی تماس بگیرید.\n\n` +
            `🌐 می‌تونی مستقیم به آدرس زیر بری:\n` +
            `https://wordlybot.xo.je`,
            { parse_mode: 'HTML' }
        );
    }
});

// هندلر دکمه‌های اینلاین
bot.on('callback_query', async (callbackQuery) => {
    const message = callbackQuery.message;
    const user = callbackQuery.from;
    const data = callbackQuery.data;

    if (data === 'refresh_info') {
        try {
            const userInfo = userDatabase.get(user.id.toString());
            
            if (userInfo) {
                const webAppUrl = `https://wordlybot.xo.je?startapp=${user.id}&ref=telegram_bot&refresh=true`;
                
                const updatedKeyboard = {
                    inline_keyboard: [[
                        {
                            text: "🔄 بروزرسانی کردم - مشاهده داشبورد",
                            web_app: { url: webAppUrl }
                        }
                    ]]
                };

                await bot.editMessageReplyMarkup(updatedKeyboard, {
                    chat_id: message.chat.id,
                    message_id: message.message_id
                });

                await bot.answerCallbackQuery(callbackQuery.id, {
                    text: "✅ اطلاعات بروزرسانی شد! حالا روی دکمه کلیک کن"
                });

            }
        } catch (error) {
            console.error('Error handling callback:', error);
            await bot.answerCallbackQuery(callbackQuery.id, {
                text: "❌ خطا در بروزرسانی"
            });
        }
    }
});

// هندلر پیام‌های معمولی
bot.on('message', async (msg) => {
    // فقط پیام‌های متنی که کامند نیستند
    if (msg.text && !msg.text.startsWith('/')) {
        const user = msg.from;
        const chatId = msg.chat.id;
        
        console.log('💬 پیام معمولی:', {
            from: user.first_name,
            text: msg.text.substring(0, 100),
            userId: user.id
        });

        // به‌روزرسانی آخرین فعالیت
        const userInfo = userDatabase.get(user.id.toString());
        if (userInfo) {
            userInfo.last_activity = new Date();
            userDatabase.set(user.id.toString(), userInfo);
        }

        // اطلاع به وب‌سوکت
        io.emit('user_activity', {
            userId: user.id,
            username: user.first_name,
            activity: 'message',
            timestamp: new Date()
        });

        // پاسخ خودکار
        if (msg.text.toLowerCase().includes('داشبورد') || msg.text.includes('dashboard')) {
            const webAppUrl = `https://wordlybot.xo.je?startapp=${user.id}&ref=telegram_message`;
            
            await bot.sendMessage(chatId,
                `📱 <b>داشبورد شما آماده است!</b>\n\n` +
                `روی لینک زیر کلیک کن یا از دکمه /start استفاده کن:\n` +
                `🔗 <code>https://wordlybot.xo.je</code>`,
                {
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [[
                            { text: "🚀 بازکردن داشبورد", web_app: { url: webAppUrl } }
                        ]]
                    }
                }
            );
        }
    }
});

// هندلر خطاها
bot.on('polling_error', (error) => {
    console.log('⚠️ خطای تلگرام:', error.code, error.message);
});

bot.on('error', (error) => {
    console.log('❌ خطای ربات:', error.message);
});

// تابع ارسال نوتیفیکیشن به کاربر
async function sendUserNotification(userId, message) {
    try {
        await bot.sendMessage(userId, message, { parse_mode: 'HTML' });
        console.log(`✅ نوتیفیکیشن ارسال شد به کاربر ${userId}`);
    } catch (error) {
        console.log(`❌ خطا در ارسال نوتیفیکیشن به ${userId}:`, error.message);
    }
}

// تابع بررسی کاربران آنلاین
function getOnlineUsers() {
    return Array.from(connectedSockets.values()).map(user => ({
        id: user.id,
        name: user.first_name,
        username: user.username,
        connectedAt: user.connectedAt
    }));
}

// شروع سرور
server.listen(PORT, () => {
    console.log('='.repeat(60));
    console.log('🚀 سرور Wordly Bot با موفقیت فعال شد!');
    console.log(`📍 پورت: ${PORT}`);
    console.log(`🤖 ربات: @WordlyGameBot`);
    console.log(`🌐 فرانت‌اند: https://wordlybot.xo.je`);
    console.log(`🔗 وب‌اپ: https://wordlybot.xo.je`);
    console.log(`❤️ سلامت سرور: https://wordlygame.onrender.com/health`);
    console.log(`📊 کاربران ثبت‌شده: ${userDatabase.size}`);
    console.log('='.repeat(60));
    
    // لاگ وضعیت هر 5 دقیقه
    setInterval(() => {
        console.log('📊 وضعیت فعلی:', {
            usersOnline: connectedSockets.size,
            totalUsers: userDatabase.size,
            timestamp: new Date().toISOString()
        });
    }, 300000);
});

// هندلر خاموشی گراسیفول
process.on('SIGINT', () => {
    console.log('\n🛑 در حال خاموش کردن سرور...');
    console.log(`📊 جمع‌بندی: ${userDatabase.size} کاربر, ${connectedSockets.size} آنلاین`);
    server.close(() => {
        console.log('✅ سرور با موفقیت خاموش شد');
        process.exit(0);
    });
});

process.on('SIGTERM', () => {
    console.log('\n🛑 درخواست خاموشی سرور...');
    server.close(() => {
        console.log('✅ سرور خاموش شد');
        process.exit(0);
    });
});

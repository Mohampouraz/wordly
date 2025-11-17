const express = require('express');
const { Telegraf } = require('telegraf');
const { Client } = require('pg');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 10000;

// تنظیمات
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const DATABASE_URL = process.env.DATABASE_URL;
const WEB_APP_URL = process.env.WEB_APP_URL;

const bot = new Telegraf(TELEGRAM_TOKEN);
const dbClient = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// middleware
app.use(express.json());
app.use(express.static('public'));

// ذخیره کاربران آنلاین (برای نوتیفیکیشن)
const onlineUsers = new Map();

// اتصال به دیتابیس
dbClient.connect()
    .then(() => console.log('✅ Connected to PostgreSQL'))
    .catch(err => console.error('❌ Database connection error:', err));

// ایجاد جداول
async function createTables() {
    try {
        // جدول کاربران
        await dbClient.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                telegram_id BIGINT UNIQUE NOT NULL,
                full_name VARCHAR(255),
                username VARCHAR(255),
                first_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                is_active BOOLEAN DEFAULT true,
                game_score INTEGER DEFAULT 0
            )
        `);

        // جدول نوتیفیکیشن‌ها
        await dbClient.query(`
            CREATE TABLE IF NOT EXISTS notifications (
                id SERIAL PRIMARY KEY,
                user_id BIGINT,
                message TEXT,
                type VARCHAR(50),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        console.log('✅ Database tables ready');
    } catch (error) {
        console.error('❌ Error creating tables:', error);
    }
}

createTables();

// تابع ارسال نوتیفیکیشن به همه کاربران
async function broadcastToAllUsers(message, options = {}) {
    try {
        const result = await dbClient.query(
            'SELECT telegram_id FROM users WHERE is_active = true'
        );
        
        const users = result.rows;
        let successCount = 0;
        
        for (const user of users) {
            try {
                await bot.telegram.sendMessage(user.telegram_id, message, options);
                successCount++;
                
                // تأخیر کوچک برای جلوگیری از محدودیت تلگرام
                await new Promise(resolve => setTimeout(resolve, 100));
            } catch (error) {
                console.error(`Failed to send to user ${user.telegram_id}:`, error.message);
                
                // اگر کاربر بلاک کرده، غیرفعالش کن
                if (error.description && error.description.includes('blocked')) {
                    await dbClient.query(
                        'UPDATE users SET is_active = false WHERE telegram_id = $1',
                        [user.telegram_id]
                    );
                }
            }
        }
        
        console.log(`📢 Broadcast sent to ${successCount}/${users.length} users`);
        return successCount;
    } catch (error) {
        console.error('Error in broadcast:', error);
        return 0;
    }
}

// تابع ارسال نوتیفیکیشن به کاربران آنلاین
function broadcastToOnlineUsers(message, options = {}) {
    let successCount = 0;
    onlineUsers.forEach((userData, telegramId) => {
        try {
            bot.telegram.sendMessage(telegramId, message, options);
            successCount++;
        } catch (error) {
            console.error(`Failed to send to online user ${telegramId}:`, error.message);
        }
    });
    console.log(`📱 Notification sent to ${successCount} online users`);
    return successCount;
}

// هندلر کامند /start
bot.command('start', async (ctx) => {
    const userId = ctx.from.id;
    const fullName = `${ctx.from.first_name || ''} ${ctx.from.last_name || ''}`.trim();
    const username = ctx.from.username;
    
    // بررسی آیا کاربر جدید است
    const existingUser = await dbClient.query(
        'SELECT * FROM users WHERE telegram_id = $1',
        [userId]
    );
    
    const isNewUser = existingUser.rows.length === 0;

    // ذخیره یا آپدیت کاربر در دیتابیس
    try {
        await dbClient.query(
            `INSERT INTO users (telegram_id, full_name, username, last_seen) 
             VALUES ($1, $2, $3, CURRENT_TIMESTAMP) 
             ON CONFLICT (telegram_id) 
             DO UPDATE SET last_seen = CURRENT_TIMESTAMP, full_name = $2, username = $3, is_active = true`,
            [userId, fullName, username]
        );
    } catch (error) {
        console.error('❌ Error saving user:', error);
    }

    // اگر کاربر جدید است، نوتیفیکیشن بفرست
    if (isNewUser) {
        const userCount = await getUserCount();
        const welcomeMessage = `🎉 کاربر جدید به ربات پیوست!\n👤 نام: ${fullName}\n🆔 آی‌دی: ${userId}\n📊 تعداد کل کاربران: ${userCount}`;
        
        // ارسال به همه کاربران آنلاین
        broadcastToOnlineUsers(welcomeMessage, {
            parse_mode: 'HTML'
        });
        
        // همچنین به ادمین اطلاع بده
        const adminMessage = `👤 کاربر جدید:\n${fullName} (${username ? '@' + username : 'بدون یوزرنیم'})`;
        await bot.telegram.sendMessage(
            userId, // در واقعیت باید آی‌دی ادمین را قرار دهید
            adminMessage,
            { parse_mode: 'HTML' }
        );
    }

    // ایجاد دکمه برای باز کردن وب اپ
    const keyboard = {
        inline_keyboard: [
            [{
                text: '🚀 باز کردن پنل کاربری',
                web_app: { url: `${WEB_APP_URL}` }
            }],
            [{
                text: '📊 آمار ربات',
                callback_data: 'stats'
            }]
        ]
    };

    const welcomeText = isNewUser ? 
        `🎉 به خانواده ربات خوش آمدید ${fullName}!` : 
        `👋 دوباره سلام ${fullName}!`;

    await ctx.reply(`${welcomeText}\n\nبرای مشاهده پنل کاربری روی دکمه زیر کلیک کنید:`, {
        reply_markup: keyboard,
        parse_mode: 'HTML'
    });
});

// کامند آمار
bot.command('stats', async (ctx) => {
    const userCount = await getUserCount();
    const activeCount = await getActiveUserCount();
    
    await ctx.reply(
        `📊 آمار ربات:\n\n👥 تعداد کاربران: ${userCount}\n🟢 کاربران فعال: ${activeCount}\n🌐 کاربران آنلاین: ${onlineUsers.size}`,
        { parse_mode: 'HTML' }
    );
});

// هندلر callback
bot.action('stats', async (ctx) => {
    const userCount = await getUserCount();
    const activeCount = await getActiveUserCount();
    
    await ctx.editMessageText(
        `📊 آمار ربات:\n\n👥 تعداد کاربران: ${userCount}\n🟢 کاربران فعال: ${activeCount}\n🌐 کاربران آنلاین: ${onlineUsers.size}`,
        { parse_mode: 'HTML' }
    );
});

// توابع کمکی
async function getUserCount() {
    const result = await dbClient.query('SELECT COUNT(*) FROM users');
    return result.rows[0].count;
}

async function getActiveUserCount() {
    const result = await dbClient.query('SELECT COUNT(*) FROM users WHERE is_active = true');
    return result.rows[0].count;
}

// API برای دریافت اطلاعات کاربر
app.get('/api/user/:telegramId', async (req, res) => {
    try {
        const telegramId = req.params.telegramId;
        
        // کاربر را آنلاین علامت بزن
        onlineUsers.set(parseInt(telegramId), {
            lastSeen: new Date(),
            userAgent: req.get('User-Agent')
        });

        const result = await dbClient.query(
            'SELECT * FROM users WHERE telegram_id = $1',
            [telegramId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        const user = result.rows[0];
        res.json({
            telegram_id: user.telegram_id,
            full_name: user.full_name,
            username: user.username,
            first_seen: user.first_seen,
            last_seen: user.last_seen,
            game_score: user.game_score,
            is_active: user.is_active
        });
    } catch (error) {
        console.error('❌ Error fetching user:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// API برای ثبت امتیاز بازی
app.post('/api/user/:telegramId/score', async (req, res) => {
    try {
        const telegramId = req.params.telegramId;
        const { score } = req.body;

        const result = await dbClient.query(
            'UPDATE users SET game_score = $1 WHERE telegram_id = $2 RETURNING *',
            [score, telegramId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({ success: true, new_score: result.rows[0].game_score });
    } catch (error) {
        console.error('❌ Error updating score:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// API برای دریافت آمار
app.get('/api/stats', async (req, res) => {
    try {
        const userCount = await getUserCount();
        const activeCount = await getActiveUserCount();
        
        res.json({
            total_users: parseInt(userCount),
            active_users: parseInt(activeCount),
            online_users: onlineUsers.size
        });
    } catch (error) {
        console.error('❌ Error getting stats:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// API برای دریافت لیست کاربران آنلاین
app.get('/api/online-users', (req, res) => {
    const onlineList = Array.from(onlineUsers.entries()).map(([id, data]) => ({
        telegram_id: id,
        last_seen: data.lastSeen
    }));
    
    res.json({ online_users: onlineList });
});

// API برای ایجاد کاربر جدید
app.post('/api/user', async (req, res) => {
    try {
        const { telegram_id, full_name, username } = req.body;
        
        const result = await dbClient.query(
            `INSERT INTO users (telegram_id, full_name, username) 
             VALUES ($1, $2, $3) 
             ON CONFLICT (telegram_id) 
             DO UPDATE SET full_name = $2, username = $3, last_seen = CURRENT_TIMESTAMP
             RETURNING *`,
            [telegram_id, full_name, username]
        );

        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error creating/updating user:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// هندلر برای سرو فایل‌های استاتیک
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Cleanup کاربران آنلاین هر 5 دقیقه
setInterval(() => {
    const now = new Date();
    onlineUsers.forEach((data, userId) => {
        if (now - data.lastSeen > 5 * 60 * 1000) { // 5 دقیقه
            onlineUsers.delete(userId);
        }
    });
}, 5 * 60 * 1000);

// راه‌اندازی سرور
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🌐 Web App URL: ${WEB_APP_URL}`);
});

// راه‌اندازی ربات
bot.launch()
    .then(() => console.log('🤖 Bot is running'))
    .catch(err => console.error('❌ Bot error:', err));

// مدیریت graceful shutdown
process.once('SIGINT', () => {
    console.log('🛑 Shutting down gracefully...');
    bot.stop('SIGINT');
    process.exit(0);
});

process.once('SIGTERM', () => {
    console.log('🛑 Shutting down gracefully...');
    bot.stop('SIGTERM');
    process.exit(0);
});

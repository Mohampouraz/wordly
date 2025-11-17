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

// ذخیره کاربران آنلاین برای نوتیفیکیشن
const onlineUsers = new Map();

// اتصال به دیتابیس
dbClient.connect()
    .then(() => console.log('✅ Connected to PostgreSQL'))
    .catch(err => console.error('❌ Database connection error:', err));

// ایجاد جداول
async function createTables() {
    try {
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
        console.log('✅ Database tables ready');
    } catch (error) {
        console.error('❌ Error creating tables:', error);
    }
}

createTables();

// تابع ارسال نوتیفیکیشن به کاربران فعال
async function sendNotificationToActiveUsers(message, excludeUserId = null) {
    try {
        console.log(`📢 ارسال نوتیفیکیشن به کاربران فعال: ${message}`);
        
        const result = await dbClient.query(
            'SELECT telegram_id FROM users WHERE is_active = true AND telegram_id != $1',
            [excludeUserId || 0]
        );
        
        const users = result.rows;
        let successCount = 0;
        let failCount = 0;

        console.log(`👥 تعداد کاربران فعال برای ارسال: ${users.length}`);

        for (const user of users) {
            try {
                await bot.telegram.sendMessage(user.telegram_id, message, {
                    parse_mode: 'HTML'
                });
                successCount++;
                console.log(`✅ ارسال به کاربر ${user.telegram_id}`);

                // تأخیر کوچک برای جلوگیری از محدودیت تلگرام
                await new Promise(resolve => setTimeout(resolve, 100));
                
            } catch (error) {
                failCount++;
                console.error(`❌ خطا در ارسال به کاربر ${user.telegram_id}:`, error.message);
                
                // اگر کاربر بلاک کرده، غیرفعالش کن
                if (error.description && error.description.includes('blocked')) {
                    await dbClient.query(
                        'UPDATE users SET is_active = false WHERE telegram_id = $1',
                        [user.telegram_id]
                    );
                    console.log(`🚫 کاربر ${user.telegram_id} غیرفعال شد`);
                }
            }
        }
        
        console.log(`📊 نتیجه ارسال نوتیفیکیشن: ${successCount} موفق, ${failCount} ناموفق`);
        return { success: successCount, failed: failCount };
        
    } catch (error) {
        console.error('💥 خطا در ارسال نوتیفیکیشن:', error);
        return { success: 0, failed: 0 };
    }
}

// تابع ارسال نوتیفیکیشن به کاربران آنلاین
function sendNotificationToOnlineUsers(message, excludeUserId = null) {
    let successCount = 0;
    let failCount = 0;

    console.log(`📱 ارسال نوتیفیکیشن به کاربران آنلاین: ${message}`);

    onlineUsers.forEach((userData, telegramId) => {
        if (excludeUserId && telegramId === excludeUserId) return;
        
        try {
            bot.telegram.sendMessage(telegramId, message, {
                parse_mode: 'HTML'
            });
            successCount++;
            console.log(`✅ ارسال به کاربر آنلاین ${telegramId}`);
        } catch (error) {
            failCount++;
            console.error(`❌ خطا در ارسال به کاربر آنلاین ${telegramId}:`, error.message);
        }
    });

    console.log(`📊 نتیجه ارسال به آنلاین‌ها: ${successCount} موفق, ${failCount} ناموفق`);
    return { success: successCount, failed: failCount };
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
        const welcomeMessage = `🎉 <b>کاربر جدید به ربات پیوست!</b>\n\n👤 <b>نام:</b> ${fullName}\n🆔 <b>آی‌دی:</b> <code>${userId}</code>\n📊 <b>تعداد کل کاربران:</b> ${userCount}\n\nخوش آمدید! 🎊`;
        
        // ارسال نوتیفیکیشن به کاربران آنلاین و فعال
        console.log('🆕 کاربر جدید شناسایی شد، ارسال نوتیفیکیشن...');
        
        // اول به کاربران آنلاین
        const onlineResult = sendNotificationToOnlineUsers(welcomeMessage, userId);
        
        // سپس به همه کاربران فعال (با تأخیر برای جلوگیری از overload)
        setTimeout(async () => {
            const activeResult = await sendNotificationToActiveUsers(welcomeMessage, userId);
            console.log(`📨 نوتیفیکیشن کاربر جدید ارسال شد: ${onlineResult.success + activeResult.success} کاربر`);
        }, 2000);
    }

    // ایجاد دکمه برای باز کردن وب اپ
    const keyboard = {
        inline_keyboard: [
            [{
                text: '🚀 باز کردن پنل کاربری',
                web_app: { url: `${WEB_APP_URL}?tgid=${userId}` }
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
        `📊 <b>آمار ربات</b>\n\n👥 <b>تعداد کاربران:</b> ${userCount}\n🟢 <b>کاربران فعال:</b> ${activeCount}\n🌐 <b>کاربران آنلاین:</b> ${onlineUsers.size}`,
        { parse_mode: 'HTML' }
    );
});

// کامند ارسال پیام به همه (فقط برای ادمین)
bot.command('broadcast', async (ctx) => {
    const userId = ctx.from.id;
    
    // بررسی آیا کاربر ادمین است (می‌توانی آی‌دی خودت رو اینجا قرار دهی)
    const adminId = 123456789; // آی‌دی ادمین رو اینجا قرار بده
    if (userId !== adminId) {
        await ctx.reply('❌ شما دسترسی به این command را ندارید.');
        return;
    }

    const message = ctx.message.text.replace('/broadcast', '').trim();
    if (!message) {
        await ctx.reply('❌ لطفاً پیام خود را بعد از /broadcast وارد کنید.');
        return;
    }

    const broadcastMessage = `📢 <b>پیام همگانی:</b>\n\n${message}`;
    
    await ctx.reply('🔄 در حال ارسال پیام به همه کاربران...');
    
    const result = await sendNotificationToActiveUsers(broadcastMessage);
    
    await ctx.reply(
        `✅ ارسال پیام همگانی تکمیل شد:\n\n✅ موفق: ${result.success}\n❌ ناموفق: ${result.failed}`,
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

        const user = result.rows[0];
        
        // ارسال نوتیفیکیشن امتیاز جدید
        const scoreMessage = `🏆 <b>امتیاز جدید!</b>\n\n👤 <b>کاربر:</b> ${user.full_name}\n🎯 <b>امتیاز:</b> ${score}\n\nتبریک می‌گم! 🎉`;
        sendNotificationToOnlineUsers(scoreMessage, telegramId);

        res.json({ success: true, new_score: user.game_score });
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

// ENV / config
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || "8217028556:AAFDNQfmRYuUnto4gb2dAUNyWjKanRZldfA";
const WEB_APP_URL = process.env.WEB_APP_URL || "https://wordlybot.xo.je"; // آدرس برنامه وب
const DATABASE_URL = process.env.DATABASE_URL || "postgresql://abolfazl:ZnczfHE6NUZWmPfYtPQjUdsuaseuFoHS@dpg-d3q9nrm3jp1c738f47pg-a.frankfurt-postgres.render.com/wordgame_lbh3";
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0'; // برای Render

const express = require('express');
const http = require('http');
const TelegramBot = require('node-telegram-bot-api');
const { Sequelize, DataTypes } = require('sequelize');
const { Server } = require("socket.io");

// 1. تنظیمات Express و HTTP Server و Socket.IO
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: WEB_APP_URL, // دسترسی فقط از برنامه وب شما
        methods: ["GET", "POST"]
    }
});

// Middlewares
app.use(express.json()); // برای پردازش webhook تلگرام

// 2. تنظیمات دیتابیس (Sequelize)
// استفاده از dialectOptions برای اتصال به PostgreSQL در Render
const sequelize = new Sequelize(DATABASE_URL, {
    dialect: 'postgres',
    dialectOptions: {
        ssl: {
            require: true,
            rejectUnauthorized: false // ضروری برای Render
        }
    },
    logging: false
});

// مدل User
const User = sequelize.define('User', {
    id: { type: DataTypes.BIGINT, primaryKey: true, allowNull: false }, // Telegram User ID
    first_name: { type: DataTypes.STRING, allowNull: false },
    last_name: { type: DataTypes.STRING, allowNull: true },
    username: { type: DataTypes.STRING, allowNull: true },
    full_name: { 
        type: DataTypes.VIRTUAL,
        get() {
            return `${this.first_name} ${this.last_name || ''}`.trim();
        }
    }
});

async function initializeDatabase() {
    try {
        await sequelize.authenticate();
        console.log('Connection to DB has been established successfully.');
        await User.sync({ alter: true }); // ایجاد یا به‌روزرسانی جدول
        console.log('User table synced.');
    } catch (error) {
        console.error('Unable to connect to the database or sync:', error);
    }
}

// 3. تنظیمات Telegram Bot (Webhook)
const bot = new TelegramBot(TELEGRAM_TOKEN);
const webhookPath = `/webhook/${TELEGRAM_TOKEN}`;
const botUrl = `https://wordlygame.onrender.com${webhookPath}`; // آدرس webhook در Render

// تنظیم webhook
async function setBotWebhook() {
    try {
        const result = await bot.setWebHook(botUrl);
        console.log(`Webhook set to: ${botUrl}. Result: ${result}`);
    } catch (error) {
        console.error('Error setting webhook:', error.message);
    }
}

// مسیر برای دریافت به‌روزرسانی‌های تلگرام
app.post(webhookPath, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
});

// مسیر اصلی برای چک کردن سلامت
app.get('/', (req, res) => {
    res.send(`Telegram Bot Webhook is running on port ${PORT}. Webhook URL: ${botUrl}`);
});


// 4. منطق بات: هندل کردن دستور /start
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const fromUser = msg.from;
    const { id, first_name, last_name, username } = fromUser;
    
    // اطلاعات کاربر برای نمایش
    const userFullName = `${first_name} ${last_name || ''}`.trim();
    const userInfo = `
        👋 خوش آمدید!
        
        **نام کامل:** ${userFullName}
        **شناسه کاربری:** \`${id}\`
    `;

    // 4.1. ذخیره/به‌روزرسانی کاربر در دیتابیس
    let isNewUser = false;
    try {
        const [user, created] = await User.findOrCreate({
            where: { id: id },
            defaults: { first_name, last_name, username }
        });
        
        // اگر کاربر قبلاً وجود داشته و اطلاعاتش عوض شده، به‌روزرسانی می‌کنیم
        if (!created) {
            await user.update({ first_name, last_name, username });
        }
        
        isNewUser = created;

    } catch (error) {
        console.error('DB Operation Error:', error);
    }

    // 4.2. ارسال پیام به کاربر در تلگرام
    const startMessage = isNewUser 
        ? `🌟 کاربر جدید: ${userFullName} به ما پیوست! 🌟`
        : `👋 خوش آمدید دوباره، ${userFullName}!`;
        
    bot.sendMessage(chatId, `${startMessage}\n\n${userInfo}`, { parse_mode: 'Markdown' });
    
    // 4.3. ارسال نوتیفیکیشن به تمام کاربران وب (Socket.IO)
    if (isNewUser) {
        const notificationMessage = `یک کاربر جدید پیوست: ${userFullName} (ID: ${id})`;
        // فرستادن پیام به تمام کلاینت‌های متصل به socket.io
        io.emit('new_user_joined', { 
            message: notificationMessage, 
            fullName: userFullName, 
            userId: id,
            timestamp: new Date().toISOString()
        });
        console.log(`Socket.IO: Emitted 'new_user_joined' for ${userFullName}`);
    }
});

// 5. راه‌اندازی سرور
async function startServer() {
    await initializeDatabase(); // اول دیتابیس را آماده می‌کنیم
    await setBotWebhook(); // سپس webhook را تنظیم می‌کنیم
    server.listen(PORT, HOST, () => {
        console.log(`Server running on http://${HOST}:${PORT}`);
    });
}

startServer();

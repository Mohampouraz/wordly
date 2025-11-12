require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const TelegramBot = require('node-telegram-bot-api');
const { Client } = require('pg');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: ["https://wordlybot.xo.je", "http://localhost:3000"],
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;

// Database configuration
const dbConfig = {
    connectionString: process.env.DATABASE_URL || 'postgresql://abolfazl:gecrw6BsIFRJfASXUuG3NTepMnv1Hqpx@dpg-d3qbq8d6ubrc73fqfim0-a.frankfurt-postgres.render.com/wordlygame',
    ssl: {
        rejectUnauthorized: false
    }
};

const dbClient = new Client(dbConfig);

// Telegram Bot
const BOT_TOKEN = process.env.BOT_TOKEN || "8217028556:AAFDNQfmRYuUnto4gb2dAUNyWjKanRZldfA";
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Store connected users (in production, use Redis instead)
const connectedUsers = new Map();

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Serve the frontend
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// API Routes
app.get('/api/users', async (req, res) => {
    try {
        const result = await dbClient.query('SELECT * FROM users ORDER BY created_at DESC LIMIT 10');
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/stats', async (req, res) => {
    try {
        const totalUsers = await dbClient.query('SELECT COUNT(*) FROM users');
        const activeToday = await dbClient.query(`
            SELECT COUNT(*) FROM users 
            WHERE last_active >= CURRENT_DATE
        `);
        
        res.json({
            totalUsers: parseInt(totalUsers.rows[0].count),
            activeToday: parseInt(activeToday.rows[0].count)
        });
    } catch (error) {
        console.error('Error fetching stats:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Initialize database tables
async function initDatabase() {
    try {
        await dbClient.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                telegram_id BIGINT UNIQUE NOT NULL,
                username VARCHAR(255),
                first_name VARCHAR(255),
                last_name VARCHAR(255),
                language_code VARCHAR(10),
                is_bot BOOLEAN DEFAULT false,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        await dbClient.query(`
            CREATE TABLE IF NOT EXISTS user_sessions (
                id SERIAL PRIMARY KEY,
                telegram_id BIGINT NOT NULL,
                socket_id VARCHAR(255),
                connected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                disconnected_at TIMESTAMP,
                FOREIGN KEY (telegram_id) REFERENCES users(telegram_id)
            )
        `);
        
        console.log('✅ Database tables initialized');
    } catch (error) {
        console.error('❌ Error initializing database:', error);
    }
}

// Socket.io connection handling
io.on('connection', (socket) => {
    console.log('🔗 New client connected:', socket.id);

    socket.on('user_connected', (userData) => {
        const { telegramId, username, firstName, lastName } = userData;
        
        // Store user connection
        connectedUsers.set(socket.id, {
            telegramId,
            username,
            socketId: socket.id,
            connectedAt: new Date()
        });

        console.log(`👤 User connected: ${username} (${telegramId})`);

        // Broadcast to all other users
        socket.broadcast.emit('user_joined', {
            username: username || firstName || 'کاربر جدید',
            telegramId,
            timestamp: new Date()
        });

        // Send current connected users count
        io.emit('users_online', {
            count: connectedUsers.size,
            users: Array.from(connectedUsers.values()).map(u => ({
                username: u.username,
                telegramId: u.telegramId
            }))
        });
    });

    socket.on('disconnect', () => {
        const user = connectedUsers.get(socket.id);
        if (user) {
            console.log(`👤 User disconnected: ${user.username} (${user.telegramId})`);
            connectedUsers.delete(socket.id);
            
            // Update users online count
            io.emit('users_online', {
                count: connectedUsers.size,
                users: Array.from(connectedUsers.values()).map(u => ({
                    username: u.username,
                    telegramId: u.telegramId
                }))
            });
        }
        console.log('🔌 Client disconnected:', socket.id);
    });

    // Handle custom events from frontend
    socket.on('send_message', (data) => {
        console.log('📨 Message received:', data);
        // Broadcast message to all users
        io.emit('new_message', {
            from: data.from,
            message: data.message,
            timestamp: new Date()
        });
    });
});

// Telegram Bot Handlers
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const user = msg.from;
    
    console.log(`🚀 New user started bot: ${user.username || user.first_name} (${user.id})`);

    try {
        // Save/update user in database
        await dbClient.query(`
            INSERT INTO users (telegram_id, username, first_name, last_name, language_code, is_bot, last_active)
            VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
            ON CONFLICT (telegram_id) 
            DO UPDATE SET 
                username = EXCLUDED.username,
                first_name = EXCLUDED.first_name,
                last_name = EXCLUDED.last_name,
                last_active = CURRENT_TIMESTAMP
        `, [user.id, user.username, user.first_name, user.last_name, user.language_code, user.is_bot]);

        // Send welcome message with web app button
        const welcomeMessage = `🌟 به ربات Wordly خوش آمدید ${user.first_name}!

🆔 آیدی شما: ${user.id}
👤 نام کاربری: @${user.username || 'ندارد'}

برای مشاهده داشبورد و اطلاعات کامل، روی دکمه زیر کلیک کنید:`;

        const keyboard = {
            inline_keyboard: [[
                {
                    text: "📊 بازکردن داشبورد",
                    web_app: { url: "https://wordlybot.xo.je" }
                }
            ]]
        };

        await bot.sendMessage(chatId, welcomeMessage, {
            reply_markup: keyboard,
            parse_mode: 'HTML'
        });

        // Broadcast new user to all connected frontend clients
        io.emit('user_joined', {
            username: user.username || user.first_name,
            telegramId: user.id,
            timestamp: new Date(),
            message: `کاربر جدید @${user.username || user.first_name} به ربات پیوست!`
        });

        console.log(`✅ User ${user.id} processed successfully`);

    } catch (error) {
        console.error('❌ Error processing /start command:', error);
        bot.sendMessage(chatId, '⚠️ خطایی رخ داده است. لطفا دوباره تلاش کنید.');
    }
});

bot.onText(/\/stats/, async (msg) => {
    const chatId = msg.chat.id;
    
    try {
        const totalUsers = await dbClient.query('SELECT COUNT(*) FROM users');
        const activeToday = await dbClient.query(`
            SELECT COUNT(*) FROM users 
            WHERE last_active >= CURRENT_DATE
        `);
        
        const statsMessage = `📊 آمار ربات:

👥 کل کاربران: ${totalUsers.rows[0].count}
🟢 کاربران فعال امروز: ${activeToday.rows[0].count}
🔗 کاربران آنلاین: ${connectedUsers.size}`;

        await bot.sendMessage(chatId, statsMessage);

    } catch (error) {
        console.error('Error fetching stats:', error);
        bot.sendMessage(chatId, '⚠️ خطا در دریافت آمار');
    }
});

bot.on('message', async (msg) => {
    // Ignore non-text messages and commands
    if (!msg.text || msg.text.startsWith('/')) return;
    
    const chatId = msg.chat.id;
    const user = msg.from;
    
    // Update last active time
    try {
        await dbClient.query(`
            UPDATE users SET last_active = CURRENT_TIMESTAMP 
            WHERE telegram_id = $1
        `, [user.id]);
    } catch (error) {
        console.error('Error updating last active:', error);
    }
});

// Error handling
bot.on('error', (error) => {
    console.error('❌ Telegram Bot Error:', error);
});

bot.on('polling_error', (error) => {
    console.error('❌ Telegram Polling Error:', error);
});

// Initialize and start server
async function startServer() {
    try {
        // Connect to database
        await dbClient.connect();
        console.log('✅ Connected to PostgreSQL database');
        
        // Initialize database tables
        await initDatabase();
        
        // Start server
        server.listen(PORT, () => {
            console.log(`🚀 Server running on port ${PORT}`);
            console.log(`🌐 Frontend: https://wordlybot.xo.je`);
            console.log(`🤖 Bot Token: ${BOT_TOKEN.substring(0, 10)}...`);
            console.log(`🔗 WebSocket server ready for connections`);
        });
    } catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
}

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('🛑 Shutting down server...');
    await dbClient.end();
    server.close(() => {
        console.log('✅ Server shut down successfully');
        process.exit(0);
    });
});

process.on('SIGTERM', async () => {
    console.log('🛑 Server termination requested...');
    await dbClient.end();
    server.close(() => {
        console.log('✅ Server shut down successfully');
        process.exit(0);
    });
});

// Start the server
startServer();

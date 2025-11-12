require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const TelegramBot = require('node-telegram-bot-api');
const { Pool } = require('pg');
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

// Database configuration with connection pooling
const dbConfig = {
    connectionString: process.env.DATABASE_URL || 'postgresql://abolfazl:gecrw6BsIFRJfASXUuG3NTepMnv1Hqpx@dpg-d3qbq8d6ubrc73fqfim0-a.frankfurt-postgres.render.com/wordlygame',
    ssl: {
        rejectUnauthorized: false
    },
    max: 5, // maximum number of clients in the pool
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    maxUses: 7500,
};

const pool = new Pool(dbConfig);

// Test database connection
async function testConnection() {
    let client;
    try {
        client = await pool.connect();
        console.log('✅ Database connection test successful');
        return true;
    } catch (error) {
        console.error('❌ Database connection test failed:', error.message);
        return false;
    } finally {
        if (client) client.release();
    }
}

// Telegram Bot - Use webhooks instead of polling for better reliability
const BOT_TOKEN = process.env.BOT_TOKEN || "8217028556:AAFDNQfmRYuUnto4gb2dAUNyWjKanRZldfA";
const bot = new TelegramBot(BOT_TOKEN);

// Store connected users (in-memory for now)
const connectedUsers = new Map();

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Health check endpoint
app.get('/health', async (req, res) => {
    const dbStatus = await testConnection();
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        database: dbStatus ? 'connected' : 'disconnected',
        usersOnline: connectedUsers.size
    });
});

// Serve a simple frontend for testing
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Telegram Bot Backend</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 40px; }
                .status { padding: 10px; border-radius: 5px; margin: 10px 0; }
                .connected { background: #d4edda; color: #155724; }
                .disconnected { background: #f8d7da; color: #721c24; }
            </style>
        </head>
        <body>
            <h1>🤖 Telegram Bot Backend</h1>
            <div id="status">Checking status...</div>
            <script>
                fetch('/health')
                    .then(r => r.json())
                    .then(data => {
                        document.getElementById('status').innerHTML = \`
                            <div class="status \${data.database === 'connected' ? 'connected' : 'disconnected'}">
                                <strong>Database:</strong> \${data.database}
                            </div>
                            <div class="status connected">
                                <strong>Users Online:</strong> \${data.usersOnline}
                            </div>
                            <div class="status connected">
                                <strong>Last Check:</strong> \${new Date(data.timestamp).toLocaleString()}
                            </div>
                        \`;
                    })
                    .catch(err => {
                        document.getElementById('status').innerHTML = \`
                            <div class="status disconnected">
                                <strong>Error:</strong> \${err.message}
                            </div>
                        \`;
                    });
            </script>
        </body>
        </html>
    `);
});

// API Routes with error handling
app.get('/api/users', async (req, res) => {
    let client;
    try {
        client = await pool.connect();
        const result = await client.query('SELECT * FROM users ORDER BY created_at DESC LIMIT 10');
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        if (client) client.release();
    }
});

app.get('/api/stats', async (req, res) => {
    let client;
    try {
        client = await pool.connect();
        const totalUsers = await client.query('SELECT COUNT(*) FROM users');
        const activeToday = await client.query(`
            SELECT COUNT(*) FROM users 
            WHERE last_active >= CURRENT_DATE
        `);
        
        res.json({
            totalUsers: parseInt(totalUsers.rows[0].count),
            activeToday: parseInt(activeToday.rows[0].count),
            onlineNow: connectedUsers.size
        });
    } catch (error) {
        console.error('Error fetching stats:', error);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        if (client) client.release();
    }
});

// Initialize database tables with retry logic
async function initDatabase() {
    let client;
    let retries = 3;
    
    while (retries > 0) {
        try {
            client = await pool.connect();
            
            await client.query(`
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
            
            await client.query(`
                CREATE TABLE IF NOT EXISTS user_sessions (
                    id SERIAL PRIMARY KEY,
                    telegram_id BIGINT NOT NULL,
                    socket_id VARCHAR(255),
                    connected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    disconnected_at TIMESTAMP
                )
            `);
            
            console.log('✅ Database tables initialized successfully');
            break;
            
        } catch (error) {
            retries--;
            console.error(`❌ Error initializing database (${retries} retries left):`, error.message);
            
            if (retries === 0) {
                console.error('❌ Failed to initialize database after retries');
                // Don't throw error, continue without database
            } else {
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        } finally {
            if (client) client.release();
        }
    }
}

// Socket.io connection handling
io.on('connection', (socket) => {
    console.log('🔗 New client connected:', socket.id);

    socket.on('user_connected', (userData) => {
        const { telegramId, username, firstName, lastName } = userData;
        
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

        io.emit('users_online', {
            count: connectedUsers.size
        });
    });

    socket.on('disconnect', () => {
        const user = connectedUsers.get(socket.id);
        if (user) {
            console.log(`👤 User disconnected: ${user.username} (${user.telegramId})`);
            connectedUsers.delete(socket.id);
            
            io.emit('users_online', {
                count: connectedUsers.size
            });
        }
        console.log('🔌 Client disconnected:', socket.id);
    });
});

// Telegram Bot Handlers with database retry
async function handleStartCommand(msg) {
    const chatId = msg.chat.id;
    const user = msg.from;
    
    console.log(`🚀 New user started bot: ${user.username || user.first_name} (${user.id})`);

    let client;
    try {
        client = await pool.connect();
        
        // Save/update user in database
        await client.query(`
            INSERT INTO users (telegram_id, username, first_name, last_name, language_code, is_bot, last_active)
            VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
            ON CONFLICT (telegram_id) 
            DO UPDATE SET 
                username = EXCLUDED.username,
                first_name = EXCLUDED.first_name,
                last_name = EXCLUDED.last_name,
                last_active = CURRENT_TIMESTAMP
        `, [user.id, user.username, user.first_name, user.last_name, user.language_code, user.is_bot]);

        // Send welcome message
        const welcomeMessage = `🌟 به ربات Wordly خوش آمدید ${user.first_name}!

🆔 آیدی شما: ${user.id}
👤 نام کاربری: @${user.username || 'ندارد'}

برای مشاهده داشبورد، به لینک زیر مراجعه کنید:
https://wordlybot.xo.je`;

        await bot.sendMessage(chatId, welcomeMessage);

        // Broadcast new user to all connected frontend clients
        io.emit('user_joined', {
            username: user.username || user.first_name,
            telegramId: user.id,
            timestamp: new Date(),
            message: `کاربر جدید ${user.first_name} به ربات پیوست!`
        });

        console.log(`✅ User ${user.id} processed successfully`);

    } catch (error) {
        console.error('❌ Error processing /start command:', error);
        
        // Send message even if database fails
        const fallbackMessage = `🌟 به ربات Wordly خوش آمدید ${user.first_name}!

🆔 آیدی شما: ${user.id}
👤 نام کاربری: @${user.username || 'ندارد'}

برای مشاهده داشبورد:
https://wordlybot.xo.je`;
        
        await bot.sendMessage(chatId, fallbackMessage);
    } finally {
        if (client) client.release();
    }
}

// Use webhook instead of polling for better reliability on Render
app.post('/webhook', express.json(), (req, res) => {
    const update = req.body;
    bot.processUpdate(update);
    res.sendStatus(200);
});

// Set webhook (you'll need to configure this in Render)
async function setWebhook() {
    try {
        const webhookUrl = `https://your-app-name.onrender.com/webhook`;
        await bot.setWebHook(webhookUrl);
        console.log('✅ Webhook set successfully:', webhookUrl);
    } catch (error) {
        console.error('❌ Error setting webhook:', error);
    }
}

// For now, use polling but with error handling
bot.onText(/\/start/, handleStartCommand);

bot.onText(/\/stats/, async (msg) => {
    const chatId = msg.chat.id;
    let client;
    
    try {
        client = await pool.connect();
        const totalUsers = await client.query('SELECT COUNT(*) FROM users');
        const activeToday = await client.query(`
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
        await bot.sendMessage(chatId, `📊 آمار فعلی:\n\n🔗 کاربران آنلاین: ${connectedUsers.size}\n\n⚠️ اطلاعات کامل در دسترس نیست`);
    } finally {
        if (client) client.release();
    }
});

// Error handling
bot.on('error', (error) => {
    console.error('❌ Telegram Bot Error:', error);
});

bot.on('polling_error', (error) => {
    console.error('❌ Telegram Polling Error:', error.code);
});

// Initialize and start server with retry logic
async function startServer() {
    console.log('🚀 Starting server...');
    
    // Test database connection but don't block startup
    testConnection().then(success => {
        if (success) {
            initDatabase();
        }
    });

    // Start server even if database fails
    server.listen(PORT, () => {
        console.log(`✅ Server running on port ${PORT}`);
        console.log(`🌐 Health check: https://your-app-name.onrender.com/health`);
        console.log(`🤖 Bot is listening for commands...`);
    });
}

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('🛑 Shutting down server gracefully...');
    await pool.end();
    server.close(() => {
        console.log('✅ Server shut down successfully');
        process.exit(0);
    });
});

process.on('SIGTERM', async () => {
    console.log('🛑 Server termination requested...');
    await pool.end();
    server.close(() => {
        console.log('✅ Server shut down successfully');
        process.exit(0);
    });
});

// Start the server
startServer().catch(error => {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
});

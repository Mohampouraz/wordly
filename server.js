require('dotenv').config();
const express = require('express');
const { Telegraf } = require('telegraf');
const { Pool } = require('pg');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "https://wordlybot.xo.je",
    methods: ["GET", "POST"]
  }
});

// Configuration
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || "8217028556:AAFDNQfmRYuUnto4gb2dAUNyWjKanRZldfA";
const WEB_APP_URL = process.env.WEB_APP_URL || "https://wordlybot.xo.je";
const DATABASE_URL = process.env.DATABASE_URL || "postgresql://abolfazl:ZnczfHE6NUZWmPfYtPQjUdsuaseuFoHS@dpg-d3q9nrm3jp1c738f47pg-a.frankfurt-postgres.render.com/wordgame_lbh3";
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Database connection
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Initialize Telegram Bot
const bot = new Telegraf(TELEGRAM_TOKEN);

// In-memory storage for real-time data
const activeLobby = new Map();
const userSockets = new Map();

// Initialize database tables
async function initializeDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        telegram_id BIGINT UNIQUE NOT NULL,
        full_name VARCHAR(255) NOT NULL,
        username VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE TABLE IF NOT EXISTS lobby_sessions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        left_at TIMESTAMP,
        is_active BOOLEAN DEFAULT true
      );
      
      CREATE TABLE IF NOT EXISTS game_sessions (
        id SERIAL PRIMARY KEY,
        word VARCHAR(50) NOT NULL,
        max_players INTEGER DEFAULT 4,
        status VARCHAR(20) DEFAULT 'waiting',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        started_at TIMESTAMP,
        ended_at TIMESTAMP
      );
      
      CREATE TABLE IF NOT EXISTS game_players (
        id SERIAL PRIMARY KEY,
        game_id INTEGER REFERENCES game_sessions(id),
        user_id INTEGER REFERENCES users(id),
        score INTEGER DEFAULT 0,
        joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Database tables initialized');
  } catch (error) {
    console.error('❌ Database initialization error:', error);
  }
}

// Telegram Bot Commands
bot.start(async (ctx) => {
  await handleUserJoin(ctx);
});

bot.command('lobby', async (ctx) => {
  await showLobbyStatus(ctx);
});

bot.command('leave', async (ctx) => {
  await handleUserLeave(ctx);
});

// Handle user joining the lobby
async function handleUserJoin(ctx) {
  const user = ctx.from;
  
  try {
    // Save/update user in database
    const userResult = await pool.query(
      `INSERT INTO users (telegram_id, full_name, username) 
       VALUES ($1, $2, $3) 
       ON CONFLICT (telegram_id) 
       DO UPDATE SET full_name = $2, username = $3
       RETURNING id`,
      [user.id, `${user.first_name} ${user.last_name || ''}`.trim(), user.username]
    );

    const userId = userResult.rows[0].id;

    // Add to lobby session
    await pool.query(
      'INSERT INTO lobby_sessions (user_id) VALUES ($1)',
      [userId]
    );

    // Update in-memory lobby
    const userInfo = {
      id: user.id,
      userId: userId,
      full_name: `${user.first_name} ${user.last_name || ''}`.trim(),
      username: user.username,
      joined_at: new Date()
    };
    
    activeLobby.set(user.id, userInfo);

    // Send welcome message
    await sendWelcomeMessage(ctx, userInfo);

    // Notify all users about lobby update
    await notifyLobbyUpdate(userInfo, 'join');

    // Broadcast to Socket.IO clients
    io.emit('lobby_update', {
      type: 'user_joined',
      user: userInfo,
      lobby: Array.from(activeLobby.values())
    });

  } catch (error) {
    console.error('Error in handleUserJoin:', error);
    await ctx.reply('❌ متأسفانه خطایی رخ داده است. لطفاً مجدداً تلاش کنید.');
  }
}

// Send welcome message with lobby info
async function sendWelcomeMessage(ctx, user) {
  const lobbyList = getLobbyUsersList();
  
  const welcomeMessage = `🎮 **به بازی حدس کلمه خوش آمدید!** 🎮

👤 **شما:** ${user.full_name}

👥 **بازیکنان حاضر در لابی:**
${lobbyList}

🎯 **برای شروع بازی روی دکمه زیر کلیک کنید:**`;

  await ctx.reply(welcomeMessage, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '🚀 شروع بازی', web_app: { url: `${WEB_APP_URL}?user_id=${user.id}` } }],
        [{ text: '🔄 بروزرسانی لابی', callback_data: 'refresh_lobby' }],
        [{ text: '🚪 خروج از لابی', callback_data: 'leave_lobby' }]
      ]
    }
  });
}

// Show lobby status
async function showLobbyStatus(ctx) {
  const lobbyList = getLobbyUsersList();
  
  await ctx.reply(`👥 **وضعیت لابی:**\n\n${lobbyList}`, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '🔄 بروزرسانی', callback_data: 'refresh_lobby' }],
        [{ text: '🚀 شروع بازی', web_app: { url: WEB_APP_URL } }],
        [{ text: '🚪 خروج از لابی', callback_data: 'leave_lobby' }]
      ]
    }
  });
}

// Handle user leaving
async function handleUserLeave(ctx) {
  const user = ctx.from;
  await removeUserFromLobby(user, ctx);
}

// Remove user from lobby
async function removeUserFromLobby(user, ctx = null) {
  const userInfo = activeLobby.get(user.id);
  
  if (userInfo) {
    activeLobby.delete(user.id);
    
    // Update database
    try {
      await pool.query(
        'UPDATE lobby_sessions SET left_at = CURRENT_TIMESTAMP, is_active = false WHERE user_id = $1 AND is_active = true',
        [userInfo.userId]
      );
    } catch (error) {
      console.error('Error updating leave status:', error);
    }
    
    // Notify other users
    await notifyLobbyUpdate(userInfo, 'leave');
    
    // Broadcast to Socket.IO
    io.emit('lobby_update', {
      type: 'user_left',
      user: userInfo,
      lobby: Array.from(activeLobby.values())
    });
    
    if (ctx) {
      await ctx.reply('👋 از لابی خارج شدید. امیدواریم به زودی بازگردید!');
    }
  }
}

// Get formatted lobby users list
function getLobbyUsersList() {
  if (activeLobby.size === 0) {
    return '📭 هنوز بازیکنی در لابی نیست...';
  }

  let list = '';
  let index = 1;
  
  for (const [userId, user] of activeLobby) {
    const timeAgo = Math.floor((new Date() - user.joined_at) / 60000);
    list += `${index}. ${user.full_name}${user.username ? ` (@${user.username})` : ''} - ${timeAgo} دقیقه قبل\n`;
    index++;
  }
  
  return list;
}

// Notify all users about lobby changes
async function notifyLobbyUpdate(changedUser, action) {
  const lobbyList = getLobbyUsersList();
  const actionText = action === 'join' ? 'پیوست' : 'ترک کرد';
  
  for (const [userId, user] of activeLobby) {
    if (userId !== changedUser.id) {
      try {
        await bot.telegram.sendMessage(
          userId,
          `🔔 **${changedUser.full_name} لابی را ${actionText}**\n\n👥 **وضعیت فعلی لابی:**\n${lobbyList}`,
          { parse_mode: 'Markdown' }
        );
      } catch (error) {
        console.error(`Error notifying user ${userId}:`, error);
        // Remove user if notification fails
        activeLobby.delete(userId);
      }
    }
  }
}

// Handle inline keyboard actions
bot.action('refresh_lobby', async (ctx) => {
  await ctx.answerCbQuery();
  await showLobbyStatus(ctx);
});

bot.action('leave_lobby', async (ctx) => {
  await ctx.answerCbQuery();
  await removeUserFromLobby(ctx.from, ctx);
});

// API Routes
app.get('/api/lobby', async (req, res) => {
  try {
    const lobbyUsers = Array.from(activeLobby.values());
    res.json({
      success: true,
      count: lobbyUsers.length,
      users: lobbyUsers
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/user/:telegramId', async (req, res) => {
  try {
    const { telegramId } = req.params;
    const userInfo = activeLobby.get(parseInt(telegramId));
    
    if (userInfo) {
      res.json({ success: true, user: userInfo });
    } else {
      res.status(404).json({ success: false, error: 'User not found in lobby' });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Web App Route
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

// Socket.IO for real-time communication
io.on('connection', (socket) => {
  console.log('🔌 User connected:', socket.id);

  socket.on('join_lobby', (userData) => {
    userSockets.set(userData.telegramId, socket.id);
    socket.join('lobby');
    
    // Send current lobby state to the new user
    socket.emit('lobby_state', {
      users: Array.from(activeLobby.values())
    });
    
    console.log(`👤 User ${userData.full_name} joined via Web App`);
  });

  socket.on('disconnect', () => {
    console.log('🔌 User disconnected:', socket.id);
    // Find and remove user from userSockets
    for (const [telegramId, socketId] of userSockets) {
      if (socketId === socket.id) {
        userSockets.delete(telegramId);
        break;
      }
    }
  });
});

// Cleanup inactive sessions
setInterval(async () => {
  try {
    await pool.query(
      `UPDATE lobby_sessions 
       SET left_at = CURRENT_TIMESTAMP, is_active = false 
       WHERE joined_at < NOW() - INTERVAL '1 hour' AND is_active = true`
    );
    
    // Clean in-memory store
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    for (const [userId, user] of activeLobby) {
      if (user.joined_at < oneHourAgo) {
        await removeUserFromLobby({ id: userId });
      }
    }
  } catch (error) {
    console.error('Error cleaning up sessions:', error);
  }
}, 30 * 60 * 1000);

// Start server
async function startServer() {
  await initializeDatabase();
  
  // Set webhook for production
  if (process.env.NODE_ENV === 'production') {
    const webhookUrl = `https://wordlygame.onrender.com/bot${TELEGRAM_TOKEN}`;
    await bot.telegram.setWebhook(webhookUrl);
    app.use(bot.webhookCallback(`/bot${TELEGRAM_TOKEN}`));
  } else {
    bot.launch();
  }
  
  server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🌐 Web App: ${WEB_APP_URL}`);
    console.log(`🤖 Telegram Bot is active`);
  });
}

// Graceful shutdown
process.once('SIGINT', () => {
  console.log('🛑 Shutting down gracefully...');
  bot.stop('SIGINT');
  process.exit();
});

process.once('SIGTERM', () => {
  console.log('🛑 Shutting down gracefully...');
  bot.stop('SIGTERM');
  process.exit();
});

startServer();

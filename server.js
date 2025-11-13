const express = require('express');
const { Pool } = require('pg');
const TelegramBot = require('node-telegram-bot-api');
const path = require('path');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Configuration
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || "8217028556:AAFDNQfmRYuUnto4gb2dAUNyWjKanRZldfA";
const WEB_APP_URL = process.env.WEB_APP_URL || "https://wordlybot.xo.je";
const DATABASE_URL = process.env.DATABASE_URL || "postgresql://abolfazl:ZnczfHE6NUZWmPfYtPQjUdsuaseuFoHS@dpg-d3q9nrm3jp1c738f47pg-a.frankfurt-postgres.render.com/wordgame_lbh3";

// Initialize Telegram Bot
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

// Database connection
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Initialize database tables
async function initializeDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS players (
        id SERIAL PRIMARY KEY,
        telegram_id BIGINT UNIQUE,
        full_name VARCHAR(255),
        username VARCHAR(255),
        score INTEGER DEFAULT 0,
        games_played INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE TABLE IF NOT EXISTS games (
        id SERIAL PRIMARY KEY,
        code VARCHAR(10) UNIQUE,
        creator_id INTEGER REFERENCES players(id),
        word VARCHAR(50),
        category VARCHAR(100),
        max_players INTEGER DEFAULT 2,
        current_players INTEGER DEFAULT 0,
        status VARCHAR(20) DEFAULT 'waiting',
        mode VARCHAR(20) DEFAULT 'user_created',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE TABLE IF NOT EXISTS game_players (
        id SERIAL PRIMARY KEY,
        game_id INTEGER REFERENCES games(id),
        player_id INTEGER REFERENCES players(id),
        score INTEGER DEFAULT 0,
        guesses TEXT[] DEFAULT '{}',
        correct_letters INTEGER DEFAULT 0,
        incorrect_letters INTEGER DEFAULT 0,
        time_taken INTEGER DEFAULT 0,
        status VARCHAR(20) DEFAULT 'playing'
      );
      
      CREATE TABLE IF NOT EXISTS league_standings (
        id SERIAL PRIMARY KEY,
        player_id INTEGER REFERENCES players(id),
        season INTEGER DEFAULT 1,
        wins INTEGER DEFAULT 0,
        losses INTEGER DEFAULT 0,
        total_score INTEGER DEFAULT 0,
        rank INTEGER DEFAULT 0
      );
    `);
    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Database initialization error:', error);
  }
}

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API Routes
app.get('/api/players', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM players ORDER BY score DESC LIMIT 50');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/games', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT g.*, p.full_name as creator_name 
      FROM games g 
      JOIN players p ON g.creator_id = p.id 
      WHERE g.status = 'waiting'
      ORDER BY g.created_at DESC
    `);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/create-game', async (req, res) => {
  const { playerId, word, category, mode, maxPlayers } = req.body;
  
  try {
    const code = generateGameCode();
    const result = await pool.query(
      'INSERT INTO games (code, creator_id, word, category, mode, max_players) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [code, playerId, word, category, mode, maxPlayers]
    );
    
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Socket.IO for real-time communication
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  
  socket.on('join-lobby', (playerData) => {
    socket.broadcast.emit('player-joined', playerData);
  });
  
  socket.on('join-game', (gameData) => {
    socket.join(gameData.gameId);
    io.to(gameData.gameId).emit('player-joined-game', gameData);
  });
  
  socket.on('make-guess', (guessData) => {
    io.to(guessData.gameId).emit('guess-made', guessData);
  });
  
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

// Telegram Bot Commands
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const button = {
    reply_markup: {
      inline_keyboard: [[
        {
          text: "🎮 Play Wordly Game",
          web_app: { url: WEB_APP_URL }
        }
      ]]
    }
  };
  
  bot.sendMessage(chatId, "Welcome to Wordly Bot! Press the button below to start playing.", button);
});

// Utility functions
function generateGameCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  initializeDatabase();
});

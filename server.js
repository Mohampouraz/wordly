const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { Pool } = require('pg');
const path = require('path');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

// تنظیم CORS برای Socket.IO
const io = socketIo(server, {
  cors: {
    origin: ["https://wordlybot.xo.je", "https://web.telegram.org"],
    methods: ["GET", "POST"],
    credentials: true
  }
});

// تنظیم CORS برای Express
app.use(cors({
  origin: ["https://wordlybot.xo.je", "https://web.telegram.org"],
  credentials: true
}));

// اتصال به پایگاه داده PostgreSQL
const pool = new Pool({
  connectionString: "postgresql://abolfazl:gecrw6BsIFRJfASXUuG3NTepMnv1Hqpx@dpg-d3qbq8d6ubrc73fqfim0-a.frankfurt-postgres.render.com/wordlygame",
  ssl: {
    rejectUnauthorized: false
  }
});

// میدلور برای سرو فایل‌های استاتیک (اگر نیاز باشد)
app.use(express.json());

// ذخیره وضعیت لابی و بازی‌ها در حافظه
const lobbyState = {
  players: [],
  games: []
};

// مسیر سلامت سرور
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'OK', 
    message: 'Wordly Game Server is running',
    players: lobbyState.players.length,
    games: lobbyState.games.length
  });
});

// API برای دریافت وضعیت لابی
app.get('/api/lobby', (req, res) => {
  res.json({
    players: lobbyState.players,
    games: lobbyState.games,
    totalPlayers: lobbyState.players.length,
    totalGames: lobbyState.games.length
  });
});

// WebSocket connection handling
io.on('connection', (socket) => {
  console.log('یک کاربر متصل شد:', socket.id);
  
  // ارسال وضعیت فعلی به کاربر جدید
  socket.emit('lobby-state', {
    players: lobbyState.players,
    games: lobbyState.games
  });

  // هنگامی که کاربر به لابی می‌پیوندد
  socket.on('join-lobby', (userData) => {
    try {
      // بررسی آیا کاربر قبلاً در لابی است
      const existingPlayerIndex = lobbyState.players.findIndex(p => p.id == userData.id);
      
      if (existingPlayerIndex === -1) {
        // افزودن کاربر به لابی
        lobbyState.players.push({
          ...userData,
          socketId: socket.id,
          joinedAt: new Date()
        });
        
        // اطلاع به همه کاربران از ورود بازیکن جدید
        socket.broadcast.emit('player-joined', userData);
      }
      
      // ارسال وضعیت فعلی لابی به کاربر جدید
      socket.emit('players-list', lobbyState.players);
      socket.emit('games-list', lobbyState.games);
      
      // به روزرسانی لیست بازیکنان برای همه
      io.emit('players-list', lobbyState.players);
      
      console.log(`بازیکن ${userData.first_name} به لابی پیوست. تعداد بازیکنان: ${lobbyState.players.length}`);
    } catch (error) {
      console.error('Error in join-lobby:', error);
      socket.emit('error', { message: 'خطا در پیوستن به لابی' });
    }
  });

  // هنگامی که کاربر بازی جدید ایجاد می‌کند
  socket.on('create-game', (data) => {
    try {
      const gameId = generateGameId();
      const newGame = {
        id: gameId,
        creator: data.creator,
        players: [data.creator],
        status: 'waiting',
        createdAt: new Date(),
        maxPlayers: 2
      };
      
      lobbyState.games.push(newGame);
      
      // اطلاع به همه کاربران از ایجاد بازی جدید
      io.emit('game-created', newGame);
      io.emit('games-list', lobbyState.games);
      
      // ارسال موفقیت به سازنده بازی
      socket.emit('game-creation-success', { gameId });
      
      console.log(`بازی جدید با ID ${gameId} توسط ${data.creator.first_name} ایجاد شد`);
    } catch (error) {
      console.error('Error in create-game:', error);
      socket.emit('error', { message: 'خطا در ایجاد بازی' });
    }
  });

  // هنگامی که کاربر می‌خواهد به بازی بپیوندد
  socket.on('join-game', (data) => {
    try {
      const gameIndex = lobbyState.games.findIndex(g => g.id === data.gameId);
      
      if (gameIndex !== -1 && lobbyState.games[gameIndex].status === 'waiting') {
        // بررسی آیا کاربر قبلاً در بازی است
        const isAlreadyInGame = lobbyState.games[gameIndex].players.some(p => p.id == data.player.id);
        
        if (!isAlreadyInGame) {
          // افزودن کاربر به بازی
          lobbyState.games[gameIndex].players.push(data.player);
          
          // اگر بازی کامل شد، وضعیت را تغییر بده
          if (lobbyState.games[gameIndex].players.length >= lobbyState.games[gameIndex].maxPlayers) {
            lobbyState.games[gameIndex].status = 'playing';
            
            // شروع بازی
            io.emit('game-started', {
              gameId: data.gameId,
              players: lobbyState.games[gameIndex].players
            });
          }
          
          // به روزرسانی لیست بازی‌ها برای همه
          io.emit('games-list', lobbyState.games);
          io.emit('player-joined-game', {
            gameId: data.gameId,
            player: data.player
          });
          
          console.log(`بازیکن ${data.player.first_name} به بازی ${data.gameId} پیوست`);
        }
      } else {
        socket.emit('error', { message: 'امکان پیوستن به این بازی وجود ندارد' });
      }
    } catch (error) {
      console.error('Error in join-game:', error);
      socket.emit('error', { message: 'خطا در پیوستن به بازی' });
    }
  });

  // هنگامی که کاربر می‌خواهد سریع به بازی بپیوندد
  socket.on('quick-join', (data) => {
    try {
      // پیدا کردن اولین بازی در انتظار بازیکن
      const waitingGame = lobbyState.games.find(g => g.status === 'waiting' && g.players.length < g.maxPlayers);
      
      if (waitingGame) {
        // پیوستن به بازی موجود
        socket.emit('quick-join-success', { gameId: waitingGame.id });
        socket.emit('join-game', { gameId: waitingGame.id, player: data.player });
      } else {
        // ایجاد بازی جدید اگر بازی در انتظاری وجود ندارد
        socket.emit('quick-join-no-game', { message: 'هیچ بازی در انتظاری یافت نشد. بازی جدیدی ایجاد کنید.' });
      }
    } catch (error) {
      console.error('Error in quick-join:', error);
      socket.emit('error', { message: 'خطا در پیوستن سریع' });
    }
  });

  // هنگامی که کاربر لابی را ترک می‌کند
  socket.on('leave-lobby', (userData) => {
    removePlayerFromLobby(userData, socket.id);
  });

  // هنگامی که اتصال کاربر قطع می‌شود
  socket.on('disconnect', () => {
    const player = lobbyState.players.find(p => p.socketId === socket.id);
    if (player) {
      removePlayerFromLobby(player, socket.id);
    }
    console.log('کاربر قطع شد:', socket.id);
  });
});

// تابع برای حذف بازیکن از لابی
function removePlayerFromLobby(userData, socketId) {
  const playerIndex = lobbyState.players.findIndex(p => p.id == userData.id);
  
  if (playerIndex !== -1) {
    const disconnectedPlayer = lobbyState.players[playerIndex];
    lobbyState.players.splice(playerIndex, 1);
    
    // اطلاع به همه کاربران از خروج بازیکن
    io.emit('player-left', disconnectedPlayer);
    io.emit('players-list', lobbyState.players);
    
    console.log(`بازیکن ${disconnectedPlayer.first_name} لابی را ترک کرد. تعداد بازیکنان: ${lobbyState.players.length}`);
  }
}

// تابع برای تولید ID منحصر به فرد برای بازی
function generateGameId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// شروع سرور
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`سرور در پورت ${PORT} اجرا شد`);
  console.log(`آدرس سرور: https://wordlygame.onrender.com`);
  console.log(`فرانت‌اند: https://wordlybot.xo.je`);
});

module.exports = app;

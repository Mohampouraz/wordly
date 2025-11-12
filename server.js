const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// اتصال به پایگاه داده PostgreSQL
const pool = new Pool({
  connectionString: "postgresql://abolfazl:gecrw6BsIFRJfASXUuG3NTepMnv1Hqpx@dpg-d3qbq8d6ubrc73fqfim0-a.frankfurt-postgres.render.com/wordlygame",
  ssl: {
    rejectUnauthorized: false
  }
});

// میدلور برای سرو فایل‌های استاتیک
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// ذخیره وضعیت لابی و بازی‌ها در حافظه (در حالت production از Redis استفاده کنید)
const lobbyState = {
  players: [],
  games: []
};

// مسیر اصلی برای سرو صفحه لابی
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// WebSocket connection handling
io.on('connection', (socket) => {
  console.log('یک کاربر متصل شد:', socket.id);

  // هنگامی که کاربر به لابی می‌پیوندد
  socket.on('join-lobby', (userData) => {
    // بررسی آیا کاربر قبلاً در لابی است
    const existingPlayerIndex = lobbyState.players.findIndex(p => p.id === userData.id);
    
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
  });

  // هنگامی که کاربر بازی جدید ایجاد می‌کند
  socket.on('create-game', (data) => {
    const gameId = generateGameId();
    const newGame = {
      id: gameId,
      creator: data.creator,
      players: [data.creator],
      status: 'waiting',
      createdAt: new Date()
    };
    
    lobbyState.games.push(newGame);
    
    // اطلاع به همه کاربران از ایجاد بازی جدید
    io.emit('game-created', newGame);
    io.emit('games-list', lobbyState.games);
    
    console.log(`بازی جدید با ID ${gameId} توسط ${data.creator.first_name} ایجاد شد`);
  });

  // هنگامی که کاربر می‌خواهد به بازی بپیوندد
  socket.on('join-game', (data) => {
    const gameIndex = lobbyState.games.findIndex(g => g.id === data.gameId);
    
    if (gameIndex !== -1 && lobbyState.games[gameIndex].status === 'waiting') {
      // افزودن کاربر به بازی
      lobbyState.games[gameIndex].players.push(data.player);
      
      // اگر بازی کامل شد، وضعیت را تغییر بده
      if (lobbyState.games[gameIndex].players.length >= 2) {
        lobbyState.games[gameIndex].status = 'playing';
      }
      
      // به روزرسانی لیست بازی‌ها برای همه
      io.emit('games-list', lobbyState.games);
      
      console.log(`بازیکن ${data.player.first_name} به بازی ${data.gameId} پیوست`);
    }
  });

  // هنگامی که کاربر می‌خواهد سریع به بازی بپیوندد
  socket.on('quick-join', (data) => {
    // پیدا کردن اولین بازی در انتظار بازیکن
    const waitingGame = lobbyState.games.find(g => g.status === 'waiting');
    
    if (waitingGame) {
      // پیوستن به بازی موجود
      socket.emit('join-game', { gameId: waitingGame.id, player: data.player });
    } else {
      // ایجاد بازی جدید اگر بازی در انتظاری وجود ندارد
      socket.emit('create-game', { creator: data.player });
    }
  });

  // هنگامی که کاربر لابی را ترک می‌کند
  socket.on('leave-lobby', (userData) => {
    // حذف کاربر از لابی
    const playerIndex = lobbyState.players.findIndex(p => p.id === userData.id);
    
    if (playerIndex !== -1) {
      lobbyState.players.splice(playerIndex, 1);
      
      // اطلاع به همه کاربران از خروج بازیکن
      socket.broadcast.emit('player-left', userData);
      io.emit('players-list', lobbyState.players);
      
      console.log(`بازیکن ${userData.first_name} لابی را ترک کرد. تعداد بازیکنان: ${lobbyState.players.length}`);
    }
  });

  // هنگامی که اتصال کاربر قطع می‌شود
  socket.on('disconnect', () => {
    // پیدا کردن کاربر بر اساس socket.id و حذف آن
    const playerIndex = lobbyState.players.findIndex(p => p.socketId === socket.id);
    
    if (playerIndex !== -1) {
      const disconnectedPlayer = lobbyState.players[playerIndex];
      lobbyState.players.splice(playerIndex, 1);
      
      // اطلاع به همه کاربران از خروج بازیکن
      socket.broadcast.emit('player-left', disconnectedPlayer);
      io.emit('players-list', lobbyState.players);
      
      console.log(`اتصال بازیکن ${disconnectedPlayer.first_name} قطع شد. تعداد بازیکنان: ${lobbyState.players.length}`);
    }
  });
});

// تابع برای تولید ID منحصر به فرد برای بازی
function generateGameId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// شروع سرور
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`سرور در پورت ${PORT} اجرا شد`);
  console.log(`لابی بازی در آدرس: http://localhost:${PORT} در دسترس است`);
});

module.exports = app;

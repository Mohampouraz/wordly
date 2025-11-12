const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

// تنظیم CORS برای تمام دامنه‌ها
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE"],
  credentials: true
}));

// تنظیم CORS برای Socket.IO
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// middleware برای parse کردن JSON
app.use(express.json());

// اتصال به پایگاه داده PostgreSQL
const pool = new Pool({
  connectionString: "postgresql://abolfazl:gecrw6BsIFRJfASXUuG3NTepMnv1Hqpx@dpg-d3qbq8d6ubrc73fqfim0-a.frankfurt-postgres.render.com/wordlygame",
  ssl: {
    rejectUnauthorized: false
  }
});

// تست اتصال به دیتابیس
pool.connect((err, client, release) => {
  if (err) {
    console.error('Error connecting to database:', err);
  } else {
    console.log('Connected to PostgreSQL database successfully');
    release();
  }
});

// ذخیره وضعیت لابی و بازی‌ها در حافظه (موقت)
const lobbyState = {
  players: [],
  games: [],
  connections: new Map()
};

// ==================== ROUTES ====================

// Route اصلی - سلامت سرور
app.get('/', (req, res) => {
  res.json({
    status: 'success',
    message: 'Wordly Game Server is running!',
    timestamp: new Date().toISOString(),
    endpoints: {
      health: '/health',
      lobby: '/api/lobby',
      players: '/api/players',
      games: '/api/games'
    }
  });
});

// سلامت سرور
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'OK', 
    message: 'Wordly Game Server is running',
    players: lobbyState.players.length,
    games: lobbyState.games.length,
    connections: lobbyState.connections.size,
    timestamp: new Date().toISOString()
  });
});

// دریافت وضعیت لابی
app.get('/api/lobby', (req, res) => {
  res.json({
    status: 'success',
    data: {
      players: lobbyState.players,
      games: lobbyState.games.filter(game => game.status === 'waiting'),
      totalPlayers: lobbyState.players.length,
      totalGames: lobbyState.games.length,
      activeGames: lobbyState.games.filter(game => game.status === 'playing').length
    }
  });
});

// دریافت لیست بازیکنان
app.get('/api/players', (req, res) => {
  res.json({
    status: 'success',
    data: {
      players: lobbyState.players,
      count: lobbyState.players.length
    }
  });
});

// دریافت لیست بازی‌ها
app.get('/api/games', (req, res) => {
  const { status } = req.query;
  let games = lobbyState.games;
  
  if (status) {
    games = games.filter(game => game.status === status);
  }
  
  res.json({
    status: 'success',
    data: {
      games: games,
      count: games.length
    }
  });
});

// ایجاد بازی جدید از طریق API
app.post('/api/games/create', (req, res) => {
  try {
    const { creator } = req.body;
    
    if (!creator || !creator.id) {
      return res.status(400).json({
        status: 'error',
        message: 'اطلاعات سازنده بازی ضروری است'
      });
    }
    
    const gameId = generateGameId();
    const newGame = {
      id: gameId,
      creator: creator,
      players: [creator],
      status: 'waiting',
      createdAt: new Date(),
      maxPlayers: 2
    };
    
    lobbyState.games.push(newGame);
    
    // اطلاع به همه کاربران از طریق WebSocket
    io.emit('game-created', newGame);
    io.emit('games-list', lobbyState.games);
    
    res.json({
      status: 'success',
      message: 'بازی با موفقیت ایجاد شد',
      data: {
        gameId: gameId,
        game: newGame
      }
    });
    
    console.log(`بازی جدید با ID ${gameId} توسط ${creator.first_name} ایجاد شد`);
  } catch (error) {
    console.error('Error creating game via API:', error);
    res.status(500).json({
      status: 'error',
      message: 'خطا در ایجاد بازی'
    });
  }
});

// پیوستن به بازی از طریق API
app.post('/api/games/join', (req, res) => {
  try {
    const { gameId, player } = req.body;
    
    if (!gameId || !player || !player.id) {
      return res.status(400).json({
        status: 'error',
        message: 'شناسه بازی و اطلاعات بازیکن ضروری است'
      });
    }
    
    const gameIndex = lobbyState.games.findIndex(g => g.id === gameId);
    
    if (gameIndex === -1) {
      return res.status(404).json({
        status: 'error',
        message: 'بازی یافت نشد'
      });
    }
    
    const game = lobbyState.games[gameIndex];
    
    if (game.status !== 'waiting') {
      return res.status(400).json({
        status: 'error',
        message: 'این بازی در حال حاضر قابل پیوستن نیست'
      });
    }
    
    // بررسی آیا کاربر قبلاً در بازی است
    const isAlreadyInGame = game.players.some(p => p.id == player.id);
    
    if (isAlreadyInGame) {
      return res.status(400).json({
        status: 'error',
        message: 'شما قبلاً در این بازی هستید'
      });
    }
    
    // افزودن کاربر به بازی
    game.players.push(player);
    
    // اگر بازی کامل شد، وضعیت را تغییر بده
    if (game.players.length >= game.maxPlayers) {
      game.status = 'playing';
      
      // اطلاع شروع بازی
      io.emit('game-started', {
        gameId: gameId,
        players: game.players
      });
    }
    
    // به روزرسانی لیست بازی‌ها برای همه
    io.emit('games-list', lobbyState.games);
    io.emit('player-joined-game', {
      gameId: gameId,
      player: player
    });
    
    res.json({
      status: 'success',
      message: 'با موفقیت به بازی پیوستید',
      data: {
        game: game
      }
    });
    
    console.log(`بازیکن ${player.first_name} به بازی ${gameId} پیوست`);
  } catch (error) {
    console.error('Error joining game via API:', error);
    res.status(500).json({
      status: 'error',
      message: 'خطا در پیوستن به بازی'
    });
  }
});

// ==================== WebSocket HANDLERS ====================

io.on('connection', (socket) => {
  console.log('🔗 کاربر جدید متصل شد:', socket.id);
  lobbyState.connections.set(socket.id, { connectedAt: new Date() });
  
  // ارسال وضعیت فعلی به کاربر جدید
  socket.emit('connected', { 
    message: 'به سرور Wordly متصل شدید',
    socketId: socket.id,
    timestamp: new Date().toISOString()
  });
  
  socket.emit('lobby-state', {
    players: lobbyState.players,
    games: lobbyState.games
  });

  // هنگامی که کاربر به لابی می‌پیوندد
  socket.on('join-lobby', (userData) => {
    try {
      console.log('درخواست پیوستن به لابی:', userData);
      
      if (!userData || !userData.id) {
        socket.emit('error', { message: 'اطلاعات کاربر نامعتبر است' });
        return;
      }
      
      // بررسی آیا کاربر قبلاً در لابی است
      const existingPlayerIndex = lobbyState.players.findIndex(p => p.id == userData.id);
      
      if (existingPlayerIndex === -1) {
        // افزودن کاربر به لابی
        const playerData = {
          ...userData,
          socketId: socket.id,
          joinedAt: new Date(),
          lastActive: new Date()
        };
        
        lobbyState.players.push(playerData);
        
        // اطلاع به همه کاربران از ورود بازیکن جدید
        socket.broadcast.emit('player-joined', userData);
        
        console.log(`✅ بازیکن ${userData.first_name} به لابی پیوست. تعداد بازیکنان: ${lobbyState.players.length}`);
      } else {
        // به‌روزرسانی اطلاعات کاربر موجود
        lobbyState.players[existingPlayerIndex].socketId = socket.id;
        lobbyState.players[existingPlayerIndex].lastActive = new Date();
      }
      
      // ارسال وضعیت فعلی لابی به کاربر جدید
      socket.emit('players-list', lobbyState.players);
      socket.emit('games-list', lobbyState.games);
      
      // به روزرسانی لیست بازیکنان برای همه
      io.emit('players-list', lobbyState.players);
      
    } catch (error) {
      console.error('❌ خطا در join-lobby:', error);
      socket.emit('error', { message: 'خطا در پیوستن به لابی' });
    }
  });

  // ایجاد بازی جدید
  socket.on('create-game', (data) => {
    try {
      const { creator } = data;
      
      if (!creator || !creator.id) {
        socket.emit('error', { message: 'اطلاعات سازنده بازی ضروری است' });
        return;
      }
      
      const gameId = generateGameId();
      const newGame = {
        id: gameId,
        creator: creator,
        players: [creator],
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
      
      console.log(`🎮 بازی جدید با ID ${gameId} توسط ${creator.first_name} ایجاد شد`);
    } catch (error) {
      console.error('❌ خطا در create-game:', error);
      socket.emit('error', { message: 'خطا در ایجاد بازی' });
    }
  });

  // پیوستن به بازی
  socket.on('join-game', (data) => {
    try {
      const { gameId, player } = data;
      
      const gameIndex = lobbyState.games.findIndex(g => g.id === gameId);
      
      if (gameIndex !== -1 && lobbyState.games[gameIndex].status === 'waiting') {
        // بررسی آیا کاربر قبلاً در بازی است
        const isAlreadyInGame = lobbyState.games[gameIndex].players.some(p => p.id == player.id);
        
        if (!isAlreadyInGame) {
          // افزودن کاربر به بازی
          lobbyState.games[gameIndex].players.push(player);
          
          // اگر بازی کامل شد، وضعیت را تغییر بده
          if (lobbyState.games[gameIndex].players.length >= lobbyState.games[gameIndex].maxPlayers) {
            lobbyState.games[gameIndex].status = 'playing';
            
            // شروع بازی
            io.emit('game-started', {
              gameId: gameId,
              players: lobbyState.games[gameIndex].players
            });
          }
          
          // به روزرسانی لیست بازی‌ها برای همه
          io.emit('games-list', lobbyState.games);
          io.emit('player-joined-game', {
            gameId: gameId,
            player: player
          });
          
          console.log(`✅ بازیکن ${player.first_name} به بازی ${gameId} پیوست`);
        }
      } else {
        socket.emit('error', { message: 'امکان پیوستن به این بازی وجود ندارد' });
      }
    } catch (error) {
      console.error('❌ خطا در join-game:', error);
      socket.emit('error', { message: 'خطا در پیوستن به بازی' });
    }
  });

  // پیوستن سریع
  socket.on('quick-join', (data) => {
    try {
      const { player } = data;
      
      // پیدا کردن اولین بازی در انتظار بازیکن
      const waitingGame = lobbyState.games.find(g => 
        g.status === 'waiting' && g.players.length < g.maxPlayers
      );
      
      if (waitingGame) {
        // پیوستن به بازی موجود
        socket.emit('quick-join-success', { gameId: waitingGame.id });
        
        // افزودن کاربر به بازی
        if (!waitingGame.players.some(p => p.id == player.id)) {
          waitingGame.players.push(player);
          
          if (waitingGame.players.length >= waitingGame.maxPlayers) {
            waitingGame.status = 'playing';
            io.emit('game-started', {
              gameId: waitingGame.id,
              players: waitingGame.players
            });
          }
          
          io.emit('games-list', lobbyState.games);
          io.emit('player-joined-game', {
            gameId: waitingGame.id,
            player: player
          });
        }
      } else {
        socket.emit('quick-join-no-game', { 
          message: 'هیچ بازی در انتظاری یافت نشد. لطفاً بازی جدیدی ایجاد کنید.' 
        });
      }
    } catch (error) {
      console.error('❌ خطا در quick-join:', error);
      socket.emit('error', { message: 'خطا در پیوستن سریع' });
    }
  });

  // ترک لابی
  socket.on('leave-lobby', (userData) => {
    removePlayerFromLobby(userData, socket.id);
  });

  // پینگ برای نگه داشتن اتصال
  socket.on('ping', (data) => {
    socket.emit('pong', { ...data, timestamp: new Date().toISOString() });
  });

  // هنگامی که اتصال کاربر قطع می‌شود
  socket.on('disconnect', (reason) => {
    console.log(`🔌 کاربر قطع شد: ${socket.id} - دلیل: ${reason}`);
    
    // پیدا کردن کاربر بر اساس socket.id و حذف آن
    const playerIndex = lobbyState.players.findIndex(p => p.socketId === socket.id);
    if (playerIndex !== -1) {
      const disconnectedPlayer = lobbyState.players[playerIndex];
      lobbyState.players.splice(playerIndex, 1);
      
      // اطلاع به همه کاربران از خروج بازیکن
      io.emit('player-left', disconnectedPlayer);
      io.emit('players-list', lobbyState.players);
      
      console.log(`👋 بازیکن ${disconnectedPlayer.first_name} لابی را ترک کرد. تعداد بازیکنان: ${lobbyState.players.length}`);
    }
    
    lobbyState.connections.delete(socket.id);
  });
});

// ==================== HELPER FUNCTIONS ====================

function removePlayerFromLobby(userData, socketId) {
  const playerIndex = lobbyState.players.findIndex(p => p.id == userData.id);
  
  if (playerIndex !== -1) {
    const disconnectedPlayer = lobbyState.players[playerIndex];
    lobbyState.players.splice(playerIndex, 1);
    
    // اطلاع به همه کاربران از خروج بازیکن
    io.emit('player-left', disconnectedPlayer);
    io.emit('players-list', lobbyState.players);
    
    console.log(`👋 بازیکن ${disconnectedPlayer.first_name} لابی را ترک کرد. تعداد بازیکنان: ${lobbyState.players.length}`);
  }
}

function generateGameId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// تمیز کردن بازی‌های قدیمی هر 5 دقیقه
setInterval(() => {
  const now = new Date();
  const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
  
  // حذف بازی‌های تمام شده قدیمی
  const initialLength = lobbyState.games.length;
  lobbyState.games = lobbyState.games.filter(game => {
    return game.status === 'playing' || new Date(game.createdAt) > fiveMinutesAgo;
  });
  
  if (lobbyState.games.length !== initialLength) {
    console.log(`🧹 بازی‌های قدیمی تمیز شدند. از ${initialLength} به ${lobbyState.games.length}`);
    io.emit('games-list', lobbyState.games);
  }
}, 5 * 60 * 1000);

// ==================== START SERVER ====================

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 سرور Wordly Game در پورت ${PORT} اجرا شد`);
  console.log(`📍 آدرس سرور: https://wordlygame.onrender.com`);
  console.log(`🌐 فرانت‌اند: https://wordlybot.xo.je`);
  console.log(`✅ سلامت سرور: https://wordlygame.onrender.com/health`);
  console.log(`🎮 وضعیت لابی: https://wordlygame.onrender.com/api/lobby`);
});

module.exports = app;

// server.js
require('dotenv').config();

const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const crypto = require('crypto');
const PORT = process.env.PORT || 3000;

// FIX: Ensure wordsData is imported
const wordsData = require('./words'); 

/* ----------------------------------------------------------------
   DB CONNECTION
---------------------------------------------------------------- */
const buildConnectionString = () => {
  let cs = process.env.DATABASE_URL;
  if (cs && !/sslmode=/i.test(cs)) cs += (cs.includes('?') ? '&' : '?') + 'sslmode=require';
  if (cs) return cs;
  const host = process.env.PGHOST, port = process.env.PGPORT || 5432, user = process.env.PGUSER, pass = process.env.PGPASSWORD, db = process.env.PGDATABASE;
  if (host && user && pass && db) return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:${port}/${db}?sslmode=require`;
  return null;
};

const connectionString = buildConnectionString();
const pool = new Pool({ connectionString, ssl: connectionString ? { rejectUnauthorized: false } : undefined });

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', methods: ['GET','POST'] } });

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));


/* ----------------------------------------------------------------
   HELPERS
---------------------------------------------------------------- */
const normalizeFaLetter = ch => {
  if (!ch) return '';
  const map = { '\u064A':'\u06CC', '\u0643':'\u06A9' };
  return (map[ch] || ch).normalize('NFC');
};
const normalizeFaWordKeepSpaces = word => {
  if (!word) return '';
  const removeMarks = /[\u0640\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g;
  let w = String(word).replace(removeMarks, '');
  w = w.replace(/\u064A/g, '\u06CC').replace(/\u0643/g, '\u06A9');
  return w.normalize('NFC');
};

// حذف تمام فاصله‌ها برای محاسبه طول دقیق و شرط برد
const normalizeFaWordStrict = word => {
  let w = normalizeFaWordKeepSpaces(word);
  return w.replace(/[\s\u200c\u200d\u200b\u00a0]/g, '');
};

const floor = Math.floor;
const ceil = Math.ceil;
const newGameDeckForRoom = (roomId, level = 'medium') => {
  const all = [];
  for (const cat of wordsData.categories) {
    for (const w of cat.words.filter(x => (level ? x.level === level : true))) {
      all.push({ word: normalizeFaWordKeepSpaces(String(w.text)), category: cat.name, level: w.level });
    }
  }
  if (!all.length) return [];
  
  let seed = 0;
  for (let i = 0; i < roomId.length; i++) seed = (seed * 31 + roomId.charCodeAt(i)) >>> 0;
  const a = all.slice();
  for (let i = a.length - 1; i > 0; i--) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const j = seed % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, Math.min(10, a.length)); // استفاده از ۱۰ کلمه برای هر بازی
};

/* ----------------------------------------------------------------
   CORE GAME/ROOM STATE FUNCTIONS
---------------------------------------------------------------- */
const getGameState = async (gameId, userId) => {
    const q = await pool.query(`
        SELECT 
            gs.*, 
            g.deck, 
            r.reveal_mode 
        FROM game_states gs
        JOIN games g ON gs.game_id = g.id
        JOIN rooms r ON g.room_id = r.id
        WHERE gs.game_id = $1 AND gs.user_id = $2;
    `, [gameId, userId]);
    if (!q.rows.length) return null;
    
    const state = q.rows[0];
    // Check if the deck has been initialized for this game (should always be true)
    if (!state.deck || state.current_index >= state.deck.length) return null; 

    const currentWord = state.deck[state.current_index];
    const wordStrict = normalizeFaWordStrict(currentWord.word);
    
    // اگر حالت خصوصی (private) باشد و حدس‌ها ناکام باشد، کلمه فاش می‌شود.
    if (state.reveal_mode === 'private' && state.wrong_letters.length >= state.allowed_wrong) {
        // فاش کردن کلمه با اضافه کردن تمام حروف صحیح
        const uniqueRequired = new Set(wordStrict.split('').filter(c => c && c.trim() !== ''));
        state.correct_letters = Array.from(uniqueRequired);
    }

    return {
        game_id: gameId,
        current_index: state.current_index,
        deck: state.deck,
        correct_letters: state.correct_letters,
        wrong_letters: state.wrong_letters,
        hints_used: state.hints_used,
        hints_allowed: state.hints_allowed,
        score: state.score,
        guessed_count: state.guessed_count,
        allowed_wrong: state.allowed_wrong,
        timer_ms: Number(state.timer_ms), // PG BigInt to JS Number
        reveal_mode: state.reveal_mode
    };
};

// Function to get the complete room state including full user data
const getRoomState = async (roomId) => {
    const r = await pool.query(`
        SELECT r.id, r.name, r.level, r.status, r.max_players, r.created_by, r.reveal_mode, g.id AS game_id
        FROM rooms r
        LEFT JOIN games g ON r.id = g.room_id AND r.status = 'in_game'
        WHERE r.id=$1 LIMIT 1;
    `, [roomId]);
    if (!r.rows.length) return null;
    const room = r.rows[0];
    const gameId = room.game_id;

    // Fetch players and their current game state (score, guessed_count) along with full user details
    const playersQuery = await pool.query(`
        SELECT 
            rp.user_id, rp.role, u.username, u.first_name, u.last_name, u.photo_url,
            gs.score, gs.guessed_count
        FROM room_players rp
        JOIN users u ON rp.user_id = u.id
        LEFT JOIN game_states gs ON rp.user_id = gs.user_id AND gs.game_id = $1
        WHERE rp.room_id = $2
        ORDER BY gs.score DESC NULLS LAST;
    `, [gameId, roomId]);
    
    const players = playersQuery.rows.map(p => ({
        user_id: p.user_id,
        role: p.role,
        score: p.score || 0,
        guessed_count: p.guessed_count || 0,
        user: { // Full user object for client-side rendering (getUserDisplayName)
            id: p.user_id,
            username: p.username,
            first_name: p.first_name,
            last_name: p.last_name,
            photo_url: p.photo_url
        }
    }));
    
    room.players = players;
    return room;
};

// Function to broadcast room state and send specific game state to each player
const sendRoomState = async (roomId) => {
    const room = await getRoomState(roomId);
    if (!room) return;
    
    // 1. Broadcast general room state to all in the room
    io.to(roomId).emit('room:state', { room: room, room_id: roomId, rooms: await getActiveRoomsList(room.level) });
    
    // 2. Send individual game state if a game is active
    if (room.status === 'in_game' && room.game_id) {
        // Get all connected sockets for this room
        const socketsInRoom = io.sockets.adapter.rooms.get(roomId) || new Set();
        
        for (const socketId of Array.from(socketsInRoom)) {
            const socket = io.sockets.sockets.get(socketId);
            const userId = socket?.userId; // Check for socket existence and userId
            
            if (userId && room.players.some(p => p.user_id === userId)) {
                const gameState = await getGameState(room.game_id, userId);
                if(gameState) {
                    socket.emit('game:state', { 
                        game_id: room.game_id, 
                        game_state: gameState,
                        room: room // Send room state for score update in sidebar
                    });
                }
            }
        }
    }
};

const getActiveRoomsList = async (level = null) => {
    let q = `SELECT r.id, r.name, r.level, r.status, r.max_players, r.created_by, r.reveal_mode, r.created_at, COUNT(rp.user_id) AS players, g.id AS game_id
             FROM rooms r 
             LEFT JOIN room_players rp ON r.id = rp.room_id
             LEFT JOIN games g ON r.id = g.room_id AND r.status = 'in_game'
             WHERE r.status <> 'finished'`;
    const params = [];
    if (level) { params.push(level); q += ` AND r.level = $${params.length}`; }
    q += ` 
    GROUP BY r.id, g.id, r.created_at
    ORDER BY r.created_at DESC LIMIT 100;`;
    const out = await pool.query(q, params);
    // Correctly return players count as number
    return out.rows.map(row => ({ ...row, players: Number(row.players) }));
};


// Function to finish the game
const finishGame = async (gameId, roomId) => {
    try {
        // 1. Update room and game status to finished
        // We set room status to 'finished' AFTER fetching results, as players need the room context to receive the event.
        await pool.query(`UPDATE games SET status='finished', finished_at=NOW() WHERE id=$1;`, [gameId]);
        
        // 2. Fetch final states and user data, ordered by score (DESC) and time (ASC) for ranking
        const resultsQuery = await pool.query(`
            SELECT 
                gs.user_id, gs.score, gs.timer_ms, gs.current_index AS words_guessed, 
                u.username, u.first_name, u.last_name
            FROM game_states gs
            JOIN users u ON gs.user_id = u.id
            WHERE gs.game_id = $1
            ORDER BY gs.score DESC, gs.timer_ms ASC; 
        `, [gameId]);
        
        const results = resultsQuery.rows.map( (r, index) => ({
            rank: index + 1,
            score: Number(r.score), // Ensure score is a number
            timer_ms: Number(r.timer_ms), // Ensure time is a number
            words_guessed: Number(r.words_guessed),
            user: { // Send user subset for client to display name
                id: r.user_id, 
                username: r.username, 
                first_name: r.first_name, 
                last_name: r.last_name
            }
        }));

        // 3. Broadcast results
        io.to(roomId).emit('game:finished', { game_id: gameId, room_id: roomId, results });
        
        // 4. Update room status to finished (to prevent new joins)
        await pool.query(`UPDATE rooms SET status='finished' WHERE id=$1;`, [roomId]);
        
        // 5. Kick everyone out of the socket.io room (Optional but helpful for cleanup)
        // NOTE: Commented out to allow the client to receive the 'game:finished' event before being kicked.
        // The client should navigate away and disconnect gracefully.
        /*
        const socketsInRoom = io.sockets.adapter.rooms.get(roomId) || new Set();
        for (const socketId of Array.from(socketsInRoom)) {
            const socket = io.sockets.sockets.get(socketId);
            socket?.leave(roomId);
        }
        */

    } catch(e) {
        console.error("Error in finishGame:", e);
    }
}

// Function to advance to the next word or finish the game
const advanceToNextWord = async (gameId, userId, currentIndex, deck, roomId) => {
    const nextIndex = currentIndex + 1;
    
    // FIX: Add score for word completion (25 points)
    await pool.query(`
        UPDATE game_states SET 
            guessed_count=guessed_count+1, 
            score=score + 25, 
            last_update=NOW() 
        WHERE game_id=$1 AND user_id=$2;
    `, [gameId, userId]);

    if (nextIndex >= deck.length) {
        // END OF DECK: Finish the game for all players in the room
        await finishGame(gameId, roomId);
        return;
    }
    
    // Continue to next word: reset letters and calculate new allowed wrong count
    const nextWordStrict = normalizeFaWordStrict(deck[nextIndex].word);
    
    // The allowed_wrong calculation needs to be robust for the next word
    const newAllowedWrong = ceil(nextWordStrict.length / 2);

    await pool.query(`
        UPDATE game_states SET 
            current_index=$3, 
            correct_letters='[]'::jsonb, 
            wrong_letters='[]'::jsonb, 
            hints_used=0, 
            allowed_wrong=$4, -- FIX: Use the calculated allowed wrong count
            last_update=NOW()
        WHERE game_id=$1 AND user_id=$2;
    `, [gameId, userId, nextIndex, newAllowedWrong]);

    // Notify room/game update
    await sendRoomState(roomId);
};

/* ----------------------------------------------------------------
   DB SCHEMA
---------------------------------------------------------------- */
const ensureSchema = async () => {
  const queries = [
    `CREATE TABLE IF NOT EXISTS users (
      id BIGINT PRIMARY KEY, username TEXT, first_name TEXT, last_name TEXT, fullname TEXT, 
      language_code TEXT, photo_url TEXT, created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW()
    );`,
    `CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY, name TEXT, status TEXT DEFAULT 'waiting', level TEXT, 
      max_players INT DEFAULT 2, created_by BIGINT, reveal_mode TEXT DEFAULT 'private', created_at TIMESTAMP DEFAULT NOW()
    );`,
    `CREATE TABLE IF NOT EXISTS room_players (
      room_id TEXT, user_id BIGINT, role TEXT, joined_at TIMESTAMP DEFAULT NOW(), PRIMARY KEY (room_id, user_id)
    );`,
    `CREATE TABLE IF NOT EXISTS games (
      id TEXT PRIMARY KEY, room_id TEXT, deck JSONB, level TEXT, status TEXT, started_at TIMESTAMP, finished_at TIMESTAMP
    );`,
    `CREATE TABLE IF NOT EXISTS game_states (
     game_id TEXT, user_id BIGINT, current_index INT DEFAULT 0, correct_letters JSONB DEFAULT '[]', 
      wrong_letters JSONB DEFAULT '[]', hints_used INT DEFAULT 0, hints_allowed INT DEFAULT 0, 
      score INT DEFAULT 0, guessed_count INT DEFAULT 0, allowed_wrong INT DEFAULT 0, timer_ms BIGINT DEFAULT 0, 
      last_update TIMESTAMP DEFAULT NOW(), PRIMARY KEY (game_id, user_id)
    );`
  ];
  for(const q of queries) await pool.query(q);
};

/* ----------------------------------------------------------------
   API ROUTES
---------------------------------------------------------------- */
// ذخیره اطلاعات تلگرام در دیتابیس
app.post('/auth/telegram', async (req, res) => {
  const { user } = req.body;
  try {
    const uid = Number(user?.id);
    if (!uid) return res.status(400).json({ ok:false });
    
    // ساخت نام کامل از روی اطلاعات تلگرام
    const fullname = `${user.first_name || ''}${user.last_name ? ' ' + user.last_name : ''}`.trim() || `کاربر ${uid}`;
    
    await pool.query(`
      INSERT INTO 
      users (id, username, first_name, last_name, fullname, language_code, photo_url)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (id) DO UPDATE SET 
        first_name = EXCLUDED.first_name, 
        last_name = EXCLUDED.last_name, 
        fullname = EXCLUDED.fullname, 
        photo_url = EXCLUDED.photo_url, 
        updated_at = NOW();
    `, [uid, user.username, user.first_name, user.last_name, fullname, user.language_code, user.photo_url]);
    res.json({ ok:true });
  } catch (e) { 
    console.error(e);
    res.status(500).json({ ok:false }); 
  }
});

app.get('/rooms/list', async (req, res) => {
  try {
    const level = req.query.level;
    const rooms = await getActiveRoomsList(level);
    res.json({ ok:true, rooms: rooms });
  } catch (e) { 
    console.error("Error in /rooms/list:", e);
    res.status(500).json({ ok:false }); 
  }
});

app.post('/rooms/myrooms', async (req, res) => {
    try {
        const { user_id } = req.body;
        if (!user_id) return res.status(400).json({ ok: false });
        
        // Find an active game/room where the user is a player
        const query = await pool.query(`
            SELECT r.id, r.name, r.status, g.id AS game_id
            FROM rooms r
            JOIN room_players rp ON r.id = rp.room_id
            LEFT JOIN games g ON r.id = g.room_id AND r.status = 'in_game'
            WHERE rp.user_id = $1 AND r.status <> 'finished'
            ORDER BY r.created_at DESC
            LIMIT 1;
        `, [user_id]);

        res.json({ ok: true, rooms: query.rows });
    } catch(e) {
        console.error("Error in /rooms/myrooms:", e);
        res.status(500).json({ ok: false });
    }
});


app.post('/rooms/create', async (req, res) => {
  const { user_id, name, level, max_players, reveal_mode } = req.body;
  if (!user_id) return res.status(400).json({ ok:false });
  try {
    const roomId = crypto.randomUUID();
    const mode = reveal_mode || 'private'; 
    await pool.query(`INSERT INTO rooms (id, name, status, level, max_players, created_by, reveal_mode) VALUES ($1,$2,'waiting',$3,$4,$5,$6);`, 
      [roomId, name || 'اتاق خصوصی', level || 'medium', Number(max_players) || 2, user_id, mode]);
    await pool.query(`INSERT INTO room_players (room_id, user_id, role) VALUES ($1,$2,$3);`, [roomId, user_id, 'host']);
    res.json({ ok:true, room_id: roomId });
  } catch (e) { 
    console.error("Error in /rooms/create:", e);
    res.status(500).json({ ok:false }); 
  }
});

// این API در کلاینت استفاده نمی‌شود، اما برای حفظ کدهای قبلی آن را نگه می‌داریم.
app.post('/rooms/join', async (req, res) => {
  const { room_id, user_id } = req.body;
  if (!room_id || !user_id) return res.status(400).json({ ok:false });
  try {
    const r = await pool.query(`SELECT * FROM rooms WHERE id=$1 LIMIT 1;`, [room_id]);
    if (!r.rows.length) return res.status(404).json({ ok:false, message: 'اتاق یافت نشد.' });
    const rn = r.rows[0];
    
    const count = await pool.query(`SELECT COUNT(*) AS count FROM room_players WHERE room_id=$1;`, [room_id]);
    const playerCount = Number(count.rows[0].count);
    
    if (rn.status === 'in_game' && playerCount >= rn.max_players) {
        // Check if the user is already a player in the room
        const check = await pool.query(`SELECT 1 FROM room_players WHERE room_id=$1 AND user_id=$2;`, [room_id, user_id]);
        if (!check.rows.length) {
            return res.status(400).json({ ok:false, message: 'ظرفیت اتاق پر است و بازی شروع شده است.' });
        }
    }
    
    if (playerCount < rn.max_players) {
        await pool.query(`
            INSERT INTO room_players (room_id, user_id, role) 
            VALUES ($1, $2, 'player') 
            ON CONFLICT (room_id, user_id) DO NOTHING;
        `, [room_id, user_id]);
    }

    res.json({ ok:true, room_id });
  } catch (e) { 
    console.error("Error in /rooms/join:", e);
    res.status(500).json({ ok:false }); 
  }
});


/* ----------------------------------------------------------------
   SOCKET.IO
---------------------------------------------------------------- */
// Map to hold socket metadata (userId, roomIds)
const socketMeta = new Map();

io.on('connection', (socket) => {
  
  socket.on('auth', ({ user_id }) => {
    if (!user_id) return;
    const userId = Number(user_id);
    socket.userId = userId;
    
    // Store metadata
    if (!socketMeta.has(socket.id)) {
        socketMeta.set(socket.id, { user_id: userId, room_ids: new Set() });
    } else {
        socketMeta.get(socket.id).user_id = userId;
    }
  });

  socket.on('room:join', async ({ room_id, user_id }) => {
    try {
      if (!room_id || !user_id) return;
      const uid = Number(user_id);
      
      const r = await pool.query(`SELECT * FROM rooms WHERE id=$1 LIMIT 1;`, [room_id]);
      if (!r.rows.length) return socket.emit('error', { message: 'اتاق یافت نشد.' });
      const room = r.rows[0];
      
      const count = await pool.query(`SELECT COUNT(*) AS count FROM room_players WHERE room_id=$1;`, [room_id]);
      const playerCountBeforeJoin = Number(count.rows[0].count);
      const isPlayerAlreadyInRoom = await pool.query(`SELECT 1 FROM room_players WHERE room_id=$1 AND user_id=$2;`, [room_id, uid]);

      // 1. Check capacity for new players
      if (room.status === 'in_game' && !isPlayerAlreadyInRoom.rows.length) {
         return socket.emit('error', { message: 'ظرفیت اتاق پر است و بازی شروع شده است.' });
      }

      // 2. Register player in room (if not already there)
      if (!isPlayerAlreadyInRoom.rows.length && playerCountBeforeJoin < room.max_players) {
          await pool.query(`
              INSERT INTO room_players (room_id, user_id, role) 
              VALUES ($1, $2, 'player');
          `, [room_id, uid]);
      }

      // 3. Join the socket.io room
      socket.join(room_id);
      if (!socketMeta.has(socket.id)) socketMeta.set(socket.id, { user_id: uid, room_ids: new Set() }); // Safety check
      socketMeta.get(socket.id)?.room_ids.add(room_id);

      // 4. Fetch the full room state and send to the joining user
      const roomState = await getRoomState(room_id);
      if(roomState) {
        const isHost = room.created_by === uid;
        socket.emit('room:joined', { room_id, room: roomState, is_host: isHost, reveal_mode: room.reveal_mode });
        
        // 5. Broadcast updated room state to everyone in the room
        await sendRoomState(room_id);
        
        const playerCountAfterJoin = isPlayerAlreadyInRoom.rows.length ? playerCountBeforeJoin : playerCountBeforeJoin + 1;

        // 6. If a game is not running and max players reached, start the game
        if (room.status === 'waiting' && playerCountAfterJoin >= room.max_players) {
            const gameId = crypto.randomUUID();
            const deck = newGameDeckForRoom(room_id, room.level);
            
            // FIX: Check if deck is empty before starting
            if(deck.length === 0) {
                 return socket.emit('error', { message: 'کلمه‌ای برای این سطح پیدا نشد.' });
            }

            await pool.query(`INSERT INTO games (id, room_id, deck, level, status, started_at) VALUES ($1,$2,$3,$4,'in_game',NOW());`, 
              [gameId, room_id, JSON.stringify(deck), room.level]);
            await pool.query(`UPDATE rooms SET status='in_game' WHERE id=$1;`, [room_id]);
            
            // Create game states for all players
            const players = await pool.query(`SELECT user_id FROM room_players WHERE room_id=$1;`, [room_id]);
            const firstWordStrict = normalizeFaWordStrict(deck[0].word);
            const initialAllowedWrong = ceil(firstWordStrict.length / 2); // Initial calculation
            
            for (const p of players.rows) {
                await pool.query(`
                    INSERT INTO game_states (game_id, user_id, allowed_wrong) 
                    VALUES ($1, $2, $3) 
                    ON CONFLICT (game_id, user_id) DO NOTHING;
                `, [gameId, p.user_id, initialAllowedWrong]); // FIX: Use the calculated allowed_wrong
            }
            
            io.to(room_id).emit('game:start', { game_id: gameId, room_id });
            // Send the full state again after starting the game
            await sendRoomState(room_id); 
        }
      }

    } catch (e) { 
      console.error("Error in room:join:", e);
      socket.emit('error', { message: 'خطا در ورود به اتاق.' });
    }
  });
  
  socket.on('room:resume', async ({ user_id }) => {
    try {
        if (!user_id) return;
        const uid = Number(user_id);

        const activeGameQuery = await pool.query(`
            SELECT r.id AS room_id, g.id AS game_id, r.created_by
            FROM rooms r
            JOIN room_players rp ON r.id = rp.room_id
            JOIN games g ON r.id = g.room_id
            JOIN game_states gs ON g.id = gs.game_id AND gs.user_id = rp.user_id
            WHERE rp.user_id = $1 AND r.status = 'in_game' AND g.status = 'in_game'
            LIMIT 1;
        `, [uid]);

        if (activeGameQuery.rows.length) {
            const { room_id, game_id, created_by } = activeGameQuery.rows[0];
            
            // Re-join the room (socket.io room)
            socket.join(room_id);
            if (!socketMeta.has(socket.id)) socketMeta.set(socket.id, { user_id: uid, room_ids: new Set() }); // Safety check
            socketMeta.get(socket.id)?.room_ids.add(room_id);

            const roomState = await getRoomState(room_id);
            if(roomState) {
                // Fetch the full room state and send to the joining user
                socket.emit('room:joined', { room_id, room: roomState, is_host: created_by === uid, reveal_mode: roomState.reveal_mode });

                // Send their specific game state
                const gameState = await getGameState(game_id, uid);
                if(gameState) {
                    socket.emit('game:state', { 
                        game_id: game_id, 
                        game_state: gameState,
                        room: roomState 
                    });
                }
            }
        }
    } catch(e) { console.error("Error resuming game:", e); }
  });

  socket.on('room:leave', async ({ room_id, user_id }) => {
    try {
      if (!room_id || !user_id) return;
      const uid = Number(user_id);
      
      // Remove from DB
      await pool.query(`DELETE FROM room_players WHERE room_id=$1 AND user_id=$2;`, [room_id, uid]);
      
      // Leave the socket.io room
      socket.leave(room_id);
      socketMeta.get(socket.id)?.room_ids.delete(room_id);

      socket.emit('room:left', { room_id });

      // Check if room is empty or needs status update
      const count = await pool.query(`SELECT COUNT(*) AS count FROM room_players WHERE room_id=$1;`, [room_id]);
      if (Number(count.rows[0].count) === 0) {
          // If the room is empty, mark it as finished
          await pool.query(`UPDATE rooms SET status='finished' WHERE id=$1;`, [room_id]);
          // Also mark the associated game as finished if one exists
          await pool.query(`UPDATE games SET status='finished', finished_at=NOW() WHERE room_id=$1 AND status='in_game';`, [room_id]);
      } else {
          // Broadcast updated room state to remaining players
          await sendRoomState(room_id);
      }
      
    } catch (e) { 
      console.error("Error in room:leave:", e);
      socket.emit('error', { message: 'خطا در خروج از اتاق.' });
    }
  });

  socket.on('game:guess_letter', async ({ game_id, user_id, letter }) => {
    try {
      if (!game_id || !user_id || !letter) {
         return socket.emit('error', { message: 'داده‌های ارسالی ناقص است.' });
      }
      const uid = Number(user_id);
      const normalizedLetter = normalizeFaLetter(letter);

      if (!normalizedLetter) {
          return socket.emit('error', { message: 'حرف وارد شده معتبر نیست.' });
      }
      
      const q = await pool.query(`
        SELECT 
            gs.current_index, gs.correct_letters, gs.wrong_letters, gs.allowed_wrong,
            g.deck, r.id AS room_id, r.reveal_mode
        FROM game_states gs
        JOIN games g ON gs.game_id = g.id
        JOIN rooms r ON g.room_id = r.id
        WHERE gs.game_id = $1 AND gs.user_id = $2;
      `, [game_id, uid]);

      if (!q.rows.length) return socket.emit('error', { message: 'وضعیت بازی برای این کاربر یافت نشد.' });
      
      const { current_index: idx, correct_letters: currentCorrect, wrong_letters: currentWrong, allowed_wrong, deck, room_id, reveal_mode } = q.rows[0];
      
      if (idx >= deck.length) return socket.emit('error', { message: 'بازی به پایان رسیده است.' });

      const currentWord = deck[idx].word;
      const wordStrict = normalizeFaWordStrict(currentWord);
      
      if (currentWrong.length >= allowed_wrong) return socket.emit('error', { message: 'تعداد حدس‌های اشتباه شما به سقف مجاز رسیده است.' });
      if (currentCorrect.includes(normalizedLetter) || currentWrong.includes(normalizedLetter)) {
          return socket.emit('error', { message: 'این حرف قبلاً حدس زده شده است.' });
      }

      let newScore = 0;
      let isCorrect = wordStrict.includes(normalizedLetter);
      
      const correctLetters = Array.from(currentCorrect);
      const wrongLetters = Array.from(currentWrong);
      
      if (isCorrect) {
          correctLetters.push(normalizedLetter);
          // 10 points for correct guess
          newScore = 10; 
      } else {
          wrongLetters.push(normalizedLetter);
          // -5 points for wrong guess
          newScore = -5;
          
          // FIX: Check for game over condition (all wrong guesses used up)
          if (wrongLetters.length >= allowed_wrong) {
             // Game over for this word, but don't advance yet.
             // The client handles the revealed word based on the state update (getGameState logic).
             // The user gets penalized, but the word is just revealed.
             // No further score change is needed here.
          }
      }
      
      // Update state
      await pool.query(`
        UPDATE game_states SET 
          correct_letters=$3::jsonb, 
          wrong_letters=$4::jsonb,
          score=score + $5
        WHERE game_id=$1 AND user_id=$2;
      `, [game_id, uid, JSON.stringify(correctLetters), JSON.stringify(wrongLetters), newScore]);
      
      // Re-fetch all unique required letters to check for win condition
      const uniqueRequired = new Set(wordStrict.split('').filter(c => c && c.trim() !== ''));
      const isWin = [...uniqueRequired].every(char => correctLetters.includes(char));
      
      if(isWin) {
         // FIX: Removed the 20 bonus points here as it's added inside advanceToNextWord now (total 25)
         await advanceToNextWord(game_id, uid, idx, deck, room_id);
      } else {
         // If not a win, just update state for the current player
         await sendRoomState(room_id);
      }

    } catch (e) { 
        console.error("Error in game:guess_letter:", e); 
        socket.emit('error', { message: 'خطا در ثبت حدس.' });
    }
  });

  socket.on('game:hint', async ({ game_id, user_id }) => {
    try {
        if (!game_id || !user_id) return socket.emit('error', { message: 'داده‌های ارسالی ناقص است.' });
        const uid = Number(user_id);

        const q = await pool.query(`
            SELECT 
                gs.current_index, gs.correct_letters, gs.wrong_letters, gs.hints_used, gs.allowed_wrong,
                g.deck, r.id AS room_id
            FROM game_states gs
            JOIN games g ON gs.game_id = g.id
            JOIN rooms r ON g.room_id = r.id
            WHERE gs.game_id = $1 AND gs.user_id = $2;
        `, [game_id, uid]);

        if (!q.rows.length) return socket.emit('error', { message: 'وضعیت بازی برای این کاربر یافت نشد.' });
        
        const { current_index: idx, correct_letters: currentCorrect, hints_used, allowed_wrong, deck, room_id } = q.rows[0];

        if (idx >= deck.length) return socket.emit('error', { message: 'بازی به پایان رسیده است.' });

        const currentWord = deck[idx].word;
        const wordStrict = normalizeFaWordStrict(currentWord);

        if (hints_used >= allowed_wrong) { // Allowed_wrong is usually the hint limit
            return socket.emit('error', { message: 'تعداد راهنماهای مجاز برای این کلمه به پایان رسیده است.' });
        }
        
        const requiredLetters = new Set(wordStrict.split('').filter(c => c && c.trim() !== ''));
        const unguessedLetters = Array.from(requiredLetters).filter(c => !currentCorrect.includes(c));

        if (unguessedLetters.length === 0) {
            return socket.emit('error', { message: 'شما قبلاً تمام حروف کلمه را حدس زده‌اید.' });
        }

        // Pick a random unguessed letter
        const hintLetter = unguessedLetters[floor(Math.random() * unguessedLetters.length)];
        
        const newCorrectLetters = Array.from(currentCorrect);
        newCorrectLetters.push(hintLetter);

        // Update state: Add correct letter, increment hints_used, deduct score
        await pool.query(`
            UPDATE game_states SET 
                correct_letters=$3::jsonb, 
                hints_used=hints_used + 1,
                score=score - 15 -- Penalty for hint
            WHERE game_id=$1 AND user_id=$2;
        `, [game_id, uid, JSON.stringify(newCorrectLetters)]);
        
        // Re-check for win condition after hint
        const isWin = Array.from(requiredLetters).every(char => newCorrectLetters.includes(char));

        if(isWin) {
            // FIX: Removed bonus points here, added in advanceToNextWord (total 25)
            await advanceToNextWord(game_id, uid, idx, deck, room_id);
        } else {
            // If not a win, just update state for the current player
            await sendRoomState(room_id);
        }
        
    } catch (e) {
        console.error("Error in game:hint:", e);
        socket.emit('error', { message: 'خطا در دریافت راهنما.' });
    }
  });


  // FIX: History request handler completed
  socket.on('history:request', async ({ user_id }) => {
    try {
        if (!user_id) return;
        const uid = Number(user_id);
        
        // 1. Get all game states for this user in finished games
        const historyQuery = await pool.query(`
            SELECT 
                g.id AS game_id, g.level, g.finished_at AS end_time, r.name AS room_name,
                gs.user_id, gs.score, gs.timer_ms, gs.current_index AS words_guessed
            FROM games g
            JOIN game_states gs ON g.id = gs.game_id
            JOIN rooms r ON g.room_id = r.id
            WHERE g.status = 'finished' AND gs.user_id = $1
            ORDER BY g.finished_at DESC;
        `, [uid]);
        
        const history = [];
        for (const userGame of historyQuery.rows) {
            const gameId = userGame.game_id;
            
            // 2. Calculate rank for this specific game
            const rankQuery = await pool.query(`
                SELECT user_id
                FROM game_states 
                WHERE game_id=$1
                ORDER BY score DESC, timer_ms ASC; -- FIX: Ranking by score (DESC) then time (ASC)
            `, [gameId]);
            
            const myRankIndex = rankQuery.rows.findIndex(r => r.user_id === uid);
            const myRank = myRankIndex !== -1 ? myRankIndex + 1 : 0;

            // 3. Find total players for display
            const totalPlayers = rankQuery.rows.length;

            history.push({
                game_id: gameId,
                room_name: userGame.room_name,
                level: userGame.level,
                end_time: userGame.end_time,
                score: Number(userGame.score),
                timer_ms: Number(userGame.timer_ms),
                words_guessed: Number(userGame.words_guessed),
                total_players: totalPlayers,
                rank: myRank
            });
        }

        socket.emit('history:list', { history });
    } catch (e) {
        console.error("Error fetching history:", e);
        socket.emit('error', { message: 'خطا در بارگذاری تاریخچه بازی‌ها.' });
    }
  });

  socket.on('game:timer', async ({ game_id, user_id, timer_ms }) => {
    try {
      if (!game_id || !user_id) return;
      const safeMs = Math.max(0, parseInt(timer_ms) || 0);
      await pool.query(`UPDATE game_states SET timer_ms=$3, last_update=NOW() WHERE game_id=$1 AND user_id=$2;`, [game_id, user_id, safeMs]);
    } catch (e) {
        console.error("Error in game:timer:", e);
    }
  });

  socket.on('disconnect', () => {
    const m = socketMeta.get(socket.id);
    if (!m) return;
    
    // Remove room association from socketMeta
    for (const rid of Array.from(m.room_ids)) {
        // Clean up socket.io room manually
        socket.leave(rid);
    }
    
    socketMeta.delete(socket.id);
  });
});

(async () => {
  if (connectionString) {
    console.log('Ensuring DB schema...');
    await ensureSchema();
  } else {
    console.warn('DB connection string is not set. Database functionality is disabled.');
  }

  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
})();

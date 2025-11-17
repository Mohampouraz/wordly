import express from "express";
import http from "http";
import cors from "cors";
import { WebSocketServer } from "ws";
import TelegramBot from "node-telegram-bot-api";

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);

// ==========================
//    CONFIGURATION
// ==========================

const BOT_TOKEN = process.env.BOT_TOKEN || "YOUR_TOKEN_HERE";
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

const wss = new WebSocketServer({ server });

// ==========================
//    GAME STATE MANAGEMENT
// ==========================

const onlineUsers = new Map();   // userId → ws
const activeRooms = new Map();   // roomId → { players, spectators, events }

// ==========================
//    UTILITIES
// ==========================

function broadcastToast(message) {
  const data = JSON.stringify({
    type: "toast",
    message,
  });

  for (const ws of onlineUsers.values()) {
    try {
      ws.send(data);
    } catch {}
  }
}

function notifyRoom(roomId, payload) {
  const room = activeRooms.get(roomId);
  if (!room) return;

  const msg = JSON.stringify(payload);

  [...room.players, ...room.spectators].forEach((id) => {
    const ws = onlineUsers.get(id);
    if (ws) ws.send(msg);
  });
}

function createRoom(ownerId) {
  const roomId = "room-" + Date.now();
  activeRooms.set(roomId, {
    ownerId,
    players: [ownerId],
    spectators: [],
    events: [],
  });
  return roomId;
}

// ==========================
//   TELEGRAM BOT COMMANDS
// ==========================

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    "👋 خوش آمدی! برای بازی از دکمه‌ها استفاده کن.",
    {
      reply_markup: {
        keyboard: [["🎮 ساخت بازی جدید", "🎲 لیست بازی‌ها"]],
        resize_keyboard: true,
      },
    }
  );
});

// ==========================
//   WEBSOCKET CONNECTIONS
// ==========================

wss.on("connection", (ws, req) => {
  const userId = new URL(req.url, "http://localhost").searchParams.get("userId");

  if (!userId) {
    ws.close();
    return;
  }

  onlineUsers.set(userId, ws);

  broadcastToast(`🔵 کاربر ${userId} به بات اضافه شد`);

  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data);

      // CREATE ROOM
      if (msg.type === "create_room") {
        const roomId = createRoom(userId);
        ws.send(JSON.stringify({ type: "room_created", roomId }));
        broadcastToast(`👤 کاربر ${userId} یک بازی جدید ایجاد کرد`);
      }

      // JOIN ROOM
      if (msg.type === "join_room") {
        const room = activeRooms.get(msg.roomId);
        if (!room) {
          ws.send(JSON.stringify({ type: "error", message: "Room not found" }));
          return;
        }

        if (!room.players.includes(userId)) {
          room.spectators.push(userId);
        }

        notifyRoom(msg.roomId, {
          type: "room_update",
          message: `🟢 کاربر ${userId} وارد اتاق شد`,
          players: room.players,
          spectators: room.spectators,
        });

        broadcastToast(`🟢 کاربر ${userId} وارد بازی ${msg.roomId} شد`);
      }

      // GAME MOVE
      if (msg.type === "move") {
        notifyRoom(msg.roomId, {
          type: "game_move",
          move: msg.move,
          userId,
        });
      }
    } catch (err) {
      console.error("WS Error:", err);
    }
  });

  ws.on("close", () => {
    onlineUsers.delete(userId);
    broadcastToast(`🔴 کاربر ${userId} خارج شد`);
  });
});

// ==========================
//   EXPRESS ROUTES (API)
// ==========================

app.get("/", (req, res) => {
  res.json({ status: "OK", message: "Game Server Running" });
});

// ==========================
//   START SERVER
// ==========================

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🌐 Server is running on port ${PORT}`));

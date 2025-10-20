// server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { Client, Pool } from "pg";
import axios from "axios";
import http from "http";
import { Server as SocketIOServer } from "socket.io";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const TELEGRAM_TOKEN =
  process.env.TELEGRAM_TOKEN ||
  "8217028556:AAFDNQfmRYuUnto4gb2dAUNyWjKanRZldfA";
const WEB_APP_URL =
  process.env.WEB_APP_URL || "https://wordlygame.onrender.com";
const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://abolfazl:ZnczfHE6NUZWmPfYtPQjUdsuaseuFoHS@dpg-d3q9nrm3jp1c738f47pg-a.frankfurt-postgres.render.com/wordgame_lbh3";
const PORT = process.env.PORT || 3000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: { origin: CORS_ORIGIN },
});

app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json());
app.use(express.static("public"));

// --- Path helpers for ESM ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ----------------------------
// Wipe all tables safely
// ----------------------------
async function wipeDatabase() {
  console.log("🧨 Wiping all tables from database...");
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    const res = await client.query(`
      SELECT tablename FROM pg_tables WHERE schemaname='public';
    `);

    for (const row of res.rows) {
      await client.query(`DROP TABLE IF EXISTS "${row.tablename}" CASCADE;`);
      console.log(`❌ Dropped table: ${row.tablename}`);
    }

    console.log("✅ Database wiped successfully!");
  } catch (err) {
    console.error("Database wipe error:", err.message);
  } finally {
    await client.end();
  }
}

// ----------------------------
// Telegram message helper
// ----------------------------
const TELEGRAM_API_BASE = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

async function sendTelegramMessage(chat_id, text, extra = {}) {
  try {
    await axios.post(`${TELEGRAM_API_BASE}/sendMessage`, {
      chat_id,
      text,
      ...extra,
    });
  } catch (err) {
    console.error("Error sending telegram message:", err.response?.data || err.message);
  }
}

// ----------------------------
// Telegram Auth verification
// ----------------------------
function verifyTelegramAuth(initData) {
  const secretKey = crypto
    .createHmac("sha256", TELEGRAM_TOKEN)
    .update("WebAppData")
    .digest();

  const dataCheckString = Object.keys(initData)
    .filter(k => k !== "hash")
    .sort()
    .map(k => `${k}=${initData[k]}`)
    .join("\n");

  const hmac = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  return hmac === initData.hash;
}

// ----------------------------
// Socket.io
// ----------------------------
io.on("connection", (socket) => {
  console.log("⚡ New client connected");

  socket.on("user_data", async (data) => {
    console.log("📩 Received user data:", data);

    if (!data.initData) {
      socket.emit("welcome", { message: "❌ اطلاعات کاربر نامعتبر است!" });
      return;
    }

    const isValid = verifyTelegramAuth(data.initData);
    if (!isValid) {
      socket.emit("welcome", { message: "❌ احراز هویت تلگرام ناموفق!" });
      return;
    }

    // موفق: پیام خوش آمد
    const user = data.initData.user;
    socket.emit("welcome", { message: `🌙 سلام ${user.first_name}! خوش آمدی به Wordly!` });

    // اختیاری: ارسال پیام به تلگرام کاربر
    try {
      await sendTelegramMessage(user.id, `✨ سلام ${user.first_name}! خوش آمدی به Mini App`);
    } catch (err) {}
  });

  socket.on("disconnect", () => {
    console.log("❌ Client disconnected");
  });
});

// ----------------------------
// Route for Mini App
// ----------------------------
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/health", (req, res) => res.json({ status: "ok" }));

// ----------------------------
// Start server
// ----------------------------
(async () => {
  await wipeDatabase();
  server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🧩 Mini App URL: ${WEB_APP_URL}`);
  });
})();

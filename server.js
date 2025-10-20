// server.js
// Telegram Mini App backend with socket.io
// Drops entire public schema on startup (no table creation)

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const axios = require("axios");
const path = require("path");
const http = require("http");
const { Server } = require("socket.io");

const TELEGRAM_TOKEN =
  process.env.TELEGRAM_TOKEN ||
  "8217028556:AAFDNQfmRYuUnto4gb2dAUNyWjKanRZldfA";
const WEB_APP_URL =
  process.env.WEB_APP_URL || "https://wordlybot.xo.je";
const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://abolfazl:ZnczfHE6NUZWmPfYtPQjUdsuaseuFoHS@dpg-d3q9nrm3jp1c738f47pg-a.frankfurt-postgres.render.com/wordgame_lbh3";
const PORT = process.env.PORT || 3000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: CORS_ORIGIN },
});

app.use(express.json());
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.static(path.join(__dirname, "public")));

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false },
});

// پاک کردن ایمن دیتابیس بدون Drop Schema
async function wipeDatabase() {
  console.log("🧨 Wiping all tables from database...");
  const client = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

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


const TELEGRAM_API_BASE = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

async function sendTelegramMessage(chat_id, text, extra = {}) {
  try {
    const res = await axios.post(`${TELEGRAM_API_BASE}/sendMessage`, {
      chat_id,
      text,
      ...extra,
    });
    return res.data;
  } catch (err) {
    console.error("Error sending telegram message:", err.response?.data || err.message);
  }
}

// Telegram webhook
app.post("/telegram/webhook", async (req, res) => {
  try {
    const update = req.body;
    console.log("Telegram update:", update);

    if (update.message && update.message.text) {
      const chatId = update.message.chat.id;
      const text = update.message.text;

      if (text.startsWith("/start")) {
        await sendTelegramMessage(chatId, "👋 سلام! خوش اومدی به Wordly Mini App\nبرای شروع روی دکمه زیر بزن:", {
          reply_markup: {
            inline_keyboard: [
              [{ text: "🚀 شروع بازی", web_app: { url: WEB_APP_URL } }],
            ],
          },
        });
      }
    }
    res.sendStatus(200);
  } catch (err) {
    console.error("Webhook error:", err);
    res.sendStatus(500);
  }
});

// Socket.io connection
io.on("connection", (socket) => {
  console.log("⚡ New client connected");

  socket.on("user_data", async (data) => {
    console.log("📩 Received user data:", data);

    // send welcome message to Telegram user (optional)
    if (data?.id) {
      await sendTelegramMessage(data.id, `🌙 سلام ${data.first_name || ""}! خوش اومدی به Mini App ✨`);
    }

    socket.emit("welcome", {
      message: `سلام ${data.first_name || "کاربر"} 👋 خوش اومدی!`,
    });
  });

  socket.on("disconnect", () => {
    console.log("❌ Client disconnected");
  });
});

app.get("/health", (req, res) => res.json({ status: "ok" }));

(async () => {
  await wipeDatabase();
  server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🧩 Mini App URL: ${WEB_APP_URL}`);
  });
})();

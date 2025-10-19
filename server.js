// server.js
import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import pkg from "pg";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();
const { Pool } = pkg;

const app = express();
app.use(cors());
app.use(bodyParser.json());

// ------------------------
// 🔹 تنظیمات اصلی
// ------------------------
const BOT_TOKEN = process.env.BOT_TOKEN;
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ------------------------
// 🔹 دیتابیس آماده
// ------------------------
(async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      telegram_id TEXT UNIQUE,
      username TEXT,
      score INT DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS words (
      id SERIAL PRIMARY KEY,
      word TEXT,
      category TEXT,
      creator TEXT
    );
  `);

  const { rows } = await pool.query("SELECT COUNT(*) FROM words");
  if (parseInt(rows[0].count) === 0) {
    await pool.query(`
      INSERT INTO words (word, category, creator)
      VALUES
        ('سلام', 'عمومی', 'WordlyBot'),
        ('سیب', 'میوه', 'WordlyBot'),
        ('کتاب', 'ابزار', 'WordlyBot');
    `);
  }
  console.log("✅ Database ready");
})();

// ------------------------
// 🔹 API ربات تلگرام
// ------------------------

// webhook endpoint
app.post(`/webhook/${BOT_TOKEN}`, async (req, res) => {
  const update = req.body;

  // اگر پیام متنی باشد
  if (update.message) {
    const chat_id = update.message.chat.id;
    const text = update.message.text;

    if (text === "/start") {
      // خوش‌آمدگویی و ارسال دکمه مینی‌اپ
      await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id,
        text: "🎮 خوش آمدید به WordlyGame!\nبرای بازی روی دکمه زیر بزنید:",
        reply_markup: {
          inline_keyboard: [[{ text: "باز کردن مینی‌اپ", web_app: { url: "https://wordlybot.xo.je" } }]]
        }
      });
    }
  }

  res.sendStatus(200);
});

// ------------------------
// 🔹 API بازی
// ------------------------
app.get("/api/random-word", async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM words ORDER BY RANDOM() LIMIT 1");
  res.json(rows[0]);
});

app.post("/api/submit-score", async (req, res) => {
  const { telegram_id, username, score } = req.body;
  if (!telegram_id) return res.status(400).json({ error: "telegram_id required" });

  const existing = await pool.query("SELECT * FROM users WHERE telegram_id = $1", [telegram_id]);
  if (existing.rowCount === 0) {
    await pool.query("INSERT INTO users (telegram_id, username, score) VALUES ($1, $2, $3)", [
      telegram_id,
      username || "ناشناس",
      score,
    ]);
  } else {
    await pool.query("UPDATE users SET score = GREATEST(score, $2) WHERE telegram_id = $1", [
      telegram_id,
      score,
    ]);
  }

  res.json({ success: true });
});

app.get("/api/leaderboard", async (req, res) => {
  const { rows } = await pool.query("SELECT username, score FROM users ORDER BY score DESC LIMIT 10");
  res.json(rows);
});

// ------------------------
// 🔹 تست سرور
// ------------------------
app.get("/", (req, res) => res.send("WordlyGame server ✅"));

// ------------------------
// 🔹 استارت سرور
// ------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));

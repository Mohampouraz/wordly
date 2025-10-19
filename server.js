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

    CREATE TABLE IF NOT EXISTS rooms (
      id SERIAL PRIMARY KEY,
      host_telegram_id TEXT,
      guest_telegram_id TEXT,
      word_id INT,
      status TEXT DEFAULT 'waiting'
    );

    CREATE TABLE IF NOT EXISTS guesses (
      id SERIAL PRIMARY KEY,
      room_id INT,
      telegram_id TEXT,
      letter TEXT,
      correct BOOLEAN,
      timestamp TIMESTAMP DEFAULT NOW()
    );
  `);

  // اضافه کردن چند کلمه نمونه
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
// 🔹 Telegram Webhook
// ------------------------
app.post(`/webhook/${BOT_TOKEN}`, async (req, res) => {
  const update = req.body;

  if (update.message) {
    const chat_id = update.message.chat.id;
    const text = update.message.text;

    if (text === "/start") {
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
// 🔹 API تست اصلی
// ------------------------
app.get("/api", (req, res) => {
  res.send("WordlyGame API ✅");
});

// ------------------------
// 🔹 API بازی
// ------------------------

// دریافت کلمه تصادفی
app.get("/api/random-word", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM words ORDER BY RANDOM() LIMIT 1");
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "خطا در دریافت کلمه" });
  }
});

// ثبت امتیاز
app.post("/api/submit-score", async (req, res) => {
  try {
    const { telegram_id, username, score } = req.body;
    if (!telegram_id) return res.status(400).json({ error: "telegram_id required" });

    const existing = await pool.query("SELECT * FROM users WHERE telegram_id = $1", [telegram_id]);
    if (existing.rowCount === 0) {
      await pool.query(
        "INSERT INTO users (telegram_id, username, score) VALUES ($1, $2, $3)",
        [telegram_id, username || "ناشناس", score]
      );
    } else {
      await pool.query(
        "UPDATE users SET score = GREATEST(score, $2) WHERE telegram_id = $1",
        [telegram_id, score]
      );
    }
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "خطا در ثبت امتیاز" });
  }
});

// رتبه‌بندی
app.get("/api/leaderboard", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT username, score FROM users ORDER BY score DESC LIMIT 10");
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "خطا در گرفتن رتبه‌بندی" });
  }
});

// اضافه کردن کلمه توسط کاربر
app.post("/api/add-word", async (req, res) => {
  try {
    const { word, category, creator } = req.body;
    if (!word || !category || !creator) return res.status(400).json({ error: "Missing data" });

    await pool.query("INSERT INTO words (word, category, creator) VALUES ($1, $2, $3)", [
      word, category, creator
    ]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "خطا در اضافه کردن کلمه" });
  }
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

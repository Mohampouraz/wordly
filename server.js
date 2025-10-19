import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import axios from "axios";
import pkg from "pg";
const { Pool } = pkg;

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static("public"));

const TOKEN = "8217028556:AAFDNQfmRYuUnto4gb2dAUNyWjKanRZldfA";
const WEB_APP_URL = "https://wordlybot.xo.je";
const PORT = process.env.PORT || 3000;

// اتصال به PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://abolfazl:ZnczfHE6NUZWmPfYtPQjUdsuaseuFoHS@dpg-d3q9nrm3jp1c738f47pg-a.frankfurt-postgres.render.com/wordgame_lbh3",
  ssl: { rejectUnauthorized: false },
});

// ایجاد جداول در صورت عدم وجود
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      telegram_id VARCHAR(100),
      username VARCHAR(100),
      score INT DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS words (
      id SERIAL PRIMARY KEY,
      word VARCHAR(100),
      category VARCHAR(100),
      difficulty VARCHAR(50),
      creator VARCHAR(100)
    );
  `);

  // چند کلمه‌ی نمونه
  const { rows } = await pool.query(`SELECT COUNT(*) FROM words;`);
  if (parseInt(rows[0].count) === 0) {
    await pool.query(`
      INSERT INTO words (word, category, difficulty, creator)
      VALUES 
        ('کتاب', 'اشیاء', 'آسان', 'مدیر سیستم'),
        ('درخت', 'طبیعت', 'متوسط', 'مدیر سیستم'),
        ('دانشگاه', 'مکان', 'سخت', 'مدیر سیستم');
    `);
  }
}
await initDB();

// 🧠 Webhook برای /start در تلگرام
app.post(`/webhook/${TOKEN}`, async (req, res) => {
  const msg = req.body.message;
  if (!msg || !msg.text) return res.sendStatus(200);

  const chatId = msg.chat.id;
  const username = msg.from.username || "ناشناس";

  if (msg.text === "/start") {
    // ثبت یا به‌روزرسانی کاربر
    await pool.query(
      `INSERT INTO users (telegram_id, username) VALUES ($1, $2)
       ON CONFLICT (telegram_id) DO UPDATE SET username = EXCLUDED.username;`,
      [chatId.toString(), username]
    );

    await axios.post(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      chat_id: chatId,
      text: "🎮 خوش اومدی! برای شروع بازی روی دکمه زیر بزن 👇",
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "🚀 ورود به Mini App",
              web_app: { url: WEB_APP_URL }
            }
          ]
        ]
      }
    });
  }

  res.sendStatus(200);
});

// 🧩 API: دریافت کلمه تصادفی
app.get("/api/random-word", async (req, res) => {
  const { rows } = await pool.query(`SELECT * FROM words ORDER BY RANDOM() LIMIT 1;`);
  res.json(rows[0]);
});

// 🧮 API: ثبت امتیاز کاربر
app.post("/api/submit-score", async (req, res) => {
  const { telegram_id, score } = req.body;
  if (!telegram_id || score == null) return res.status(400).json({ error: "Invalid data" });

  await pool.query(`UPDATE users SET score = GREATEST(score, $1) WHERE telegram_id = $2;`, [
    score,
    telegram_id.toString(),
  ]);

  res.json({ success: true });
});

// 🏆 API: جدول رتبه‌بندی
app.get("/api/leaderboard", async (req, res) => {
  const { rows } = await pool.query(`SELECT username, score FROM users ORDER BY score DESC LIMIT 10;`);
  res.json(rows);
});

// سلامت سرور
app.get("/", (req, res) => res.send("✅ WordlyGame Server is running."));

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));

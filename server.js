// server.js
// Node.js + Express backend for WordlyGame (PostgreSQL, Telegram WebApp)
// Required packages: express, body-parser, cors, pg, axios, uuid
// npm i express body-parser cors pg axios uuid

import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import axios from "axios";
import { Pool } from "pg";
import { v4 as uuidv4 } from "uuid";

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static("public")); // serve public/index.html if you put it in /public

// ENV / config
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || "8217028556:AAFDNQfmRYuUnto4gb2dAUNyWjKanRZldfA";
const WEB_APP_URL = process.env.WEB_APP_URL || "https://wordlybot.xo.je";
const DATABASE_URL = process.env.DATABASE_URL || "postgresql://abolfazl:ZnczfHE6NUZWmPfYtPQjUdsuaseuFoHS@dpg-d3q9nrm3jp1c738f47pg-a.frankfurt-postgres.render.com/wordgame_lbh3";
const PORT = process.env.PORT || 3000;

// Postgres pool (supports Heroku-like DATABASE_URL)
const pool = new Pool({
  connectionString: DATABASE_URL,
  // If Render or Heroku needs SSL true, ensure DATABASE_URL has proper config.
  ssl: process.env.DB_SSL === "false" ? false : { rejectUnauthorized: false },
});

// In-memory sessions (server keeps word secret here)
const sessions = new Map(); // sessionId -> { word, revealed[], guesses[], startAt, totalAllowedTime, category, creator, length, finished, correctCount }

// Initialize DB: users, words, scores
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      telegram_id VARCHAR(100) UNIQUE,
      username VARCHAR(200),
      best_score INT DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS words (
      id SERIAL PRIMARY KEY,
      word VARCHAR(200) NOT NULL,
      category VARCHAR(100),
      creator VARCHAR(100),
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS scores (
      id SERIAL PRIMARY KEY,
      telegram_id VARCHAR(100),
      username VARCHAR(200),
      score INT,
      correct_letters INT,
      total_letters INT,
      elapsed_sec INT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  // seed words if empty
  const res = await pool.query(`SELECT COUNT(*) FROM words;`);
  if (parseInt(res.rows[0].count, 10) === 0) {
    await pool.query(
      `INSERT INTO words (word, category, creator) VALUES
      ('گلستان', 'طبیعت', 'سیستم'),
      ('هوش', 'علم', 'سیستم'),
      ('دوستی', 'اجتماعی', 'سیستم'),
      ('رمزارز', 'فناوری', 'سیستم'),
      ('فرصت', 'عمومی', 'سیستم'),
      ('دانشگاه', 'مکان', 'سیستم');`
    );
    console.log("📦 Seeded sample words.");
  }
}

await initDB();

// ----------------- Telegram webhook -----------------
app.post(`/webhook/:token`, async (req, res) => {
  try {
    const tokenParam = req.params.token;
    if (!TELEGRAM_TOKEN || tokenParam !== TELEGRAM_TOKEN) {
      return res.sendStatus(403);
    }
    const body = req.body;
    const message = body.message || body.edited_message;
    if (!message) return res.sendStatus(200);

    const chatId = message.chat.id;
    const username = message.from?.username || `${message.from?.first_name || ""} ${message.from?.last_name || ""}`.trim();

    if ((message.text || "").trim() === "/start") {
      // upsert user
      await pool.query(
        `INSERT INTO users (telegram_id, username) VALUES ($1, $2)
         ON CONFLICT (telegram_id) DO UPDATE SET username = EXCLUDED.username;`,
        [String(chatId), username]
      );

      // send message with WebApp button
      await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
        chat_id: chatId,
        text: "🎮 خوش آمدی! برای ورود به بازی روی دکمه زیر بزن.",
        reply_markup: {
          inline_keyboard: [
            [
              { text: "🚀 ورود به Mini App", web_app: { url: WEB_APP_URL } }
            ]
          ]
        }
      });
    }
  } catch (err) {
    console.error("webhook error:", err?.message || err);
  }
  res.sendStatus(200);
});

// ----------------- API: create session (single-player) -----------------
app.get("/api/session/start", async (req, res) => {
  try {
    // pick random word from DB
    const wr = await pool.query(`SELECT id, word, category, creator FROM words ORDER BY RANDOM() LIMIT 1;`);
    if (wr.rows.length === 0) return res.status(500).json({ ok: false, error: "no_words" });

    const wordRow = wr.rows[0];
    const word = wordRow.word;
    const length = Array.from(word).length;
    const totalAllowedTime = Math.max(20, length * 8); // e.g., 8 sec per char, min 20s

    const sessionId = uuidv4();
    const revealed = Array.from({ length }, () => false);

    sessions.set(sessionId, {
      word,
      revealed,
      guesses: [],
      startAt: null,
      totalAllowedTime,
      category: wordRow.category || "—",
      creator: wordRow.creator || "—",
      length,
      finished: false,
      correctCount: 0,
      createdAt: Date.now(),
    });

    // return metadata (do NOT return the word)
    return res.json({
      ok: true,
      sessionId,
      length,
      category: wordRow.category,
      creator: wordRow.creator,
      totalAllowedTime,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

// ----------------- API: start timer (marks startAt) -----------------
app.post("/api/session/startTimer", (req, res) => {
  const { sessionId } = req.body;
  const s = sessions.get(sessionId);
  if (!s) return res.status(404).json({ ok: false, error: "session_not_found" });
  if (!s.startAt) s.startAt = Math.floor(Date.now() / 1000);
  return res.json({ ok: true, startedAt: s.startAt });
});

// ----------------- API: guess a letter -----------------
app.post("/api/session/guess", (req, res) => {
  try {
    const { sessionId, letter } = req.body;
    if (!sessionId || !letter) return res.status(400).json({ ok: false, error: "invalid_payload" });

    const s = sessions.get(sessionId);
    if (!s) return res.status(404).json({ ok: false, error: "session_not_found" });
    if (s.finished) return res.status(400).json({ ok: false, error: "session_finished" });

    // start time check
    if (s.startAt) {
      const elapsed = Math.floor(Date.now() / 1000) - s.startAt;
      s.remainingTime = Math.max(0, s.totalAllowedTime - elapsed);
      if (s.remainingTime <= 0) {
        s.finished = true;
      }
    }

    const normalized = String(letter).trim();
    if (s.guesses.includes(normalized)) {
      return res.json({ ok: true, duplicate: true, guesses: s.guesses, revealed: s.revealed, remainingTime: s.remainingTime || s.totalAllowedTime });
    }
    s.guesses.push(normalized);

    // find positions
    const positions = [];
    Array.from(s.word).forEach((ch, idx) => {
      if (ch === normalized) {
        positions.push(idx);
        if (!s.revealed[idx]) {
          s.revealed[idx] = true;
          s.correctCount += 1;
        }
      }
    });

    // if all revealed
    if (s.revealed.every(Boolean)) {
      s.finished = true;
    }

    return res.json({
      ok: true,
      positions,
      revealed: s.revealed,
      guesses: s.guesses,
      remainingTime: s.remainingTime || s.totalAllowedTime,
      finished: s.finished,
      correctCount: s.correctCount,
      length: s.length,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

// ----------------- API: hint (reveals one letter, costs 2 guesses) -----------------
app.post("/api/session/hint", (req, res) => {
  try {
    const { sessionId } = req.body;
    const s = sessions.get(sessionId);
    if (!s) return res.status(404).json({ ok: false, error: "session_not_found" });
    if (s.finished) return res.status(400).json({ ok: false, error: "session_finished" });

    // add two penalty markers
    s.guesses.push("__HINT__");
    s.guesses.push("__HINT__");

    // pick one unrevealed index
    const unrevealed = s.revealed.map((v, i) => (!v ? i : -1)).filter(i => i >= 0);
    if (unrevealed.length === 0) return res.json({ ok: false, error: "no_unrevealed" });

    const pick = unrevealed[Math.floor(Math.random() * unrevealed.length)];
    s.revealed[pick] = true;
    s.correctCount += 1;

    if (s.revealed.every(Boolean)) s.finished = true;

    return res.json({ ok: true, revealed: s.revealed, revealedIndex: pick, guesses: s.guesses, finished: s.finished });
  } catch (err) {
    console.error(err); return res.status(500).json({ ok: false, error: "server_error" });
  }
});

// ----------------- API: give up (reveal word) -----------------
app.post("/api/session/giveup", (req, res) => {
  const { sessionId } = req.body;
  const s = sessions.get(sessionId);
  if (!s) return res.status(404).json({ ok: false, error: "session_not_found" });
  s.finished = true;
  return res.json({ ok: true, gaveUp: true, word: s.word });
});

// ----------------- API: finish & compute score -----------------
app.post("/api/session/finish", async (req, res) => {
  try {
    const { sessionId, telegram_id, username, action } = req.body; // action: 'completed'|'timeout'|'giveup'
    const s = sessions.get(sessionId);
    if (!s) return res.status(404).json({ ok: false, error: "session_not_found" });

    const started = s.startAt || Math.floor(Date.now() / 1000);
    const elapsed = Math.min(Math.floor(Date.now() / 1000) - started, s.totalAllowedTime);
    const hintPenalty = s.guesses.filter(g => g === "__HINT__").length;

    let score = 0;
    if (action === "giveup") {
      score = 0;
    } else {
      // scoring: base per correct letter + time bonus - hint penalty
      const base = s.correctCount * 300;
      const timeBonus = Math.max(0, s.totalAllowedTime - elapsed) * 4;
      const penalty = hintPenalty * 100;
      score = Math.max(0, Math.round(base + timeBonus - penalty));
    }

    // persist score
    if (telegram_id) {
      await pool.query(
        `INSERT INTO scores (telegram_id, username, score, correct_letters, total_letters, elapsed_sec)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [String(telegram_id), username || "", score, s.correctCount, s.length, elapsed]
      );

      // upsert user best_score
      await pool.query(
        `INSERT INTO users (telegram_id, username, best_score)
         VALUES ($1, $2, $3)
         ON CONFLICT (telegram_id) DO UPDATE SET username = EXCLUDED.username, best_score = GREATEST(users.best_score, EXCLUDED.best_score);`,
        [String(telegram_id), username || "", score]
      );
    }

    s.finished = true;
    // reveal the actual word for client
    return res.json({ ok: true, score, word: s.word, correctCount: s.correctCount, totalLetters: s.length, elapsed });
  } catch (err) {
    console.error(err); return res.status(500).json({ ok: false, error: "server_error" });
  }
});

// ----------------- API: leaderboard -----------------
app.get("/api/leaderboard", async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT username, best_score FROM users ORDER BY best_score DESC NULLS LAST LIMIT 20;`);
    return res.json(rows);
  } catch (err) {
    console.error(err); return res.status(500).json({ error: "server_error" });
  }
});

// health
app.get("/", (req, res) => res.send("WordlyGame server ✅"));

// start
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));

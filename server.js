require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const { Pool } = require('pg');
const axios = require('axios');

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

// ---------- PostgreSQL ----------
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function query(text, params) {
  return pool.query(text, params);
}

// ---------- ایجاد جداول ----------
async function initDB() {
  await query(`
    CREATE TABLE IF NOT EXISTS words (
      id SERIAL PRIMARY KEY,
      word TEXT NOT NULL,
      category TEXT,
      creator TEXT
    );
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS scores (
      id SERIAL PRIMARY KEY,
      telegram_id TEXT,
      username TEXT,
      score INT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS guess_logs (
      id SERIAL PRIMARY KEY,
      telegram_id TEXT,
      letter TEXT,
      correct BOOLEAN,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS games (
      id SERIAL PRIMARY KEY,
      creator_id TEXT,
      player_id TEXT,
      word_id INT REFERENCES words(id),
      status TEXT DEFAULT 'waiting',
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  console.log("✅ Database initialized");
}
initDB();

// ---------- API ----------

// کلمه تصادفی
app.get('/api/random-word', async (req,res)=>{
  try{
    const {rows} = await query('SELECT * FROM words ORDER BY RANDOM() LIMIT 1');
    res.json(rows[0]);
  } catch(e){ console.error(e); res.status(500).json({error:'DB error'});}
});

// ثبت امتیاز
app.post('/api/submit-score', async (req,res)=>{
  const {telegram_id, username, score} = req.body;
  try{
    await query('INSERT INTO scores(telegram_id, username, score) VALUES($1,$2,$3)',
      [telegram_id, username, score]);
    res.json({success:true});
  } catch(e){ console.error(e); res.status(500).json({error:'DB error'});}
});

// رتبه‌بندی
app.get('/api/leaderboard', async (req,res)=>{
  try{
    const {rows} = await query('SELECT username, MAX(score) as score FROM scores GROUP BY username ORDER BY score DESC LIMIT 10');
    res.json(rows);
  } catch(e){ console.error(e); res.status(500).json({error:'DB error'});}
});

// افزودن کلمه
app.post('/api/add-word', async (req,res)=>{
  const {word, category, creator} = req.body;
  try{
    await query('INSERT INTO words(word, category, creator) VALUES($1,$2,$3)', [word, category, creator]);
    res.json({success:true});
  } catch(e){ console.error(e); res.status(500).json({error:'DB error'});}
});

// ایجاد بازی دو نفره
app.post('/api/create-game', async (req,res)=>{
  const {creator_id, word_id} = req.body;
  try{
    const {rows} = await query(
      'INSERT INTO games(creator_id, word_id) VALUES($1,$2) RETURNING *',
      [creator_id, word_id]
    );
    res.json(rows[0]);
  } catch(e){ console.error(e); res.status(500).json({error:'DB error'});}
});

// پیوستن به بازی
app.post('/api/join-game', async (req,res)=>{
  const {game_id, player_id} = req.body;
  try{
    await query('UPDATE games SET player_id=$1, status=$2 WHERE id=$3', [player_id,'active',game_id]);
    
    // اطلاع به سازنده بازی در تلگرام
    const {rows} = await query('SELECT creator_id FROM games WHERE id=$1',[game_id]);
    const creator_id = rows[0].creator_id;
    await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id: creator_id,
      text: `🎮 یک بازیکن به بازی شما پیوست!`
    }).catch(err=>console.error("Telegram notification failed:", err.message));
    
    res.json({success:true});
  } catch(e){ console.error(e); res.status(500).json({error:'DB error'});}
});

// ---------- Webhook تلگرام ----------
app.post(`/webhook/${BOT_TOKEN}`, async (req,res)=>{
  const update = req.body;

  // اگر کاربر /start زد، دکمه WebApp را ارسال کن
  if(update.message && update.message.text === '/start'){
    const chat_id = update.message.chat.id;
    const username = update.message.from.username || update.message.from.first_name;

    await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id: chat_id,
      text: `سلام ${username}! برای شروع بازی روی دکمه زیر کلیک کن 🎮`,
      reply_markup: {
        inline_keyboard: [[
          { text: "🎮 شروع بازی", web_app: { url: "https://wordlybot.xo.je/index.html" } }
        ]]
      }
    }).catch(err => console.error("Telegram sendMessage failed:", err.message));
  }

  res.sendStatus(200);
});

// ---------- سرور ----------
app.listen(PORT, ()=>{
  console.log(`✅ WordlyGame server running on port ${PORT}`);
});

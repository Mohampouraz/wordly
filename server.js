const { Telegraf } = require('telegraf');
const express = require('express');
const cors = require('cors');
const { Client } = require('pg');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || "8217028556:AAFDNQfmRYuUnto4gb2dAUNyWjKanRZldfA";
const WEB_APP_URL = process.env.WEB_APP_URL || "https://wordlybot.xo.je";
const DATABASE_URL = process.env.DATABASE_URL || "postgresql://abolfazl:ZnczfHE6NUZWmPfYtPQjUdsuaseuFoHS@dpg-d3q9nrm3jp1c738f47pg-a.frankfurt-postgres.render.com/wordgame_lbh3";

// Express برای API
const app = express();
app.use(cors());
app.use(express.json());

// اتصال به DB
const client = new Client({ connectionString: DATABASE_URL });
client.connect();

// API برای اطلاعات کاربر (validate initData و ذخیره در DB)
app.post('/user-info', async (req, res) => {
  const { initData } = req.body;
  if (!initData) return res.status(400).json({ success: false, error: 'initData missing' });

  // ساده validate initData (در تولید، از hmac استفاده کن)
  const dataCheckString = initData.replace(/&hash=[^&]*/, ''); // حذف hash
  // TODO: hash رو چک کن با bot token

  try {
    // ذخیره در DB (مثال: جدول users)
    const query = 'INSERT INTO users (user_id, username, first_name, created_at) VALUES ($1, $2, $3, NOW()) ON CONFLICT (user_id) DO NOTHING';
    // فرض: جدول users با ستون‌های user_id (unique), username, first_name, created_at داری
    // اطلاعات رو از initData parse کن
    const userData = new URLSearchParams(initData.split('&')[0]); // ساده parse
    const userId = userData.get('user_id');
    const username = userData.get('username');
    const firstName = userData.get('first_name');

    await client.query(query, [userId, username, firstName]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.json({ success: false, error: 'DB error' });
  }
});

// Telegraf برای ربات
const bot = new Telegraf(TELEGRAM_TOKEN);

// هندل هر command (مثل /start یا هر command دیگه)
bot.command('start', (ctx) => {
  ctx.reply('خوش آمدید! روی دکمه زیر کلیک کنید:', {
    reply_markup: {
      inline_keyboard: [[{ text: 'باز کردن Mini App', web_app: { url: WEB_APP_URL } }]]
    }
  });
});

// هندل هر command دیگه (fallback)
bot.on('text', (ctx) => {
  if (ctx.message.text.startsWith('/')) {
    ctx.reply('دستور نامعتبر! از /start استفاده کنید:', {
      reply_markup: {
        inline_keyboard: [[{ text: 'باز کردن Mini App', web_app: { url: WEB_APP_URL } }]]
      }
    });
  }
});

bot.launch();

// Express رو روی پورت Render listen کن
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

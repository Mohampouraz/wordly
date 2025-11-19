// server.js
const express = require('express');
const path = require('path');
const { words } = require('./words'); // برای استفاده در آینده

const app = express();
// اطلاعات کانفیگ که شما ارائه دادید
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || "8217028556:AAFDNQfmRYuUnto4gb2dAUNyWjKanRZldfA";
const DATABASE_URL = process.env.DATABASE_URL || "postgresql://abolfazl:uADpBikvq08jFXFWHURmINea1L5oz389@dpg-d4bn1mer433s73d1tiug-a.frankfurt-postgres.render.com/wordlygame_yqt5";
const WEB_APP_URL = process.env.WEB_APP_URL || "https://wordlygame.onrender.com";

// پیکربندی پورت
const PORT = process.env.PORT || 3000;

// ****************************
// تعریف مسیرها و میدل‌ورها
// ****************************

// ارائه فایل‌های استاتیک از پوشه فعلی (برای index.html)
app.use(express.static(path.join(__dirname)));

// یک نمونه ساده از API برای گرفتن کلمات (اختیاری در این مرحله)
app.get('/api/words', (req, res) => {
    res.json(words);
});

// مسیر اصلی که index.html را سرویس می‌دهد
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ****************************
// راه‌اندازی سرور
// ****************************

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`Web App URL: ${WEB_APP_URL}`);
    console.log(`Configured Database URL: ${DATABASE_URL}`);
});

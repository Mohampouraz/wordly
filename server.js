// server.js
const express = require('express');
const path = require('path');
const { words } = require('./words'); // برای استفاده در آینده

const app = express();
// اطلاعات کانفیگ
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || "8217028556:AAFDNQfmRYuUnto4gb2dAUNyWjKanRZldfA";
const DATABASE_URL = process.env.DATABASE_URL || "postgresql://abolfazl:uADpBikvq08jFXFWHURmINea1L5oz389@dpg-d4bn1mer433s73d1tiug-a.frankfurt-postgres.render.com/wordlygame_yqt5";
const WEB_APP_URL = process.env.WEB_APP_URL || "https://wordlygame.onrender.com";

// پیکربندی پورت
const PORT = process.env.PORT || 3000;

// ****************************
// تعریف مسیرها و میدل‌ورها
// ****************************

// ۱. ارائه فایل‌های استاتیک از پوشه 'public'
// این خط مهم است! با این کار، Express فایل index.html، css و js را از پوشه public پیدا می‌کند.
app.use(express.static(path.join(__dirname, 'public')));

// ۲. مسیر اصلی (/)
// اگر index.html در پوشه public باشد، Express به طور خودکار آن را در مسیر '/' پیدا می‌کند.
// اما برای اطمینان و مدیریت بهتر مسیرها، می‌توانیم آن را صراحتاً تعریف کنیم:
app.get('/', (req, res) => {
    // از آنجا که از app.use(express.static) استفاده شده، نیازی به این خط نیست،
    // اما برای حالت‌هایی که می‌خواهید فایل خاصی را ارسال کنید، مفید است.
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ۳. مسیر تلگرام برای شروع بازی (/start)
// ربات تلگرام برای اجرای Web App از دستور /start استفاده می‌کند.
// اگر Web App شما به پارامترهای تلگرام نیاز دارد، آن‌ها را از req.query دریافت می‌کند.
app.get('/start', (req, res) => {
    // در اینجا می‌توانید لاگ‌برداری کنید یا پارامترهای ارسالی از تلگرام را ببینید.
    console.log('Received /start request from Telegram. Query params:', req.query);
    
    // Web App تلگرام معمولاً از طریق دکمه‌ای در ربات به URL اصلی هدایت می‌شود.
    // اما اگر بخواهید به طور صریح مسیر /start را مدیریت کنید:
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});


// ****************************
// راه‌اندازی سرور
// ****************************

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`Web App URL: ${WEB_APP_URL}`);
});

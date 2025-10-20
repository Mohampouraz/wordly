const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3000;

// آدرس دقیق فایل HTML روی هاست جداگانه شما
const EXTERNAL_HTML_URL = 'https://wordlybot.xo.je/index.html'; 

// تعریف مسیر اصلی
app.get('/', async (req, res) => {
    try {
        console.log(`Fetching HTML from: ${EXTERNAL_HTML_URL}`);
        
        // **دریافت محتوای HTML از هاست جداگانه**
        const response = await axios.get(EXTERNAL_HTML_URL, {
            // برای اطمینان از دریافت کامل محتوای باینری
            responseType: 'text' 
        });

        // تنظیم نوع محتوا برای مرورگر
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        
        // **ارسال محتوای HTML دریافتی به کاربر**
        res.send(response.data);

    } catch (error) {
        console.error('Error fetching HTML from external host:', error.message);
        
        // نمایش خطای عمومی در صورت عدم دسترسی به هاست خارجی
        res.status(502).send(`
            <!DOCTYPE html>
            <html lang="fa" dir="rtl">
            <head>
                <meta charset="UTF-8">
                <title>خطای سرویس</title>
                <style>body { font-family: Tahoma, sans-serif; text-align: center; direction: rtl; margin-top: 50px; background-color: #fcebeb; color: #cc0000; }</style>
            </head>
            <body>
                <h1>🛑 خطا در راه‌اندازی مینی‌اپ</h1>
                <p>سرور واسط (Render) نتوانست به فایل index.html روی هاست wordlybot.xo.je دسترسی پیدا کند.</p>
                <p>لطفاً از فعال بودن هاست wordlybot.xo.je/index.html مطمئن شوید.</p>
            </body>
            </html>
        `);
    }
});

app.listen(PORT, () => {
    console.log(`Reverse Proxy Server running on port ${PORT}`);
});

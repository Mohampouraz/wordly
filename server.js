// مطمئن شوید که قبلاً 'express' و 'axios' را نصب کرده‌اید (در package.json)
const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3000;

// *****************************************************************
// آدرس دقیق فایل HTML روی هاست جداگانه شما
const EXTERNAL_HTML_URL = 'https://wordlybot.xo.je/index.html'; 
// *****************************************************************

// تنظیم مسیر اصلی
app.get('/', async (req, res) => {
    try {
        console.log(`User request received. Fetching HTML from: ${EXTERNAL_HTML_URL}`);
        
        // --- نکته کلیدی: دریافت محتوای HTML از هاست دیگر ---
        const response = await axios.get(EXTERNAL_HTML_URL, {
            responseType: 'text' 
        });

        // تنظیم هدر برای اطمینان از نمایش صحیح زبان فارسی و HTML
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        
        // ارسال محتوای دریافتی به مرورگر کاربر
        res.send(response.data);

    } catch (error) {
        console.error('ERROR: Could not fetch external HTML:', error.message);
        
        // صفحه خطای ساده در صورت عدم موفقیت در برقراری ارتباط با هاست wordlybot.xo.je
        res.status(502).send("<h1>🛑 Error 502: Cannot load Mini App content. Check wordlybot.xo.je</h1>");
    }
});

app.listen(PORT, () => {
    console.log(`Reverse Proxy Server running on port ${PORT}`);
});

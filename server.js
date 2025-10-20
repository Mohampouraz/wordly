const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3000;
const EXTERNAL_HTML_URL = 'https://wordlybot.xo.je/index.html'; // آدرس هاست جداگانه شما

app.get('/', async (req, res) => {
    try {
        const response = await axios.get(EXTERNAL_HTML_URL, {
            responseType: 'text' 
        });

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(response.data);

    } catch (error) {
        // این خطا باید در لاگ‌های Render ظاهر شود
        console.error('ERROR: Axios failed to fetch content.', error.message); 
        
        // اگر خطایی رخ داد، یک پاسخ ساده به تلگرام برگردانده شود.
        res.status(500).send("<h1>[Internal Error] Server could not load content.</h1>");
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

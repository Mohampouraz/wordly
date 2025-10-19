import express from "express";
import bodyParser from "body-parser";
import axios from "axios";

const app = express();
app.use(bodyParser.json());

const TOKEN = "8217028556:AAFDNQfmRYuUnto4gb2dAUNyWjKanRZldfA";
const WEB_APP_URL = "https://wordlybot.jo.xe"; // لینک فرانت mini app

// Webhook endpoint
app.post(`/webhook/${TOKEN}`, async (req, res) => {
  const message = req.body.message;

  if (!message || !message.text) return res.sendStatus(200);

  const chatId = message.chat.id;
  const text = message.text;

  if (text === "/start") {
    await axios.post(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      chat_id: chatId,
      text: "خوش اومدی! برای شروع بازی روی دکمه زیر بزن 👇",
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "ورود به Mini App 🚀",
              web_app: { url: WEB_APP_URL }
            }
          ]
        ]
      }
    });
  }

  res.sendStatus(200);
});

// health check
app.get("/", (req, res) => res.send("Bot server running ✅"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

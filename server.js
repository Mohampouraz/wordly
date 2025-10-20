// server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import http from "http";
import { Server as SocketIOServer } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || "YOUR_TELEGRAM_TOKEN";
const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: { origin: "*" },
});

// ESM path helpers
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Serve static files
app.use(express.static("public"));

// Main route
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Socket.io
io.on("connection", (socket) => {
  console.log("⚡ New client connected");

  socket.on("user_data", (data) => {
    if (!data || !data.user) {
      socket.emit("welcome", { message: "❌ اطلاعات کاربر دریافت نشد!" });
      return;
    }

    const user = data.user;
    console.log("📩 User connected:", user);

    // Welcome message
    socket.emit("welcome", {
      message: `🌙 سلام ${user.first_name}! خوش آمدی به Wordly!`,
    });
  });

  socket.on("disconnect", () => {
    console.log("❌ Client disconnected");
  });
});

// Start server
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

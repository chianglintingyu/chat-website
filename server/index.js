// ====== 匯入模組 ======
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

// ====== 建立伺服器 ======
const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ====== 提供前端靜態檔案 ======
app.use(express.static(path.join(__dirname, '../client')));

// ====== Socket.io 事件 ======
io.on('connection', (socket) => {
  console.log('🟢 有人連線了');

  socket.on('chat message', (msg) => {
    console.log('📩 收到訊息：', msg);
    io.emit('chat message', msg); // 廣播給所有人
  });

  socket.on('disconnect', () => {
    console.log('🔴 使用者離線');
  });
});

// ====== 啟動伺服器 ======
const PORT = 3000;

// ⚡ 這裡關鍵：'0.0.0.0' 代表「接受所有 IP 的連線」
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 伺服器啟動： http://localhost:${PORT}`);
  console.log('🌐 同網路的人可用你的 IP 連線，例如：http://192.168.xxx.xxx:3000');
});


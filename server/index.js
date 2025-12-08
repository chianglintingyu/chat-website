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

  socket.on('join room', ({ room, name }) => {
    const targetRoom = room?.trim();
    if (!targetRoom) return;

    const previousRoom = socket.data.room;
    if (previousRoom === targetRoom) {
      socket.emit('room joined', targetRoom);
      return;
    }
    if (previousRoom) {
      socket.leave(previousRoom);
      socket.to(previousRoom).emit('system message', {
        room: previousRoom,
        text: `${socket.data.name || name || '有人'} 離開了房間`,
      });
    }

    socket.data.room = targetRoom;
    socket.data.name = name || socket.data.name || '匿名使用者';
    socket.join(targetRoom);
    socket.emit('room joined', targetRoom);
    socket.to(targetRoom).emit('system message', {
      room: targetRoom,
      text: `${socket.data.name} 加入了房間`,
    });
  });

  socket.on('chat message', (msg) => {
    const room = msg?.room?.trim() || socket.data.room;
    const text = msg?.text?.trim();
    if (!room || !text) return;

    const payload = {
      name: msg?.name || socket.data.name || '匿名使用者',
      text,
      room,
    };

    console.log(`📩 收到訊息（${room}）：`, payload.text);
    io.to(room).emit('chat message', payload); // 只廣播給同房間
  });

  socket.on('disconnect', () => {
    console.log('🔴 使用者離線');
    const room = socket.data.room;
    if (room) {
      socket.to(room).emit('system message', {
        room,
        text: `${socket.data.name || '有人'} 已離線`,
      });
    }
  });
});

// ====== 啟動伺服器 ======
const PORT = 3000;

// ⚡ 這裡關鍵：'0.0.0.0' 代表「接受所有 IP 的連線」
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 伺服器啟動： http://localhost:${PORT}`);
  console.log('🌐 同網路的人可用你的 IP 連線，例如：http://192.168.xxx.xxx:3000');
});

// server/index.js

require('dotenv').config();

// ====== 載入套件 ======
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const mongoose = require('mongoose');

// MongoDB model
const Message = require('./models/Message');

// ====== 建立伺服器 ======
const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ====== MongoDB Atlas 連線 ======
mongoose
  .connect(
    'mongodb+srv://Clarice:Clarice@clarice.bslpxvh.mongodb.net/chatDB?appName=Clarice',
    {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    }
  )
  .then(() => console.log('✅ MongoDB 連線成功'))
  .catch((err) => console.error('❌ MongoDB 連線失敗', err));

// ====== 提供前端靜態檔案 ======
app.use(express.static(path.join(__dirname, '../client')));

// ====== 房間資料（只存「房間 & 密碼」，不存訊息） ======
const rooms = {};

// 取得房間列表（不包含密碼）
function getRoomList() {
  return Object.keys(rooms).map((name) => {
    const room = io.sockets.adapter.rooms.get(name);
    return {
      name,
      hasPassword: !!rooms[name].password,
      userCount: room ? room.size : 0,
    };
  });
}

// ====== Socket.io ======
io.on('connection', (socket) => {
  console.log('使用者連線', socket.id);

  // 一進來先給房間列表
  socket.emit('roomList', getRoomList());

  // 建立房間
  socket.on('createRoom', ({ roomName, password }) => {
    roomName = (roomName || '').trim();
    if (!roomName) {
      socket.emit('createRoomResult', { ok: false, msg: '房間名稱不能空白' });
      return;
    }

    if (rooms[roomName]) {
      socket.emit('createRoomResult', {
        ok: false,
        msg: '房間已存在',
      });
      return;
    }

    rooms[roomName] = { password: password || null };

    socket.emit('createRoomResult', {
      ok: true,
      msg: '房間建立成功',
      roomName,
    });

    io.emit('roomList', getRoomList());
  });

  // ====== 加入房間（MongoDB 版） ======
  socket.on('joinRoom', async ({ roomName, password, username }) => {
    roomName = (roomName || '').trim();
    username = (username || '匿名').trim() || '匿名';

    const room = rooms[roomName];
    if (!room) {
      socket.emit('joinRoomResult', { ok: false, msg: '房間不存在' });
      return;
    }

    if (room.password && room.password !== password) {
      socket.emit('joinRoomResult', { ok: false, msg: '密碼錯誤' });
      return;
    }

    if (socket.currentRoom) {
      socket.leave(socket.currentRoom);
    }

    socket.join(roomName);
    socket.currentRoom = roomName;
    socket.username = username;

    try {
      // 從 MongoDB 撈歷史訊息
      const history = await Message.find({ roomName })
        .sort({ time: 1 })
        .limit(100);

      socket.emit('joinRoomResult', {
        ok: true,
        msg: '加入成功',
        roomName,
        messages: history.map((m) => ({
          id: m._id.toString(),
          user: m.user,
          type: m.type,
          content: m.content,
          time: m.time,
        })),
      });

      io.emit('roomList', getRoomList());
    } catch (err) {
      console.error(err);
      socket.emit('joinRoomResult', {
        ok: false,
        msg: '讀取歷史訊息失敗',
      });
    }
  });

  // ====== 發送訊息（MongoDB） ======
  socket.on('sendMessage', async ({ roomName, type, content }) => {
    if (!rooms[roomName]) return;

    try {
      const saved = await Message.create({
        roomName,
        user: socket.username || '匿名',
        type: type === 'image' ? 'image' : 'text',
        content,
        time: new Date(),
      });

      io.to(roomName).emit('newMessage', {
        roomName,
        message: {
          id: saved._id.toString(),
          user: saved.user,
          type: saved.type,
          content: saved.content,
          time: saved.time,
        },
      });
    } catch (err) {
      console.error('儲存訊息失敗', err);
    }
  });

  // ====== 刪除訊息（MongoDB） ======
  socket.on('deleteMessage', async ({ roomName, messageId }) => {
    try {
      await Message.deleteOne({ _id: messageId, roomName });
      io.to(roomName).emit('messageDeleted', { roomName, messageId });
    } catch (err) {
      console.error('刪除訊息失敗', err);
    }
  });

  socket.on('disconnect', () => {
    console.log('使用者離線', socket.id);
    io.emit('roomList', getRoomList());
  });
});

// ====== 啟動伺服器 ======
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`伺服器已啟動：http://localhost:${PORT}`);
});

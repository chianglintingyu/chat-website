// server/index.js
require('dotenv').config();

const express = require('express');
const http = require('http');
const path = require('path');
const mongoose = require('mongoose');
const { Server } = require('socket.io');
const bcrypt = require('bcrypt');

const Message = require('./models/Message');
const Room = require('./models/Room');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ===== 靜態檔案 =====
app.use(express.static(path.join(__dirname, '../client')));

// ===== 記憶體快取：只放「線上人數」相關 =====
// roomsCache = {
//   [roomName]: { passwordHash: string|null, users: Set<socketId> }
// }
const roomsCache = {};

// ===== 從 DB 載入房間到 roomsCache（重開伺服器仍可恢復房間清單）=====
async function loadRoomsFromDB() {
  const rooms = await Room.find({});
  for (const r of rooms) {
    if (!roomsCache[r.name]) {
      roomsCache[r.name] = { passwordHash: r.password || null, users: new Set() };
    } else {
      roomsCache[r.name].passwordHash = r.password || null;
    }
  }
  console.log(`✅ 已載入房間數：${rooms.length}`);
}

function getRoomList() {
  return Object.keys(roomsCache).map((name) => ({
    name,
    hasPassword: !!roomsCache[name].passwordHash,
    userCount: roomsCache[name].users.size,
  }));
}

// ===== MongoDB 連線 =====
mongoose
  .connect(process.env.MONGODB_URI)
  .then(async () => {
    console.log('✅ MongoDB 連線成功');
    await loadRoomsFromDB();
  })
  .catch((err) => console.error('❌ MongoDB 連線失敗', err));

// ===== Socket.io =====
io.on('connection', (socket) => {
  console.log('🔌 使用者連線', socket.id);

  // 一進來就給房間列表（來自 roomsCache）
  socket.emit('roomList', getRoomList());

  // 建立房間（存 DB + 更新 cache）
  socket.on('createRoom', async ({ roomName, password }) => {
    roomName = (roomName || '').trim();
    if (!roomName) {
      socket.emit('createRoomResult', { ok: false, msg: '房間名稱不能空白' });
      return;
    }

    try {
      const exists = await Room.findOne({ name: roomName });
      if (exists) {
        socket.emit('createRoomResult', { ok: false, msg: '房間已存在' });
        return;
      }

      let passwordHash = null;
      if (password) {
        passwordHash = await bcrypt.hash(password, 10);
      }

      await Room.create({
        name: roomName,
        password: passwordHash,
      });

      // 更新快取（人數用 users Set，重開會再載入）
      roomsCache[roomName] = roomsCache[roomName] || { users: new Set(), passwordHash: null };
      roomsCache[roomName].passwordHash = passwordHash;

      socket.emit('createRoomResult', { ok: true, msg: '房間建立成功', roomName });

      // 廣播更新房間列表
      io.emit('roomList', getRoomList());
    } catch (err) {
      console.error(err);
      socket.emit('createRoomResult', { ok: false, msg: '建立房間失敗' });
    }
  });

  // 加入房間（必要時從 DB 把房間載回 cache）
  socket.on('joinRoom', async ({ roomName, password, username }) => {
    roomName = (roomName || '').trim();
    username = (username || '匿名').trim() || '匿名';

    try {
      // 如果 cache 沒有這個房間，嘗試從 DB 找（重開伺服器後也能加入）
      if (!roomsCache[roomName]) {
        const roomFromDB = await Room.findOne({ name: roomName });
        if (!roomFromDB) {
          socket.emit('joinRoomResult', { ok: false, msg: '房間不存在' });
          return;
        }
        roomsCache[roomName] = { passwordHash: roomFromDB.password || null, users: new Set() };
      }

      // 檢查密碼（bcrypt compare）
      const passwordHash = roomsCache[roomName].passwordHash;
      if (passwordHash) {
        const ok = await bcrypt.compare(password || '', passwordHash);
        if (!ok) {
          socket.emit('joinRoomResult', { ok: false, msg: '密碼錯誤' });
          return;
        }
      }

      // 離開舊房間（更新舊房間人數）
      if (socket.currentRoom && roomsCache[socket.currentRoom]) {
        roomsCache[socket.currentRoom].users.delete(socket.id);
        socket.leave(socket.currentRoom);
      }

      // 加入新房間（更新人數）
      socket.join(roomName);
      socket.currentRoom = roomName;
      socket.username = username;
      roomsCache[roomName].users.add(socket.id);

      // 撈 DB 歷史訊息
      const history = await Message.find({ roomName }).sort({ time: 1 }).limit(100);

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

      // 更新房間列表（讓人數 0→1 立刻顯示）
      io.emit('roomList', getRoomList());
    } catch (err) {
      console.error(err);
      socket.emit('joinRoomResult', { ok: false, msg: '加入房間失敗' });
    }
  });

  // 發送訊息（文字/圖片）：存 DB + 即時廣播
  socket.on('sendMessage', async ({ roomName, type, content }) => {
    if (!roomName) return;

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
      console.error('❌ 儲存訊息失敗', err);
    }
  });

  // 刪除訊息：刪 DB + 即時廣播
  socket.on('deleteMessage', async ({ roomName, messageId }) => {
    try {
      await Message.deleteOne({ _id: messageId, roomName });
      io.to(roomName).emit('messageDeleted', { roomName, messageId });
    } catch (err) {
      console.error('❌ 刪除訊息失敗', err);
    }
  });

  // 離線：扣人數 + 更新房間列表
  socket.on('disconnect', () => {
    if (socket.currentRoom && roomsCache[socket.currentRoom]) {
      roomsCache[socket.currentRoom].users.delete(socket.id);
    }
    io.emit('roomList', getRoomList());
    console.log('❌ 使用者離線', socket.id);
  });
});

// ===== 啟動 =====
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 伺服器啟動：http://localhost:${PORT}`);
});

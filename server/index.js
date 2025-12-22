// server/index.js
// ====== 載入套件 ======
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { v4: uuidv4 } = require('uuid'); // 用來產生訊息 id

// ====== 建立伺服器 ======
const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ====== 提供前端靜態檔案 ======
app.use(express.static(path.join(__dirname, '../client')));

// ====== 房間資料 in memory ======
// rooms = {
//   '房間名': {
//      password: '123',
//      messages: [ { id, user, type, content, time } ]
//   }
// }
const rooms = {};

// 取得送到前端的房間列表（不要把密碼送出去）
function getRoomList() {
  return Object.keys(rooms).map((name) => {
    // 計算房間目前在線人數（可選）
    const room = io.sockets.adapter.rooms.get(name);
    const userCount = room ? room.size : 0;

    return {
      name,
      hasPassword: !!rooms[name].password,
      userCount,
    };
  });
}

// ====== Socket.io 事件 ======
io.on('connection', (socket) => {
  console.log('有使用者連線', socket.id);

  // 一連進來就給他房間列表
  socket.emit('roomList', getRoomList());

  // 使用者要求重新拿房間列表（通常不太需要，但備用）
  socket.on('getRooms', () => {
    socket.emit('roomList', getRoomList());
  });

  // 建立房間
  socket.on('createRoom', ({ roomName, password }) => {
    roomName = (roomName || '').trim();

    if (!roomName) {
      socket.emit('createRoomResult', {
        ok: false,
        msg: '房間名稱不能空白',
      });
      return;
    }

    if (rooms[roomName]) {
      socket.emit('createRoomResult', {
        ok: false,
        msg: '房間已存在，請換一個名稱',
      });
      return;
    }

    rooms[roomName] = {
      password: password || null,
      messages: [],
    };

    console.log(`建立房間：${roomName}`);

    socket.emit('createRoomResult', {
      ok: true,
      msg: '房間建立成功',
      roomName,
    });

    // 廣播更新房間列表給所有人
    io.emit('roomList', getRoomList());
  });

  // 加入房間
  socket.on('joinRoom', ({ roomName, password, username }) => {
    roomName = (roomName || '').trim();
    username = (username || '匿名').trim() || '匿名';

    const room = rooms[roomName];
    if (!room) {
      socket.emit('joinRoomResult', {
        ok: false,
        msg: '房間不存在',
      });
      return;
    }

    if (room.password && room.password !== password) {
      socket.emit('joinRoomResult', {
        ok: false,
        msg: '密碼錯誤',
      });
      return;
    }

    // 離開舊房間（如果有）
    if (socket.currentRoom) {
      socket.leave(socket.currentRoom);
    }

    socket.join(roomName);
    socket.currentRoom = roomName;
    socket.username = username;

    console.log(`${username} 加入房間：${roomName}`);

    socket.emit('joinRoomResult', {
      ok: true,
      msg: '加入成功',
      roomName,
      // 把目前房間的歷史訊息給他
      messages: room.messages,
    });

    // 更新房間列表給所有人（人數可能變動）
    io.emit('roomList', getRoomList());
  });

  // 發送訊息（文字或圖片）
  socket.on('sendMessage', ({ roomName, type, content }) => {
    const room = rooms[roomName];
    if (!room) return;

    const message = {
      id: uuidv4(), // 訊息唯一 id
      user: socket.username || '匿名',
      type: type === 'image' ? 'image' : 'text',
      content,
      time: new Date().toISOString(), // ISO 字串，前端再轉成本地時間
    };

    // 存在房間歷史記錄中（讓後來加入的人看得到）
    room.messages.push(message);

    // 廣播給該房間所有人
    io.to(roomName).emit('newMessage', {
      roomName,
      message,
    });
  });

  // 刪除訊息
  socket.on('deleteMessage', ({ roomName, messageId }) => {
    const room = rooms[roomName];
    if (!room) return;

    room.messages = room.messages.filter((m) => m.id !== messageId);

    // 告訴房間裡所有人這則訊息被刪掉
    io.to(roomName).emit('messageDeleted', {
      roomName,
      messageId,
    });
  });

  socket.on('disconnect', () => {
    console.log('使用者離線', socket.id);
    // 人數有變，更新房間列表給所有人
    io.emit('roomList', getRoomList());
  });
});

// ====== 啟動伺服器 ======
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`伺服器已啟動：http://localhost:${PORT}`);
});

// server/index.js

const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", 
  },
  maxHttpBufferSize: 1e7 
});

// ===== 靜態檔案 =====
app.use(express.static(path.join(__dirname, '../client')));
app.use(express.json({ limit: '50mb' }));

// ===== data.json 設定 =====
const DATA_PATH = path.join(__dirname, 'data.json');

function loadData() {
  return JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
}

function saveData(data) {
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
}

if (!fs.existsSync(DATA_PATH)) {
  const defaultData = { users: {}, rooms: {}, messages: [] };
  saveData(defaultData);
}

// ===== 記憶體快取（只存線上人數） =====
const roomsCache = {};

// ===== 啟動時載入 rooms =====
function loadRoomsFromFile() {
  const data = loadData();
  for (const roomName in data.rooms) {
    roomsCache[roomName] = {
      passwordHash: data.rooms[roomName].password || null,
      users: new Set(),
    };
  }
  console.log(`✅ 已載入房間數：${Object.keys(data.rooms).length}`);
}

loadRoomsFromFile();

// 👇 [新增] 1. 確保有一個公共大廳 (如果沒有就建立)
  const initLobby = () => {
    const data = loadData();
    if (!data.rooms['public_lobby']) {
      data.rooms['public_lobby'] = {
        password: null,
        admin: 'SYSTEM',
        members: [],
        memberNicknames: {},
        displayName: '公共留言板'
      };
      saveData(data);
      if (roomsCache) roomsCache['public_lobby'] = { users: new Set() };
    }
  };
  initLobby(); // 每次連線都檢查一下 (雖然有點多餘但保險)

// ===== 取得房間列表 (修改：過濾掉 public_lobby) =====
function getRoomList() {
  const data = loadData();
  return Object.keys(data.rooms)
    .filter(key => key !== 'public_lobby') 
    .map((key) => {
      const room = data.rooms[key];
      return {
        name: room.displayName || key,
        realName: key, 
        hasPassword: !!room.password,
        members: room.members || [],
        memberCount: room.members ? room.members.length : 0,
      };
    });
}

/* =====================
   帳號系統（API）
===================== */

app.post('/api/register', async (req, res) => {
  const { email, password, nickname } = req.body;
  if (!email || !password || !nickname) return res.json({ ok: false, msg: '資料不完整' });
  const data = loadData();
  if (data.users[email]) return res.json({ ok: false, msg: '帳號已存在' });
  const passwordHash = await bcrypt.hash(password, 10);
  data.users[email] = { email, passwordHash, nickname };
  saveData(data);
  res.json({ ok: true });
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  const data = loadData();
  const user = data.users[email];
  if (!user) return res.json({ ok: false, msg: '帳號不存在' });
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.json({ ok: false, msg: '密碼錯誤' });
  res.json({
    ok: true,
    user: {
      email,
      nickname: user.nickname,
      avatar: user.avatar || null 
    },
  });
});

app.post('/api/updateProfile', async (req, res) => {
  const { email, nickname, avatar } = req.body;
  const data = loadData();
  const user = data.users[email];
  if (!user) return res.json({ ok: false, msg: '找不到使用者' });
  if (nickname) user.nickname = nickname;
  if (avatar !== undefined) user.avatar = avatar; 
  saveData(data);
  res.json({ 
    ok: true, 
    user: { email: user.email, nickname: user.nickname, avatar: user.avatar || null }
  });
});

/* =====================
   Socket.io
===================== */

io.on('connection', (socket) => {
  console.log('🔌 使用者連線', socket.id);

  

  // 👇 [新增] 2. 進入大廳事件
  socket.on('enterLobby', (user) => {
    if (!user || !user.email) return;

    const data = loadData();
    const roomName = 'public_lobby';
    const room = data.rooms[roomName];
    
    // 綁定使用者資訊 (這樣才能發言)
    socket.userEmail = user.email;
    socket.username = user.nickname;
    socket.currentRoom = roomName;
    socket.join(roomName);

    // 紀錄線上人數
    if (!roomsCache[roomName]) roomsCache[roomName] = { users: new Set() };
    roomsCache[roomName].users.add(socket.id);

    // 撈取歷史訊息
    const history = data.messages
      .filter((m) => m.roomName === roomName)
      .slice(-100) // 取最後 100 則
      .map(msg => {
          // 大廳不顯示群組暱稱，直接顯示原名
          return { ...msg, user: data.users[msg.senderEmail]?.nickname || msg.user };
      });

    socket.emit('enterLobbyResult', {
      roomName,
      displayName: room.displayName,
      messages: history
    });
  });

  socket.emit('roomList', getRoomList());

  // ===== 建立房間 =====
  // ===== 建立房間 (修改：使用亂數 ID，避免名稱被佔用) =====
  socket.on('createRoom', async ({ roomName, password, creatorEmail }) => {
    roomName = (roomName || '').trim();
    if (!roomName) return socket.emit('createRoomResult', { ok: false, msg: '房間名稱不能空白' });

    const data = loadData();

    // 1. [修改] 檢查「顯示名稱」是否重複 (而不是檢查 Key)
    const nameExists = Object.values(data.rooms).some(r => r.displayName === roomName);
    if (nameExists) {
      return socket.emit('createRoomResult', { ok: false, msg: '此房間名稱已被使用' });
    }

    // 2. [修改] 產生一個唯一的亂數 ID (例如 room_173599xxxx)
    const roomId = 'room_' + Date.now(); 

    let passwordHash = null;
    if (password) passwordHash = await bcrypt.hash(password, 10);

    // 3. [修改] 使用 ID 當作資料庫的 Key，名稱存在 displayName 裡
    data.rooms[roomId] = {
      password: passwordHash,
      admin: creatorEmail,   
      members: [creatorEmail], 
      memberNicknames: {} ,   
      displayName: roomName 
    };
    saveData(data);
    
    // 初始化快取 (用 ID)
    roomsCache[roomId] = { users: new Set() }; 
    
    // 回傳時把 ID 傳回去，讓前端可以選中
    socket.emit('createRoomResult', { ok: true, msg: '建立成功', roomName: roomId ,displayName: roomName});
    io.emit('roomList', getRoomList());
  });

  // ===== 加入房間 =====
  // ===== 加入房間 (修改：支援 ID 或名稱搜尋) =====
  socket.on('joinRoom', async ({ roomName, password, user }) => {
    if (!user || !user.email) return socket.emit('joinRoomResult', { ok: false, msg: '請先登入' });
    
    const data = loadData();
    
    // 👇 [關鍵修改] 智慧搜尋：前端傳來的 roomName 可能是 ID (點列表) 或 名稱 (手動輸入)
    // 1. 先假設它是 ID，直接找
    let targetId = roomName;
    let room = data.rooms[targetId];

    // 2. 如果找不到，就當作它是「顯示名稱」，去搜尋對應的 ID
    if (!room) {
       const foundId = Object.keys(data.rooms).find(key => data.rooms[key].displayName === roomName);
       if (foundId) {
          targetId = foundId;
          room = data.rooms[targetId];
       }
    }

    if (!room) return socket.emit('joinRoomResult', { ok: false, msg: '房間不存在' });

    const isMember = room.members && room.members.includes(user.email);

    if (room.password && !isMember) {
      const ok = await bcrypt.compare(password || '', room.password);
      if (!ok) return socket.emit('joinRoomResult', { ok: false, msg: '密碼錯誤' });
    }

    if (!room.members) room.members = [];
    if (!room.members.includes(user.email)) {
      room.members.push(user.email);
      saveData(data);

      const msg = {
        id: Date.now().toString(),
        roomName: targetId, // 👈 [修改] 確保使用 ID
        type: 'system',
        content: `${user.nickname} 加入了群組`,
        time: new Date()
      };
      data.messages.push(msg);
      saveData(data);
      io.to(targetId).emit('newMessage', { roomName: targetId, message: msg });
    }

    socket.join(targetId); // 👈 [修改] 加入 ID 房間
    socket.currentRoom = targetId;
    socket.userEmail = user.email; 
    socket.username = user.nickname; 

    if (!roomsCache[targetId]) roomsCache[targetId] = { users: new Set() };
    roomsCache[targetId].users.add(socket.id);

    const history = data.messages
      .filter((m) => m.roomName === targetId) // 👈 [修改] 撈取該 ID 的訊息
      .slice(-100)
      .map(msg => {
        let displayUser = msg.user;
        if (msg.senderEmail && room.memberNicknames && room.memberNicknames[msg.senderEmail]) {
            displayUser = room.memberNicknames[msg.senderEmail];
        }
        return { ...msg, user: displayUser };
      });

    socket.emit('joinRoomResult', { 
      ok: true, 
      msg: '加入成功', 
      roomName: targetId, // 👈 [修改] 回傳 ID 給前端紀錄
      displayName: room.displayName || targetId, 
      messages: history,
      isAdmin: room.admin === user.email 
    });

    io.emit('roomList', getRoomList());
  });

  // ===== 發送訊息 =====
  socket.on('sendMessage', ({ roomName, type, content, fileName }) => {
    if (!socket.userEmail) return; 
    const data = loadData();
    const room = data.rooms[roomName];
    const originalNick = data.users[socket.userEmail].nickname;
    const groupNick = (room.memberNicknames && room.memberNicknames[socket.userEmail]) || originalNick;

    const message = {
      id: Date.now().toString(),
      roomName,
      user: groupNick,     
      senderEmail: socket.userEmail, 
      avatar: data.users[socket.userEmail].avatar,
      type: type === 'image' ? 'image' : (type === 'file' ? 'file' : 'text'),
      content,
      fileName: fileName || '',
      time: new Date(),
    };

    data.messages.push(message);
    saveData(data);
    io.to(roomName).emit('newMessage', { roomName, message });
  });

  // ===== 刪除訊息 =====
  socket.on('deleteMessage', ({ roomName, messageId }) => {
    const data = loadData();
    data.messages = data.messages.filter((m) => m.id !== messageId);
    saveData(data);
    io.to(roomName).emit('messageDeleted', { roomName, messageId });
  });

  // ===== 離線 =====
  socket.on('disconnect', () => {
    if (socket.currentRoom && roomsCache[socket.currentRoom]) {
      roomsCache[socket.currentRoom].users.delete(socket.id);
    }
    io.emit('roomList', getRoomList());
    console.log('❌ 使用者離線', socket.id);
  });

  // ===== 新功能區塊 =====

  // 4. 取得群組設定 (成員列表)
  socket.on('getRoomSettings', (roomName) => {
    const data = loadData();
    const room = data.rooms[roomName];
    if (!room) return;

    // [修正] 移除了錯誤的「使用者退出」廣播代碼

    const membersDetails = (room.members || []).map(email => {
      const u = data.users[email];
      return {
        email,
        nickname: u ? u.nickname : 'Unknown', 
        groupNickname: (room.memberNicknames && room.memberNicknames[email]) || '',
        avatar: u ? u.avatar : null,
        isAdmin: room.admin === email
      };
    });

    socket.emit('roomSettingsData', {
      roomName,
      displayName: room.displayName || roomName,
      admin: room.admin,
      members: membersDetails
    });
  });

  // 5. 踢出成員
  socket.on('kickMember', ({ roomName, targetEmail }) => {
    const data = loadData();
    const room = data.rooms[roomName];
    if (room.admin !== socket.userEmail) return; 

    room.members = room.members.filter(e => e !== targetEmail);
    const targetUser = data.users[targetEmail];
    const msg = {
          id: Date.now().toString(),
          roomName, type: 'system',
          content: `${targetUser ? targetUser.nickname : targetEmail} 已被移出群組`,
          time: new Date()
      };
      data.messages.push(msg);
      saveData(data);
      io.to(roomName).emit('newMessage', { roomName, message: msg });
    
    if (room.memberNicknames) delete room.memberNicknames[targetEmail];
    
    saveData(data);
    io.to(roomName).emit('memberListUpdated'); 
  });

  // 6. 更改群組成員暱稱
  socket.on('updateMemberNickname', ({ roomName, targetEmail, newNickname }) => {
    const data = loadData();
    const room = data.rooms[roomName];
    
    if (!room.memberNicknames) room.memberNicknames = {};
    room.memberNicknames[targetEmail] = newNickname;
    saveData(data);
    
    io.to(roomName).emit('memberListUpdated');
  });

  // 7. 退出群組
  socket.on('leaveGroup', ({ roomName }) => {
    const data = loadData();
    const room = data.rooms[roomName];
    if (!room) return;

    room.members = room.members.filter(e => e !== socket.userEmail);
    
    if (room.admin === socket.userEmail) {
      if (room.members.length > 0) {
        room.admin = room.members[0]; 
      } else {
        delete data.rooms[roomName]; 
      }
    }
    
    // 發送退出通知
    const userNick = (room.memberNicknames && room.memberNicknames[socket.userEmail]) || data.users[socket.userEmail].nickname;
    const msg = {
        id: Date.now().toString(),
        roomName, type: 'system',
        content: `${userNick} 已退出群組`,
        time: new Date()
    };
    data.messages.push(msg);
    saveData(data);
    io.to(roomName).emit('newMessage', { roomName, message: msg });

    socket.leave(roomName);
    socket.emit('leftGroupSuccess');
    io.emit('roomList', getRoomList());
  });

  // 8. 解散群組
  socket.on('deleteGroup', ({ roomName }) => {
    const data = loadData();
    const room = data.rooms[roomName];
    if (room.admin !== socket.userEmail) return;

    delete data.rooms[roomName];
    data.messages = data.messages.filter(m => m.roomName !== roomName);
    
    saveData(data);
    io.to(roomName).emit('groupDeleted');
    io.emit('roomList', getRoomList());
  });
  
  // [新增] 更改群組名稱
  // [新增] 更改群組名稱 (修正版：防止伺服器重啟後崩潰)
  socket.on('changeGroupName', ({ roomName, newName }) => {
    // 1. 安全檢查：如果伺服器忘記你是誰 (例如剛重啟)，就直接擋掉，避免崩潰
    if (!socket.userEmail) return; 

    const data = loadData();
    const room = data.rooms[roomName];
    if (!room) return;
    
    room.displayName = newName;
    saveData(data);
    
    // 2. 安全取得暱稱 (多一層保護：確認 user 存在才讀取 nickname)
    const user = data.users[socket.userEmail];
    const originalNick = user ? user.nickname : 'Unknown'; // 如果找不到人，就叫 Unknown
    
    const actorNick = (room.memberNicknames && room.memberNicknames[socket.userEmail]) || originalNick;
    
    const msg = {
        id: Date.now().toString(),
        roomName, type: 'system',
        content: `${actorNick} 將群組名稱更改為「${newName}」`,
        time: new Date()
    };
    data.messages.push(msg);
    saveData(data);
    io.to(roomName).emit('newMessage', { roomName, message: msg });
    
    io.to(roomName).emit('roomInfoUpdated', { newName });
    io.emit('roomList', getRoomList());
  });

  // [新增] 邀請成員
  // [修改] 邀請成員 (只發送通知，不直接加入)
  // [修改] 邀請成員 (增強版：防止崩潰 + 離線提示)
  socket.on('inviteMember', async ({ roomName, targetNickname }) => {
    // 1. 安全檢查：如果伺服器重啟過，socket.userEmail 會不見導致崩潰
    if (!socket.userEmail) {
        // 借用既有的 alert 事件告訴前端
        socket.emit('createRoomResult', { ok: false, msg: '連線資料已過期，請重新整理網頁後再試！' }); 
        return;
    }

    const data = loadData();
    const room = data.rooms[roomName];
    
    // 2. 找人 (檢查暱稱是否存在)
    const targetUser = Object.values(data.users).find(u => u.nickname === targetNickname);
    
    if (!targetUser) {
        socket.emit('createRoomResult', { ok: false, msg: `找不到暱稱為「${targetNickname}」的使用者` });
        return; 
    }

    // 3. 檢查是否已經在群組
    if (room.members && room.members.includes(targetUser.email)) {
        socket.emit('createRoomResult', { ok: false, msg: '該使用者已經在群組內了' });
        return; 
    }

    // 4. 找出對方的 Socket ID (檢查對方是否在線上)
    const sockets = await io.fetchSockets();
    const targetSocket = sockets.find(s => s.userEmail === targetUser.email);

    if (targetSocket) {
      // 只有在確定 socket.userEmail 存在後，才讀取暱稱
      const inviterNick = data.users[socket.userEmail].nickname;
      
      targetSocket.emit('receiveInvitation', {
        roomName,
        roomDisplayName: room.displayName || roomName,
        inviter: inviterNick
      });
      
      // 告訴邀請者發送成功
      socket.emit('createRoomResult', { ok: true, msg: `已發送邀請給 ${targetNickname}！` });
    } else {
      // 對方不在線上
      socket.emit('createRoomResult', { ok: false, msg: `發送失敗：${targetNickname} 目前不在線上` });
    }
  });

  // [新增] 接受邀請 (對方按下同意後觸發)
  socket.on('acceptInvite', ({ roomName }) => {
    const data = loadData();
    const room = data.rooms[roomName];
    if (!room) return;

    // 將使用者加入資料庫
    if (!room.members) room.members = [];
    if (!room.members.includes(socket.userEmail)) {
      room.members.push(socket.userEmail);
      
      // 發送系統訊息
      const userNick = data.users[socket.userEmail].nickname;
      const msg = {
        id: Date.now().toString(),
        roomName, type: 'system',
        content: `${userNick} 加入了群組`,
        time: new Date()
      };
      data.messages.push(msg);
      saveData(data);
      io.to(roomName).emit('newMessage', { roomName, message: msg });
    }

    // 告訴前端：加入成功，請自動跳轉
    socket.emit('inviteAccepted', { roomName });
    io.emit('roomList', getRoomList());
  });

}); // end of io.on connection

// [修正] server.listen 必須移到 io.on 外面
const PORT = 3000;
server.listen(PORT, () => {
  console.log(`🚀 伺服器啟動：http://localhost:${PORT}`);
});
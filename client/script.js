// client/script.js

// 連線到後端 Socket.io
const socket = io();

// ====== DOM 元素 ======
const roomListEl = document.getElementById('roomList');
const usernameInput = document.getElementById('usernameInput');
const roomNameInput = document.getElementById('roomNameInput');
const roomPasswordInput = document.getElementById('roomPasswordInput');
const createRoomBtn = document.getElementById('createRoomBtn');
const joinRoomBtn = document.getElementById('joinRoomBtn');

const currentRoomTitle = document.getElementById('currentRoomTitle');
const messagesEl = document.getElementById('messages');
const messageInput = document.getElementById('messageInput');
const imageInput = document.getElementById('imageInput');
const sendBtn = document.getElementById('sendBtn');

const chatForm = document.getElementById('chatForm');

chatForm.addEventListener('submit', (e) => {
  e.preventDefault();   // ⭐ 防止表單刷新頁面
  sendTextMessage();    // ⭐ 只從這裡送訊息
});

// ====== 狀態 ======
let currentRoom = null;

// ====== 工具函式 ======

// 轉成「HH:MM」時間
function formatTime(isoString) {
  const d = new Date(isoString);
  return d.toLocaleTimeString('zh-TW', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

// 在畫面上渲染房間列表
function renderRoomList(rooms) {
  roomListEl.innerHTML = '';

  rooms.forEach((room) => {
    const li = document.createElement('li');
    li.className = 'room-item';

    const lockIcon = room.hasPassword ? ' 🔒' : '';
    const countText =
      typeof room.userCount === 'number' ? `（${room.userCount}人）` : '';

    li.textContent = `${room.name}${lockIcon} ${countText}`;

    // 點房間名稱 → 自動填入輸入框
    li.addEventListener('click', () => {
      roomNameInput.value = room.name;
    });

    roomListEl.appendChild(li);
  });
}

// 在畫面上新增一則訊息
function addMessageToUI(message) {
  const wrapper = document.createElement('div');
  wrapper.className = 'message';
  wrapper.dataset.id = message.id;

  const header = document.createElement('div');
  header.className = 'message-header';
  header.textContent = `${message.user} · ${formatTime(message.time)}`;

  const body = document.createElement('div');
  body.className = 'message-body';

  if (message.type === 'image') {
    const img = document.createElement('img');
    img.src = message.content; // base64 dataURL
    img.className = 'message-image';
    body.appendChild(img);
  } else {
    body.textContent = message.content;
  }

  const actions = document.createElement('div');
  actions.className = 'message-actions';

  const deleteBtn = document.createElement('button');
  deleteBtn.textContent = '刪除';
  deleteBtn.className = 'delete-btn';
  deleteBtn.addEventListener('click', () => {
    if (!currentRoom) return;
    socket.emit('deleteMessage', {
      roomName: currentRoom,
      messageId: message.id,
    });
  });

  actions.appendChild(deleteBtn);

  wrapper.appendChild(header);
  wrapper.appendChild(body);
  wrapper.appendChild(actions);

  messagesEl.appendChild(wrapper);
  // 捲到最底
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// 清空訊息區並渲染歷史訊息
function renderMessages(messages) {
  messagesEl.innerHTML = '';
  messages.forEach(addMessageToUI);
}

// ====== Socket.io 接收事件 ======

// 伺服器推送房間列表
socket.on('roomList', (rooms) => {
  renderRoomList(rooms);
});

// 建立房間結果
socket.on('createRoomResult', (res) => {
  alert(res.msg);
  if (res.ok && res.roomName) {
    // 建立完可以直接幫他填房名，按「加入房間」即可
    roomNameInput.value = res.roomName;
  }
});

// 加入房間結果
socket.on('joinRoomResult', (res) => {
  alert(res.msg);
  if (!res.ok) return;

  currentRoom = res.roomName;
  currentRoomTitle.textContent = `目前房間：${currentRoom}`;

  // 顯示該房間的歷史訊息
  renderMessages(res.messages || []);
});

// 收到新訊息
socket.on('newMessage', ({ roomName, message }) => {
  // 只顯示目前所在的房間
  if (roomName !== currentRoom) return;
  addMessageToUI(message);
});

// 收到刪除訊息事件
socket.on('messageDeleted', ({ roomName, messageId }) => {
  if (roomName !== currentRoom) return;
  const el = document.querySelector(`.message[data-id="${messageId}"]`);
  if (el) el.remove();
});

// ====== 前端操作事件 ======

// 建立房間
createRoomBtn.addEventListener('click', () => {
  const roomName = roomNameInput.value.trim();
  const password = roomPasswordInput.value;

  socket.emit('createRoom', {
    roomName,
    password,
  });
});

// 加入房間
joinRoomBtn.addEventListener('click', () => {
  const username = usernameInput.value.trim() || '匿名';
  const roomName = roomNameInput.value.trim();
  const password = roomPasswordInput.value;

  if (!roomName) {
    alert('請先輸入房間名稱');
    return;
  }

  socket.emit('joinRoom', {
    username,
    roomName,
    password,
  });
});

// 送出文字訊息



function sendTextMessage() {
  if (!currentRoom) {
    alert('請先加入房間');
    return;
  }

  const text = messageInput.value.trim();
  if (!text) return;

  socket.emit('sendMessage', {
    roomName: currentRoom,
    type: 'text',
    content: text,
  });

  messageInput.value = '';
}

// 上傳圖片
imageInput.addEventListener('change', () => {
  if (!currentRoom) {
    alert('請先加入房間再傳圖片');
    imageInput.value = '';
    return;
  }

  const file = imageInput.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    const base64 = e.target.result; // dataURL
    socket.emit('sendMessage', {
      roomName: currentRoom,
      type: 'image',
      content: base64,
    });
  };
  reader.readAsDataURL(file);

  // 清空 input 避免同一張圖不能再傳
  imageInput.value = '';
});

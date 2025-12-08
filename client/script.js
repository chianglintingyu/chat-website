// 連線到伺服器
const socket = io();

// 提示使用者輸入暱稱
let nickname = prompt("請輸入你的暱稱：");
if (!nickname) nickname = "匿名使用者";

// 找到 HTML 元素
const form = document.getElementById('form');
const input = document.getElementById('input');
const messages = document.getElementById('messages');
const roomSelect = document.getElementById('room-select');
const customRoomInput = document.getElementById('custom-room');
const joinRoomBtn = document.getElementById('join-room-btn');
const currentRoomLabel = document.getElementById('current-room');

let currentRoom = roomSelect.value || '大廳';

// 加入房間
const joinRoom = (roomName) => {
  const target = roomName.trim();
  if (!target) return;
  socket.emit('join room', { room: target, name: nickname });
};

joinRoom(currentRoom);

// 送出訊息
form.addEventListener('submit', (e) => {
  e.preventDefault();
  if (input.value.trim() && currentRoom) {
    socket.emit('chat message', {
      name: nickname,
      text: input.value,
      room: currentRoom
    });
    input.value = '';
  }
});

// 切換到預設房間
roomSelect.addEventListener('change', () => {
  const selected = roomSelect.value;
  if (selected) {
    customRoomInput.value = '';
    joinRoom(selected);
  }
});

// 加入或建立自訂房間
const handleCustomRoomJoin = () => {
  const target = customRoomInput.value.trim();
  if (target) {
    roomSelect.value = '';
    joinRoom(target);
    customRoomInput.value = '';
  }
};

joinRoomBtn.addEventListener('click', handleCustomRoomJoin);
customRoomInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    handleCustomRoomJoin();
  }
});

// 接收訊息
socket.on('chat message', (msg) => {
  if (msg.room !== currentRoom) return; // 忽略其他房間的訊息
  const item = document.createElement('li');
  item.innerHTML = `<strong>${msg.name}：</strong> ${msg.text}`;
  messages.appendChild(item);
  messages.scrollTop = messages.scrollHeight;
});

// 接收系統訊息
socket.on('system message', (msg) => {
  if (msg.room !== currentRoom) return;
  const item = document.createElement('li');
  item.classList.add('system');
  item.textContent = msg.text;
  messages.appendChild(item);
  messages.scrollTop = messages.scrollHeight;
});

// 房間切換回饋
socket.on('room joined', (room) => {
  currentRoom = room;
  currentRoomLabel.textContent = room;
  messages.innerHTML = '';
  const info = document.createElement('li');
  info.classList.add('system');
  info.textContent = `已進入房間：${room}`;
  messages.appendChild(info);
});

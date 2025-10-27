// 連線到伺服器
const socket = io();

// 提示使用者輸入暱稱
let nickname = prompt("請輸入你的暱稱：");
if (!nickname) nickname = "匿名使用者";

// 找到 HTML 元素
const form = document.getElementById('form');
const input = document.getElementById('input');
const messages = document.getElementById('messages');

// 送出訊息
form.addEventListener('submit', (e) => {
  e.preventDefault();
  if (input.value.trim()) {
    // 傳送包含暱稱與訊息的物件
    socket.emit('chat message', {
      name: nickname,
      text: input.value
    });
    input.value = '';
  }
});

// 接收訊息
socket.on('chat message', (msg) => {
  const item = document.createElement('li');
  item.innerHTML = `<strong>${msg.name}：</strong> ${msg.text}`;
  messages.appendChild(item);
  messages.scrollTop = messages.scrollHeight;
});

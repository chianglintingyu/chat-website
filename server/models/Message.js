// server/models/Message.js
const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  roomName: { type: String, required: true },      // 房間名稱
  user: { type: String, required: true },          // 使用者
  type: { type: String, enum: ['text', 'image'], default: 'text' },
  content: { type: String, required: true },       // 文字 or base64 圖片
  time: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Message', messageSchema);




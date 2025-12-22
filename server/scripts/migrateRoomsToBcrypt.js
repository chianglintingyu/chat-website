require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const Room = require('../models/Room');

async function migrate() {
  // 1) 連線資料庫
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ MongoDB 連線成功');

  // 2) 抓全部房間
  const rooms = await Room.find({});
  console.log(`📦 找到房間總數：${rooms.length}`);

  let converted = 0;
  let skipped = 0;

  for (const room of rooms) {
    // 沒密碼：跳過
    if (!room.password) {
      skipped++;
      continue;
    }

    // 已經是 bcrypt hash：跳過（bcrypt hash 常見開頭 $2a$/$2b$/$2y$）
    if (typeof room.password === 'string' && room.password.startsWith('$2')) {
      skipped++;
      continue;
    }

    // 3) 這裡代表是「舊明文密碼」→ 轉 hash
    console.log(`🔄 轉換房間：${room.name}`);
    const hashed = await bcrypt.hash(room.password, 10);
    room.password = hashed;
    await room.save();

    converted++;
  }

  console.log('🎉 遷移完成');
  console.log(`✅ 已轉換：${converted} 間`);
  console.log(`⏭️ 已跳過：${skipped} 間（沒密碼或已是 hash）`);

  process.exit(0);
}

migrate().catch((err) => {
  console.error('❌ 遷移失敗', err);
  process.exit(1);
});

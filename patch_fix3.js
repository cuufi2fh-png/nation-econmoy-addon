const fs = require('fs');

let code = fs.readFileSync('BP/scripts/main.js', 'utf-8');

// 1. Find showIdCardUI and cut off everything after it
const idCardIndex = code.indexOf('function showIdCardUI(player) {');
if (idCardIndex === -1) {
    console.error("showIdCardUI not found!");
    process.exit(1);
}

// Find the end of showIdCardUI function
const nextFuncIndex = code.indexOf('function posAddItemUI(player, marker) {', idCardIndex);
if (nextFuncIndex === -1) {
    console.error("posAddItemUI not found after showIdCardUI!");
    process.exit(1);
}

let cleanCode = code.substring(0, nextFuncIndex);

// 2. Fix block.x, block.y, block.z -> block.location.x, block.location.y, block.location.z
cleanCode = cleanCode.replace(/block\.x/g, 'block.location.x');
cleanCode = cleanCode.replace(/block\.y/g, 'block.location.y');
cleanCode = cleanCode.replace(/block\.z/g, 'block.location.z');

// Also fix event.block.x if any
cleanCode = cleanCode.replace(/event\.block\.location\.location\.x/g, 'event.block.location.x'); // in case of double replacement
cleanCode = cleanCode.replace(/event\.block\.location\.location\.y/g, 'event.block.location.y');
cleanCode = cleanCode.replace(/event\.block\.location\.location\.z/g, 'event.block.location.z');

// 3. Improve Trade Port single player message
const oldTradeMsg = 'player.sendMessage("§c주변(5블록 이내)에 거래할 플레이어가 없습니다.");';
const newTradeMsg = 'player.sendMessage("§c[무역 포트] 주변(5블록 이내)에 거래할 다른 플레이어가 없습니다.\\n§7(무역 테이블은 2명의 플레이어가 마주보고 거래하는 시스템입니다)");';
cleanCode = cleanCode.replace(oldTradeMsg, newTradeMsg);

fs.writeFileSync('BP/scripts/main.js', cleanCode);
console.log("Successfully cleaned and patched main.js!");

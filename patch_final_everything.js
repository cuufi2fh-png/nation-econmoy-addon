const fs = require('fs');
const path = require('path');

let code = fs.readFileSync('BP/scripts/main.js', 'utf-8');

// 1. Fix Flagpole auto-spawn condition
const oldFlagLoop = `// [자동화] 64블록마다 깃발 자동 생성 (플레이어 접근 시)
system.runInterval(() => {
    let allFlagpoles = JSON.parse(world.getDynamicProperty("all_flagpoles") || "{}");
    const overworld = world.getDimension("overworld");
    let changed = false;
    
    for (const player of world.getAllPlayers()) {
        if (player.dimension.id !== "overworld") continue;
        const loc = player.location;
        const gx = Math.floor(loc.x / 64) * 64 + 32;
        const gz = Math.floor(loc.z / 64) * 64 + 32;
        
        if (Math.hypot(loc.x - gx, loc.z - gz) < 25) {
            let exists = false;
            for (const existingKey of Object.keys(allFlagpoles)) {
                const [ex, ey, ez] = existingKey.split(",").map(Number);
                if (ex === gx && ez === gz) { exists = true; break; }
            }`;

const newFlagLoop = `// [자동화] 64블록마다 깃발 자동 생성 (플레이어 접근 시)
system.runInterval(() => {
    let allFlagpoles = JSON.parse(world.getDynamicProperty("all_flagpoles") || "{}");
    const overworld = world.getDimension("overworld");
    let changed = false;
    
    for (const player of world.getAllPlayers()) {
        if (!player.dimension.id.includes("overworld")) continue;
        const loc = player.location;
        const gx = Math.floor(loc.x / 64) * 64 + 32;
        const gz = Math.floor(loc.z / 64) * 64 + 32;
        
        if (Math.hypot(loc.x - gx, loc.z - gz) < 25) {
            let exists = false;
            for (const existingKey of Object.keys(allFlagpoles)) {
                const [ex, ey, ez] = existingKey.split(",").map(Number);
                if (ex === gx && ez === gz) { exists = true; break; }
            }
            if (!exists) {
                try {
                    const nearbyFlags = overworld.getEntities({ type: "nf:flagpole_marker", location: { x: gx + 0.5, y: loc.y, z: gz + 0.5 }, maxDistance: 40 });
                    if (nearbyFlags.length > 0) exists = true;
                } catch(e){}
            }`;

code = code.replace(oldFlagLoop, newFlagLoop);

// 2. Upgrade Banner creation to save nation_names
const oldBannerInit = `                // [V0.5] 화폐 시스템 초기화
                let currencies = JSON.parse(world.getDynamicProperty("currencies") || "{}");
                currencies[nId] = { symbol: "COIN", supply: 100000, rate: 1.0 }; // 기준 통화량 10만
                world.setDynamicProperty("currencies", JSON.stringify(currencies));`;

const newBannerInit = `                // [V0.5] 화폐 시스템 초기화
                let currencies = JSON.parse(world.getDynamicProperty("currencies") || "{}");
                currencies[nId] = { symbol: "COIN", supply: 100000, rate: 1.0, tax_rate: 50 }; // 기준 통화량 10만, 기본세금 50
                world.setDynamicProperty("currencies", JSON.stringify(currencies));
                
                let nationNames = JSON.parse(world.getDynamicProperty("nation_names") || "{}");
                nationNames[nId] = nationName;
                world.setDynamicProperty("nation_names", JSON.stringify(nationNames));`;

code = code.replace(oldBannerInit, newBannerInit);

// 3. Replace trade_port interact logic for Stock Market
const oldTradeInteract = `    } else if (block.typeId === "nf:trade_port") {
        event.cancel = true;
        system.run(() => {
            let finalStr = player.getDynamicProperty("final_trade");
            let pendingStr = player.getDynamicProperty("pending_trade");
            if (finalStr && finalStr !== "") {
                showFinalTradeMenu(player, JSON.parse(finalStr));
            } else if (pendingStr && pendingStr !== "") {
                showTradeReplyMenu(player, JSON.parse(pendingStr));
            } else {
                showP2PTradeMenu(player);
            }
        });
    }`;

const newTradeInteract = `    } else if (block.typeId === "nf:trade_port") {
        event.cancel = true;
        system.run(() => {
            new ActionFormData().title("§l무역 및 금융 센터").body("원하시는 시스템을 선택하세요.")
            .button("§a[물물교환] P2P 무역 테이블")
            .button("§6[증권거래소] 실시간 주식 시장")
            .button("닫기")
            .show(player).then(res => {
                if (res.canceled || res.selection === 2) return;
                if (res.selection === 0) {
                    let finalStr = player.getDynamicProperty("final_trade");
                    let pendingStr = player.getDynamicProperty("pending_trade");
                    if (finalStr && finalStr !== "") showFinalTradeMenu(player, JSON.parse(finalStr));
                    else if (pendingStr && pendingStr !== "") showTradeReplyMenu(player, JSON.parse(pendingStr));
                    else showP2PTradeMenu(player);
                } else if (res.selection === 1) {
                    showStockMarketUI(player);
                }
            });
        });
    }`;

code = code.replace(oldTradeInteract, newTradeInteract);

// 4. Upgrade showIdCardUI and add Stock Market + Loan ScriptEvent logic
const oldIdCardUI = `// [V0.7] 신분증 UI
function showIdCardUI(player) {
    const nId = getNationId(player);
    if (!nId) { player.sendMessage("§c국가에 소속되지 않은 무국적자입니다."); return; }
    
    let hasId = player.getDynamicProperty("id_issued");
    if (!hasId) {
        new ModalFormData().title("§l신분증 발급").textField("집 주소를 입력하세요.", "예: 서울시 강남구...")
        .show(player).then(res => {
            if (res.canceled) return;
            const address = res.formValues[0] || "알 수 없음";
            const passport = "M-" + Math.floor(Math.random() * 900000 + 100000); // M-123456
            
            player.setDynamicProperty("id_address", address);
            player.setDynamicProperty("id_passport", passport);
            player.setDynamicProperty("id_issued", true);
            player.sendMessage("§a[안내] 신분증 발급이 완료되었습니다.");
            
            showIdCardUI(player);
        });
        return;
    }
    
    const address = player.getDynamicProperty("id_address");
    const passport = player.getDynamicProperty("id_passport");
    const nationName = nId.replace("nation_id_", "국가 "); 
    
    new ActionFormData().title("§l신분증 (ID Card)")
    .body(\`§b소속: §f\${nationName}\\n§e이름: §f\${player.name}\\n§a집 주소: §f\${address}\\n§6여권 번호: §f\${passport}\`)
    .button("확인")
    .show(player);
}`;

const newIdCardUI = `// [V0.7] 신분증 UI 및 국가 관리 포털
function showIdCardUI(player) {
    const nId = getNationId(player);
    let nationNames = JSON.parse(world.getDynamicProperty("nation_names") || "{}");
    
    if (!nId) {
        const availableNations = Object.keys(nationNames);
        const form = new ActionFormData().title("§l국가 포털 (무국적 상태)")
        .body("현재 소속된 국가가 없습니다.\\n원하시는 작업을 선택하세요.");
        
        if (availableNations.length > 0) {
            form.button("§a국가 가입하기 (기존 국가 선택)");
        } else {
            form.button("§7[가입 불가] 생성된 국가 없음");
        }
        form.button("§b국가 건국 안내 (현수막 사용)");
        form.button("닫기");
        
        form.show(player).then(res => {
            if (res.canceled) return;
            if (res.selection === 0 && availableNations.length > 0) {
                const options = availableNations.map(id => \`\${nationNames[id]} (ID: \${id.replace("nation_id_", "")})\`);
                new ModalFormData().title("§l국가 가입").dropdown("가입할 국가를 선택하세요.", options)
                .show(player).then(r => {
                    if (r.canceled) return;
                    const selectedId = availableNations[r.formValues[0]];
                    player.addTag("has_nation"); player.addTag(selectedId);
                    const numId = selectedId.replace("nation_id_", "");
                    player.runCommand(\`scoreboard players set @s nation_id \${numId}\`);
                    world.setDynamicProperty("player_nation_" + player.name, selectedId);
                    player.sendMessage(\`§a[안내] 성공적으로 '\${nationNames[selectedId]}' 국가에 가입되었습니다!\`);
                });
            } else if (res.selection === 1 || (res.selection === 0 && availableNations.length === 0)) {
                player.sendMessage("§e[건국 안내] §f모루에서 현수막(Banner)의 이름을 국가명으로 변경한 뒤, 손에 들고 허공을 클릭(사용)하면 나만의 국가가 건국됩니다!");
            }
        });
        return;
    }
    
    let hasId = player.getDynamicProperty("id_issued");
    if (!hasId) {
        new ModalFormData().title("§l신분증 발급").textField("집 주소를 입력하세요.", "예: 서울시 강남구...")
        .show(player).then(res => {
            if (res.canceled) return;
            const address = res.formValues[0] || "알 수 없음";
            const passport = "M-" + Math.floor(Math.random() * 900000 + 100000);
            player.setDynamicProperty("id_address", address);
            player.setDynamicProperty("id_passport", passport);
            player.setDynamicProperty("id_issued", true);
            player.sendMessage("§a[안내] 신분증 발급이 완료되었습니다.");
            showIdCardUI(player);
        });
        return;
    }
    
    const address = player.getDynamicProperty("id_address");
    const passport = player.getDynamicProperty("id_passport");
    const displayNationName = nationNames[nId] || nId.replace("nation_id_", "국가 "); 
    const curr = getCurrencyInfo(nId);
    
    const form = new ActionFormData().title("§l신분증 및 국가 관리")
    .body(\`§b소속 국가: §f\${displayNationName}\\n§e이름: §f\${player.name}\\n§a집 주소: §f\${address}\\n§6여권 번호: §f\${passport}\\n\\n§7화폐 기호: \${curr.symbol} | 세금 비율: \${curr.tax_rate || 50} Gold 기준\`);
    
    form.button("§e국고 및 경제 정보 조회");
    form.button("§c국가 탈퇴하기");
    if (player.hasTag("nation_leader")) {
        form.button("§6[지도자] 국가 설정 (이름/화폐/세금)");
    }
    form.button("닫기");
    
    form.show(player).then(res => {
        if (res.canceled) return;
        if (res.selection === 0) {
            let treasury = 0;
            try { treasury = world.scoreboard.getObjective("treasury").getScore(player.dimension.getEntities({name: displayNationName})[0]); } catch(e){}
            player.sendMessage(\`§e[국가 정보] §b\${displayNationName}§f | 국고 잔액: \${treasury} \${curr.symbol} | 현재 환율: \${curr.rate.toFixed(4)}\`);
        } else if (res.selection === 1) {
            new ActionFormData().title("§l국가 탈퇴 확인").body("정말로 소속 국가를 탈퇴하시겠습니까?\\n§c(주의: 탈퇴 시 국가의 보호 및 혜택을 받을 수 없게 됩니다)")
            .button("§c탈퇴하기").button("§a취소")
            .show(player).then(r => {
                if (r.canceled || r.selection === 1) return;
                player.getTags().forEach(t => { if(t.startsWith("nation_id_") || t === "has_nation" || t === "nation_leader") player.removeTag(t); });
                player.runCommand("scoreboard players set @s nation_id 0");
                world.setDynamicProperty("player_nation_" + player.name, undefined);
                player.sendMessage("§c[안내] 국가에서 탈퇴하여 무국적자가 되었습니다.");
            });
        } else if (player.hasTag("nation_leader") && res.selection === 2) {
            new ModalFormData().title("§l국가 설정 관리")
            .textField("국가명 변경", "새 국가명 입력", displayNationName)
            .textField("화폐 기호/단위 변경", "예: KRW, USD", curr.symbol)
            .textField("영토당 세금 징수액 (기본 50)", "숫자 입력", String(curr.tax_rate || 50))
            .show(player).then(r => {
                if (r.canceled) return;
                const newName = r.formValues[0];
                const newSym = r.formValues[1].toUpperCase();
                const newTax = parseInt(r.formValues[2]);
                
                if (newName && newName !== "") nationNames[nId] = newName;
                if (newSym && newSym !== "") curr.symbol = newSym;
                if (!isNaN(newTax) && newTax >= 0) curr.tax_rate = newTax;
                
                let currencies = JSON.parse(world.getDynamicProperty("currencies") || "{}");
                currencies[nId] = curr;
                world.setDynamicProperty("currencies", JSON.stringify(currencies));
                world.setDynamicProperty("nation_names", JSON.stringify(nationNames));
                
                player.sendMessage(\`§a[국가 설정] 성공적으로 변경되었습니다!\\n§f국가명: \${newName} | 화폐: \${newSym} | 세금: \${newTax}\`);
            });
        }
    });
}

// ====== 증권 거래소 (Stock Market) 로직 ======
let defaultStocks = {
    "mining": { name: "국영 광업 공사", price: 5000, history: [5000], fluc: 0.05 },
    "arms": { name: "크리퍼 무기 산업", price: 12000, history: [12000], fluc: 0.08 },
    "bank": { name: "베드락 건설 은행", price: 25000, history: [25000], fluc: 0.03 }
};

function showStockMarketUI(player) {
    let stocks = JSON.parse(world.getDynamicProperty("stock_market") || JSON.stringify(defaultStocks));
    let playerStocks = JSON.parse(player.getDynamicProperty("player_stocks") || "{}");
    
    const form = new ActionFormData().title("§l증권 거래소 (Stock Exchange)")
    .body("실시간 주식 시세 및 보유 자산을 관리합니다.\\n주가는 1분마다 변동하며 경제 상황에 영향을 받습니다.");
    
    const keys = Object.keys(stocks);
    for (const key of keys) {
        const st = stocks[key];
        const myCount = playerStocks[key] || 0;
        form.button(\`§e\${st.name}\\n§f현재가: \${st.price}₩ (보유: \${myCount}주)\`);
    }
    form.button("§a내 주식 지갑 조회 및 매도");
    form.button("닫기");
    
    form.show(player).then(res => {
        if (res.canceled || res.selection === keys.length + 1) return;
        if (res.selection < keys.length) {
            const key = keys[res.selection];
            const st = stocks[key];
            let money = 0;
            try { money = world.scoreboard.getObjective("player_money").getScore(player); } catch(e){}
            const maxBuy = Math.floor(money / st.price);
            
            new ModalFormData().title(\`§l주식 매수 - \${st.name}\`)
            .slider(\`매수 수량 (현재가: \${st.price}₩ | 보유금액: \${money}₩)\`, 1, Math.max(1, maxBuy > 64 ? 64 : maxBuy), 1, 1)
            .show(player).then(r => {
                if (r.canceled) return;
                const amount = r.formValues[0];
                const totalCost = st.price * amount;
                if (money < totalCost) { player.sendMessage("§c잔액이 부족합니다."); return; }
                
                player.runCommand(\`scoreboard players remove @s player_money \${totalCost}\`);
                playerStocks[key] = (playerStocks[key] || 0) + amount;
                player.setDynamicProperty("player_stocks", JSON.stringify(playerStocks));
                player.sendMessage(\`§a[증권] \${st.name} \${amount}주를 \${totalCost}₩에 매수했습니다!\`);
                showStockMarketUI(player);
            });
        } else if (res.selection === keys.length) {
            const sellForm = new ActionFormData().title("§l내 주식 지갑 및 매도").body("보유 중인 주식을 매도(판매)할 수 있습니다.");
            const ownedKeys = keys.filter(k => (playerStocks[k] || 0) > 0);
            
            if (ownedKeys.length === 0) {
                sellForm.button("보유 중인 주식이 없습니다.").show(player).then(() => showStockMarketUI(player));
                return;
            }
            
            for (const k of ownedKeys) {
                sellForm.button(\`§c[매도] §f\${stocks[k].name} (보유: \${playerStocks[k]}주 | 현재가: \${stocks[k].price}₩)\`);
            }
            sellForm.button("뒤로 가기");
            
            sellForm.show(player).then(r => {
                if (r.canceled || r.selection === ownedKeys.length) { showStockMarketUI(player); return; }
                const k = ownedKeys[r.selection];
                const st = stocks[k];
                const myCount = playerStocks[k];
                
                new ModalFormData().title(\`§l주식 매도 - \${st.name}\`)
                .slider(\`매도 수량 (현재가: \${st.price}₩ | 보유: \${myCount}주)\`, 1, myCount, 1, 1)
                .show(player).then(res2 => {
                    if (res2.canceled) return;
                    const amount = res2.formValues[0];
                    const totalIncome = st.price * amount;
                    
                    player.runCommand(\`scoreboard players add @s player_money \${totalIncome}\`);
                    playerStocks[k] -= amount;
                    if (playerStocks[k] <= 0) delete playerStocks[k];
                    player.setDynamicProperty("player_stocks", JSON.stringify(playerStocks));
                    player.sendMessage(\`§a[증권] \${st.name} \${amount}주를 매도하여 \${totalIncome}₩을 입금받았습니다!\`);
                    showStockMarketUI(player);
                });
            });
        }
    });
}

system.runInterval(() => {
    let stocks = JSON.parse(world.getDynamicProperty("stock_market") || JSON.stringify(defaultStocks));
    for (const key of Object.keys(stocks)) {
        let st = stocks[key];
        let changeRate = (Math.random() * (st.fluc * 2)) - st.fluc;
        if (Math.random() < 0.1) changeRate += (Math.random() > 0.5 ? 0.15 : -0.15);
        
        st.price = Math.max(500, Math.floor(st.price * (1 + changeRate)));
        st.history.push(st.price);
        if (st.history.length > 5) st.history.shift();
    }
    world.setDynamicProperty("stock_market", JSON.stringify(stocks));
}, 1200);

// ====== 대출 ScriptEvent 수신 로직 ======
system.afterEvents.scriptEventReceive.subscribe((event) => {
    if (event.id === "nf:loan") {
        const player = event.sourceEntity;
        if (!player || player.typeId !== "minecraft:player") return;
        
        const msg = event.message;
        const nId = getNationId(player);
        const curr = getCurrencyInfo(nId);
        let creditScore = player.getDynamicProperty("credit_score") || 500;
        let debt = player.getDynamicProperty("debt") || 0;
        let money = 0;
        try { money = world.scoreboard.getObjective("player_money").getScore(player); } catch(e) {}
        
        if (msg === "apply") {
            showLoanApplyUI(player, creditScore, debt, curr);
        } else if (msg === "repay") {
            showLoanRepayUI(player, money, debt, creditScore, curr);
        }
    }
});
`;

code = code.replace(oldIdCardUI, newIdCardUI);

fs.writeFileSync('BP/scripts/main.js', code);

// 5. Create loan mcfunction files
const loanDir = 'BP/functions/loan';
if (!fs.existsSync(loanDir)) {
    fs.mkdirSync(loanDir, { recursive: true });
}

fs.writeFileSync(path.join(loanDir, 'apply.mcfunction'), 'scriptevent nf:loan apply\n');
fs.writeFileSync(path.join(loanDir, 'repay.mcfunction'), 'scriptevent nf:loan repay\n');

console.log("Successfully patched everything!");

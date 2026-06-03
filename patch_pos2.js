const fs = require('fs');

let code = fs.readFileSync('BP/scripts/main.js', 'utf-8');

const newCode = `
function posAddItemUI(player, marker) {
    const invComp = player.getComponent("inventory") || player.getComponent("minecraft:inventory");
    if (!invComp) return;
    const inventory = invComp.container;
    const items = [];
    const options = [];
    
    for (let i = 0; i < inventory.size; i++) {
        const item = inventory.getItem(i);
        if (item) {
            items.push({ slot: i, item: item });
            options.push(item.typeId.replace("minecraft:", "") + " x" + item.amount);
        }
    }

    if (items.length === 0) {
        player.sendMessage("§c판매할 아이템이 인벤토리에 없습니다.");
        return;
    }

    new ModalFormData()
        .title("§l상품 등록 (1회용 판매)")
        .dropdown("판매할 아이템 선택", options)
        .textField("판매 가격 (단위: ₩)", "예: 1000")
        .show(player).then(res => {
            if (res.canceled) return;
            const selectedIdx = res.formValues[0];
            const price = parseInt(res.formValues[1]);
            if (isNaN(price) || price <= 0) { player.sendMessage("§c올바른 가격을 입력하세요."); return; }
            
            const selected = items[selectedIdx];
            const item = inventory.getItem(selected.slot);
            if (!item) return;
            
            // Remove item from inventory
            inventory.setItem(selected.slot, undefined);
            
            const itemData = { typeId: item.typeId, amount: item.amount, price: price };
            marker.setDynamicProperty("pos_item", JSON.stringify(itemData));
            marker.setDynamicProperty("pos_price", price);
            marker.nameTag = "§e결제 대기중: §f" + price + " (판매자: " + player.name + ")";
            
            player.sendMessage("§a[POS] 상품이 단말기에 올라갔습니다. 결제 대기 중입니다.");
        });
}

function openPosCustomerMenu(player, marker, owner) {
    // If we are here, it means the customer clicked the POS. We process payment directly!
    const itemStr = marker.getDynamicProperty("pos_item");
    if (!itemStr || itemStr === "") {
        player.sendMessage("§c[POS] 현재 등록된 상품이 없습니다.");
        return;
    }
    const item = JSON.parse(itemStr);
    
    const ownerNationId = getNationId(owner);
    const ownerCurr = getCurrencyInfo(ownerNationId);
    
    processPosPayment(player, marker, owner, item, ownerCurr);
}

function processPosPayment(player, marker, owner, item, ownerCurr) {
    const equip = player.getComponent("equippable");
    const mainhand = equip ? equip.getEquipment("Mainhand") : undefined;
    if (!mainhand || (mainhand.typeId !== "nf:check_card" && mainhand.typeId !== "nf:credit_card")) { 
        player.sendMessage("§c[POS] 결제 오류: 손에 카드를 든 상태로 단말기를 터치해야 결제가 진행됩니다."); return; 
    }
    
    const customerNationId = getNationId(player);
    if (!customerNationId) { player.sendMessage("§c국가에 소속되어야 금융을 이용할 수 있습니다."); return; }
    const customerCurr = getCurrencyInfo(customerNationId);
    
    const currentPrice = item.price;
    const valueInGold = currentPrice * ownerCurr.rate;
    const customerPrice = Math.ceil(valueInGold / customerCurr.rate);
    
    const isCredit = (mainhand.typeId === "nf:credit_card");
    let customerMoney = 0;
    try { customerMoney = world.scoreboard.getObjective("player_money").getScore(player); } catch (e) {}

    if (isCredit) {
        let creditScore = player.getDynamicProperty("credit_score") || 500;
        let debt = player.getDynamicProperty("debt") || 0;
        let limit = creditScore * 100;
        
        if (customerPrice > (limit - debt)) {
            player.sendMessage("§c[결제 실패] 한도 초과. (지불해야 할 금액: " + customerPrice + " " + customerCurr.symbol + ")"); return;
        }
        player.setDynamicProperty("debt", debt + customerPrice);
        player.sendMessage("§a[결제 완료] 신용 승인: " + customerPrice + " " + customerCurr.symbol + " 결제됨.");
    } else {
        if (customerMoney < customerPrice) { 
            player.sendMessage("§c[결제 실패] 잔액 부족. (필요: " + customerPrice + " " + customerCurr.symbol + ", 환율 적용됨)"); return; 
        }
        player.runCommand("scoreboard players remove @s player_money " + customerPrice);
        player.sendMessage("§a[결제 완료] " + customerPrice + " " + customerCurr.symbol + " 차감됨. (환율 자동 적용)");
    }
    
    const fee = Math.floor(currentPrice * 0.05);
    const ownerIncome = currentPrice - fee;
    
    player.dimension.runCommand("scoreboard players add \\"" + owner + "\\" player_money " + ownerIncome);
    try { player.dimension.runCommand("tellraw \\"" + owner + "\\" {\\"rawtext\\":[{\\"text\\":\\"§a[POS] " + ownerIncome + " " + ownerCurr.symbol + " 입금됨! (수수료 " + fee + " 공제, 상품: " + item.typeId.replace("minecraft:", "") + ")\\"}]}"); } catch(e) {}
    
    player.runCommand("give @s " + item.typeId + " " + item.amount);
    
    // 결제 완료 후 초기화
    marker.setDynamicProperty("pos_item", "");
    marker.setDynamicProperty("pos_price", 0);
    marker.nameTag = "§e" + owner + "의 상점";
}
`;

// Find the start of posAddItemUI and replace it entirely to the end of processPosPayment
let startIdx = code.indexOf('function posAddItemUI(player, marker)');
let endIdx = code.indexOf('// [V0.7] P2P Trade Logic'); // This comment is right after processPosPayment

if (startIdx !== -1 && endIdx !== -1) {
    code = code.substring(0, startIdx) + newCode + "\\n" + code.substring(endIdx);
}

fs.writeFileSync('BP/scripts/main.js', code);

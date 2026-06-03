const fs = require('fs');

let code = fs.readFileSync('BP/scripts/main.js', 'utf-8');

// 1. Update playerPlaceBlock for pos_terminal
code = code.replace(
    /marker\.setDynamicProperty\("pos_owner", event\.player\.name\);/g,
    'marker.setDynamicProperty("pos_owner", "");\n        marker.nameTag = "§8주인 없는 단말기";'
);

// 2. Replace playerInteractWithBlock pos_terminal logic
const oldInteractStart = 'if (block.typeId === "nf:pos_terminal") {';
const oldInteractEnd = '} else if (block.typeId === "nf:trade_port") {';

const newInteractLogic = `if (block.typeId === "nf:pos_terminal") {
        event.cancel = true;
        system.run(() => {
            const markers = player.dimension.getEntities({ type: "nf:pos_marker", location: { x: block.x + 0.5, y: block.y, z: block.z + 0.5 }, maxDistance: 0.5 });
            if (markers.length === 0) return;
            const marker = markers[0];
            const owner = marker.getDynamicProperty("pos_owner") || "";
            
            if (owner === "") {
                new ActionFormData().title("§lPOS 단말기").body("아직 주인이 없습니다.")
                .button("§a점주 등록하기")
                .show(player).then(res => {
                    if (res.canceled) return;
                    marker.setDynamicProperty("pos_owner", player.name);
                    marker.nameTag = "§e" + player.name + "의 상점";
                    player.sendMessage("§a[POS] 이제 당신이 점주입니다.");
                });
            } else if (player.name === owner) {
                new ActionFormData().title("§lPOS 관리").body("작업을 선택하세요.")
                .button("§a판매 상품 추가")
                .button("§c초기화 (점주 등록 해제)")
                .show(player).then(res => {
                    if(res.canceled) return;
                    if(res.selection === 0) posAddItemUI(player, marker);
                    if(res.selection === 1) {
                        marker.setDynamicProperty("pos_owner", "");
                        marker.setDynamicProperty("pos_catalog", "[]");
                        marker.nameTag = "§8주인 없는 단말기";
                        player.sendMessage("§a[POS] 단말기가 초기화되었습니다.");
                    }
                });
            } else {
                openPosCustomerMenu(player, marker, owner);
            }
        });
    } else if (block.typeId === "nf:trade_port") {`;

// We need to slice the string to replace safely
let lines = code.split('\n');
let startIdx = lines.findIndex(l => l.includes('if (block.typeId === "nf:pos_terminal") {'));
let endIdx = lines.findIndex(l => l.includes('} else if (block.typeId === "nf:trade_port") {'));

if (startIdx !== -1 && endIdx !== -1) {
    lines.splice(startIdx, endIdx - startIdx, newInteractLogic);
}
code = lines.join('\n');

code += `
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
        .title("§l상품 등록 (재고 무한)")
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
            
            let catalog = JSON.parse(marker.getDynamicProperty("pos_catalog") || "[]");
            catalog.push({ typeId: item.typeId, amount: item.amount, price: price });
            marker.setDynamicProperty("pos_catalog", JSON.stringify(catalog));
            
            player.sendMessage("§a[POS] 상품 등록 완료: " + item.typeId.replace("minecraft:", "") + " x" + item.amount + " (가격: " + price + ")");
        });
}

function openPosCustomerMenu(player, marker, owner) {
    let catalog = JSON.parse(marker.getDynamicProperty("pos_catalog") || "[]");
    if (catalog.length === 0) {
        player.sendMessage("§c판매 중인 상품이 없습니다.");
        return;
    }

    const ownerNationId = getNationId(owner);
    const ownerCurr = getCurrencyInfo(ownerNationId);

    const form = new ActionFormData().title("§l" + owner + "의 상점").body("결제할 카드를 손에 들고 상품을 선택하세요.");
    for (const item of catalog) {
        form.button("§a" + item.typeId.replace("minecraft:", "") + " x" + item.amount + "\\n§f가격: " + item.price + " " + ownerCurr.symbol);
    }
    form.show(player).then(res => {
        if (res.canceled) return;
        const selected = catalog[res.selection];
        processPosPayment(player, owner, selected, ownerCurr);
    });
}

function processPosPayment(player, owner, item, ownerCurr) {
    const equip = player.getComponent("equippable");
    const mainhand = equip ? equip.getEquipment("Mainhand") : undefined;
    if (!mainhand || (mainhand.typeId !== "nf:check_card" && mainhand.typeId !== "nf:credit_card")) { 
        player.sendMessage("§c[POS] 결제 오류: 손에 카드를 든 상태로 구매를 시도해야 합니다."); return; 
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
}
`;

fs.writeFileSync('BP/scripts/main.js', code);

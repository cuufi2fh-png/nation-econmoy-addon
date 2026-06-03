const fs = require('fs');

let code = fs.readFileSync('BP/scripts/main_backup.js', 'utf-8');

const splitIndex = code.indexOf('// ====== V0.2, V0.4, V0.5: POS 기기 로직 (자동 환전 추가) ======');
if (splitIndex === -1) {
    console.error("Split index not found!");
    process.exit(1);
}

let topPart = code.substring(0, splitIndex);

let newCode = `// ====== V0.2, V0.4, V0.5: POS 기기 로직 (자동 환전 추가) ======
world.afterEvents.playerPlaceBlock.subscribe((event) => {
    const block = event.block;
    if (block.typeId === "nf:pos_terminal") {
        const marker = event.dimension.spawnEntity("nf:pos_marker", { x: block.x + 0.5, y: block.y, z: block.z + 0.5 });
        marker.setDynamicProperty("pos_owner", "");
        marker.nameTag = "§8주인 없는 단말기";
    }
});

world.afterEvents.playerBreakBlock.subscribe((event) => {
    if (event.brokenBlockPermutation.type.id === "nf:pos_terminal") {
        const markers = event.dimension.getEntities({ type: "nf:pos_marker", location: { x: event.block.x + 0.5, y: event.block.y, z: event.block.z + 0.5 }, maxDistance: 0.5 });
        for (const marker of markers) marker.remove();
    }
});

world.beforeEvents.playerInteractWithBlock.subscribe((event) => {
    const block = event.block;
    const player = event.player;
    
    if (event.itemStack && event.itemStack.typeId === "nf:property_wand") {
        event.cancel = true;
        const isSneaking = player.isSneaking;
        const pos = block.location;
        if (isSneaking) {
            player.setDynamicProperty("re_pos2_x", pos.x);
            player.setDynamicProperty("re_pos2_y", pos.y);
            player.setDynamicProperty("re_pos2_z", pos.z);
            system.run(() => { player.sendMessage("§a[부동산] 두 번째 지점 (Pos2) 설정: " + pos.x + ", " + pos.y + ", " + pos.z); });
        } else {
            player.setDynamicProperty("re_pos1_x", pos.x);
            player.setDynamicProperty("re_pos1_y", pos.y);
            player.setDynamicProperty("re_pos1_z", pos.z);
            system.run(() => { player.sendMessage("§a[부동산] 첫 번째 지점 (Pos1) 설정: " + pos.x + ", " + pos.y + ", " + pos.z + "\\n(웅크리고 클릭하면 Pos2가 설정됩니다)"); });
        }
        return;
    }

    if (block.typeId === "nf:pos_terminal") {
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
                .button("§a판매 상품 등록 (단일품목 1회)")
                .button("§c초기화 (점주 등록 해제)")
                .show(player).then(res => {
                    if(res.canceled) return;
                    if(res.selection === 0) posAddItemUI(player, marker);
                    if(res.selection === 1) {
                        marker.setDynamicProperty("pos_owner", "");
                        marker.setDynamicProperty("pos_item", "");
                        marker.setDynamicProperty("pos_price", 0);
                        marker.nameTag = "§8주인 없는 단말기";
                        player.sendMessage("§a[POS] 단말기가 초기화되었습니다.");
                    }
                });
            } else {
                openPosCustomerMenu(player, marker, owner);
            }
        });
    } else if (block.typeId === "nf:trade_port") {
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
    }
});

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
            
            inventory.setItem(selected.slot, undefined);
            
            const itemData = { typeId: item.typeId, amount: item.amount, price: price };
            marker.setDynamicProperty("pos_item", JSON.stringify(itemData));
            marker.setDynamicProperty("pos_price", price);
            marker.nameTag = "§e결제 대기중: §f" + price + " (판매자: " + player.name + ")";
            
            player.sendMessage("§a[POS] 상품이 단말기에 올라갔습니다. 결제 대기 중입니다.");
        });
}

function openPosCustomerMenu(player, marker, owner) {
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
    
    marker.setDynamicProperty("pos_item", "");
    marker.setDynamicProperty("pos_price", 0);
    marker.nameTag = "§e" + owner + "의 상점";
}

// [V0.7] P2P Trade Logic
function showP2PTradeMenu(player) {
    const players = player.dimension.getPlayers({ location: player.location, maxDistance: 5 });
    const nearby = players.filter(p => p.name !== player.name);
    if (nearby.length === 0) {
        player.sendMessage("§c주변(5블록 이내)에 거래할 플레이어가 없습니다.");
        return;
    }
    const options = nearby.map(p => p.name);
    new ModalFormData().title("§l무역 포트 (1:1 거래)").dropdown("거래 상대 선택", options)
    .show(player).then(res => {
        if (res.canceled) return;
        const targetPlayerName = options[res.formValues[0]];
        const targetPlayer = nearby.find(p => p.name === targetPlayerName);
        if (!targetPlayer) return;
        
        startTradeOffer(player, targetPlayer);
    });
}

function startTradeOffer(player, targetPlayer) {
    const invComp = player.getComponent("inventory") || player.getComponent("minecraft:inventory");
    const inventory = invComp ? invComp.container : null;
    const items = [];
    const options = ["아이템 없음"];
    
    if (inventory) {
        for (let i = 0; i < inventory.size; i++) {
            const item = inventory.getItem(i);
            if (item) {
                items.push({ slot: i, item: item });
                options.push(item.typeId.replace("minecraft:", "") + " x" + item.amount);
            }
        }
    }
    
    new ModalFormData().title("§l" + targetPlayer.name + "님에게 거래 제안")
    .textField("제시할 돈 (₩)", "예: 1000", "0")
    .dropdown("제시할 아이템", options)
    .show(player).then(res => {
        if (res.canceled) return;
        const moneyOffer = parseInt(res.formValues[0]);
        if (isNaN(moneyOffer) || moneyOffer < 0) { player.sendMessage("§c올바른 금액을 입력하세요."); return; }
        
        let itemOffer = null;
        let selectedSlot = -1;
        if (res.formValues[1] > 0) {
            const selected = items[res.formValues[1] - 1];
            itemOffer = { typeId: selected.item.typeId, amount: selected.item.amount };
            selectedSlot = selected.slot;
        }
        
        let currentMoney = 0;
        try { currentMoney = world.scoreboard.getObjective("player_money").getScore(player); } catch(e){}
        if (currentMoney < moneyOffer) { player.sendMessage("§c잔액이 부족합니다."); return; }
        
        const tradeData = {
            requester: player.name,
            offerMoney: moneyOffer,
            offerItem: itemOffer,
            requesterSlot: selectedSlot
        };
        targetPlayer.setDynamicProperty("pending_trade", JSON.stringify(tradeData));
        player.sendMessage("§a" + targetPlayer.name + "님에게 거래를 요청했습니다.");
        targetPlayer.sendMessage("§e[알림] §b" + player.name + "§e님으로부터 무역 거래 요청이 왔습니다! 근처의 무역 포트를 클릭해 확인하세요.");
    });
}

function showTradeReplyMenu(player, tradeData) {
    const requesterName = tradeData.requester;
    const invComp = player.getComponent("inventory") || player.getComponent("minecraft:inventory");
    const inventory = invComp ? invComp.container : null;
    const items = [];
    const options = ["아이템 없음"];
    
    if (inventory) {
        for (let i = 0; i < inventory.size; i++) {
            const item = inventory.getItem(i);
            if (item) {
                items.push({ slot: i, item: item });
                options.push(item.typeId.replace("minecraft:", "") + " x" + item.amount);
            }
        }
    }
    
    let offerStr = "돈: " + tradeData.offerMoney + "₩";
    if (tradeData.offerItem) offerStr += "\\n아이템: " + tradeData.offerItem.typeId.replace("minecraft:", "") + " x" + tradeData.offerItem.amount;
    
    new ModalFormData().title("§l받은 거래 요청")
    .textField("상대방(" + requesterName + ")의 제시:\\n" + offerStr + "\\n\\n내 답변 (제시할 돈)", "예: 0", "0")
    .dropdown("내 제시 아이템", options)
    .toggle("거래 거절", false)
    .show(player).then(res => {
        if (res.canceled) return;
        player.setDynamicProperty("pending_trade", "");
        
        if (res.formValues[2]) {
            player.sendMessage("§c거래를 거절했습니다.");
            try { player.dimension.runCommand("tellraw \\"" + requesterName + "\\" {\\"rawtext\\":[{\\"text\\":\\"§c[무역] " + player.name + "님이 거래를 거절했습니다.\\"}]}"); } catch(e){}
            return;
        }
        
        const myMoneyOffer = parseInt(res.formValues[0]);
        if (isNaN(myMoneyOffer) || myMoneyOffer < 0) { player.sendMessage("§c올바른 금액을 입력하세요."); return; }
        
        let myItemOffer = null;
        let mySlot = -1;
        if (res.formValues[1] > 0) {
            const selected = items[res.formValues[1] - 1];
            myItemOffer = { typeId: selected.item.typeId, amount: selected.item.amount };
            mySlot = selected.slot;
        }
        
        let myMoney = 0;
        try { myMoney = world.scoreboard.getObjective("player_money").getScore(player); } catch(e){}
        if (myMoney < myMoneyOffer) { player.sendMessage("§c잔액이 부족합니다."); return; }
        
        const finalTradeData = {
            requester: requesterName,
            requesterMoney: tradeData.offerMoney,
            requesterItem: tradeData.offerItem,
            requesterSlot: tradeData.requesterSlot,
            target: player.name,
            targetMoney: myMoneyOffer,
            targetItem: myItemOffer,
            targetSlot: mySlot
        };
        
        const reqPlayer = player.dimension.getPlayers({name: requesterName})[0];
        if (!reqPlayer) { player.sendMessage("§c상대방이 오프라인이거나 멀리 있습니다."); return; }
        
        reqPlayer.setDynamicProperty("final_trade", JSON.stringify(finalTradeData));
        player.sendMessage("§a" + requesterName + "님에게 역제안을 보냈습니다. 상대의 수락을 기다리세요.");
        reqPlayer.sendMessage("§e[알림] §b" + player.name + "§e님이 거래 제안에 응답했습니다! 무역 포트를 눌러 확인하세요.");
    });
}

function showFinalTradeMenu(player, finalTradeData) {
    let reqStr = "돈: " + finalTradeData.requesterMoney + "₩";
    if (finalTradeData.requesterItem) reqStr += "\\n아이템: " + finalTradeData.requesterItem.typeId.replace("minecraft:", "") + " x" + finalTradeData.requesterItem.amount;
    
    let tarStr = "돈: " + finalTradeData.targetMoney + "₩";
    if (finalTradeData.targetItem) tarStr += "\\n아이템: " + finalTradeData.targetItem.typeId.replace("minecraft:", "") + " x" + finalTradeData.targetItem.amount;

    new ActionFormData().title("§l최종 거래 확인")
    .body("[나의 제시]\\n" + reqStr + "\\n\\n[상대방(" + finalTradeData.target + ")의 제시]\\n" + tarStr + "\\n\\n이 거래를 확정하시겠습니까?")
    .button("§a수락 (교환 진행)")
    .button("§c거절")
    .show(player).then(res => {
        if (res.canceled) return;
        player.setDynamicProperty("final_trade", "");
        
        const targetPlayer = player.dimension.getPlayers({name: finalTradeData.target})[0];
        if (!targetPlayer) { player.sendMessage("§c상대방이 멀리 있거나 오프라인입니다."); return; }
        
        if (res.selection === 1) {
            player.sendMessage("§c거래를 취소했습니다.");
            targetPlayer.sendMessage("§c[무역] 상대방이 거래를 취소했습니다.");
            return;
        }
        
        const pInvComp = player.getComponent("inventory") || player.getComponent("minecraft:inventory");
        const tInvComp = targetPlayer.getComponent("inventory") || targetPlayer.getComponent("minecraft:inventory");
        
        if (finalTradeData.requesterItem && pInvComp) {
            const cur = pInvComp.container.getItem(finalTradeData.requesterSlot);
            if(!cur || cur.typeId !== finalTradeData.requesterItem.typeId || cur.amount < finalTradeData.requesterItem.amount) {
                player.sendMessage("§c아이템이 부족하여 거래가 취소되었습니다.");
                targetPlayer.sendMessage("§c상대방의 아이템이 부족하여 거래가 취소되었습니다.");
                return;
            }
        }
        if (finalTradeData.targetItem && tInvComp) {
            const cur = tInvComp.container.getItem(finalTradeData.targetSlot);
            if(!cur || cur.typeId !== finalTradeData.targetItem.typeId || cur.amount < finalTradeData.targetItem.amount) {
                player.sendMessage("§c상대방의 아이템이 부족하여 거래가 취소되었습니다.");
                targetPlayer.sendMessage("§c아이템이 부족하여 거래가 취소되었습니다.");
                return;
            }
        }
        
        player.runCommand("scoreboard players remove @s player_money " + finalTradeData.requesterMoney);
        player.runCommand("scoreboard players add @s player_money " + finalTradeData.targetMoney);
        
        targetPlayer.runCommand("scoreboard players remove @s player_money " + finalTradeData.targetMoney);
        targetPlayer.runCommand("scoreboard players add @s player_money " + finalTradeData.requesterMoney);
        
        if (finalTradeData.requesterItem && pInvComp) {
            const cur = pInvComp.container.getItem(finalTradeData.requesterSlot);
            if (cur.amount === finalTradeData.requesterItem.amount) {
                pInvComp.container.setItem(finalTradeData.requesterSlot, undefined);
            } else {
                cur.amount -= finalTradeData.requesterItem.amount;
                pInvComp.container.setItem(finalTradeData.requesterSlot, cur);
            }
            targetPlayer.runCommand("give @s " + finalTradeData.requesterItem.typeId + " " + finalTradeData.requesterItem.amount);
        }
        
        if (finalTradeData.targetItem && tInvComp) {
            const cur = tInvComp.container.getItem(finalTradeData.targetSlot);
            if (cur.amount === finalTradeData.targetItem.amount) {
                tInvComp.container.setItem(finalTradeData.targetSlot, undefined);
            } else {
                cur.amount -= finalTradeData.targetItem.amount;
                tInvComp.container.setItem(finalTradeData.targetSlot, cur);
            }
            player.runCommand("give @s " + finalTradeData.targetItem.typeId + " " + finalTradeData.targetItem.amount);
        }
        
        player.sendMessage("§a[무역 완료] 거래가 성공적으로 성사되었습니다!");
        targetPlayer.sendMessage("§a[무역 완료] 거래가 성공적으로 성사되었습니다!");
    });
}

// ====== V0.7: 부동산 시스템 로직 ======
world.afterEvents.entityHitEntity.subscribe((event) => {
    const player = event.damagingEntity;
    const target = event.hitEntity;
    if (player.typeId !== "minecraft:player" || target.typeId !== "nf:property_sign") return;
    
    const reId = target.getDynamicProperty("re_id");
    if (!reId) return;
    
    let estates = JSON.parse(world.getDynamicProperty("real_estates") || "[]");
    const estate = estates.find(e => e.id === reId);
    if (!estate) {
        player.sendMessage("§c유효하지 않은 매물입니다.");
        target.remove();
        return;
    }
    
    if (estate.owner === player.name) {
        new ActionFormData().title("§l내 부동산 관리").body("매물을 철거하시겠습니까?")
        .button("§c매물 철거하기")
        .button("§a취소")
        .show(player).then(res => {
            if(res.canceled || res.selection === 1) return;
            estates = estates.filter(e => e.id !== reId);
            world.setDynamicProperty("real_estates", JSON.stringify(estates));
            target.remove();
            player.sendMessage("§a[부동산] 매물을 철거했습니다.");
        });
        return;
    }
    
    new ActionFormData().title("§l부동산 구매").body("§f" + estate.name + "\\n§e가격: " + estate.price + "₩\\n§7소유자: " + estate.owner + "\\n\\n이 부동산을 구매하시겠습니까?")
    .button("§a구매하기")
    .button("§c취소")
    .show(player).then(res => {
        if (res.canceled || res.selection === 1) return;
        
        let money = 0;
        try { money = world.scoreboard.getObjective("player_money").getScore(player); } catch(e){}
        if (money < estate.price) { player.sendMessage("§c잔액이 부족합니다."); return; }
        
        player.runCommand("scoreboard players remove @s player_money " + estate.price);
        player.dimension.runCommand("scoreboard players add \\"" + estate.owner + "\\" player_money " + estate.price);
        
        player.sendMessage("§a[부동산] " + estate.name + "을(를) 성공적으로 구매했습니다!");
        try { player.dimension.runCommand("tellraw \\"" + estate.owner + "\\" {\\"rawtext\\":[{\\"text\\":\\"§a[부동산] " + estate.name + "이(가) " + player.name + "님에게 판매되었습니다! (" + estate.price + "₩ 입금)\\"}]}"); } catch(e){}
        
        estate.owner = player.name;
        world.setDynamicProperty("real_estates", JSON.stringify(estates));
        target.nameTag = "§b[부동산] §f" + estate.name + "\\n§e소유자: " + estate.owner;
    });
});

function isProtected(player, blockLocation, dimensionId) {
    if (player.hasTag("admin")) return false; // Admin can bypass
    
    let estates = [];
    try { estates = JSON.parse(world.getDynamicProperty("real_estates") || "[]"); } catch(e){}
    for (const estate of estates) {
        if (estate.dimension === dimensionId) {
            const min = estate.min;
            const max = estate.max;
            if (blockLocation.x >= min.x && blockLocation.x <= max.x &&
                blockLocation.y >= min.y && blockLocation.y <= max.y &&
                blockLocation.z >= min.z && blockLocation.z <= max.z) {
                if (estate.owner !== player.name) {
                    return true;
                }
            }
        }
    }
    return false;
}

world.beforeEvents.playerBreakBlock.subscribe((event) => {
    if (isProtected(event.player, event.block.location, event.dimension.id)) {
        event.cancel = true;
        system.run(() => { event.player.sendMessage("§c[부동산] 남의 영토에서는 블록을 부술 수 없습니다!"); });
    }
});

world.beforeEvents.playerPlaceBlock.subscribe((event) => {
    if (isProtected(event.player, event.block.location, event.dimension.id)) {
        event.cancel = true;
        system.run(() => { event.player.sendMessage("§c[부동산] 남의 영토에서는 블록을 설치할 수 없습니다!"); });
    }
});

// ====== 상호작용 (깃대, 은행 NPC) ======
// (나머지는 파일 끝에 원래 있던 코드들)
`;

// Extract everything from `// ====== 상호작용 (깃대, 은행 NPC) ======` to the end from main_backup.js
let interactionIndex = code.indexOf('// ====== 상호작용 (깃대, 은행 NPC) ======');
let interactionPart = code.substring(interactionIndex); // This includes Bank NPC and Flagpole

// However, I also need to ensure that the initial itemUse events from main_backup are preserved.
// They are in `topPart`.
fs.writeFileSync('BP/scripts/main.js', topPart + "\n" + newCode + "\n" + interactionPart);

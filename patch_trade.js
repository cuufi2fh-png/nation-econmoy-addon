const fs = require('fs');

let code = fs.readFileSync('BP/scripts/main.js', 'utf-8');

// Replace interact logic for trade_port
const oldInteractStart = '    } else if (block.typeId === "nf:trade_port") {';
const oldInteractEnd = '});'; // Be careful, the very next }); closes world.beforeEvents.playerInteractWithBlock.subscribe

const newTradeLogic = `    } else if (block.typeId === "nf:trade_port") {
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
});`;

// Find the trade_port logic
let lines = code.split('\n');
let startIdx = lines.findIndex(l => l.includes('} else if (block.typeId === "nf:trade_port") {'));
let endIdx = -1;
for (let i = startIdx + 1; i < lines.length; i++) {
    if (lines[i].startsWith('});')) {
        endIdx = i;
        break;
    }
}

if (startIdx !== -1 && endIdx !== -1) {
    lines.splice(startIdx, endIdx - startIdx + 1, newTradeLogic);
}
code = lines.join('\n');

// Now we need to remove the old showTradeMenu, showTradeSellMenu, showTradeBuyMenu
// They are at the end of the file.
let tradeFuncStart = code.indexOf('// [V0.6] 무역 포트 메뉴 (비동기 마켓)');
if (tradeFuncStart !== -1) {
    // Actually, I can just replace everything from there to the end or right before posAddItemUI
    // wait, posAddItemUI is appended at the very end in the previous patch.
    // Let's just find the exact string.
}

// I will just append the new P2P trade functions at the end of the file, and we don't strictly *need* to delete the old ones if they are unused, but it's cleaner to remove them.
code += `

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
        
        // Check invs safely
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
        
        // Money
        player.runCommand("scoreboard players remove @s player_money " + finalTradeData.requesterMoney);
        player.runCommand("scoreboard players add @s player_money " + finalTradeData.targetMoney);
        
        targetPlayer.runCommand("scoreboard players remove @s player_money " + finalTradeData.targetMoney);
        targetPlayer.runCommand("scoreboard players add @s player_money " + finalTradeData.requesterMoney);
        
        // Items
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
`;

fs.writeFileSync('BP/scripts/main.js', code);

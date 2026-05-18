import { world, system } from "@minecraft/server";
import { ModalFormData, ActionFormData } from "@minecraft/server-ui";

// ====== V0.1: 국가 생성 로직 ======
function getNextNationId() {
    let id = world.getDynamicProperty("nextNationId");
    if (id === undefined) id = 1;
    world.setDynamicProperty("nextNationId", id + 1);
    return id;
}

world.beforeEvents.itemUse.subscribe((event) => {
    const item = event.itemStack;
    const player = event.source;

    if (item.typeId.includes("banner")) {
        const nationName = item.nameTag;
        if (nationName && nationName !== "" && !nationName.includes("Banner") && !nationName.includes("현수막")) {
            if (player.hasTag("has_nation")) {
                system.run(() => { player.sendMessage("§c이미 소속된 국가가 있습니다!"); });
                return;
            }
            event.cancel = true;
            system.run(() => {
                const currentNationId = getNextNationId();
                const nId = "nation_id_" + currentNationId;
                player.addTag("has_nation");
                player.addTag("nation_leader");
                player.addTag(nId);
                player.runCommand(`scoreboard players set @s nation_id ${currentNationId}`);
                player.runCommand(`tellraw @a {"rawtext":[{"text":"§e[공지] §a${player.name}§f님이 §b${nationName}§f 국가를 건국했습니다!"}]}`);
                player.runCommand(`function nation/create`);
                
                let currencies = JSON.parse(world.getDynamicProperty("currencies") || "{}");
                currencies[nId] = {
    symbol: "COIN",
    supply: 100000,
    rate: 1.0,
    tax_rate: 50,

    treasury: 0,          // 국가 금고
    server_treasury: 0    // 서버 세금 보관용
};
                world.setDynamicProperty("currencies", JSON.stringify(currencies));
                
                let nationNames = JSON.parse(world.getDynamicProperty("nation_names") || "{}");
                nationNames[nId] = nationName;
                world.setDynamicProperty("nation_names", JSON.stringify(nationNames));
                
                world.setDynamicProperty("player_nation_" + player.name, nId);

                const equipment = player.getComponent("equippable");
                if (equipment) {
                    const mainhand = equipment.getEquipment("Mainhand");
                    if (mainhand && mainhand.amount > 1) {
                        mainhand.amount--;
                        equipment.setEquipment("Mainhand", mainhand);
                    } else {
                        equipment.setEquipment("Mainhand", undefined);
                    }
                }
            });
        }
    } else if (item.typeId === "nf:check_card") {
        event.cancel = true;
        system.run(() => {
            const nId = getNationId(player);
            if (!nId) { player.sendMessage("§c국가에 소속되어야 조회 가능합니다."); return; }
            const curr = getCurrencyInfo(nId);
            let money = 0;
            try { money = world.scoreboard.getObjective("player_money").getScore(player); } catch(e) {}
            player.sendMessage(`§a[체크카드] 잔액: ${money.toLocaleString()} ${curr.symbol}`);
        });
    } else if (item.typeId === "nf:credit_card") {
        event.cancel = true;
        system.run(() => {
            const nId = getNationId(player);
            if (!nId) { player.sendMessage("§c국가에 소속되어야 조회 가능합니다."); return; }
            const curr = getCurrencyInfo(nId);
            let creditScore = JSON.parse(world.getDynamicProperty("credit_score_" + player.name) || "500");
            let debt = JSON.parse(world.getDynamicProperty("debt_" + player.name) || "0");
            let limit = creditScore * 100;
            player.sendMessage(`§6[신용카드] 총 한도: ${Math.floor(limit).toLocaleString()} ${curr.symbol} | 누적 사용액(빚): ${Math.floor(debt).toLocaleString()} ${curr.symbol}`);
        });
    } else if (item.typeId === "nf:property_wand") {
        event.cancel = true;
        system.run(() => {
            const x1 = JSON.parse(world.getDynamicProperty("re_pos1_x_" + player.name) || "null");
            const y1 = JSON.parse(world.getDynamicProperty("re_pos1_y_" + player.name) || "null");
            const z1 = JSON.parse(world.getDynamicProperty("re_pos1_z_" + player.name) || "null");
            const x2 = JSON.parse(world.getDynamicProperty("re_pos2_x_" + player.name) || "null");
            const y2 = JSON.parse(world.getDynamicProperty("re_pos2_y_" + player.name) || "null");
            const z2 = JSON.parse(world.getDynamicProperty("re_pos2_z_" + player.name) || "null");
            
            if (x1 === null || x2 === null) {
                player.sendMessage("§c[부동산] 영역이 완전히 설정되지 않았습니다. 지팡이로 두 블록을 클릭(하나는 웅크리고)하세요.");
                return;
            }
            
            new ModalFormData().title("§l부동산 및 상업 건물 매물 등록")
            .dropdown("용도 및 거래 방식 선택", [
                "🏠 주택 매매 등록 (단독 소유권 판매)",
                "🏠 주택 월세 임대 등록 (세입자 임대)",
                "🏢 상업용 건물 통째로 매매 (소유권 판매)",
                "🏢 상업용 건물주 직접 등록 (방 임대업 시작)"
            ])
            .textField("매물/건물 이름", "예: 강남빌라 101호")
            .textField("가격 / 월세 (단위: ₩)", "예: 50000")
            .show(player).then(res => {
                if (res.canceled) return;
                const type = res.formValues[0];
                const name = res.formValues[1] || "이름 없는 매물";
                const price = parseInt(res.formValues[2]);
                if (isNaN(price) || price < 0) { player.sendMessage("§c가격을 올바르게 입력하세요."); return; }
                
                const minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
                const minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
                const minZ = Math.min(z1, z2), maxZ = Math.max(z1, z2);
                
                const reData = {
                    id: "re_" + Date.now(),
                    type: type, name: name, price: price, owner: player.name, tenant: "", rooms: [],
                    min: {x: minX, y: minY, z: minZ}, max: {x: maxX, y: maxY, z: maxZ},
                    dimension: player.dimension.id
                };
                
                let estates = JSON.parse(world.getDynamicProperty("real_estates") || "[]");
                estates.push(reData);
                world.setDynamicProperty("real_estates", JSON.stringify(estates));
                
                const signX = Math.floor((minX + maxX)/2);
                const signY = Math.floor((minY + maxY)/2);
                const signZ = Math.floor((minZ + maxZ)/2);
                
                if (type === 0) {
                    const sign = player.dimension.spawnEntity("nf:property_sign", {x: signX + 0.5, y: signY + 0.5, z: signZ + 0.5});
                    sign.nameTag = "§b[주택 매매]\n§f" + name + "\n§e매매가: " + price.toLocaleString() + "₩\n§a클릭하여 인수";
                    sign.setDynamicProperty("re_id", reData.id);
                    player.sendMessage("§a[부동산] 주택 매매 등록 완료! (" + minX + "," + minY + "," + minZ + " ~ " + maxX + "," + maxY + "," + maxZ + ")");
                } else if (type === 1) {
                    const sign = player.dimension.spawnEntity("nf:property_sign", {x: signX + 0.5, y: signY + 0.5, z: signZ + 0.5});
                    sign.nameTag = "§a[주택 임대]\n§f" + name + "\n§e월세: " + price.toLocaleString() + "₩\n§7(48분마다)\n§b클릭하여 입주";
                    sign.setDynamicProperty("re_id", reData.id);
                    player.sendMessage("§a[부동산] 주택 월세 임대 등록 완료! (" + minX + "," + minY + "," + minZ + " ~ " + maxX + "," + maxY + "," + maxZ + ")");
                } else if (type === 2) {
                    const sign = player.dimension.spawnEntity("nf:property_sign", {x: signX + 0.5, y: signY + 0.5, z: signZ + 0.5});
                    sign.nameTag = "§6[건물 매매]\n§f" + name + "\n§e매매가: " + price.toLocaleString() + "₩\n§a클릭하여 건물주 되기";
                    sign.setDynamicProperty("re_id", reData.id);
                    player.sendMessage("§a[부동산] 상업용 건물 매매 등록 완료! (" + minX + "," + minY + "," + minZ + " ~ " + maxX + "," + maxY + "," + maxZ + ")");
                } else if (type === 3) {
                    player.runCommand("give @s nf:building_cert 1");
                    player.sendMessage("§a[건물주 등록] '" + name + "' 건물의 소유 증명서가 발급되었습니다! 증명서를 들고 허공을 클릭하여 임대할 방들을 관리하세요.");
                }
            });
        });
    } else if (item.typeId === "nf:id_card") {
        event.cancel = true;
        system.run(() => { showIdCardUI(player); });
    } else if (item.typeId === "nf:building_cert") {
        event.cancel = true;
        system.run(() => {
            let estates = JSON.parse(world.getDynamicProperty("real_estates") || "[]");
            const myBuildings = estates.filter(e => e.owner === player.name && (e.type === 2 || e.type === 3));
            if (myBuildings.length === 0) { player.sendMessage("§c소유 중인 상업용 건물이 없습니다."); return; }
            
            if (myBuildings.length === 1) { showBuildingManageUI(player, myBuildings[0]); return; }
            
            const form = new ActionFormData().title("§l소유 건물 목록").body("관리할 건물을 선택하세요.");
            for (const b of myBuildings) form.button(`§e🏢 ${b.name}`);
            form.button("닫기");
            form.show(player).then(res => {
                if (res.canceled || res.selection === myBuildings.length) return;
                showBuildingManageUI(player, myBuildings[res.selection]);
            });
        });
    }
});

function showBuildingManageUI(player, building) {
    const form = new ActionFormData().title(`§l건물 관리 - ${building.name}`)
    .body(`§e건물주: §f${building.owner}\n§b현재 등록된 임대 방(점포) 수: §f${(building.rooms || []).length}개\n\n원하시는 작업을 선택하세요.`);
    
    form.button("§a+ 신규 임대 방(점포) 등록하기");
    const rooms = building.rooms || [];
    for (const r of rooms) {
        form.button(`§e방 ${r.name}\n§f월세: ${r.price.toLocaleString()}₩ | ${r.tenant ? "세입자: " + r.tenant : "§b임대 문의중"}`);
    }
    form.button("닫기");
    
    form.show(player).then(res => {
        if (res.canceled || res.selection === rooms.length + 1) return;
        if (res.selection === 0) {
            const loc = player.location;
            new ModalFormData().title(`§l신규 임대 방 등록 (${building.name})`)
            .textField("방/점포 이름 (호수)", "예: 101호")
            .textField("월세 금액 (₩)", "예: 30000")
            .show(player).then(r => {
                if (r.canceled) return;
                const roomName = r.formValues[0];
                const roomPrice = parseInt(r.formValues[1]);
                if (!roomName || roomName === "" || isNaN(roomPrice) || roomPrice < 0) {
                    player.sendMessage("§c입력값이 올바르지 않습니다."); return;
                }
                
                let estates = JSON.parse(world.getDynamicProperty("real_estates") || "[]");
                let bIdx = estates.findIndex(e => e.id === building.id);
                if (bIdx === -1) return;
                
                const roomId = "room_" + Date.now();
                if (!estates[bIdx].rooms) estates[bIdx].rooms = [];
                estates[bIdx].rooms.push({ id: roomId, name: roomName, price: roomPrice, tenant: "", loc: { x: Math.floor(loc.x), y: Math.floor(loc.y), z: Math.floor(loc.z) } });
                world.setDynamicProperty("real_estates", JSON.stringify(estates));
                
                const sign = player.dimension.spawnEntity("nf:property_sign", {x: Math.floor(loc.x) + 0.5, y: Math.floor(loc.y) + 0.5, z: Math.floor(loc.z) + 0.5});
                sign.nameTag = `§b[임대 문의]\n§f${building.name} ${roomName}\n§e월세: ${roomPrice.toLocaleString()}₩\n§a클릭하여 점포 임대`;
                sign.setDynamicProperty("re_id", building.id);
                sign.setDynamicProperty("room_id", roomId);
                
                player.sendMessage(`§a[건물 관리] 성공적으로 '${roomName}' 점포 임대 문의가 등록되었습니다! (현재 서 있는 위치에 표지판 생성됨)`);
            });
        } else {
            const r = rooms[res.selection - 1];
            new ActionFormData().title(`§l방 관리 - ${r.name}`).body(`§e방 이름: §f${r.name}\n§a월세: §f${r.price.toLocaleString()}₩\n§b세입자: §f${r.tenant ? r.tenant : "없음 (임대 대기중)"}`)
            .button(r.tenant ? "§c세입자 퇴거 (계약 해지)" : "§7(세입자 없음)")
            .button("뒤로 가기")
            .show(player).then(r2 => {
                if (r2.canceled || r2.selection === 1) { showBuildingManageUI(player, building); return; }
                if (r2.selection === 0 && r.tenant) {
                    let estates = JSON.parse(world.getDynamicProperty("real_estates") || "[]");
                    let bIdx = estates.findIndex(e => e.id === building.id);
                    if (bIdx !== -1) {
                        let rIdx = estates[bIdx].rooms.findIndex(rm => rm.id === r.id);
                        if (rIdx !== -1) {
                            const oldTenant = estates[bIdx].rooms[rIdx].tenant;
                            estates[bIdx].rooms[rIdx].tenant = "";
                            world.setDynamicProperty("real_estates", JSON.stringify(estates));
                            player.sendMessage(`§c[건물 관리] 세입자(${oldTenant})와의 임대 계약을 해지했습니다.`);
                            
                            const loc = estates[bIdx].rooms[rIdx].loc;
                            const signs = player.dimension.getEntities({ type: "nf:property_sign", location: { x: loc.x + 0.5, y: loc.y + 0.5, z: loc.z + 0.5 }, maxDistance: 1.0 });
                            for (const s of signs) {
                                s.nameTag = `§b[임대 문의]\n§f${building.name} ${r.name}\n§e월세: ${r.price.toLocaleString()}₩\n§a클릭하여 점포 임대`;
                            }
                        }
                    }
                }
            });
        }
    });
}

function getNationId(playerOrName) {
    if (typeof playerOrName === "string") {
        return world.getDynamicProperty("player_nation_" + playerOrName) || null;
    } else {
        const tags = playerOrName.getTags();
        for (const tag of tags) if (tag.startsWith("nation_id_")) return tag;
        return null;
    }
}

function getCurrencyInfo(nId) {
    if (!nId) return { symbol: "무국적", supply: 1, rate: 1.0, tax_rate: 50 };
    let currencies = JSON.parse(world.getDynamicProperty("currencies") || "{}");
    return currencies[nId] || { symbol: "COIN", supply: 100000, rate: 1.0, tax_rate: 50 };
}

// ====== 부동산 거래 헬퍼 함수 ======
function calculateRealEstateFee(basePrice, sellerNationId) {
    const FEE_RATE = 0.0514; // 5.14% 수수료
    const fee = Math.floor(basePrice * FEE_RATE);
    const totalPayment = basePrice + fee;
    
    const sellerCurr = getCurrencyInfo(sellerNationId);
    const taxRate = (sellerCurr.tax_rate || 50) / 100;
    const taxAmount = Math.floor(basePrice * taxRate);
    const sellerAmount = basePrice - taxAmount; // 판매자가 받는 금액 (세금 제외)
    
    return {
        basePrice: basePrice,
        fee: fee,
        totalPayment: totalPayment,
        taxAmount: taxAmount,
        sellerAmount: sellerAmount,
        feeRate: FEE_RATE,
        taxRate: taxRate
    };
}

function spawnRealtorNPC(dimension, location, estate) {
    const npc = dimension.spawnEntity("nf:realtor_npc", location);
    npc.nameTag = `§6부동산 사장\n§e${estate.name}`;
    npc.setDynamicProperty("re_id", estate.id);
    npc.setDynamicProperty("re_type", estate.type);
    return npc;
}

function processPropertySale(player, estate, buyer, seller, basePrice) {
    const dimension = player.dimension;
    const sellerNationId = getNationId(seller);
    const buyerNationId = getNationId(buyer);
    
    // 수수료 및 세금 계산
    const trans = calculateRealEstateFee(basePrice, sellerNationId);
    
    // 거래 기록 저장
    let transactions = JSON.parse(world.getDynamicProperty("real_estate_transactions") || "[]");
    const transRecord = {
        id: "trans_" + Date.now(),
        timestamp: Date.now(),
        estate: estate.id,
        buyer: buyer,
        seller: seller,
        basePrice: basePrice,
        fee: trans.fee,
        tax: trans.taxAmount,
        finalPrice: trans.totalPayment
    };
    transactions.push(transRecord);
    world.setDynamicProperty("real_estate_transactions", JSON.stringify(transactions));
    
    // 거래 처리
    try {
        dimension.runCommand(`scoreboard players remove "${buyer}" player_money ${trans.totalPayment}`);
    } catch(e) {}
    
    try {
        dimension.runCommand(`scoreboard players add "${seller}" player_money ${trans.sellerAmount}`);
    } catch(e) {}
    
    // 서버 계좌로 수수료 입금
    try {
        dimension.runCommand(`scoreboard players add @s[name="SYSTEM"] player_money ${trans.fee}`);
    } catch(e) {}
    
    // 알림
    const curr = getCurrencyInfo(buyerNationId);
    try {
        dimension.runCommand(`tellraw "${buyer}" {"rawtext":[{"text":"§a[부동산 거래 완료]\\n§f물건: ${estate.name}\\n§a구매가: ${basePrice.toLocaleString()}${curr.symbol}\\n§e수수료: ${trans.fee.toLocaleString()}${curr.symbol}\\n§c국가세: ${trans.taxAmount.toLocaleString()}${curr.symbol}\\n§b총 결제: ${trans.totalPayment.toLocaleString()}${curr.symbol}"}]}`);
    } catch(e) {}
    
    try {
        dimension.runCommand(`tellraw "${seller}" {"rawtext":[{"text":"§a[부동산 판매 완료]\\n§f물건: ${estate.name}\\n§a판매가: ${basePrice.toLocaleString()}${curr.symbol}\\n§c국가세: ${trans.taxAmount.toLocaleString()}${curr.symbol}\\n§b수령액: ${trans.sellerAmount.toLocaleString()}${curr.symbol}"}]}`);
    } catch(e) {}
    
    return transRecord;
}

// ====== 부동산 표지판 클릭 (NPC 스폰) ======
world.beforeEvents.playerInteractWithEntity.subscribe((event) => {
    const target = event.target;
    const player = event.player;
    
    // 부동산 사장 NPC 클릭 처리
    if (target.typeId === "nf:realtor_npc") {
        event.cancel = true;
        system.run(() => {
            const reId = target.getDynamicProperty("re_id");
            if (!reId) return;
            let estates = JSON.parse(world.getDynamicProperty("real_estates") || "[]");
            let bIdx = estates.findIndex(e => e.id === reId);
            if (bIdx === -1) return;
            let estate = estates[bIdx];
            
            showRealEstateTradingUI(player, estate, estates, bIdx);
        });
        return;
    }
    
    // 기존 표지판 클릭 로직 (NPC 스폰으로 변경)
    if (target.typeId !== "nf:property_sign") return;
    event.cancel = true;
    
    system.run(() => {
        const reId = target.getDynamicProperty("re_id");
        if (!reId) return;
        let estates = JSON.parse(world.getDynamicProperty("real_estates") || "[]");
        let bIdx = estates.findIndex(e => e.id === reId);
        if (bIdx === -1) return;
        let estate = estates[bIdx];
        
        // 표지판 대신 NPC 스폰
        const npcLocation = {x: target.location.x, y: target.location.y + 0.5, z: target.location.z};
        const npc = spawnRealtorNPC(player.dimension, npcLocation, estate);
        player.sendMessage(`§a[부동산] 부동산 사장이 나타났습니다! NPC를 클릭하여 거래하세요.`);
    });
});

// ====== 부동산 거래 UI ======
function showRealEstateTradingUI(player, estate, estates, bIdx) {
    const roomId = null; // 이 함수에서 처리할 roomId는 NPC의 데이터 속성에서 가져옴
        
        if (roomId) {
            let rIdx = (estate.rooms || []).findIndex(rm => rm.id === roomId);
            if (rIdx === -1) return;
            let room = estate.rooms[rIdx];
            
            if (room.tenant === player.name) {
                player.sendMessage(`§e[부동산] 당신이 임대 중인 점포입니다. (월세: ${room.price.toLocaleString()}₩)`); return;
            }
            if (room.tenant !== "") {
                player.sendMessage(`§c[부동산] 이미 임대된 점포입니다. (세입자: ${room.tenant})`); return;
            }
            if (estate.owner === player.name) {
                new ActionFormData().title(`§l내 점포 관리 - ${room.name}`).body(`§e월세: ${room.price.toLocaleString()}₩ | 임대 문의중\n이 임대 문의 표지판을 철거하시겠습니까?`)
                .button("§c임대 문의 철거").button("닫기").show(player).then(r => {
                    if (r.canceled || r.selection === 1) return;
                    estates[bIdx].rooms.splice(rIdx, 1);
                    world.setDynamicProperty("real_estates", JSON.stringify(estates));
                    target.remove();
                    player.sendMessage("§c[건물 관리] 임대 문의 표지판을 철거했습니다.");
                });
                return;
            }
            
            new ActionFormData().title("§l점포 임대 계약")
            .body(`§e🏢 건물명: §f${estate.name} ${room.name}\n§a💰 월세: §f${room.price.toLocaleString()}₩ (48분마다)\n§b👑 건물주: §f${estate.owner}\n\n§d[계약 혜택] 계약 체결 시 영업용 POS 단말기 1대가 즉시 지급됩니다!\n계약하시겠습니까?`)
            .button("§a계약 체결 및 첫 달 월세 결제").button("취소").show(player).then(r => {
                if (r.canceled || r.selection === 1) return;
                let money = 0; try { money = world.scoreboard.getObjective("player_money").getScore(player); } catch(e){}
                if (money < room.price) { player.sendMessage("§c잔액이 부족합니다."); return; }
                
                player.runCommand(`scoreboard players remove @s player_money ${room.price}`);
                player.dimension.runCommand(`scoreboard players add "${estate.owner}" player_money ${room.price}`);
                try { player.dimension.runCommand(`tellraw "${estate.owner}" {"rawtext":[{"text":"§a[부동산 입금] ${player.name}님이 점포(${estate.name} ${room.name}) 임대 계약을 체결하여 첫 달 월세 ${room.price.toLocaleString()}₩이 입금되었습니다!"}]}`); } catch(e){}
                
                estates[bIdx].rooms[rIdx].tenant = player.name;
                world.setDynamicProperty("real_estates", JSON.stringify(estates));
                
                target.nameTag = `§d[영업중]\n§f${estate.name} ${room.name}\n§7대표: ${player.name}\n§e월세: ${room.price.toLocaleString()}₩`;
                player.runCommand("give @s nf:pos_terminal 1");
                player.sendMessage("§a[점포 임대] 계약이 체결되었습니다! 인벤토리로 POS 단말기가 지급되었습니다. 점포에 설치하여 장사를 시작하세요!");
            });
            return;
        }
        
        if (estate.owner === player.name) {
            new ActionFormData().title(`§l내 매물 관리 - ${estate.name}`).body(`§e등록 가격/월세: ${estate.price.toLocaleString()}₩\n이 매물 등록을 취소하고 표지판을 철거하시겠습니까?`)
            .button("§c매물 등록 취소 및 철거").button("닫기").show(player).then(r => {
                if (r.canceled || r.selection === 1) return;
                estates.splice(bIdx, 1);
                world.setDynamicProperty("real_estates", JSON.stringify(estates));
                target.remove();
                player.sendMessage("§c[부동산] 매물 등록을 취소했습니다.");
            });
            return;
        }

        let money = 0; try { money = world.scoreboard.getObjective("player_money").getScore(player); } catch(e){}
        if (money < estate.price) { player.sendMessage("§c잔액이 부족합니다."); return; }
        
        if (estate.type === 0) { // 주택 매매
            new ActionFormData().title("§l주택 매매 계약").body(`§e🏠 주택명: §f${estate.name}\n§a💰 매매가: §f${estate.price.toLocaleString()}₩\n§b👑 소유자: §f${estate.owner}\n\n구매하시겠습니까?`)
            .button("§a매매 체결 (구매)").button("취소").show(player).then(r => {
                if (r.canceled || r.selection === 1) return;
                if (money < estate.price) { player.sendMessage("§c잔액이 부족합니다."); return; }
                player.runCommand(`scoreboard players remove @s player_money ${estate.price}`);
                player.dimension.runCommand(`scoreboard players add "${estate.owner}" player_money ${estate.price}`);
                try { player.dimension.runCommand(`tellraw "${estate.owner}" {"rawtext":[{"text":"§a[부동산 입금] ${player.name}님이 주택(${estate.name})을 매수하여 ${estate.price.toLocaleString()}₩이 입금되었습니다!"}]}`); } catch(e){}
                
                estates[bIdx].owner = player.name;
                world.setDynamicProperty("real_estates", JSON.stringify(estates));
                target.remove();
                player.sendMessage("§a[부동산] 주택 매매 완료! 이제 이 주택은 당신의 소유입니다.");
            });
        } else if (estate.type === 1) { // 주택 임대
            if (estate.tenant === player.name) { player.sendMessage(`§e[부동산] 당신이 임대 중인 주택입니다. (월세: ${estate.price.toLocaleString()}₩)`); return; }
            if (estate.tenant !== "") { player.sendMessage(`§c[부동산] 이미 임대된 주택입니다. (세입자: ${estate.tenant})`); return; }
            
            new ActionFormData().title("§l주택 임대 계약").body(`§e🏠 주택명: §f${estate.name}\n§a💰 월세: §f${estate.price.toLocaleString()}₩ (48분마다)\n§b👑 집주인: §f${estate.owner}\n\n계약하시겠습니까?`)
            .button("§a임대 계약 및 첫 달 월세 결제").button("취소").show(player).then(r => {
                if (r.canceled || r.selection === 1) return;
                if (money < estate.price) { player.sendMessage("§c잔액이 부족합니다."); return; }
                player.runCommand(`scoreboard players remove @s player_money ${estate.price}`);
                player.dimension.runCommand(`scoreboard players add "${estate.owner}" player_money ${estate.price}`);
                try { player.dimension.runCommand(`tellraw "${estate.owner}" {"rawtext":[{"text":"§a[부동산 입금] ${player.name}님이 주택(${estate.name}) 임대 계약을 체결하여 첫 달 월세 ${estate.price.toLocaleString()}₩이 입금되었습니다!"}]}`); } catch(e){}
                
                estates[bIdx].tenant = player.name;
                world.setDynamicProperty("real_estates", JSON.stringify(estates));
                target.nameTag = `§d[임대중]\n§f${estate.name}\n§7세입자: ${player.name}\n§e월세: ${estate.price.toLocaleString()}₩`;
                player.sendMessage("§a[부동산] 주택 임대 계약 완료! 48분마다 월세가 자동 출금됩니다.");
            });
        } else if (estate.type === 2) { // 상업용 건물 매매
            new ActionFormData().title("§l상업용 건물 매매 계약").body(`§e🏢 건물명: §f${estate.name}\n§a💰 매매가: §f${estate.price.toLocaleString()}₩\n§b👑 건물주: §f${estate.owner}\n\n건물을 인수하시겠습니까?`)
            .button("§a건물 인수 및 대금 결제").button("취소").show(player).then(r => {
                if (r.canceled || r.selection === 1) return;
                if (money < estate.price) { player.sendMessage("§c잔액이 부족합니다."); return; }
                player.runCommand(`scoreboard players remove @s player_money ${estate.price}`);
                player.dimension.runCommand(`scoreboard players add "${estate.owner}" player_money ${estate.price}`);
                try { player.dimension.runCommand(`tellraw "${estate.owner}" {"rawtext":[{"text":"§a[부동산 입금] ${player.name}님이 건물(${estate.name})을 인수하여 ${estate.price.toLocaleString()}₩이 입금되었습니다!"}]}`); } catch(e){}
                
                estates[bIdx].owner = player.name;
                estates[bIdx].type = 3; // 이제 건물주가 되었으므로 방 임대업 가능 상태
                world.setDynamicProperty("real_estates", JSON.stringify(estates));
                target.remove();
                player.runCommand("give @s nf:building_cert 1");
                player.sendMessage("§a[부동산] 상업용 건물 인수 완료! 건물 소유 증명서를 발급받았습니다. 증명서를 들고 클릭하여 방 임대를 시작하세요.");
            });
        }
    });
});

// ====== 현수막 및 POS 기기 설치/파괴 로직 ======
world.afterEvents.playerPlaceBlock.subscribe((event) => {
    const block = event.block;
    const player = event.player;
    if (block.typeId === "nf:pos_terminal") {
        const marker = event.dimension.spawnEntity("nf:pos_marker", { x: block.location.x + 0.5, y: block.location.y, z: block.location.z + 0.5 });
        marker.setDynamicProperty("pos_owner", ""); marker.nameTag = "§8주인 없는 단말기";
    }
    
    if (block.typeId.includes("banner")) {
        const nId = getNationId(player);
        if (!nId) {
            system.run(() => { player.sendMessage("§c[영토] 국가에 소속된 국민/지도자만 현수막을 설치하여 영토를 점령/확장할 수 있습니다."); }); return;
        }
        system.run(() => {
            let allFlagpoles = JSON.parse(world.getDynamicProperty("all_flagpoles") || "{}");
            let nationNames = JSON.parse(world.getDynamicProperty("nation_names") || "{}");
            const nationName = nationNames[nId] || nId.replace("nation_id_", "국가 ");
            const loc = block.location; const key = `${loc.x},${loc.y},${loc.z}`;
            allFlagpoles[key] = nId;
            world.setDynamicProperty("all_flagpoles", JSON.stringify(allFlagpoles));
            recalculateBorders(allFlagpoles);
            player.sendMessage(`§a[영토 점령] 현수막이 설치되어 '${nationName}' 국가의 영토로 편입되었습니다! (${loc.x}, ${loc.y}, ${loc.z})`);
        });
    }
});

world.afterEvents.playerBreakBlock.subscribe((event) => {
    const perm = event.brokenBlockPermutation;
    const loc = event.block.location;
    if (perm.type.id === "nf:pos_terminal") {
        const markers = event.dimension.getEntities({ type: "nf:pos_marker", location: { x: loc.x + 0.5, y: loc.y, z: loc.z + 0.5 }, maxDistance: 0.5 });
        for (const marker of markers) marker.remove();
    }
    
    if (perm.type.id.includes("banner")) {
        system.run(() => {
            let allFlagpoles = JSON.parse(world.getDynamicProperty("all_flagpoles") || "{}");
            const key = `${loc.x},${loc.y},${loc.z}`;
            if (allFlagpoles[key]) {
                delete allFlagpoles[key];
                world.setDynamicProperty("all_flagpoles", JSON.stringify(allFlagpoles));
                recalculateBorders(allFlagpoles);
            }
        });
    }
});

// ====== 블록 상호작용 (POS, 무역포트, 지팡이) ======
world.beforeEvents.playerInteractWithBlock.subscribe((event) => {
    const block = event.block;
    const player = event.player;
    
    const now = Date.now();
    const lastTime = JSON.parse(world.getDynamicProperty("last_interact_time_" + player.name) || "0");
    if (now - lastTime < 500) return;
    world.setDynamicProperty("last_interact_time_" + player.name, JSON.stringify(now));
    
    if (event.itemStack && event.itemStack.typeId === "nf:property_wand") {
        event.cancel = true;
        const isSneaking = player.isSneaking;
        const pos = block.location;
        if (isSneaking) {
            world.setDynamicProperty("re_pos2_x_" + player.name, JSON.stringify(pos.x));
            world.setDynamicProperty("re_pos2_y_" + player.name, JSON.stringify(pos.y));
            world.setDynamicProperty("re_pos2_z_" + player.name, JSON.stringify(pos.z));
            system.run(() => { player.sendMessage("§a[부동산] 두 번째 지점 (Pos2) 설정: " + pos.x + ", " + pos.y + ", " + pos.z); });
        } else {
            world.setDynamicProperty("re_pos1_x_" + player.name, JSON.stringify(pos.x));
            world.setDynamicProperty("re_pos1_y_" + player.name, JSON.stringify(pos.y));
            world.setDynamicProperty("re_pos1_z_" + player.name, JSON.stringify(pos.z));
            system.run(() => { player.sendMessage("§a[부동산] 첫 번째 지점 (Pos1) 설정: " + pos.x + ", " + pos.y + ", " + pos.z + "\n(웅크리고 클릭하면 Pos2가 설정됩니다)"); });
        }
        return;
    }

    if (block.typeId === "nf:pos_terminal") {
        event.cancel = true;
        system.run(() => {
            const markers = player.dimension.getEntities({ type: "nf:pos_marker", location: { x: block.location.x + 0.5, y: block.location.y, z: block.location.z + 0.5 }, maxDistance: 0.5 });
            if (markers.length === 0) return;
            const marker = markers[0];
            const owner = marker.getDynamicProperty("pos_owner") || "";
            const activeCartStr = marker.getDynamicProperty("pos_active_cart") || "";
            
            if (owner === "") {
                new ActionFormData().title("§lPOS 단말기").body("아직 주인이 없습니다.")
                .button("§a점주 등록하기")
                .show(player).then(res => {
                    if (res.canceled) return;
                    marker.setDynamicProperty("pos_owner", player.name);
                    marker.setDynamicProperty("pos_catalog", "[]");
                    marker.setDynamicProperty("pos_cart", "[]");
                    marker.setDynamicProperty("pos_active_cart", "");
                    marker.nameTag = "§e" + player.name + "의 상점";
                    player.sendMessage("§a[POS] 이제 당신이 점주입니다.");
                });
                return;
            }

            if (activeCartStr !== "") {
                const equip = player.getComponent("equippable");
                const mainhand = equip ? equip.getEquipment("Mainhand") : undefined;
                const isCard = mainhand && (mainhand.typeId === "nf:check_card" || mainhand.typeId === "nf:credit_card");
                
                if (isCard) {
                    processPosPayment(player, marker, owner, JSON.parse(activeCartStr));
                } else {
                    if (player.name === owner) {
                        new ActionFormData().title("§l결제 대기 관리").body("현재 결제 대기 중인 장바구니 목록이 있습니다.\n결제 대기 상태를 취소하시겠습니까?")
                        .button("§c결제 대기 취소")
                        .button("§a닫기 (유지)")
                        .show(player).then(res => {
                            if (res.canceled || res.selection === 1) return;
                            marker.setDynamicProperty("pos_active_cart", "");
                            marker.nameTag = "§e" + owner + "의 상점";
                            player.sendMessage("§a[POS] 결제 대기 상태가 취소되었습니다.");
                        });
                    } else {
                        player.sendMessage("§c[POS] 결제 대기 중입니다. 손에 카드(체크/신용카드)를 들고 터치해 주세요.");
                    }
                }
                return;
            }

            if (player.name === owner) {
                new ActionFormData().title("§lPOS 점주 메뉴").body("원하시는 작업을 선택하세요.")
                .button("§a🛒 계산 시작 (장바구니 담기)")
                .button("§b📦 판매 상품 관리 (영구 등록/삭제)")
                .button("§6📈 기업 주식 상장 (IPO 신청)")
                .button("§c⚠️ 점주 등록 해제 (초기화)")
                .show(player).then(res => {
                    if(res.canceled) return;
                    if(res.selection === 0) showPosSellUI(player, marker);
                    if(res.selection === 1) showPosCatalogUI(player, marker);
                    if(res.selection === 2) showPosIPOUI(player, marker);
                    if(res.selection === 3) {
                        marker.setDynamicProperty("pos_owner", "");
                        marker.setDynamicProperty("pos_catalog", "[]");
                        marker.setDynamicProperty("pos_cart", "[]");
                        marker.setDynamicProperty("pos_active_cart", "");
                        marker.nameTag = "§8주인 없는 단말기";
                        player.sendMessage("§a[POS] 단말기가 초기화되었습니다.");
                    }
                });
            } else {
                player.sendMessage("§c[POS] 현재 판매 대기 중인 상품이 없습니다.");
            }
        });
    } else if (block.typeId === "nf:trade_port") {
        event.cancel = true;
        system.run(() => {
            new ActionFormData().title("§l무역 및 금융 센터").body("원하시는 시스템을 선택하세요.")
            .button("§a[물물교환] P2P 무역 테이블")
            .button("§6[증권거래소] 실시간 주식 시장")
            .button("§b[계좌이체] 플레이어 송금")
            .button("닫기")
            .show(player).then(res => {
                if (res.canceled || res.selection === 3) return;
                if (res.selection === 0) {
                    let finalStr = JSON.parse(world.getDynamicProperty("final_trade_" + player.name) || "null");
                    let pendingStr = JSON.parse(world.getDynamicProperty("pending_trade_" + player.name) || "null");
                    if (finalStr) showFinalTradeMenu(player, finalStr);
                    else if (pendingStr) showTradeReplyMenu(player, pendingStr);
                    else showP2PTradeMenu(player);
                } else if (res.selection === 1) {
                    showStockMarketUI(player);
                } else if (res.selection === 2) {
                    showWireTransferUI(player);
                }
            });
        });
    }
});

// ====== POS 기기 헬퍼 함수 ======
function showPosIPOUI(player, marker) {
    new ModalFormData().title("§l기업 주식 상장 (IPO)")
    .textField("상장할 기업/종목명", "예: 데릭 컴퍼니", player.name + " 컴퍼니")
    .textField("초기 공모 주가 (₩)", "예: 5000", "5000")
    .textField("초기 자본금/매출액 (₩)", "예: 1000000", "1000000")
    .textField("초기 채무액 (₩)", "예: 0", "0")
    .show(player).then(r => {
        if (r.canceled) return;
        const name = r.formValues[0];
        const price = parseInt(r.formValues[1]);
        const rev = parseInt(r.formValues[2]);
        const debt = parseInt(r.formValues[3]);
        
        if (!name || name === "" || isNaN(price) || price <= 0 || isNaN(rev) || isNaN(debt)) {
            player.sendMessage("§c입력값이 올바르지 않습니다."); return;
        }
        
        let stocks = JSON.parse(world.getDynamicProperty("stock_market") || JSON.stringify(defaultStocks));
        const key = "ipo_" + Date.now();
        stocks[key] = { name: name, price: price, revenue: rev, debt: debt, history: [price], fluc: 0.05 };
        world.setDynamicProperty("stock_market", JSON.stringify(stocks));
        
        player.runCommand(`tellraw @a {"rawtext":[{"text":"§e[증권거래소 공지] §a${player.name}§f님의 기업 §b'${name}'§f이(가) 공모가 §e${price.toLocaleString()}₩§f에 신규 상장되었습니다!"}]}`);
    });
}

function showPosCatalogUI(player, marker) {
    let catalog = JSON.parse(marker.getDynamicProperty("pos_catalog") || "[]");
    const form = new ActionFormData().title("§l판매 상품 관리").body("현재 영구 등록된 상품 목록입니다.");
    form.button("§a+ 새 상품 영구 등록 (인벤토리에서)");
    for (let i = 0; i < catalog.length; i++) {
        form.button(`§c[삭제] §f${catalog[i].name} (개당 ${catalog[i].price.toLocaleString()}₩)`);
    }
    form.button("§7뒤로 가기");
    
    form.show(player).then(res => {
        if (res.canceled) return;
        if (res.selection === 0) {
            const invComp = player.getComponent("inventory") || player.getComponent("minecraft:inventory");
            if (!invComp) return;
            const inventory = invComp.container;
            const items = []; const options = [];
            
            for (let i = 0; i < inventory.size; i++) {
                const item = inventory.getItem(i);
                if (item) {
                    items.push({ slot: i, item: item });
                    options.push(`${item.typeId.replace("minecraft:", "")} (보유: ${item.amount}개)`);
                }
            }
            if (items.length === 0) { player.sendMessage("§c인벤토리에 등록할 아이템이 없습니다."); return; }
            
            new ModalFormData().title("§l새 판매 상품 영구 등록")
            .dropdown("등록할 아이템 선택", options)
            .textField("개당 판매 가격 (₩)", "예: 1000")
            .show(player).then(r => {
                if (r.canceled) return;
                const idx = r.formValues[0];
                const price = parseInt(r.formValues[1]);
                if (isNaN(price) || price <= 0) { player.sendMessage("§c올바른 가격을 입력하세요."); return; }
                
                const selectedItem = items[idx].item;
                const name = selectedItem.typeId.replace("minecraft:", "");
                catalog.push({ typeId: selectedItem.typeId, name: name, price: price });
                marker.setDynamicProperty("pos_catalog", JSON.stringify(catalog));
                player.sendMessage(`§a[POS] '${name}' 상품이 개당 ${price.toLocaleString()}₩에 영구 등록되었습니다!`);
                showPosCatalogUI(player, marker);
            });
        } else if (res.selection <= catalog.length) {
            const delIdx = res.selection - 1;
            const delName = catalog[delIdx].name; catalog.splice(delIdx, 1);
            marker.setDynamicProperty("pos_catalog", JSON.stringify(catalog));
            player.sendMessage(`§c[POS] '${delName}' 상품이 목록에서 삭제되었습니다.`);
            showPosCatalogUI(player, marker);
        }
    });
}

function showPosSellUI(player, marker) {
    let catalog = JSON.parse(marker.getDynamicProperty("pos_catalog") || "[]");
    if (catalog.length === 0) {
        player.sendMessage("§c[POS] 등록된 상품이 없습니다. '판매 상품 관리'에서 먼저 상품을 영구 등록하세요."); return;
    }
    
    let cart = JSON.parse(marker.getDynamicProperty("pos_cart") || "[]");
    let cartTotal = cart.reduce((sum, item) => sum + item.price, 0);
    let cartSummary = cart.length === 0 ? "§7(장바구니 비어 있음)" : cart.map(c => `§f- ${c.name} x${c.amount} (${c.price.toLocaleString()}₩)`).join("\n");
    
    const form = new ActionFormData().title("§lPOS 장바구니 계산")
    .body(`§e[현재 장바구니 목록]\n${cartSummary}\n\n§a💰 총 합계 금액: ${cartTotal.toLocaleString()}₩\n\n원하시는 작업을 선택하세요.`);
    
    form.button("§a+ 장바구니에 상품 추가");
    if (cart.length > 0) {
        form.button("§e🚀 [결제 대기] 손님 결제 요청하기");
        form.button("§c🗑️ 장바구니 전체 비우기");
    }
    form.button("§7닫기");
    
    form.show(player).then(res => {
        if (res.canceled) return;
        if (res.selection === 0) {
            const options = catalog.map(c => `${c.name} (개당 ${c.price.toLocaleString()}₩)`);
            new ModalFormData().title("§l장바구니 상품 추가")
            .dropdown("추가할 상품 선택", options)
            .slider("수량 선택", 1, 64, 1, 1)
            .show(player).then(r => {
                if (r.canceled) return;
                const selected = catalog[r.formValues[0]];
                const amount = r.formValues[1];
                const itemTotal = selected.price * amount;
                
                cart.push({ typeId: selected.typeId, name: selected.name, amount: amount, price: itemTotal });
                marker.setDynamicProperty("pos_cart", JSON.stringify(cart));
                player.sendMessage(`§a[POS] 장바구니 추가: ${selected.name} x${amount} (+${itemTotal.toLocaleString()}₩)`);
                showPosSellUI(player, marker);
            });
        } else if (res.selection === 1 && cart.length > 0) {
            marker.setDynamicProperty("pos_active_cart", JSON.stringify(cart));
            marker.setDynamicProperty("pos_cart", "[]");
            marker.nameTag = `§e[결제 대기중] §f상품 ${cart.length}종 합계\n§a총액: ${cartTotal.toLocaleString()}₩\n§b카드를 들고 터치하세요`;
            player.sendMessage(`§a[POS] 결제 대기 시작! 총액 ${cartTotal.toLocaleString()}₩ (손님이 카드로 터치하면 결제됩니다)`);
        } else if (res.selection === 2 && cart.length > 0) {
            marker.setDynamicProperty("pos_cart", "[]");
            player.sendMessage("§c[POS] 장바구니를 비웠습니다.");
            showPosSellUI(player, marker);
        }
    });
}

function processPosPayment(player, marker, owner, cart) {
    const equip = player.getComponent("equippable");
    const mainhand = equip ? equip.getEquipment("Mainhand") : undefined;
    if (!mainhand || (mainhand.typeId !== "nf:check_card" && mainhand.typeId !== "nf:credit_card")) return;
    
    const customerNationId = getNationId(player);
    if (!customerNationId) { player.sendMessage("§c국가에 소속되어야 금융을 이용할 수 있습니다."); return; }
    const customerCurr = getCurrencyInfo(customerNationId);
    const ownerNationId = getNationId(owner); const ownerCurr = getCurrencyInfo(ownerNationId);
    
    const currentPrice = cart.reduce((sum, item) => sum + item.price, 0);
    const valueInGold = currentPrice * ownerCurr.rate;
    const customerPrice = Math.ceil(valueInGold / customerCurr.rate);
    
    const isCredit = (mainhand.typeId === "nf:credit_card");
    let customerMoney = 0;
    try { customerMoney = world.scoreboard.getObjective("player_money").getScore(player); } catch (e) {}

    if (isCredit) {
        let creditScore = JSON.parse(world.getDynamicProperty("credit_score_" + player.name) || "500");
        let debt = JSON.parse(world.getDynamicProperty("debt_" + player.name) || "0");
        let limit = creditScore * 100;
        
        if (customerPrice > (limit - debt)) {
            player.sendMessage(`§c[결제 실패] 한도 초과. (지불 금액: ${customerPrice.toLocaleString()} ${customerCurr.symbol})`); return;
        }
        world.setDynamicProperty("debt_" + player.name, JSON.stringify(debt + customerPrice));
        player.sendMessage(`§a[결제 완료] 신용 승인: ${customerPrice.toLocaleString()} ${customerCurr.symbol} 결제됨.`);
    } else {
        if (customerMoney < customerPrice) { 
            player.sendMessage(`§c[결제 실패] 잔액 부족. (필요: ${customerPrice.toLocaleString()} ${customerCurr.symbol}, 환율 적용됨)`); return; 
        }
        player.runCommand(`scoreboard players remove @s player_money ${customerPrice}`);
        player.sendMessage(`§a[결제 완료] ${customerPrice.toLocaleString()} ${customerCurr.symbol} 차감됨. (환율 자동 적용)`);
    }
    
    const fee = Math.floor(currentPrice * 0.05); const ownerIncome = currentPrice - fee;
    player.dimension.runCommand(`scoreboard players add "${owner}" player_money ${ownerIncome}`);
    try { player.dimension.runCommand(`tellraw "${owner}" {"rawtext":[{"text":"§a[POS] ${ownerIncome.toLocaleString()} ${ownerCurr.symbol} 입금됨! (수수료 ${fee.toLocaleString()} 공제, 상품 ${cart.length}종 판매)"}]}`); } catch(e) {}
    
    for (const item of cart) { player.runCommand(`give @s ${item.typeId} ${item.amount}`); }
    marker.setDynamicProperty("pos_active_cart", ""); marker.nameTag = `§e${owner}의 상점`;
}

// ====== P2P 무역 및 송금 로직 ======
function showWireTransferUI(player) {
    const otherPlayers = world.getAllPlayers().filter(p => p.name !== player.name);
    if (otherPlayers.length === 0) { player.sendMessage("§c현재 접속 중인 다른 플레이어가 없습니다."); return; }
    const options = otherPlayers.map(p => p.name);
    let money = 0; try { money = world.scoreboard.getObjective("player_money").getScore(player); } catch(e){}
    
    new ModalFormData().title("§l계좌 이체 (송금)")
    .dropdown(`받는 사람 선택 (내 잔액: ${money.toLocaleString()}₩)`, options)
    .textField("송금할 금액 (₩)", "예: 10000")
    .show(player).then(r => {
        if (r.canceled) return;
        const targetPlayer = otherPlayers[r.formValues[0]]; const amount = parseInt(r.formValues[1]);
        if (isNaN(amount) || amount <= 0) { player.sendMessage("§c올바른 금액을 입력하세요."); return; }
        if (money < amount) { player.sendMessage("§c잔액이 부족합니다."); return; }
        
        player.runCommand(`scoreboard players remove @s player_money ${amount}`);
        targetPlayer.runCommand(`scoreboard players add @s player_money ${amount}`);
        player.sendMessage(`§a[송금 완료] ${targetPlayer.name}님에게 ${amount.toLocaleString()}₩을 송금했습니다.`);
        targetPlayer.sendMessage(`§a[은행 입금] ${player.name}님으로부터 ${amount.toLocaleString()}₩이 입금되었습니다!`);
    });
}

function showP2PTradeMenu(player) {
    const players = player.dimension.getPlayers({ location: player.location, maxDistance: 5 });
    const nearby = players.filter(p => p.name !== player.name);
    if (nearby.length === 0) {
        player.sendMessage("§c[무역 포트] 주변(5블록 이내)에 거래할 다른 플레이어가 없습니다.\n§7(무역 테이블은 2명의 플레이어가 마주보고 거래하는 시스템입니다)"); return;
    }
    const options = nearby.map(p => p.name);
    new ModalFormData().title("§l무역 포트 (1:1 거래)").dropdown("거래 상대 선택", options)
    .show(player).then(res => {
        if (res.canceled) return;
        const targetPlayerName = options[res.formValues[0]];
        const targetPlayer = nearby.find(p => p.name === targetPlayerName);
        if (!targetPlayer) return;

        const invComp = player.getComponent("inventory") || player.getComponent("minecraft:inventory");
        if (!invComp) return; const inventory = invComp.container;
        const items = []; const itemOptions = [];
        for (let i = 0; i < inventory.size; i++) {
            const item = inventory.getItem(i);
            if (item) { items.push({ slot: i, item: item }); itemOptions.push(`${item.typeId.replace("minecraft:", "")} x${item.amount}`); }
        }
        if (items.length === 0) { player.sendMessage("§c거래할 아이템이 인벤토리에 없습니다."); return; }

        new ModalFormData().title(`§l무역 제안 -> ${targetPlayerName}`)
        .dropdown("내가 줄 아이템 선택", itemOptions)
        .textField("상대에게 요구할 자금 (단위: ₩)", "예: 5000")
        .show(player).then(r => {
            if (r.canceled) return;
            const selected = items[r.formValues[0]]; const price = parseInt(r.formValues[1]);
            if (isNaN(price) || price < 0) { player.sendMessage("§c올바른 금액을 입력하세요."); return; }

            const item = inventory.getItem(selected.slot); if (!item) return;
            inventory.setItem(selected.slot, undefined);

            const tradeData = {
                sender: player.name, recipient: targetPlayerName,
                item: { typeId: item.typeId, amount: item.amount }, price: price
            };
            world.setDynamicProperty("pending_trade_" + targetPlayerName, JSON.stringify(tradeData));
            targetPlayer.sendMessage(`§a[무역 포트] ${player.name}님으로부터 거래 제안이 도착했습니다! 무역 포트를 클릭하여 확인하세요.`);
            player.sendMessage(`§a[무역 포트] ${targetPlayerName}님에게 거래를 제안했습니다.`);
        });
    });
}

function showTradeReplyMenu(player, tradeData) {
    const itemName = tradeData.item.typeId.replace("minecraft:", "");
    new ActionFormData().title("§l도착한 무역 제안")
    .body(`§e${tradeData.sender}§f님의 제안:\n\n§b[받을 아이템]§f ${itemName} x${tradeData.item.amount}\n§c[지불할 금액]§f ${tradeData.price.toLocaleString()}₩`)
    .button("§a수락 (결제 및 거래 진행)").button("§c거절")
    .show(player).then(res => {
        world.setDynamicProperty("pending_trade_" + player.name, undefined);
        if (res.canceled || res.selection === 1) {
            const senderPlayer = world.getAllPlayers().find(p => p.name === tradeData.sender);
            if (senderPlayer) {
                senderPlayer.sendMessage(`§c[무역 포트] ${player.name}님이 거래 제안을 거절했습니다.`);
                senderPlayer.runCommand(`give @s ${tradeData.item.typeId} ${tradeData.item.amount}`);
            }
            player.sendMessage("§c거래 제안을 거절했습니다.");
            return;
        }

        let money = 0; try { money = world.scoreboard.getObjective("player_money").getScore(player); } catch(e){}
        if (money < tradeData.price) {
            player.sendMessage("§c잔액이 부족하여 거래를 수락할 수 없습니다.");
            const senderPlayer = world.getAllPlayers().find(p => p.name === tradeData.sender);
            if(senderPlayer) senderPlayer.runCommand(`give @s ${tradeData.item.typeId} ${tradeData.item.amount}`);
            return;
        }

        player.runCommand(`scoreboard players remove @s player_money ${tradeData.price}`);
        player.runCommand(`give @s ${tradeData.item.typeId} ${tradeData.item.amount}`);

        const finalData = { sender: tradeData.sender, recipient: player.name, price: tradeData.price, itemName: itemName, amount: tradeData.item.amount };
        world.setDynamicProperty("final_trade_" + tradeData.sender, JSON.stringify(finalData));

        const senderPlayer = world.getAllPlayers().find(p => p.name === tradeData.sender);
        if (senderPlayer) {
            senderPlayer.sendMessage(`§a[무역 포트] ${player.name}님이 거래를 수락했습니다! 무역 포트를 클릭하여 대금을 수령하세요.`);
        }
        player.sendMessage(`§a[무역 포트] 거래가 완료되었습니다! (${tradeData.price.toLocaleString()}₩ 지불)`);
    });
}

function showFinalTradeMenu(player, finalData) {
    new ActionFormData().title("§l무역 대금 수령")
    .body(`§a${finalData.recipient}§f님과의 거래가 완료되었습니다.\n\n§b[판매한 아이템]§f ${finalData.itemName} x${finalData.amount}\n§e[수령할 대금]§f ${finalData.price.toLocaleString()}₩`)
    .button("§a대금 수령하기")
    .show(player).then(res => {
        if (res.canceled) return;
        world.setDynamicProperty("final_trade_" + player.name, undefined);
        player.runCommand(`scoreboard players add @s player_money ${finalData.price}`);
        player.sendMessage(`§a[무역 포트] 성공적으로 ${finalData.price.toLocaleString()}₩을 수령했습니다!`);
    });
}

// ====== 증권 거래소 (Stock Market) 로직 ======
let defaultStocks = {
    "mining": { name: "국영 광업 공사", price: 5000, revenue: 1500000, debt: 200000, history: [5000], fluc: 0.05 },
    "arms": { name: "크리퍼 무기 산업", price: 12000, revenue: 4800000, debt: 1500000, history: [12000], fluc: 0.08 },
    "bank": { name: "베드락 건설 은행", price: 25000, revenue: 9500000, debt: 500000, history: [25000], fluc: 0.03 }
};

function showStockMarketUI(player) {
    let stocks = JSON.parse(world.getDynamicProperty("stock_market") || JSON.stringify(defaultStocks));
    let playerStocks = JSON.parse(world.getDynamicProperty("player_stocks_" + player.name) || "{}");
    
    const form = new ActionFormData().title("§l증권 거래소 (Stock Exchange)")
    .body("실시간 주식 시세 및 보유 자산을 관리합니다.\n주가는 1분마다 변동하며 경제 상황에 영향을 받습니다.");
    
    const keys = Object.keys(stocks);
    for (const key of keys) {
        const st = stocks[key]; const myCount = playerStocks[key] || 0;
        form.button(`§e${st.name}\n§f현재가: ${st.price.toLocaleString()}₩ (보유: ${myCount}주)`);
    }
    form.button("§a내 주식 지갑 조회 및 전체 매도");
    form.button("닫기");
    
    form.show(player).then(res => {
        if (res.canceled || res.selection === keys.length + 1) return;
        if (res.selection < keys.length) {
            const key = keys[res.selection]; const st = stocks[key]; const myCount = playerStocks[key] || 0;
            
            new ActionFormData().title(`§l종목 상세 정보 - ${st.name}`)
            .body(`§e[기업 재무 상태]\n§f🏢 종목명: ${st.name}\n§a📈 현재 주가: ${st.price.toLocaleString()}₩\n§b💰 연간 매출액: ${(st.revenue || 1000000).toLocaleString()}₩\n§c📉 현재 채무 상태: ${(st.debt || 0).toLocaleString()}₩\n\n§7내 보유 수량: ${myCount}주\n\n원하시는 거래를 선택하세요.`)
            .button("§a주식 매수 (Buy)").button("§c주식 매도 (Sell)").button("뒤로 가기")
            .show(player).then(r => {
                if (r.canceled || r.selection === 2) { showStockMarketUI(player); return; }
                let money = 0; try { money = world.scoreboard.getObjective("player_money").getScore(player); } catch(e){}
                
                if (r.selection === 0) {
                    const maxBuy = Math.floor(money / st.price);
                    new ModalFormData().title(`§l주식 매수 - ${st.name}`)
                    .slider(`매수 수량 (현재가: ${st.price.toLocaleString()}₩ | 보유금액: ${money.toLocaleString()}₩)`, 1, Math.max(1, maxBuy > 64 ? 64 : maxBuy), 1, 1)
                    .show(player).then(r2 => {
                        if (r2.canceled) return; const amount = r2.formValues[0]; const totalCost = st.price * amount;
                        if (money < totalCost) { player.sendMessage("§c잔액이 부족합니다."); return; }
                        player.runCommand(`scoreboard players remove @s player_money ${totalCost}`);
                        playerStocks[key] = (playerStocks[key] || 0) + amount;
                        world.setDynamicProperty("player_stocks_" + player.name, JSON.stringify(playerStocks));
                        player.sendMessage(`§a[증권] ${st.name} ${amount}주를 ${totalCost.toLocaleString()}₩에 매수했습니다!`);
                        showStockMarketUI(player);
                    });
                } else if (r.selection === 1) {
                    if (myCount === 0) { player.sendMessage("§c보유 중인 주식이 없습니다."); showStockMarketUI(player); return; }
                    new ModalFormData().title(`§l주식 매도 - ${st.name}`)
                    .slider(`매도 수량 (현재가: ${st.price.toLocaleString()}₩ | 보유: ${myCount}주)`, 1, myCount, 1, 1)
                    .show(player).then(r2 => {
                        if (r2.canceled) return; const amount = r2.formValues[0]; const totalIncome = st.price * amount;
                        player.runCommand(`scoreboard players add @s player_money ${totalIncome}`);
                        playerStocks[key] -= amount; if (playerStocks[key] <= 0) delete playerStocks[key];
                        world.setDynamicProperty("player_stocks_" + player.name, JSON.stringify(playerStocks));
                        player.sendMessage(`§a[증권] ${st.name} ${amount}주를 매도하여 ${totalIncome.toLocaleString()}₩을 입금받았습니다!`);
                        showStockMarketUI(player);
                    });
                }
            });
        } else if (res.selection === keys.length) {
            const sellForm = new ActionFormData().title("§l내 주식 지갑 및 매도").body("보유 중인 주식을 매도(판매)할 수 있습니다.");
            const ownedKeys = keys.filter(k => (playerStocks[k] || 0) > 0);
            if (ownedKeys.length === 0) { sellForm.button("보유 중인 주식이 없습니다.").show(player).then(() => showStockMarketUI(player)); return; }
            for (const k of ownedKeys) { sellForm.button(`§c[매도] §f${stocks[k].name} (보유: ${playerStocks[k]}주 | 현재가: ${stocks[k].price.toLocaleString()}₩)`); }
            sellForm.button("뒤로 가기");
            sellForm.show(player).then(r => {
                if (r.canceled || r.selection === ownedKeys.length) { showStockMarketUI(player); return; }
                const k = ownedKeys[r.selection]; const st = stocks[k]; const myCount = playerStocks[k];
                new ModalFormData().title(`§l주식 매도 - ${st.name}`)
                .slider(`매도 수량 (현재가: ${st.price.toLocaleString()}₩ | 보유: ${myCount}주)`, 1, myCount, 1, 1)
                .show(player).then(res2 => {
                    if (res2.canceled) return; const amount = res2.formValues[0]; const totalIncome = st.price * amount;
                    player.runCommand(`scoreboard players add @s player_money ${totalIncome}`);
                    playerStocks[k] -= amount; if (playerStocks[k] <= 0) delete playerStocks[k];
                    world.setDynamicProperty("player_stocks_" + player.name, JSON.stringify(playerStocks));
                    player.sendMessage(`§a[증권] ${st.name} ${amount}주를 매도하여 ${totalIncome.toLocaleString()}₩을 입금받았습니다!`);
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
        st.revenue = Math.floor((st.revenue || 1000000) * (1 + (changeRate * 0.5)));
        st.history.push(st.price); if (st.history.length > 5) st.history.shift();
    }
    world.setDynamicProperty("stock_market", JSON.stringify(stocks));
}, 1200);

// ====== 신분증 및 은행/대출 UI ======
function showIdCardUI(player) {
    const nId = getNationId(player);
    let nationNames = JSON.parse(world.getDynamicProperty("nation_names") || "{}");
    
    if (!nId) {
        const availableNations = Object.keys(nationNames);
        const form = new ActionFormData().title("§l국가 포털 (무국적 상태)").body("현재 소속된 국가가 없습니다.\n원하시는 작업을 선택하세요.");
        if (availableNations.length > 0) form.button("§a국가 가입하기 (기존 국가 선택)");
        else form.button("§7[가입 불가] 생성된 국가 없음");
        form.button("§b국가 건국 안내 (현수막 사용)"); form.button("닫기");
        
        form.show(player).then(res => {
            if (res.canceled) return;
            if (res.selection === 0 && availableNations.length > 0) {
                const options = availableNations.map(id => `${nationNames[id]} (ID: ${id.replace("nation_id_", "")})`);
                new ModalFormData().title("§l국가 가입").dropdown("가입할 국가를 선택하세요.", options)
                .show(player).then(r => {
                    if (r.canceled) return; const selectedId = availableNations[r.formValues[0]];
                    player.addTag("has_nation"); player.addTag(selectedId);
                    const numId = selectedId.replace("nation_id_", "");
                    player.runCommand(`scoreboard players set @s nation_id ${numId}`);
                    world.setDynamicProperty("player_nation_" + player.name, selectedId);
                    player.sendMessage(`§a[안내] 성공적으로 '${nationNames[selectedId]}' 국가에 가입되었습니다!`);
                });
            } else if (res.selection === 1 || (res.selection === 0 && availableNations.length === 0)) {
                player.sendMessage("§e[건국 안내] §f모루에서 현수막(Banner)의 이름을 국가명으로 변경한 뒤, 손에 들고 허공을 클릭(사용)하면 나만의 국가가 건국됩니다!");
            }
        });
        return;
    }
    
    let hasId = JSON.parse(world.getDynamicProperty("id_issued_" + player.name) || "false");
    if (!hasId) {
        new ModalFormData().title("§l신분증 발급").textField("집 주소를 입력하세요.", "예: 서울시 강남구...")
        .show(player).then(res => {
            if (res.canceled) return; const address = res.formValues[0] || "알 수 없음";
            const passport = "M-" + Math.floor(Math.random() * 900000 + 100000);
            world.setDynamicProperty("id_address_" + player.name, JSON.stringify(address));
            world.setDynamicProperty("id_passport_" + player.name, JSON.stringify(passport));
            world.setDynamicProperty("id_issued_" + player.name, JSON.stringify(true));
            player.sendMessage("§a[안내] 신분증 발급이 완료되었습니다."); showIdCardUI(player);
        });
        return;
    }
    
    const address = JSON.parse(world.getDynamicProperty("id_address_" + player.name) || '"알 수 없음"');
    const passport = JSON.parse(world.getDynamicProperty("id_passport_" + player.name) || '"M-000000"');
    const displayNationName = nationNames[nId] || nId.replace("nation_id_", "국가 "); 
    const curr = getCurrencyInfo(nId);
    
    const form = new ActionFormData().title("§l신분증 및 국가 관리")
    .body(`§b소속 국가: §f${displayNationName}\n§e이름: §f${player.name}\n§a집 주소: §f${address}\n§6여권 번호: §f${passport}\n\n§7화폐 기호: ${curr.symbol} | 세금 비율: ${curr.tax_rate || 50} Gold 기준`);
    
    form.button("§e국고 및 경제 정보 조회");
    form.button("§b계좌 이체 (플레이어 송금)");
    form.button("§c국가 탈퇴하기");
    if (player.hasTag("nation_leader")) form.button("§6[지도자] 국가 설정 (이름/화폐/세금)");
    form.button("닫기");
    
    form.show(player).then(res => {
        if (res.canceled) return;
        if (res.selection === 0) {
            let treasury = 0; try { treasury = world.scoreboard.getObjective("treasury").getScore(player.dimension.getEntities({name: displayNationName})[0]); } catch(e){}
            player.sendMessage(`§e[국가 정보] §b${displayNationName}§f | 국고 잔액: ${treasury.toLocaleString()} ${curr.symbol} | 현재 환율: ${curr.rate.toFixed(4)}`);
        } else if (res.selection === 1) {
            showWireTransferUI(player);
        } else if (res.selection === 2) {
            new ActionFormData().title("§l국가 탈퇴 확인").body("정말로 소속 국가를 탈퇴하시겠습니까?\n§c(주의: 탈퇴 시 국가의 보호 및 혜택을 받을 수 없게 됩니다)")
            .button("§c탈퇴하기").button("§a취소")
            .show(player).then(r => {
                if (r.canceled || r.selection === 1) return;
                player.getTags().forEach(t => { if(t.startsWith("nation_id_") || t === "has_nation" || t === "nation_leader") player.removeTag(t); });
                player.runCommand("scoreboard players set @s nation_id 0");
                world.setDynamicProperty("player_nation_" + player.name, undefined);
                player.sendMessage("§c[안내] 국가에서 탈퇴하여 무국적자가 되었습니다.");
            });
        } else if (player.hasTag("nation_leader") && res.selection === 3) {
            new ModalFormData().title("§l국가 설정 관리")
            .textField("국가명 변경", "새 국가명 입력", displayNationName)
            .textField("화폐 기호/단위 변경", "예: KRW, USD", curr.symbol)
            .textField("영토당 세금 징수액 (기본 50)", "숫자 입력", String(curr.tax_rate || 50))
            .show(player).then(r => {
                if (r.canceled) return;
                const newName = r.formValues[0]; const newSym = r.formValues[1].toUpperCase(); const newTax = parseInt(r.formValues[2]);
                if (newName && newName !== "") nationNames[nId] = newName;
                if (newSym && newSym !== "") curr.symbol = newSym;
                if (!isNaN(newTax) && newTax >= 0) curr.tax_rate = newTax;
                
                let currencies = JSON.parse(world.getDynamicProperty("currencies") || "{}"); currencies[nId] = curr;
                world.setDynamicProperty("currencies", JSON.stringify(currencies));
                world.setDynamicProperty("nation_names", JSON.stringify(nationNames));
                player.sendMessage(`§a[국가 설정] 성공적으로 변경되었습니다!\n§f국가명: ${newName} | 화폐: ${newSym} | 세금: ${newTax}`);
            });
        }
    });
}

function showBankMenu(player) {
    const nId = getNationId(player); const curr = getCurrencyInfo(nId);
    let creditScore = JSON.parse(world.getDynamicProperty("credit_score_" + player.name) || "500");
    let debt = JSON.parse(world.getDynamicProperty("debt_" + player.name) || "0");
    let money = 0; try { money = world.scoreboard.getObjective("player_money").getScore(player); } catch(e) {}

    const form = new ActionFormData().title(`§l${curr.symbol} 은행 업무`)
        .body(`§e[환율 정보] 1 Gold = ${(1.0 / curr.rate).toFixed(2)} ${curr.symbol}\n\n§a[내 정보]\n§f잔액: ${money.toLocaleString()} ${curr.symbol}\n§c빚: ${Math.floor(debt).toLocaleString()} ${curr.symbol}\n§b신용 점수: ${Math.floor(creditScore)}점\n`)
        .button("대출 신청").button("대출 상환");
    if (player.hasTag("nation_leader")) form.button("§6[지도자] 중앙은행");
    form.button("닫기");

    form.show(player).then((res) => {
        if (res.canceled) return;
        if (res.selection === 0) showLoanApplyUI(player, creditScore, debt, curr);
        if (res.selection === 1) showLoanRepayUI(player, money, debt, creditScore, curr);
        if (player.hasTag("nation_leader") && res.selection === 2) showCentralBankUI(player, nId, curr);
    });
}

function showLoanApplyUI(player, creditScore, debt, curr) {
    let maxLoan = Math.max(0, (creditScore * 50) - debt);
    new ModalFormData().title("대출 신청").textField(`최대 대출: ${Math.floor(maxLoan).toLocaleString()} ${curr.symbol}`, "금액 입력")
    .show(player).then(res => {
        if(res.canceled) return; let amt = parseInt(res.formValues[0]); if(isNaN(amt) || amt <= 0) return;
        if(amt > maxLoan) { player.sendMessage("§c한도를 초과했습니다."); return; }
        player.runCommand(`scoreboard players add @s player_money ${amt}`);
        world.setDynamicProperty("debt_" + player.name, JSON.stringify(debt + amt));
        player.sendMessage(`§a[은행] ${amt.toLocaleString()} ${curr.symbol} 대출 승인.`);
    });
}

function showLoanRepayUI(player, money, debt, creditScore, curr) {
    new ModalFormData().title("대출 상환").textField(`잔액: ${money.toLocaleString()} ${curr.symbol}\n빚: ${Math.floor(debt).toLocaleString()} ${curr.symbol}`, "상환할 금액 입력")
    .show(player).then(res => {
        if(res.canceled) return; let amt = parseInt(res.formValues[0]); if(isNaN(amt) || amt <= 0) return;
        if(amt > money) { player.sendMessage("§c잔액 부족."); return; }
        if(amt > debt) amt = debt;
        player.runCommand(`scoreboard players remove @s player_money ${amt}`);
        world.setDynamicProperty("debt_" + player.name, JSON.stringify(debt - amt));
        world.setDynamicProperty("credit_score_" + player.name, JSON.stringify(Math.min(1000, creditScore + (amt / 1000))));
        player.sendMessage(`§a[은행] ${amt.toLocaleString()} ${curr.symbol} 상환 완료.`);
    });
}

function showCentralBankUI(player, nId, curr) {
    new ActionFormData().title(`§l${curr.symbol} 중앙은행 (지도자 전용)`)
        .body(`§b국가 통화 관리 시스템입니다.\n§f현재 통화량: ${curr.supply.toLocaleString()} ${curr.symbol}\n현재 환율: ${curr.rate.toFixed(4)}`)
        .button("화폐 기호 변경").button("통화 발행 (양적완화)").button("닫기")
        .show(player).then(res => {
            if (res.canceled || res.selection === 2) return;
            if (res.selection === 0) {
                new ModalFormData().title("화폐 기호 변경").textField("새로운 화폐 기호 (예: KRW, USD)", "문자 입력", curr.symbol)
                .show(player).then(r => {
                    if(r.canceled) return; let sym = r.formValues[0].toUpperCase();
                    if(sym.length > 0 && sym.length <= 5) {
                        let currencies = JSON.parse(world.getDynamicProperty("currencies") || "{}");
                        currencies[nId].symbol = sym; world.setDynamicProperty("currencies", JSON.stringify(currencies));
                        player.sendMessage(`§a[중앙은행] 화폐 기호가 ${sym} (으)로 변경되었습니다.`);
                    }
                });
            } else if (res.selection === 1) {
                new ModalFormData().title("통화 발행 (양적완화)").textField("새로 찍어낼 화폐 액수", "예: 50000")
                .show(player).then(r => {
                    if(r.canceled) return; let amt = parseInt(r.formValues[0]);
                    if(!isNaN(amt) && amt > 0) {
                        let currencies = JSON.parse(world.getDynamicProperty("currencies") || "{}");
                        let c = currencies[nId]; c.supply += amt; c.rate = 100000 / c.supply;
                        world.setDynamicProperty("currencies", JSON.stringify(currencies));
                        player.runCommand(`scoreboard players add @s player_money ${amt}`);
                        player.sendMessage(`§c[경고] §a${amt.toLocaleString()} ${c.symbol}§c 을 발행했습니다. 통화량 증가로 환율이 §e${c.rate.toFixed(4)}§c 로 하락했습니다.`);
                    }
                });
            }
        });
}

// ====== 백그라운드 루프 (국경선, 월세 출금, 대출이자) ======
function recalculateBorders(allFlagpoles) {
    let borderLines = []; const nationPoints = {};
    for (const [posKey, nId] of Object.entries(allFlagpoles)) {
        if (!nationPoints[nId]) nationPoints[nId] = [];
        const [x, y, z] = posKey.split(",").map(Number);
        nationPoints[nId].push({x, y, z});
    }
    for (const [nId, points] of Object.entries(nationPoints)) {
        for (let i = 0; i < points.length; i++) {
            for (let j = i + 1; j < points.length; j++) {
                const p1 = points[i]; const p2 = points[j];
                const dx = p1.x - p2.x; const dz = p1.z - p2.z;
                if ((dx*dx + dz*dz) <= 2500) borderLines.push({ p1, p2, nId });
            }
        }
    }
    world.setDynamicProperty("border_lines", JSON.stringify(borderLines));
}

system.runInterval(() => {
    const borderLinesStr = world.getDynamicProperty("border_lines"); if (!borderLinesStr) return;
    const borderLines = JSON.parse(borderLinesStr); if (borderLines.length === 0) return;
    
    for (const player of world.getAllPlayers()) {
        const px = player.location.x; const pz = player.location.z; const dim = player.dimension;
        for (const line of borderLines) {
            const midX = (line.p1.x + line.p2.x) / 2; const midZ = (line.p1.z + line.p2.z) / 2;
            if ((px - midX) ** 2 + (pz - midZ) ** 2 < 2500) {
                const steps = 15; const dx = (line.p2.x - line.p1.x) / steps; const dy = (line.p2.y - line.p1.y) / steps; const dz = (line.p2.z - line.p1.z) / steps;
                for (let i = 0; i <= steps; i++) {
                    dim.spawnParticle("minecraft:villager_happy", {x: line.p1.x + dx*i, y: line.p1.y + dy*i + 1.5, z: line.p1.z + dz*i});
                }
            }
        }
    }
}, 20);

// 현실시간 48분(57600틱)마다 주택 월세 및 점포 월세 출금
system.runInterval(() => {
    let estates = JSON.parse(world.getDynamicProperty("real_estates") || "[]");
    const overworld = world.getDimension("overworld");
    
    for (let bIdx = 0; bIdx < estates.length; bIdx++) {
        let estate = estates[bIdx];
        if (estate.type === 1 && estate.tenant !== "") { // 주택 임대
            overworld.runCommand(`scoreboard players remove "${estate.tenant}" player_money ${estate.price}`);
            overworld.runCommand(`scoreboard players add "${estate.owner}" player_money ${estate.price}`);
            try { overworld.runCommand(`tellraw "${estate.tenant}" {"rawtext":[{"text":"§e[부동산] 주택(${estate.name}) 월세 ${estate.price.toLocaleString()}₩이 자동 출금되었습니다."}]}`); } catch(e){}
            try { overworld.runCommand(`tellraw "${estate.owner}" {"rawtext":[{"text":"§a[부동산 입금] 주택(${estate.name}) 월세 ${estate.price.toLocaleString()}₩이 입금되었습니다."}]}`); } catch(e){}
        } else if (estate.type === 3) { // 상업용 건물
            let rooms = estate.rooms || [];
            for (let rIdx = 0; rIdx < rooms.length; rIdx++) {
                let room = rooms[rIdx];
                if (room.tenant !== "") {
                    overworld.runCommand(`scoreboard players remove "${room.tenant}" player_money ${room.price}`);
                    overworld.runCommand(`scoreboard players add "${estate.owner}" player_money ${room.price}`);
                    try { overworld.runCommand(`tellraw "${room.tenant}" {"rawtext":[{"text":"§e[부동산] 점포(${estate.name} ${room.name}) 월세 ${room.price.toLocaleString()}₩이 자동 출금되었습니다."}]}`); } catch(e){}
                    try { overworld.runCommand(`tellraw "${estate.owner}" {"rawtext":[{"text":"§a[부동산 입금] 점포(${estate.name} ${room.name}) 월세 ${room.price.toLocaleString()}₩이 입금되었습니다."}]}`); } catch(e){}
                }
            }
        }
    }
}, 57600);

system.runInterval(() => {
    const objMoney = world.scoreboard.getObjective("player_money");
    for (const player of world.getAllPlayers()) {
        let debt = JSON.parse(world.getDynamicProperty("debt_" + player.name) || "0");
        if (debt > 0) {
            debt = debt * 1.05; player.sendMessage(`§c[은행] 대출 이자 발생. 빚: ₩${Math.floor(debt).toLocaleString()}`);
            let money = 0; try { money = objMoney.getScore(player); } catch(e) {}
            if (money > 0) {
                const repayAmt = Math.min(money, Math.floor(debt));
                player.runCommand(`scoreboard players remove @s player_money ${repayAmt}`); debt -= repayAmt;
                let cScore = JSON.parse(world.getDynamicProperty("credit_score_" + player.name) || "500");
                world.setDynamicProperty("credit_score_" + player.name, JSON.stringify(Math.min(1000, cScore + (repayAmt / 1000))));
                player.sendMessage(`§a[은행] ${repayAmt.toLocaleString()} 자동 상환됨. 남은 빚: ₩${Math.floor(debt).toLocaleString()}`);
            } else {
                let cScore = JSON.parse(world.getDynamicProperty("credit_score_" + player.name) || "500");
                world.setDynamicProperty("credit_score_" + player.name, JSON.stringify(Math.max(0, cScore - 5)));
                player.sendMessage(`§4[은행 경고] 연체되어 신용 점수 하락!`);
            }
            world.setDynamicProperty("debt_" + player.name, JSON.stringify(debt));
        }
    }
}, 1200);

system.afterEvents.scriptEventReceive.subscribe((event) => {
    if (event.id === "nf:loan") {
        const player = event.sourceEntity; if (!player || player.typeId !== "minecraft:player") return;
        const msg = event.message; const nId = getNationId(player); const curr = getCurrencyInfo(nId);
        let creditScore = JSON.parse(world.getDynamicProperty("credit_score_" + player.name) || "500");
        let debt = JSON.parse(world.getDynamicProperty("debt_" + player.name) || "0");
        let money = 0; try { money = world.scoreboard.getObjective("player_money").getScore(player); } catch(e) {}
        
        if (msg === "apply") showLoanApplyUI(player, creditScore, debt, curr);
        else if (msg === "repay") showLoanRepayUI(player, money, debt, creditScore, curr);
    }
});


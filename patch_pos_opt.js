const fs = require('fs');

let code = fs.readFileSync('BP/scripts/main.js', 'utf-8');

// 1. Add debounce to playerInteractWithBlock
const interactSub = 'world.beforeEvents.playerInteractWithBlock.subscribe((event) => {\n    const block = event.block;\n    const player = event.player;';
const interactSubNew = `world.beforeEvents.playerInteractWithBlock.subscribe((event) => {
    const block = event.block;
    const player = event.player;
    
    // [최적화] 클릭 중복 방지 (500ms 쿨다운)
    const now = Date.now();
    const lastTime = player.getDynamicProperty("last_interact_time") || 0;
    if (now - lastTime < 500) return;
    player.setDynamicProperty("last_interact_time", now);`;

code = code.replace(interactSub, interactSubNew);

// 2. Replace POS terminal interact logic
const oldPosInteract = `    if (block.typeId === "nf:pos_terminal") {
        event.cancel = true;
        system.run(() => {
            const markers = player.dimension.getEntities({ type: "nf:pos_marker", location: { x: block.location.x + 0.5, y: block.location.y, z: block.location.z + 0.5 }, maxDistance: 0.5 });
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
    }`;

const newPosInteract = `    if (block.typeId === "nf:pos_terminal") {
        event.cancel = true;
        system.run(() => {
            const markers = player.dimension.getEntities({ type: "nf:pos_marker", location: { x: block.location.x + 0.5, y: block.location.y, z: block.location.z + 0.5 }, maxDistance: 0.5 });
            if (markers.length === 0) return;
            const marker = markers[0];
            const owner = marker.getDynamicProperty("pos_owner") || "";
            const activeItemStr = marker.getDynamicProperty("pos_active_item") || "";
            
            // 1. 주인이 없는 경우
            if (owner === "") {
                new ActionFormData().title("§lPOS 단말기").body("아직 주인이 없습니다.")
                .button("§a점주 등록하기")
                .show(player).then(res => {
                    if (res.canceled) return;
                    marker.setDynamicProperty("pos_owner", player.name);
                    marker.setDynamicProperty("pos_catalog", "[]");
                    marker.setDynamicProperty("pos_active_item", "");
                    marker.nameTag = "§e" + player.name + "의 상점";
                    player.sendMessage("§a[POS] 이제 당신이 점주입니다.");
                });
                return;
            }

            // 2. 결제 대기 중인 경우 (누구든 카드 들고 터치 시 결제 진행)
            if (activeItemStr !== "") {
                const equip = player.getComponent("equippable");
                const mainhand = equip ? equip.getEquipment("Mainhand") : undefined;
                const isCard = mainhand && (mainhand.typeId === "nf:check_card" || mainhand.typeId === "nf:credit_card");
                
                if (isCard) {
                    processPosPayment(player, marker, owner, JSON.parse(activeItemStr));
                } else {
                    // 점주가 맨손으로 터치 시 결제 대기 취소 가능
                    if (player.name === owner) {
                        new ActionFormData().title("§l결제 대기 관리").body("현재 결제 대기 중인 상품이 있습니다.\\n결제 대기 상태를 취소하시겠습니까?")
                        .button("§c결제 대기 취소")
                        .button("§a닫기 (유지)")
                        .show(player).then(res => {
                            if (res.canceled || res.selection === 1) return;
                            marker.setDynamicProperty("pos_active_item", "");
                            marker.nameTag = "§e" + owner + "의 상점";
                            player.sendMessage("§a[POS] 결제 대기 상태가 취소되었습니다.");
                        });
                    } else {
                        player.sendMessage("§c[POS] 결제 대기 중입니다. 손에 카드(체크/신용카드)를 들고 터치해 주세요.");
                    }
                }
                return;
            }

            // 3. 점주 관리 메뉴 (결제 대기 중이 아닐 때)
            if (player.name === owner) {
                new ActionFormData().title("§lPOS 점주 메뉴").body("원하시는 작업을 선택하세요.")
                .button("§a계산 시작 (상품 판매)")
                .button("§b판매 상품 관리 (영구 등록/삭제)")
                .button("§c점주 등록 해제 (초기화)")
                .show(player).then(res => {
                    if(res.canceled) return;
                    if(res.selection === 0) showPosSellUI(player, marker);
                    if(res.selection === 1) showPosCatalogUI(player, marker);
                    if(res.selection === 2) {
                        marker.setDynamicProperty("pos_owner", "");
                        marker.setDynamicProperty("pos_catalog", "[]");
                        marker.setDynamicProperty("pos_active_item", "");
                        marker.nameTag = "§8주인 없는 단말기";
                        player.sendMessage("§a[POS] 단말기가 초기화되었습니다.");
                    }
                });
            } else {
                player.sendMessage("§c[POS] 현재 판매 대기 중인 상품이 없습니다.");
            }
        });
    }`;

code = code.replace(oldPosInteract, newPosInteract);

// 3. Replace POS helper functions
const posHelpersStart = code.indexOf('function posAddItemUI(player, marker) {');
const p2pStart = code.indexOf('// [V0.7] P2P Trade Logic');

if (posHelpersStart === -1 || p2pStart === -1) {
    console.error("Could not find POS helper functions or P2P Trade Logic!");
    process.exit(1);
}

const newPosHelpers = `function showPosCatalogUI(player, marker) {
    let catalog = JSON.parse(marker.getDynamicProperty("pos_catalog") || "[]");
    
    const form = new ActionFormData().title("§l판매 상품 관리").body("현재 영구 등록된 상품 목록입니다.");
    form.button("§a+ 새 상품 영구 등록 (인벤토리에서)");
    for (let i = 0; i < catalog.length; i++) {
        form.button(\`§c[삭제] §f\${catalog[i].name} (개당 \${catalog[i].price}₩)\`);
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
                    options.push(\`\${item.typeId.replace("minecraft:", "")} (보유: \${item.amount}개)\`);
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
                player.sendMessage(\`§a[POS] '\${name}' 상품이 개당 \${price}₩에 영구 등록되었습니다!\`);
                showPosCatalogUI(player, marker);
            });
        } else if (res.selection <= catalog.length) {
            const delIdx = res.selection - 1;
            const delName = catalog[delIdx].name;
            catalog.splice(delIdx, 1);
            marker.setDynamicProperty("pos_catalog", JSON.stringify(catalog));
            player.sendMessage(\`§c[POS] '\${delName}' 상품이 목록에서 삭제되었습니다.\`);
            showPosCatalogUI(player, marker);
        }
    });
}

function showPosSellUI(player, marker) {
    let catalog = JSON.parse(marker.getDynamicProperty("pos_catalog") || "[]");
    if (catalog.length === 0) {
        player.sendMessage("§c[POS] 등록된 상품이 없습니다. '판매 상품 관리'에서 먼저 상품을 영구 등록하세요.");
        return;
    }
    
    const options = catalog.map(c => \`\${c.name} (개당 \${c.price}₩)\`);
    
    new ModalFormData().title("§l계산 시작 (상품 판매)")
    .dropdown("판매할 상품 선택", options)
    .slider("판매 수량", 1, 64, 1, 1)
    .show(player).then(res => {
        if (res.canceled) return;
        const selected = catalog[res.formValues[0]];
        const amount = res.formValues[1];
        const totalPrice = selected.price * amount;
        
        const activeItem = {
            typeId: selected.typeId,
            name: selected.name,
            amount: amount,
            price: totalPrice
        };
        
        marker.setDynamicProperty("pos_active_item", JSON.stringify(activeItem));
        marker.nameTag = \`§e[결제 대기중] §f\${selected.name} x\${amount}\\n§a총액: \${totalPrice}₩\\n§b카드를 들고 터치하세요\`;
        player.sendMessage(\`§a[POS] 결제 대기 중: \${selected.name} x\${amount} (총액 \${totalPrice}₩)\`);
    });
}

function processPosPayment(player, marker, owner, item) {
    const equip = player.getComponent("equippable");
    const mainhand = equip ? equip.getEquipment("Mainhand") : undefined;
    if (!mainhand || (mainhand.typeId !== "nf:check_card" && mainhand.typeId !== "nf:credit_card")) return;
    
    const customerNationId = getNationId(player);
    if (!customerNationId) { player.sendMessage("§c국가에 소속되어야 금융을 이용할 수 있습니다."); return; }
    const customerCurr = getCurrencyInfo(customerNationId);
    
    const ownerNationId = getNationId(owner);
    const ownerCurr = getCurrencyInfo(ownerNationId);
    
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
            player.sendMessage(\`§c[결제 실패] 한도 초과. (지불 금액: \${customerPrice} \${customerCurr.symbol})\`); return;
        }
        player.setDynamicProperty("debt", debt + customerPrice);
        player.sendMessage(\`§a[결제 완료] 신용 승인: \${customerPrice} \${customerCurr.symbol} 결제됨.\`);
    } else {
        if (customerMoney < customerPrice) { 
            player.sendMessage(\`§c[결제 실패] 잔액 부족. (필요: \${customerPrice} \${customerCurr.symbol}, 환율 적용됨)\`); return; 
        }
        player.runCommand(\`scoreboard players remove @s player_money \${customerPrice}\`);
        player.sendMessage(\`§a[결제 완료] \${customerPrice} \${customerCurr.symbol} 차감됨. (환율 자동 적용)\`);
    }
    
    const fee = Math.floor(currentPrice * 0.05);
    const ownerIncome = currentPrice - fee;
    
    player.dimension.runCommand(\`scoreboard players add "\${owner}" player_money \${ownerIncome}\`);
    try { player.dimension.runCommand(\`tellraw "\${owner}" {"rawtext":[{"text":"§a[POS] \${ownerIncome} \${ownerCurr.symbol} 입금됨! (수수료 \${fee} 공제, 상품: \${item.name} x\${item.amount})"}]}\`); } catch(e) {}
    
    player.runCommand(\`give @s \${item.typeId} \${item.amount}\`);
    
    marker.setDynamicProperty("pos_active_item", ""); marker.nameTag = \`§e\${owner}의 상점\`;
}

`;

code = code.substring(0, posHelpersStart) + newPosHelpers + code.substring(p2pStart);

// 4. Add 64-block flagpole spawning loop
const borderLoopIndex = code.indexOf('// 1. 국경선 렌더링 (1초)');
if (borderLoopIndex === -1) {
    console.error("Could not find border rendering loop!");
    process.exit(1);
}

const flagpoleLoop = `// [자동화] 64블록마다 깃발 자동 생성 (플레이어 접근 시)
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
            }
            
            if (!exists) {
                let spawnY = loc.y;
                for (let y = 310; y > -60; y--) {
                    try {
                        const b = overworld.getBlock({x: gx, y: y, z: gz});
                        if (b && !b.isAir && !b.typeId.includes("leaves") && !b.typeId.includes("log")) {
                            spawnY = y + 1;
                            break;
                        }
                    } catch(e){}
                }
                
                try {
                    const flag = overworld.spawnEntity("nf:flagpole_marker", {x: gx + 0.5, y: spawnY, z: gz + 0.5});
                    flag.setDynamicProperty("owner_nation_id", "neutral");
                    flag.nameTag = "§8[무소속 영토]\\n§7점령 가능";
                    
                    const fullKey = \`\${gx},\${spawnY},\${gz}\`;
                    allFlagpoles[fullKey] = "neutral";
                    changed = true;
                } catch(e){}
            }
        }
    }
    
    if (changed) {
        world.setDynamicProperty("all_flagpoles", JSON.stringify(allFlagpoles));
        recalculateBorders(allFlagpoles);
    }
}, 20);

`;

code = code.substring(0, borderLoopIndex) + flagpoleLoop + code.substring(borderLoopIndex);

fs.writeFileSync('BP/scripts/main.js', code);
console.log("Successfully optimized POS and added flagpole grid spawning!");

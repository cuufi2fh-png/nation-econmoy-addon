import { world, system, ItemStack, EquipmentSlot } from "@minecraft/server";
import { ModalFormData, ActionFormData } from "@minecraft/server-ui";

// =====================================================
// ★ 전역 UI 락 매니저 (모든 UI 다중열림 방지 통합)
// =====================================================

const uiLocks = new Map();

/**
 * UI 락 획득. 이미 열려있으면 false 반환.
 * autoRelease: 틱 후 자동해제 (안전망). 0이면 자동해제 없음.
 */
function acquireUiLock(key, autoReleaseTicks = 60) {
    if (uiLocks.get(key)) return false;
    uiLocks.set(key, true);
    if (autoReleaseTicks > 0) {
        system.runTimeout(() => {
            uiLocks.delete(key);
        }, autoReleaseTicks);
    }
    return true;
}

function releaseUiLock(key) {
    uiLocks.delete(key);
}

function getUiKey(player, tag) {
    return `${player.name}__${tag}`;
}

// ====== 유틸리티 함수 ======

function getNationId(playerOrName) {
    if (typeof playerOrName === "string") {
        return world.getDynamicProperty("player_nation_" + playerOrName) || null;
    } else {
        const tags = playerOrName.getTags();
        for (const tag of tags) {
            if (tag.startsWith("nation_id_")) return tag;
        }
        return null;
    }
}

function getCurrencyInfo(nId) {
    if (!nId) return { symbol: "무국적", supply: 1, rate: 1.0, tax_rate: 50 };
    let currencies = JSON.parse(world.getDynamicProperty("currencies") || "{}");
    return currencies[nId] || { symbol: "COIN", supply: 100000, rate: 1.0, tax_rate: 50 };
}

function getPlayerMoney(player) {
    try {
        return world.scoreboard.getObjective("player_money")?.getScore(player) || 0;
    } catch (e) {
        return 0;
    }
}

function getNextNationId() {
    let id = world.getDynamicProperty("nextNationId");
    if (id === undefined) id = 1;
    world.setDynamicProperty("nextNationId", id + 1);
    return id;
}

function safeParse(propName, defaultValue = {}) {
    try {
        const value = world.getDynamicProperty(propName);
        if (value === undefined || value === null) return defaultValue;
        return JSON.parse(value);
    } catch (e) {
        console.warn(`[Parse Error] ${propName}: ${e}`);
        return defaultValue;
    }
}

// ====== V0.1: 국가 생성 로직 ======

world.beforeEvents.itemUse.subscribe((event) => {
    try {
        const item = event.itemStack;
        const player = event.source;

        if (!item || typeof item.typeId !== "string") return;

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

                    let currencies = safeParse("currencies", {});
                    currencies[nId] = { symbol: "COIN", supply: 100000, rate: 1.0, tax_rate: 50 };
                    world.setDynamicProperty("currencies", JSON.stringify(currencies));

                    let nationNames = safeParse("nation_names", {});
                    nationNames[nId] = nationName;
                    world.setDynamicProperty("nation_names", JSON.stringify(nationNames));

                    world.setDynamicProperty("player_nation_" + player.name, nId);

                    const equipment = player.getComponent("equippable");
                    if (equipment) {
                        const mainhand = equipment.getEquipment("Handslot");
                        if (mainhand && mainhand.amount > 1) {
                            mainhand.amount--;
                            equipment.setEquipment("Handslot", mainhand);
                        } else {
                            equipment.setEquipment("Handslot", undefined);
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
                const money = getPlayerMoney(player);
                player.sendMessage(`§a[체크카드] 잔액: ${money.toLocaleString()} ${curr.symbol}`);
            });
        } else if (item.typeId === "nf:credit_card") {
            event.cancel = true;
            system.run(() => {
                const nId = getNationId(player);
                if (!nId) { player.sendMessage("§c국가에 소속되어야 조회 가능합니다."); return; }
                const curr = getCurrencyInfo(nId);
                const creditScore = JSON.parse(world.getDynamicProperty("credit_score_" + player.name) || "500");
                const debt = JSON.parse(world.getDynamicProperty("debt_" + player.name) || "0");
                const limit = creditScore * 100;
                player.sendMessage(`§6[신용카드] 총 한도: ${Math.floor(limit).toLocaleString()} ${curr.symbol} | 누적 사용액(빚): ${Math.floor(debt).toLocaleString()} ${curr.symbol}`);
            });
        } else if (item.typeId === "nf:property_wand") {
            event.cancel = true;
            system.run(() => { showPropertyWandUI(player); });
        } else if (item.typeId === "nf:id_card") {
            event.cancel = true;
            system.run(() => { showIdCardUI(player); });
        } else if (item.typeId === "nf:building_cert") {
            event.cancel = true;
            system.run(() => {
                const estates = safeParse("real_estates", []);
                const myBuildings = estates.filter(e => e && e.owner === player.name && (e.type === 2 || e.type === 3));
                if (myBuildings.length === 0) { player.sendMessage("§c소유 중인 상업용 건물이 없습니다."); return; }
                if (myBuildings.length === 1) { showBuildingManageUI(player, myBuildings[0]); return; }

                const form = new ActionFormData().title("§l소유 건물 목록").body("관리할 건물을 선택하세요.");
                for (const b of myBuildings) form.button(`§e🏢 ${b.name}`);
                form.button("닫기");
                form.show(player).then(res => {
                    if (res.canceled || res.selection === myBuildings.length) return;
                    showBuildingManageUI(player, myBuildings[res.selection]);
                }).catch(e => console.error(`[Building List Error] ${e}`));
            });
        } else if (item.typeId === "nf:guide_book") {
            event.cancel = true;
            system.run(() => { showGuideBookUI(player); });
        }
    } catch (error) {
        console.error(`[Item Use Error] ${error}`);
    }
});

// ====== 부동산 지팡이 UI ======

function showPropertyWandUI(player) {
    if (!player) return;

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
            const price = parseInt(res.formValues[2] || "0");
            if (isNaN(price) || price < 0) { player.sendMessage("§c가격을 올바르게 입력하세요."); return; }

            const minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
            const minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
            const minZ = Math.min(z1, z2), maxZ = Math.max(z1, z2);

            const reData = {
                id: "re_" + Date.now(),
                type, name, price, owner: player.name, tenant: "", rooms: [],
                min: { x: minX, y: minY, z: minZ },
                max: { x: maxX, y: maxY, z: maxZ },
                dimension: player.dimension.id,
                is_sold: false
            };

            let estates = safeParse("real_estates", []);
            estates.push(reData);
            world.setDynamicProperty("real_estates", JSON.stringify(estates));

            const signX = Math.floor((minX + maxX) / 2);
            const signY = Math.floor((minY + maxY) / 2);
            const signZ = Math.floor((minZ + maxZ) / 2);

            try {
                if (type === 0) {
                    const sign = player.dimension.spawnEntity("nf:property_sign", { x: signX + 0.5, y: signY + 0.5, z: signZ + 0.5 });
                    if (sign) {
                        sign.nameTag = `§b[주택 매매]\n§f${name}\n§e매매가: ${price.toLocaleString()}₩\n§a클릭하여 인수`;
                        sign.setDynamicProperty("re_id", reData.id);
                    }
                    player.sendMessage(`§a[부동산] 주택 매매 등록 완료! (${minX},${minY},${minZ} ~ ${maxX},${maxY},${maxZ})`);
                } else if (type === 1) {
                    const sign = player.dimension.spawnEntity("nf:property_sign", { x: signX + 0.5, y: signY + 0.5, z: signZ + 0.5 });
                    if (sign) {
                        sign.nameTag = `§a[주택 임대]\n§f${name}\n§e월세: ${price.toLocaleString()}₩\n§7(48분마다)\n§b클릭하여 입주`;
                        sign.setDynamicProperty("re_id", reData.id);
                    }
                    player.sendMessage(`§a[부동산] 주택 월세 임대 등록 완료! (${minX},${minY},${minZ} ~ ${maxX},${maxY},${maxZ})`);
                } else if (type === 2) {
                    const sign = player.dimension.spawnEntity("nf:property_sign", { x: signX + 0.5, y: signY + 0.5, z: signZ + 0.5 });
                    if (sign) {
                        sign.nameTag = `§6[건물 매매]\n§f${name}\n§e매매가: ${price.toLocaleString()}₩\n§a클릭하여 건물주 되기`;
                        sign.setDynamicProperty("re_id", reData.id);
                    }
                    player.sendMessage(`§a[부동산] 상업용 건물 매매 등록 완료! (${minX},${minY},${minZ} ~ ${maxX},${maxY},${maxZ})`);
                } else if (type === 3) {
                    player.runCommand("give @s nf:building_cert 1");
                    player.sendMessage(`§a[건물주 등록] '${name}' 건물의 소유 증명서가 발급되었습니다!`);
                }
            } catch (spawnError) {
                console.warn(`[Property Sign Spawn Error] ${spawnError}`);
                player.sendMessage("§c[부동산] 표지판 생성 실패. 해당 엔티티가 정의되어 있는지 확인하세요.");
            }
        }).catch(e => console.error(`[Property Wand UI Error] ${e}`));
}

// ====== 건물 관리 UI ======

function showBuildingManageUI(player, building) {
    if (!player || !building) return;

    const form = new ActionFormData()
        .title(`§l건물 관리 - ${building.name}`)
        .body(`§e건물주: §f${building.owner}\n§b현재 등록된 임대 방(점포) 수: §f${(building.rooms || []).length}개\n\n원하시는 작업을 선택하세요.`);

    form.button("§a+ 신규 임대 방(점포) 등록하기");
    const rooms = building.rooms || [];
    for (const r of rooms) {
        if (r && r.name) {
            form.button(`§e방 ${r.name}\n§f월세: ${r.price?.toLocaleString() || 0}₩ | ${r.tenant ? "세입자: " + r.tenant : "§b임대 문의중"}`);
        }
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
                    const roomPrice = parseInt(r.formValues[1] || "0");
                    if (!roomName || roomName === "" || isNaN(roomPrice) || roomPrice < 0) {
                        player.sendMessage("§c입력값이 올바르지 않습니다."); return;
                    }

                    let estates = safeParse("real_estates", []);
                    let bIdx = estates.findIndex(e => e && e.id === building.id);
                    if (bIdx === -1) return;

                    const roomId = "room_" + Date.now();
                    if (!estates[bIdx].rooms) estates[bIdx].rooms = [];
                    estates[bIdx].rooms.push({
                        id: roomId, name: roomName, price: roomPrice, tenant: "",
                        loc: { x: Math.floor(loc.x), y: Math.floor(loc.y), z: Math.floor(loc.z) }
                    });
                    world.setDynamicProperty("real_estates", JSON.stringify(estates));

                    try {
                        const sign = player.dimension.spawnEntity("nf:property_sign", {
                            x: Math.floor(loc.x) + 0.5,
                            y: Math.floor(loc.y) + 0.5,
                            z: Math.floor(loc.z) + 0.5
                        });
                        if (sign) {
                            sign.nameTag = `§b[임대 문의]\n§f${building.name} ${roomName}\n§e월세: ${roomPrice.toLocaleString()}₩\n§a클릭하여 점포 임대`;
                            sign.setDynamicProperty("re_id", building.id);
                            sign.setDynamicProperty("room_id", roomId);
                        }
                    } catch (e) {
                        console.warn(`[Room Sign Spawn Error] ${e}`);
                    }

                    player.sendMessage(`§a[건물 관리] '${roomName}' 점포 임대 문의가 등록되었습니다!`);
                }).catch(e => console.error(`[Room Register Error] ${e}`));
        } else {
            const r = rooms[res.selection - 1];
            if (!r) return;
            new ActionFormData().title(`§l방 관리 - ${r.name}`)
                .body(`§e방 이름: §f${r.name}\n§a월세: §f${r.price?.toLocaleString() || 0}₩\n§b세입자: §f${r.tenant || "없음 (임대 대기중)"}`)
                .button(r.tenant ? "§c세입자 퇴거 (계약 해지)" : "§7(세입자 없음)")
                .button("뒤로 가기")
                .show(player).then(r2 => {
                    if (r2.canceled || r2.selection === 1) { showBuildingManageUI(player, building); return; }
                    if (r2.selection === 0 && r.tenant) {
                        let estates = safeParse("real_estates", []);
                        let bIdx = estates.findIndex(e => e && e.id === building.id);
                        if (bIdx !== -1) {
                            let rIdx = estates[bIdx].rooms?.findIndex(rm => rm && rm.id === r.id) ?? -1;
                            if (rIdx !== -1) {
                                const oldTenant = estates[bIdx].rooms[rIdx].tenant;
                                estates[bIdx].rooms[rIdx].tenant = "";
                                world.setDynamicProperty("real_estates", JSON.stringify(estates));
                                player.sendMessage(`§c[건물 관리] 세입자(${oldTenant})와의 임대 계약을 해지했습니다.`);

                                const loc = estates[bIdx].rooms[rIdx].loc;
                                const signs = player.dimension.getEntities({
                                    type: "nf:property_sign",
                                    location: { x: loc.x + 0.5, y: loc.y + 0.5, z: loc.z + 0.5 },
                                    maxDistance: 1.0
                                });
                                for (const s of signs) {
                                    if (s) s.nameTag = `§b[임대 문의]\n§f${building.name} ${r.name}\n§e월세: ${r.price?.toLocaleString() || 0}₩\n§a클릭하여 점포 임대`;
                                }
                            }
                        }
                    }
                }).catch(e => console.error(`[Room Manage Error] ${e}`));
        }
    }).catch(e => console.error(`[Building Manage UI Error] ${e}`));
}

// ====== 부동산 표지판 클릭 ======

world.beforeEvents.playerInteractWithEntity.subscribe((event) => {
    try {
        const target = event.target;
        const player = event.player;

        if (!target || typeof target.typeId !== "string") return;

        if (target.typeId === "nf:realtor_npc") {
            event.cancel = true;
            system.run(() => { showRealtorMenu(player); });
            return;
        }

        if (target.typeId !== "nf:property_sign") return;
        event.cancel = true;

        system.run(() => {
            const reId = target.getDynamicProperty("re_id");
            if (!reId) return;
            let estates = safeParse("real_estates", []);
            let bIdx = estates.findIndex(e => e && e.id === reId);
            if (bIdx === -1) {
                try { target.remove(); } catch { }
                player.sendMessage("§c[부동산] 존재하지 않는 매물 표지판을 철거했습니다.");
                return;
            }
            let estate = estates[bIdx];
            const roomId = target.getDynamicProperty("room_id");

            if (roomId) {
                let rIdx = (estate.rooms || []).findIndex(rm => rm && rm.id === roomId);
                if (rIdx === -1) { try { target.remove(); } catch { } return; }
                let room = estate.rooms[rIdx];

                if (room.tenant === player.name) {
                    player.sendMessage(`§e[부동산] 당신이 임대 중인 점포입니다. (월세: ${room.price?.toLocaleString() || 0}₩)`);
                    return;
                }
                if (room.tenant !== "") {
                    player.sendMessage(`§c[부동산] 이미 임대된 점포입니다. (세입자: ${room.tenant})`);
                    return;
                }
                if (estate.owner === player.name) {
                    new ActionFormData().title(`§l내 점포 관리 - ${room.name}`)
                        .body(`§e월세: ${room.price?.toLocaleString() || 0}₩ | 임대 문의중\n이 임대 문의 표지판을 철거하시겠습니까?`)
                        .button("§c임대 문의 철거").button("닫기").show(player).then(r => {
                            if (r.canceled || r.selection === 1) return;
                            estates[bIdx].rooms.splice(rIdx, 1);
                            world.setDynamicProperty("real_estates", JSON.stringify(estates));
                            try { target.remove(); } catch { }
                            player.sendMessage("§c[건물 관리] 임대 문의 표지판을 철거했습니다.");
                        }).catch(e => console.error(`[Room Remove Error] ${e}`));
                    return;
                }

                player.sendMessage("§c[부동산 안내] 매물 구매 및 점포 임대 계약은 도시의 '부동산 중개인 NPC'를 찾아가 상호작용해 주세요.");
                return;
            }

            if (estate.type === 0 && estate.is_sold) {
                player.sendMessage("§c[부동산] 이미 매매가 완료된 주택입니다.");
                try { target.remove(); } catch { }
                return;
            }
            if (estate.type === 1) {
                if (estate.tenant === player.name) { player.sendMessage(`§e[부동산] 당신이 임대 중인 주택입니다.`); return; }
                if (estate.tenant !== "") { player.sendMessage(`§c[부동산] 이미 임대된 주택입니다.`); return; }
            }

            if (estate.owner === player.name) {
                new ActionFormData().title(`§l내 매물 관리 - ${estate.name}`)
                    .body(`§e등록 가격/월세: ${estate.price?.toLocaleString() || 0}₩\n매물 등록을 취소하고 표지판을 철거하시겠습니까?`)
                    .button("§c매물 등록 취소 및 철거").button("닫기").show(player).then(r => {
                        if (r.canceled || r.selection === 1) return;
                        estates.splice(bIdx, 1);
                        world.setDynamicProperty("real_estates", JSON.stringify(estates));
                        try { target.remove(); } catch { }
                        player.sendMessage("§c[부동산] 매물 등록을 취소했습니다.");
                    }).catch(e => console.error(`[Estate Remove Error] ${e}`));
                return;
            }

            player.sendMessage("§c[부동산 안내] 매물 구매 및 임대 계약은 도시의 '부동산 중개인 NPC'를 찾아가 상호작용해 주세요.");
        });
    } catch (error) {
        console.error(`[Entity Interact Error] ${error}`);
    }
});

// ====== 부동산 중개인 NPC 시스템 ======

function showRealtorMenu(player) {
    if (!player) return;

    new ActionFormData().title("§l🏢 부동산 중개소")
        .body("§e환영합니다!\n\n§b원하시는 거래 종류를 선택하세요.")
        .button("§a🏠 주택 매매 목록 (소유권 분양)")
        .button("§b🏠 주택 월세 목록 (단독주택 임대)")
        .button("§6🏢 상업용 건물 매매 (건물주 되기)")
        .button("§d🏬 상가 점포 월세 목록 (방 임대)")
        .button("닫기")
        .show(player).then(res => {
            if (res.canceled || res.selection === 4) return;
            showRealtorList(player, res.selection);
        }).catch(e => console.error(`[Realtor Menu Error] ${e}`));
}

function showRealtorList(player, categoryType) {
    if (!player) return;

    let estates = safeParse("real_estates", []);
    let list = [];
    let title = "";
    let isRoom = (categoryType === 3);

    if (categoryType === 0) {
        title = "§l🏠 주택 매매 목록";
        list = estates.filter(e => e && e.type === 0 && !e.is_sold);
    } else if (categoryType === 1) {
        title = "§l🏠 주택 월세 목록";
        list = estates.filter(e => e && e.type === 1 && e.tenant === "");
    } else if (categoryType === 2) {
        title = "§l🏢 상업용 건물 매매";
        list = estates.filter(e => e && e.type === 2);
    } else if (categoryType === 3) {
        title = "§l🏬 상가 점포 월세 목록";
        for (const e of estates) {
            if (e && e.rooms) {
                for (const r of e.rooms) {
                    if (r && r.tenant === "") list.push({ estate: e, room: r });
                }
            }
        }
    }

    if (list.length === 0) {
        new ActionFormData().title(title).body("§c현재 등록된 매물이 없습니다.").button("뒤로 가기")
            .show(player).then(r => { if (!r.canceled) showRealtorMenu(player); })
            .catch(e => console.error(`[Realtor Empty Error] ${e}`));
        return;
    }

    const form = new ActionFormData().title(title).body("§e계약을 진행할 매물을 선택하세요.");
    for (const item of list) {
        if (!item) continue;
        if (isRoom) {
            form.button(`§d🏬 ${item.estate.name} ${item.room.name}\n§f월세: ${item.room.price?.toLocaleString() || 0}₩ | 건물주: ${item.estate.owner}`);
        } else {
            const priceStr = categoryType === 1
                ? `월세: ${item.price?.toLocaleString() || 0}₩`
                : `매매가: ${item.price?.toLocaleString() || 0}₩`;
            form.button(`§e🏠 ${item.name}\n§f${priceStr} | 소유자: ${item.owner}`);
        }
    }
    form.button("뒤로 가기");

    form.show(player).then(res => {
        if (res.canceled) return;
        if (res.selection === list.length) { showRealtorMenu(player); return; }
        if (isRoom) {
            showRealtorTradeUI(player, list[res.selection].estate, list[res.selection].room);
        } else {
            showRealtorTradeUI(player, list[res.selection], null);
        }
    }).catch(e => console.error(`[Realtor List Error] ${e}`));
}

function showRealtorTradeUI(player, estate, room) {
    if (!player || !estate) return;

    const money = getPlayerMoney(player);
    let estates = safeParse("real_estates", []);
    let bIdx = estates.findIndex(e => e && e.id === estate.id);
    if (bIdx === -1) { player.sendMessage("§c[부동산] 존재하지 않는 매물입니다."); return; }

    if (room) {
        let rIdx = (estates[bIdx].rooms || []).findIndex(rm => rm && rm.id === room.id);
        if (rIdx === -1) { player.sendMessage("§c[부동산] 존재하지 않는 점포입니다."); return; }

        new ActionFormData().title("§l점포 임대 계약")
            .body(`§e🏢 건물명: §f${estate.name} ${room.name}\n§a💰 월세: §f${room.price?.toLocaleString() || 0}₩ (48분마다)\n§b👑 건물주: §f${estate.owner}\n\n§d[계약 혜택] 계약 체결 시 POS 단말기 1대가 즉시 지급됩니다!\n계약하시겠습니까?`)
            .button("§a계약 체결 및 첫 달 월세 결제").button("취소")
            .show(player).then(r => {
                if (r.canceled || r.selection === 1) return;
                if (money < room.price) { player.sendMessage("§c잔액이 부족합니다."); return; }

                try {
                    player.runCommand(`scoreboard players remove @s player_money ${room.price}`);
                    player.dimension.runCommand(`scoreboard players add "${estate.owner}" player_money ${room.price}`);
                } catch (e) { console.warn(`[Rent Payment Error] ${e}`); }

                estates[bIdx].rooms[rIdx].tenant = player.name;
                world.setDynamicProperty("real_estates", JSON.stringify(estates));

                const allSigns = player.dimension.getEntities({ type: "nf:property_sign" });
                for (const s of allSigns) {
                    if (s && s.getDynamicProperty("re_id") === estate.id && s.getDynamicProperty("room_id") === room.id) {
                        s.nameTag = `§d[영업중]\n§f${estate.name} ${room.name}\n§7대표: ${player.name}\n§e월세: ${room.price?.toLocaleString() || 0}₩`;
                    }
                }

                player.runCommand("give @s nf:pos_terminal 1");
                player.sendMessage("§a[점포 임대] 계약이 체결되었습니다! POS 단말기가 지급되었습니다.");
            }).catch(e => console.error(`[Room Rental Trade Error] ${e}`));
        return;
    }

    if (estate.type === 0) {
        new ActionFormData().title("§l주택 매매 계약")
            .body(`§e🏠 주택명: §f${estate.name}\n§a💰 매매가: §f${estate.price?.toLocaleString() || 0}₩\n§b👑 소유자: §f${estate.owner}\n\n구매하시겠습니까?`)
            .button("§a매매 체결 (구매)").button("취소")
            .show(player).then(r => {
                if (r.canceled || r.selection === 1) return;
                if (money < estate.price) { player.sendMessage("§c잔액이 부족합니다."); return; }
                try {
                    player.runCommand(`scoreboard players remove @s player_money ${estate.price}`);
                    player.dimension.runCommand(`scoreboard players add "${estate.owner}" player_money ${estate.price}`);
                } catch (e) { console.warn(`[House Purchase Error] ${e}`); }

                estates[bIdx].owner = player.name;
                estates[bIdx].is_sold = true;
                world.setDynamicProperty("real_estates", JSON.stringify(estates));

                const allSigns = player.dimension.getEntities({ type: "nf:property_sign" });
                for (const s of allSigns) {
                    if (s && s.getDynamicProperty("re_id") === estate.id) try { s.remove(); } catch { }
                }
                player.sendMessage("§a[부동산] 주택 매매 완료!");
            }).catch(e => console.error(`[House Trade Error] ${e}`));
    } else if (estate.type === 1) {
        new ActionFormData().title("§l주택 임대 계약")
            .body(`§e🏠 주택명: §f${estate.name}\n§a💰 월세: §f${estate.price?.toLocaleString() || 0}₩ (48분마다)\n§b👑 집주인: §f${estate.owner}\n\n계약하시겠습니까?`)
            .button("§a임대 계약 및 첫 달 월세 결제").button("취소")
            .show(player).then(r => {
                if (r.canceled || r.selection === 1) return;
                if (money < estate.price) { player.sendMessage("§c잔액이 부족합니다."); return; }
                try {
                    player.runCommand(`scoreboard players remove @s player_money ${estate.price}`);
                    player.dimension.runCommand(`scoreboard players add "${estate.owner}" player_money ${estate.price}`);
                } catch (e) { console.warn(`[House Rental Error] ${e}`); }

                estates[bIdx].tenant = player.name;
                world.setDynamicProperty("real_estates", JSON.stringify(estates));

                const allSigns = player.dimension.getEntities({ type: "nf:property_sign" });
                for (const s of allSigns) {
                    if (s && s.getDynamicProperty("re_id") === estate.id) {
                        s.nameTag = `§d[임대중]\n§f${estate.name}\n§7세입자: ${player.name}\n§e월세: ${estate.price?.toLocaleString() || 0}₩`;
                    }
                }
                player.sendMessage("§a[부동산] 주택 임대 계약 완료! 48분마다 월세가 자동 출금됩니다.");
            }).catch(e => console.error(`[House Rental Trade Error] ${e}`));
    } else if (estate.type === 2) {
        new ActionFormData().title("§l상업용 건물 매매 계약")
            .body(`§e🏢 건물명: §f${estate.name}\n§a💰 매매가: §f${estate.price?.toLocaleString() || 0}₩\n§b👑 건물주: §f${estate.owner}\n\n건물을 인수하시겠습니까?`)
            .button("§a건물 인수 및 대금 결제").button("취소")
            .show(player).then(r => {
                if (r.canceled || r.selection === 1) return;
                if (money < estate.price) { player.sendMessage("§c잔액이 부족합니다."); return; }
                try {
                    player.runCommand(`scoreboard players remove @s player_money ${estate.price}`);
                    player.dimension.runCommand(`scoreboard players add "${estate.owner}" player_money ${estate.price}`);
                } catch (e) { console.warn(`[Building Purchase Error] ${e}`); }

                estates[bIdx].owner = player.name;
                estates[bIdx].type = 3;
                world.setDynamicProperty("real_estates", JSON.stringify(estates));

                const allSigns = player.dimension.getEntities({ type: "nf:property_sign" });
                for (const s of allSigns) {
                    if (s && s.getDynamicProperty("re_id") === estate.id) try { s.remove(); } catch { }
                }
                player.runCommand("give @s nf:building_cert 1");
                player.sendMessage("§a[부동산] 상업용 건물 인수 완료! 건물 소유 증명서가 발급되었습니다.");
            }).catch(e => console.error(`[Building Trade Error] ${e}`));
    }
}

// =====================================================
// ★ playerInteractWithBlock - 단일 리스너로 통합
//   (원본의 3개 분리 → 1개로 통합하여 중복 이벤트 제거)
// =====================================================

world.beforeEvents.playerInteractWithBlock.subscribe((event) => {
    try {
        const block = event.block;
        const player = event.player;
        const itemStack = event.itemStack;

        if (!block || !player) return;

        const blockType = block.typeId;
        const itemType = itemStack?.typeId ?? null;

        // =====================================================
        // [1] 부동산 지팡이 - 블록 선택
        // =====================================================

        if (itemType === "nf:property_wand") {
            if (blockType === "nf:pos_terminal" || blockType === "nf:kiosk") {
                // 지팡이 들고 POS/키오스크 클릭 시 위치 저장만
            }

            const posSnapshot = { x: block.location.x, y: block.location.y, z: block.location.z };
            const isSneaking = player.isSneaking;
            const now = Date.now();
            const lastTime = JSON.parse(world.getDynamicProperty("last_interact_time_" + player.name) || "0");
            if (now - lastTime < 500) return;
            world.setDynamicProperty("last_interact_time_" + player.name, JSON.stringify(now));

            event.cancel = true;
            system.run(() => {
                if (isSneaking) {
                    world.setDynamicProperty("re_pos2_x_" + player.name, JSON.stringify(posSnapshot.x));
                    world.setDynamicProperty("re_pos2_y_" + player.name, JSON.stringify(posSnapshot.y));
                    world.setDynamicProperty("re_pos2_z_" + player.name, JSON.stringify(posSnapshot.z));
                    player.sendMessage(`§a[부동산] Pos2 설정: ${posSnapshot.x}, ${posSnapshot.y}, ${posSnapshot.z}`);
                } else {
                    world.setDynamicProperty("re_pos1_x_" + player.name, JSON.stringify(posSnapshot.x));
                    world.setDynamicProperty("re_pos1_y_" + player.name, JSON.stringify(posSnapshot.y));
                    world.setDynamicProperty("re_pos1_z_" + player.name, JSON.stringify(posSnapshot.z));
                    player.sendMessage(`§a[부동산] Pos1 설정: ${posSnapshot.x}, ${posSnapshot.y}, ${posSnapshot.z}\n§7(웅크리고 클릭하면 Pos2 설정)`);
                }
            });
            return;
        }

        // =====================================================
        // [2] 키오스크 연결 막대기
        // =====================================================

        if (itemType === "nf:kiosk_linker") {
            if (blockType === "nf:pos_terminal") {
                event.cancel = true;
                const posSnapshot = { x: block.location.x, y: block.location.y, z: block.location.z };
                system.run(() => {
                    try {
                        world.setDynamicProperty("kiosk_linker_pos_" + player.name, JSON.stringify(posSnapshot));
                        player.sendMessage(
                            `§b[키오스크 연결기]\n§7POS 위치 저장 완료\n\n§fX: ${posSnapshot.x}\n§fY: ${posSnapshot.y}\n§fZ: ${posSnapshot.z}\n\n§e이제 키오스크를 터치하세요.`
                        );
                    } catch (e) { console.warn(`[KIOSK LINK SAVE ERROR] ${e}`); }
                });
                return;
            }

            if (blockType === "nf:kiosk") {
                event.cancel = true;
                const kioskLoc = { x: block.location.x, y: block.location.y, z: block.location.z };
                system.run(() => {
                    try {
                        const savedPosStr = world.getDynamicProperty("kiosk_linker_pos_" + player.name);
                        if (!savedPosStr) {
                            player.sendMessage("§c[연결 실패]\n§7먼저 POS를 터치하세요.");
                            return;
                        }
                        const posSnapshot = JSON.parse(savedPosStr);
                        let terminals = safeParse("pos_terminals", {});
                        const posKey = `${posSnapshot.x},${posSnapshot.y},${posSnapshot.z}`;
                        if (!terminals[posKey]) {
                            player.sendMessage("§c[연결 실패]\n§7저장된 POS를 찾을 수 없습니다.");
                            return;
                        }
                        let linkedKiosks = safeParse("linked_kiosks", {});
                        const kioskKey = `${kioskLoc.x},${kioskLoc.y},${kioskLoc.z}`;
                        linkedKiosks[kioskKey] = posSnapshot;
                        world.setDynamicProperty("linked_kiosks", JSON.stringify(linkedKiosks));
                        player.sendMessage(
                            `§a[키오스크 연결 완료]\n\n§7키오스크 위치\n§f${kioskLoc.x}, ${kioskLoc.y}, ${kioskLoc.z}\n\n§7연결된 POS\n§f${posSnapshot.x}, ${posSnapshot.y}, ${posSnapshot.z}`
                        );
                    } catch (e) {
                        console.warn(`[KIOSK LINK ERROR] ${e}`);
                        player.sendMessage("§c[키오스크 오류]\n§7연결 처리 중 오류 발생");
                    }
                });
                return;
            }
        }

        // =====================================================
        // [3] POS 단말기
        // =====================================================

 if (blockType === "nf:pos_terminal") {
    // ★ UI 락 - beforeEvents 단계에서 즉시 체크
    const lockKey = getUiKey(player, "pos");
    if (!acquireUiLock(lockKey, 80)) return;

    event.cancel = true;

    // ★ 핵심 수정 1: 가져오는 순간부터 소수점을 완전히 날려 정수형 객체로 스냅샷 생성
    const locSnapshot = { 
        x: Math.floor(block.location.x), 
        y: Math.floor(block.location.y), 
        z: Math.floor(block.location.z) 
    };
    const dimId = player.dimension.id;

    system.run(() => {
        try {
            let terminals = safeParse("pos_terminals", {});
            const posKey = `${locSnapshot.x},${locSnapshot.y},${locSnapshot.z}`;

            // 이제 무조건 정수 포맷이므로 안전하게 매칭 및 생성됨
            if (!terminals[posKey]) {
                terminals[posKey] = { owner: player.name, catalog: [] };
                world.setDynamicProperty("pos_terminals", JSON.stringify(terminals));
            }

            // 마커 검색 및 자동 생성
            let markers = [];
            try {
                markers = [...player.dimension.getEntities({ type: "nf:pos_marker" })];
            } catch (e) {
                console.warn(`[POS MARKER SEARCH ERROR] ${e}`);
            }

            // ★ 핵심 수정 2: 교차 검증 적용 (linked_pos와 pos_terminal_key 둘 다 체크)
            let linkedMarker = markers.find(m => {
                try { 
                    const k1 = m.getDynamicProperty("pos_terminal_key");
                    const k2 = m.getDynamicProperty("linked_pos");
                    return k1 === posKey || k2 === posKey; 
                } catch { 
                    return false; 
                }
            });

            if (!linkedMarker) {
                try {
                    // 엔티티 스폰 시에는 정수 블록 좌표 정중앙(+0.5)과 블록 위(+1)에 이쁘게 소환
                    linkedMarker = player.dimension.spawnEntity("nf:pos_marker", {
                        x: locSnapshot.x + 0.5,
                        y: locSnapshot.y + 1,
                        z: locSnapshot.z + 0.5
                    });
                    if (linkedMarker) {
                        linkedMarker.nameTag = `§e${player.name} POS`;
                        linkedMarker.setDynamicProperty("pos_owner", player.name);
                        linkedMarker.setDynamicProperty("pos_terminal_key", posKey);
                        linkedMarker.setDynamicProperty("linked_pos", posKey);
                        linkedMarker.setDynamicProperty("businessId", "biz_" + Math.floor(Math.random() * 9999999));
                        player.sendMessage("§e[POS]\n§7POS 마커 자동 복구 완료");
                    }
                } catch (spawnErr) {
                    console.warn(`[POS AUTO MARKER ERROR] ${spawnErr}`);
                }
            }

            // 정수 좌표 포맷이 확보된 locSnapshot을 최종 메뉴에 전달
            showPosMainMenu(player, locSnapshot, dimId, lockKey);
        } catch (uiError) {
            releaseUiLock(lockKey);
            console.warn(`[POS/UI ERROR] ${uiError}`);
            player.sendMessage("§c[POS 오류]\n§7UI를 열 수 없습니다.");
        }
    });
    return;
}

        // =====================================================
        // [4] 키오스크
        // =====================================================

        if (blockType === "nf:kiosk") {
            const lockKey = getUiKey(player, "kiosk");
            if (!acquireUiLock(lockKey, 80)) return;

            event.cancel = true;
            const locSnapshot = { x: block.location.x, y: block.location.y, z: block.location.z };
            const dimId = player.dimension.id;

            system.run(() => {
                try {
                    let linkedKiosks = safeParse("linked_kiosks", {});
                    const kioskKey = `${locSnapshot.x},${locSnapshot.y},${locSnapshot.z}`;
                    if (!linkedKiosks[kioskKey]) {
                        releaseUiLock(lockKey);
                        player.sendMessage("§c[키오스크]\n§7연결된 POS가 없습니다.");
                        return;
                    }
                    showKioskPurchaseMenu(player, locSnapshot, dimId, lockKey);
                } catch (uiError) {
                    releaseUiLock(lockKey);
                    console.warn(`[KIOSK/UI ERROR] ${uiError}`);
                    player.sendMessage("§c[키오스크 오류]\n§7UI를 열 수 없습니다.");
                }
            });
            return;
        }

        // =====================================================
        // [5] 카지노 환전소
        // =====================================================

        if (blockType === "nf:casino_exchange") {
            const lockKey = getUiKey(player, "casino_exchange");
            if (!acquireUiLock(lockKey, 80)) return;

            event.cancel = true;
            const loc = { x: block.location.x, y: block.location.y, z: block.location.z };

            system.run(() => {
                try {
                    const exKey = `casino_exchange_${loc.x}_${loc.y}_${loc.z}`;
                    let exData = {};
                    try { exData = JSON.parse(world.getDynamicProperty(exKey) || "{}"); }
                    catch { exData = {}; }
                    showCasinoExchangeGuestUI(player, exKey, exData, lockKey);
                } catch (e) {
                    releaseUiLock(lockKey);
                    console.warn(`[CASINO UI ERROR] ${e}`);
                    try { player.sendMessage("§c카지노 UI 오류"); } catch { }
                }
            });
            return;
        }

        // =====================================================
        // [6] 카지노 슬롯머신
        // =====================================================

        if (blockType === "nf:casino_machine") {
            const lockKey = getUiKey(player, "casino_machine");
            if (!acquireUiLock(lockKey, 40)) return;

            event.cancel = true;
            const machineKey = `casino_machine_${block.location.x}_${block.location.y}_${block.location.z}`;
            // itemStack 스냅샷 (beforeEvents에서만 유효하므로 미리 복사)
            const snapItem = itemStack ? { typeId: itemStack.typeId, amount: itemStack.amount } : null;

            system.run(() => {
                try {
                    let data = {};
                    try { data = JSON.parse(world.getDynamicProperty(machineKey) || "{}"); }
                    catch { data = {}; }
                    if (!data.bet) data.bet = 0;

                    // 칩 넣기
                    if (snapItem && (snapItem.typeId === "nf:chip_1k" || snapItem.typeId === "nf:chip_10k")) {
                        const value = snapItem.typeId === "nf:chip_1k" ? 1000 : 10000;
                        const addMoney = value * snapItem.amount;
                        data.bet += addMoney;
                        world.setDynamicProperty(machineKey, JSON.stringify(data));

                        try {
                            const equip = player.getComponent("equippable");
                            equip?.setEquipment("Mainhand", undefined);
                        } catch { }

                        releaseUiLock(lockKey);
                        player.sendMessage(
                            `§e🎰 [카지노 머신]\n\n§f추가 베팅금:\n§a${addMoney.toLocaleString()}₩\n\n§f현재 누적 베팅금:\n§6${data.bet.toLocaleString()}₩`
                        );
                        return;
                    }

                    // 맨손 클릭 → 추첨
                    if (!snapItem) {
                        if (!data.bet || data.bet <= 0) {
                            releaseUiLock(lockKey);
                            player.sendMessage("§c🎰 [카지노]\n§7먼저 카지노 칩을 넣어주세요.");
                            return;
                        }
                        const totalBet = data.bet;
                        data.bet = 0;
                        world.setDynamicProperty(machineKey, JSON.stringify(data));
                        releaseUiLock(lockKey);

                        player.sendMessage(`§6🎰 슬롯머신 회전중...\n§f현재 베팅금:\n§e${totalBet.toLocaleString()}₩`);

                        const rand = Math.random();

                        if (rand < 0.03) {
                            const reward = totalBet * 10;
                            try { player.runCommandAsync(`scoreboard players add @s player_money ${reward}`); } catch { }
                            player.sendMessage(`§6§l🎰 JACKPOT 🎰\n\n§f베팅금:\n§e${totalBet.toLocaleString()}₩\n\n§a최종 당첨금:\n§6${reward.toLocaleString()}₩`);
                            return;
                        }
                        if (rand < 0.36) {
                            const reward = totalBet * 2;
                            try { player.runCommandAsync(`scoreboard players add @s player_money ${reward}`); } catch { }
                            player.sendMessage(`§a🎉 [카지노 승리]\n\n§f베팅금:\n§e${totalBet.toLocaleString()}₩\n\n§a획득금:\n§6${reward.toLocaleString()}₩`);
                            return;
                        }
                        player.sendMessage(`§c💀 [카지노 패배]\n\n§f손실 금액:\n§c${totalBet.toLocaleString()}₩`);
                        return;
                    }

                    releaseUiLock(lockKey);
                    player.sendMessage("§c[카지노]\n§7카지노 칩 또는 맨손만 사용할 수 있습니다.");
                } catch (e) {
                    releaseUiLock(lockKey);
                    console.warn(`[CASINO MACHINE ERROR] ${e}`);
                    try { player.sendMessage("§c카지노 머신 오류"); } catch { }
                }
            });
            return;
        }

    } catch (error) {
        console.warn(`[BLOCK INTERACT ERROR] ${error}`);
    }
});

// ====== POS 메인 메뉴 ======
// ★ lockKey를 받아서 show 완료 후 직접 해제
// ====== POS 메인 메뉴 (가맹점주 & 납품업체 역할 분리 통합본) ======
function showPosMainMenu(player, blockLocation, dimensionId, lockKey) {
    if (!player || !blockLocation) {
        if (lockKey) releaseUiLock(lockKey);
        return;
    }

    let terminals = safeParse("pos_terminals", {});
    const posKey = `${blockLocation.x},${blockLocation.y},${blockLocation.z}`;

    if (!terminals[posKey]) {
        terminals[posKey] = { owner: player.name, catalog: [] };
        world.setDynamicProperty("pos_terminals", JSON.stringify(terminals));
    }

    const posData = terminals[posKey];
    const isOwner = posData.owner === player.name || player.hasTag("admin");

    // 1. 마커 검색 조건 강화 (linked_pos와 pos_terminal_key 교차 검증)
    let marker = null;
    try {
        const allMarkers = [...player.dimension.getEntities({ type: "nf:pos_marker" })];
        marker = allMarkers.find(m => {
            try { 
                const k1 = m.getDynamicProperty("pos_terminal_key");
                const k2 = m.getDynamicProperty("linked_pos");
                return k1 === posKey || k2 === posKey; 
            } catch { 
                return false; 
            }
        }) || null;
    } catch (e) {
        console.warn(`[POS MARKER SEARCH ERROR] ${e}`);
    }

    const form = new ActionFormData()
        .title("§e[POS 계산대]")
        .body(
            `§7위치: (${blockLocation.x}, ${blockLocation.y}, ${blockLocation.z})\n` +
            `§7소유주: §a${posData.owner}\n\n§e원하는 작업을 선택하세요.`
        );

    // 버튼 인덱스 매핑 (동적 등록)
    const btnMap = [];
    
    // [공통 기능] 손님용 구매 UI
    form.button("§d🛒 상품 구매");
    btnMap.push("buy");

    // [가맹점주 전용 기능]
    if (isOwner) {
        form.button("§6📦 판매 상품 관리"); btnMap.push("catalog");
        form.button("§e🤝 물류 가맹 계약"); btnMap.push("franchise");
        form.button("§a📨 상품 발주"); btnMap.push("order");
        form.button("§b🔗 키오스크 연결 막대기"); btnMap.push("kiosk_linker");
        form.button("§a 주식상장"); btnMap.push("stock_sign");
        form.button("§e 상호명변경"); btnMap.push("name_change");
    }

    // [납품업체/도매 본사 전용 기능] 
    // 연동된 마커의 소유주이거나, 어드민인 경우에만 노출
    const isSupplier = (marker && marker.getDynamicProperty("pos_owner") === player.name) || player.hasTag("admin");
    if (isSupplier) {
        form.button("§6🚚 납품 마커 원격 등록"); btnMap.push("supplier_reg");
        form.button("§b📦 본사 도매 카탈로그"); btnMap.push("supplier_catalog");
        form.button("§d🚛 가맹점 발주 처리"); btnMap.push("supply_process");
    }

    form.button("§f❌ 닫기");
    btnMap.push("close");

    form.show(player).then(res => {
        // UI 액션 종료 후 즉시 락 해제
        if (lockKey) releaseUiLock(lockKey);
        if (!res || res.canceled) return;

        const action = btnMap[res.selection];
        if (!action || action === "close") return;

        try {
            // 2. 공통 및 가맹점 전용 UI 라우팅 실행
            if (action === "buy") { showPosCustomerPurchaseUI(player, blockLocation, dimensionId); return; }
            if (action === "catalog") { showPosCatalogManageUI(player, blockLocation, dimensionId); return; }
            if (action === "franchise") { showPosFranchiseUI(player, marker); return; }
            if (action === "stock_sign") { handleStockMenu(player, action, blockLocation); return; }
            if (action === "name_change") { handleNameChangeUI(player, action, blockLocation, dimensionId); return; }

            // 3. 가맹점주용 발주 기능 (마커 체크 독립 분리)
            if (action === "order") {
                if (!marker) {
                    player.sendMessage("§c[POS] 계약된 가맹 납품업체 마커를 찾을 수 없습니다.");
                    return;
                }
                showPosOrderUI(player, marker); 
                return; 
            }

            // 4. 납품업체 본사 전용 UI 라우팅 (묶음 유효성 검사)
            if (["supplier_reg", "supplier_catalog", "supply_process"].includes(action)) {
                if (!marker) {
                    player.sendMessage("§c[POS] 동기화된 납품 마커가 필드에 존재하지 않습니다.");
                    return;
                }
                if (action === "supplier_reg") { showPosSupplierRegisterUI(player, marker); return; }
                if (action === "supplier_catalog") { showSupplierCatalogUI(player, marker); return; }
                if (action === "supply_process") { showPosSupplyProcessUI(player, marker); return; }
            }

            // 5. 부가 아이템 지급 명령 핸들러
            if (action === "kiosk_linker") {
                system.run(() => {
                    try {
                        player.runCommand("give @s nf:kiosk_linker 1");
                        player.sendMessage("§a[POS] 키오스크 연결 막대기 지급 완료");
                    } catch (e) {
                        console.warn(`[KIOSK LINKER GIVE ERROR] ${e}`);
                        player.sendMessage("§c[POS] 아이템 지급 실패");
                    }
                });
            }
        } catch (subUiError) {
            player.sendMessage(`§c[시스템 오류] 내부 연동 함수가 올바르지 않습니다.\n§7오류내용: ${subUiError.message}`);
            console.error(`[Sub UI Error] ${subUiError}`);
        }
    }).catch(e => {
        if (lockKey) releaseUiLock(lockKey);
        console.warn(`[POS FORM ERROR] ${e}`);
    });
}

// 닉네임 변경 UI
// ====== 상호명 변경 기능 ======
function handleNameChangeUI(player, key, blockLocation, dimensionId) {
    if (key === "name_change") {
        if (!blockLocation) {
            player.sendMessage("§c[오류] 메인 메뉴로부터 블록 좌표를 전달받지 못했습니다.");
            return;
        }
        showNameChangeUI(player, blockLocation, dimensionId);
    }
}
function showNameChangeUI(player, blockLocation, dimensionId) {
    const form = new ModalFormData()
        .title("상호명 변경")
        .textField("새 상호명 입력", "새로운 상호명");

    form.show(player).then(res => {
        if (res.canceled) return;

        const newName = res.formValues[0].trim();
        if (!newName) {
            player.sendMessage("§c상호명은 공백이 될 수 없습니다.");
            return;
        }

        // 정수형 좌표 변환으로 키값 일치 보장
        const blockX = Math.floor(blockLocation.x);
        const blockY = Math.floor(blockLocation.y);
        const blockZ = Math.floor(blockLocation.z);
        const posKey = `${blockX},${blockY},${blockZ}`;

        let terminals = safeParse("pos_terminals", {});
        const posData = terminals[posKey];

        if (!posData) {
            player.sendMessage(`§cPOS 데이터를 찾을 수 없습니다.\n§7[시도된 좌표 키]: ${posKey}`);
            return;
        }

        // 1. 데이터베이스에 새 상호명 적용
        posData.name = newName;
        world.setDynamicProperty("pos_terminals", JSON.stringify(terminals));

        // 2. 마커 이름 업데이트 (★ 조건 강화 및 교차 검증)
        try {
            const allMarkers = [...player.dimension.getEntities({ type: "nf:pos_marker" })];
            const marker = allMarkers.find(m => {
                try { 
                    // 두 변수명 중 하나라도 현재 posKey와 일치하면 마커로 인정
                    const key1 = m.getDynamicProperty("linked_pos");
                    const key2 = m.getDynamicProperty("pos_terminal_key");
                    return key1 === posKey || key2 === posKey; 
                } catch { 
                    return false; 
                }
            });

            if (marker) {
                marker.nameTag = `§e${newName}`;
            } else {
                // 마커를 월드 내에서 엔티티로 찾지 못했을 때의 경고 안내 (단, 데이터는 정상 저장됨)
                console.warn(`[POS] 월드 내에서 좌표(${posKey})에 해당하는 엔티티 마커를 로드하지 못했습니다.`);
            }
        } catch (e) {
            console.warn(`[POS MARKER UPDATE ERROR] ${e}`);
        }

        player.sendMessage(`§a상호명이 "${newName}"(으)로 변경되었습니다.`);
    }).catch(e => console.error(`[Name Change UI Error] ${e}`));
}

// ====== 주식상장 UI ======
function handleStockMenu(player, key, blockLocation) {
    if (key === "stock_sign") {
        if (!blockLocation) {
            player.sendMessage("§c[오류] 메인 메뉴로부터 POS 단말기 좌표를 전달받지 못했습니다.");
            return;
        }
        showStockSignUI(player, blockLocation);
    }
}

function showStockSignUI(player, blockLocation) {
    // ★ 핵심 최적화: 소수점 좌표 완벽 방어
    // 메인 메뉴의 locSnapshot({x+0.5...})이 들어와도 정확히 정수 블록 좌표로 치환합니다.
    const blockX = Math.floor(blockLocation.x);
    const blockY = Math.floor(blockLocation.y);
    const blockZ = Math.floor(blockLocation.z);
    const posKey = `${blockX},${blockY},${blockZ}`;

    let terminals = safeParse("pos_terminals", {});
    const posData = terminals[posKey];

    // 데이터 검증 실패 시 디버깅을 위해 시도한 posKey를 보여줍니다.
    if (!posData) {
        player.sendMessage(`§cPOS 데이터를 찾을 수 없습니다. 상장할 수 없습니다.\n§7[시도된 좌표 키]: ${posKey}`);
        return;
    }

    const defaultName = posData.name || "미지정 상호명";

    const form = new ModalFormData()
        .title("주식 상장")
        .textField("회사 이름 (상호명)", "회사 이름 입력", defaultName)
        .textField("회사 코드 (예: NFNEW)", "NFNEW")
        .textField("최초 주가", "1000")
        .textField("대출 금액", "0");

    form.show(player).then(res => {
        if (res.canceled) return;

        const [nameInput, codeInput, priceStr, debtStr] = res.formValues;
        
        const name = nameInput ? nameInput.trim() : defaultName;
        const code = codeInput ? codeInput.trim().toUpperCase() : ""; // 코드는 대문자 공백제거 처리
        const price = parseInt(priceStr);
        const debt = parseInt(debtStr);

        // 유효성 검사
        if (!code || !name || isNaN(price) || isNaN(debt) || price <= 0 || debt < 0) {
            player.sendMessage("§c입력 오류: 빈칸이 있거나 값이 올바르지 않습니다. (최초 주가는 0보다 커야 합니다)");
            return;
        }

        let stocks = safeParse("stocks", {});

        if (stocks[code]) {
            player.sendMessage(`§c이미 존재하는 주식 코드[${code}]입니다.`);
            return;
        }

        // 주식 데이터 구조 최적화 및 저장
        stocks[code] = {
            name,
            price,
            fluc: 0.05,
            revenue: 0,
            debt,
            history: [price],
            posKey: posKey // 역추적 및 마커 연동용 좌표 키 보존
        };

        world.setDynamicProperty("stocks", JSON.stringify(stocks));
        player.sendMessage(`§a상장 완료: ${name} [${code}]`);
        
    }).catch(e => console.error(`[Stock Sign UI Error] ${e}`));
}
// ====== POS 고객 구매 UI ======

function showPosCustomerPurchaseUI(player, blockLocation, dimensionId) {
    if (!player || !blockLocation) return;

    let terminals = safeParse("pos_terminals", {});
    const posKey = `${blockLocation.x},${blockLocation.y},${blockLocation.z}`;
    const posData = terminals[posKey];

    if (!posData || !posData.catalog || posData.catalog.length === 0) {
        player.sendMessage("§c[POS] 등록된 상품이 없습니다. 소유주에게 상품 등록을 요청하세요.");
        return;
    }

    const catalog = posData.catalog;
    const form = new ActionFormData()
        .title("§d[상품 선택]")
        .body("구매할 상품을 선택해 주세요.");

    for (const prod of catalog) {
        form.button(`§e${prod.name}\n§a가격: ${prod.price.toLocaleString()}₩`);
    }
    form.button("뒤로 가기");

    form.show(player).then(res => {
        if (res.canceled || res.selection === catalog.length) {
            showPosMainMenu(player, blockLocation, dimensionId, null);
            return;
        }
        const selectedProd = catalog[res.selection];
        showProductQuantityUI(player, blockLocation, blockLocation, dimensionId, selectedProd, posData.owner, false);
    }).catch(e => console.error(`[POS Cust Purchase Error] ${e}`));
}

// ====== 키오스크 구매 메뉴 ======

function showKioskPurchaseMenu(player, blockLocation, dimensionId, lockKey) {
    if (!player || !blockLocation) {
        if (lockKey) releaseUiLock(lockKey);
        return;
    }

    let linkedKiosks = safeParse("linked_kiosks", {});
    const kioskKey = `${blockLocation.x},${blockLocation.y},${blockLocation.z}`;
    const posLoc = linkedKiosks[kioskKey];

    if (!posLoc) {
        if (lockKey) releaseUiLock(lockKey);
        player.sendMessage("§c[키오스크] 이 키오스크는 연결되어 있지 않습니다.");
        return;
    }

    let terminals = safeParse("pos_terminals", {});
    const posKey = `${posLoc.x},${posLoc.y},${posLoc.z}`;
    const posData = terminals[posKey];

    if (!posData || !posData.catalog || posData.catalog.length === 0) {
        if (lockKey) releaseUiLock(lockKey);
        player.sendMessage("§c[키오스크] 상품이 없습니다.");
        return;
    }

    const catalog = posData.catalog;
    const form = new ActionFormData()
        .title("§b[키오스크 상점]")
        .body("구매할 상품을 선택하세요:");

    for (const prod of catalog) {
        form.button(`§e${prod.name}\n§a가격: ${prod.price.toLocaleString()}₩`);
    }
    form.button("❌ 닫기");

    form.show(player).then(res => {
        if (lockKey) releaseUiLock(lockKey);
        if (res.canceled || res.selection === catalog.length) return;
        const selectedProd = catalog[res.selection];
        showProductQuantityUI(player, blockLocation, posLoc, dimensionId, selectedProd, posData.owner, true);
    }).catch(e => {
        if (lockKey) releaseUiLock(lockKey);
        console.error(`[Kiosk Purchase Menu Error] ${e}`);
    });
}

// ====== 수량 선택 UI ======

function showProductQuantityUI(player, interactBlockLoc, posLoc, dimensionId, product, ownerName, isKiosk) {
    if (!player || !product) return;

    new ModalFormData()
        .title("§d[수량 선택]")
        .textField(`§e${product.name}`, "1", "1")
        .show(player).then(res => {
            if (res.canceled) {
                if (isKiosk) {
                    showKioskPurchaseMenu(player, interactBlockLoc, dimensionId, null);
                } else {
                    showPosCustomerPurchaseUI(player, interactBlockLoc, dimensionId);
                }
                return;
            }
            const quantity = parseInt(res.formValues[0] || "1");
            if (isNaN(quantity) || quantity <= 0) { player.sendMessage("§c[오류] 수량 오류"); return; }
            if (quantity > 64) { player.sendMessage("§c[오류] 최대 64개"); return; }

            const totalCost = product.price * quantity;
            showPurchaseConfirmUI(player, interactBlockLoc, posLoc, dimensionId, product, quantity, totalCost, ownerName, isKiosk);
        }).catch(e => console.error(`[Quantity UI Error] ${e}`));
}

// ====== 결제 확인 UI ======

function showPurchaseConfirmUI(player, interactBlockLoc, posLoc, dimensionId, product, quantity, totalCost, ownerName, isKiosk) {
    if (!player) return;

    new ActionFormData()
        .title("§d[결제 확인]")
        .body(`§e${product.name} x${quantity}\n§a총액: ${totalCost.toLocaleString()}₩`)
        .button("§a결제")
        .button("§c취소")
        .show(player).then(res => {
            if (res.canceled || res.selection === 1) return;
            const finalMoney = getPlayerMoney(player);
            if (finalMoney < totalCost) { player.sendMessage("§c[오류] 잔액 부족"); return; }
            processPaymentAndIssueReceipt(player, posLoc, dimensionId, product.name, quantity, totalCost, ownerName);
        }).catch(e => console.error(`[Confirm UI Error] ${e}`));
}

// ====== 결제 처리 및 교환권 발행 ======

function processPaymentAndIssueReceipt(player, posLoc, dimensionId, itemName, quantity, totalCost, ownerName) {
    try {
        player.runCommand(`scoreboard players remove @s player_money ${totalCost}`);
        player.dimension.runCommand(`scoreboard players add "${ownerName}" player_money ${totalCost}`);

        const receiptItem = new ItemStack("nf:receipt", 1);
        receiptItem.nameTag = `§e${itemName} x${quantity}`;

        const inventory = player.getComponent("inventory");
        if (inventory && inventory.container) {
            inventory.container.addItem(receiptItem);
        } else {
            player.dimension.spawnItem(receiptItem, player.location);
        }

        player.sendMessage(`§a[결제 완료] ${itemName} x${quantity} | ${totalCost.toLocaleString()}₩`);

        const ownerPlayer = world.getAllPlayers().find(p => p.name === ownerName);
        if (ownerPlayer) {
            ownerPlayer.sendMessage(`§d[POS 알림] ${player.name}님이 ${itemName} x${quantity} 구매 | +${totalCost.toLocaleString()}₩`);
        }
    } catch (error) {
        console.error(`[Payment Error] ${error}`);
    }
}

// ====== POS 상품 관리 UI ======

function showPosCatalogManageUI(player, blockLocation, dimensionId) {
    if (!player || !blockLocation) return;

    let terminals = safeParse("pos_terminals", {});
    const posKey = `${blockLocation.x},${blockLocation.y},${blockLocation.z}`;
    const posData = terminals[posKey];
    if (!posData) return;

    const catalog = posData.catalog || [];
    const form = new ActionFormData()
        .title("§6[상품 관리]")
        .body(`§e상품 ${catalog.length}개`);

    form.button("신규 등록");
    for (const prod of catalog) form.button(prod.name);
    form.button("뒤로");

    form.show(player).then(res => {
        if (res.canceled) return;
        if (res.selection === 0) {
            showPosAddProductUI(player, blockLocation, dimensionId);
        } else if (res.selection === catalog.length + 1) {
            showPosMainMenu(player, blockLocation, dimensionId, null);
        } else {
            const prodIndex = res.selection - 1;
            showPosDeleteProductUI(player, blockLocation, dimensionId, prodIndex, catalog[prodIndex]);
        }
    }).catch(e => console.error(`[Catalog Manage Error] ${e}`));
}

function showPosAddProductUI(player, blockLocation, dimensionId) {
    if (!player) return;

    new ModalFormData()
        .title("§a[상품 등록]")
        .textField("이름", "", "")
        .textField("가격", "", "")
        .show(player).then(res => {
            if (res.canceled) return;
            const name = res.formValues[0];
            const price = parseInt(res.formValues[1]);
            if (!name || isNaN(price) || price < 0) { player.sendMessage("§c올바른 값을 입력하세요."); return; }

            let terminals = safeParse("pos_terminals", {});
            const posKey = `${blockLocation.x},${blockLocation.y},${blockLocation.z}`;
            if (!terminals[posKey]) return;
            if (!terminals[posKey].catalog) terminals[posKey].catalog = [];
            terminals[posKey].catalog.push({ name, price });
            world.setDynamicProperty("pos_terminals", JSON.stringify(terminals));

            player.sendMessage(`§a[POS] '${name}' 상품이 등록되었습니다.`);
            showPosCatalogManageUI(player, blockLocation, dimensionId);
        }).catch(e => console.error(`[Add Product Error] ${e}`));
}

function showPosDeleteProductUI(player, blockLocation, dimensionId, index, product) {
    if (!player || !product) return;

    new ActionFormData()
        .title("§c상품 삭제")
        .body(`§e${product.name} (${product.price.toLocaleString()}₩)\n\n정말 삭제하시겠습니까?`)
        .button("§c삭제").button("취소")
        .show(player).then(res => {
            if (res.canceled || res.selection === 1) {
                showPosCatalogManageUI(player, blockLocation, dimensionId);
                return;
            }
            let terminals = safeParse("pos_terminals", {});
            const posKey = `${blockLocation.x},${blockLocation.y},${blockLocation.z}`;
            if (terminals[posKey]?.catalog) {
                terminals[posKey].catalog.splice(index, 1);
                world.setDynamicProperty("pos_terminals", JSON.stringify(terminals));
            }
            player.sendMessage(`§c[POS] '${product.name}' 상품이 삭제되었습니다.`);
            showPosCatalogManageUI(player, blockLocation, dimensionId);
        }).catch(e => console.error(`[Delete Product Error] ${e}`));
}

// ====== POS 납품업체 등록 UI ======


function showPosSupplierRegisterUI(player, marker) {
    if (!player || !marker) {
        player?.sendMessage("§c[납품업체] 마커를 찾을 수 없습니다.");
        return;
    }

    // 1. 월드 내의 모든 POS 마커 중에서 'supplierId'가 등록된(납품업체인) 마커들을 싹 수집
    let supplierMarkers = [];
    try {
        const allMarkers = [...player.dimension.getEntities({ type: "nf:pos_marker" })];
        supplierMarkers = allMarkers.filter(m => {
            try { return m.getDynamicProperty("supplierId") !== undefined; }
            catch { return false; }
        });
    } catch (e) {
        console.warn(`[Supplier Search Error] ${e}`);
    }

    // 2. 등록 가능한 납품업체가 하나도 없을 때 예외 처리
    if (supplierMarkers.length === 0) {
        player.sendMessage("§c[납품업체 등록]\n§7현재 등록 가능한 납품업체가 존재하지 않습니다.");
        return;
    }

    // 3. ActionFormData를 이용해 가게 이름으로 버튼 목록 생성
    const form = new ActionFormData()
        .title("§l🤝 납품업체 가맹 선택")
        .body("§7계약을 맺을 납품업체(공급처)를 선택하세요.");

    for (const sm of supplierMarkers) {
        const rawName = sm.nameTag || "이름 없는 업체";
        const cleanName = rawName.replace(/§./g, ""); // 색상 코드 제거
        const supId = sm.getDynamicProperty("supplierId");

        // 버튼 텍스트에 가게 이름과 ID를 친절하게 표시
        form.button(`§e🏪 ${cleanName}\n§8[ID: ${supId}]`);
    }
    form.button("§c닫기");

    // 4. 플레이어가 선택한 가게를 내 마커에 등록
    form.show(player).then(res => {
        if (res.canceled || res.selection === supplierMarkers.length) return;

        // 플레이어가 누른 버튼의 인덱스로 마커 데이터 매칭
        const selectedMarker = supplierMarkers[res.selection];
        const selectedSupId = selectedMarker.getDynamicProperty("supplierId");
        const selectedName = (selectedMarker.nameTag || "이름 없는 업체").replace(/§./g, "");

        // 현재 내 마커에 선택한 가맹점의 supplierId를 저장
        marker.setDynamicProperty("franchisedSupplier", selectedSupId);

        player.sendMessage(`§a[납품업체 등록 완료]\n§f이제 '§e${selectedName}§f' 점포로부터 물품을 발주할 수 있습니다!`);
    }).catch(e => console.error(`[Supplier Register UI Error] ${e}`));
}
// ====== 도매 카탈로그 UI ======

function showSupplierCatalogUI(player, marker) {
    if (!player || !marker) {
        player?.sendMessage("§c[도매] 마커를 찾을 수 없습니다.");
        return;
    }

    const supId = marker.getDynamicProperty("franchisedSupplier");
    if (!supId) {
        player.sendMessage("§c[도매] 먼저 납품업체를 등록하세요.");
        return;
    }

    let supMarker = null;
    try {
        const allMarkers = [...player.dimension.getEntities({ type: "nf:pos_marker" })];
        supMarker = allMarkers.find(m => {
            try { return m.getDynamicProperty("supplierId") === supId; }
            catch { return false; }
        }) || null;
    } catch (e) { console.warn(`[Supplier Catalog Search] ${e}`); }

    if (!supMarker) {
        player.sendMessage("§c[도매] 납품업체 단말기를 찾을 수 없습니다.");
        return;
    }

    let catalog = [];
    try { catalog = JSON.parse(supMarker.getDynamicProperty("supplier_catalog") || "[]"); }
    catch { catalog = []; }

    if (catalog.length === 0) {
        player.sendMessage("§c[도매] 등록된 도매 상품이 없습니다.");
        return;
    }

    const form = new ActionFormData()
        .title("§l📦 도매 카탈로그")
        .body(`§7납품업체: §f${supMarker.getDynamicProperty("pos_owner") || "알 수 없음"}\n\n§e도매 상품 목록:`);

    for (const c of catalog) {
        form.button(`§e${c.name}\n§f도매가: ${c.price?.toLocaleString() || 0}₩`);
    }
    form.button("§c닫기");

    form.show(player).then(res => {
        if (res.canceled || res.selection === catalog.length) return;
    }).catch(e => console.error(`[Supplier Catalog UI Error] ${e}`));
}

// ====== 물류 가맹 계약 UI ======

function showPosFranchiseUI(player, marker) {
    if (!player || !marker) {
        player?.sendMessage("§c[가맹] 마커를 찾을 수 없습니다.");
        return;
    }

    // ★ [중요] 최초 열람 시 이 마커의 진짜 납품업체 주인을 현재 플레이어로 설정
    if (!marker.getDynamicProperty("supplier_owner")) {
        marker.setDynamicProperty("supplier_owner", player.name);
    }

    const supId = marker.getDynamicProperty("supplierId") || ("biz_" + Math.floor(Math.random() * 9999999));
    if (!marker.getDynamicProperty("supplierId")) {
        marker.setDynamicProperty("supplierId", supId);
    }

    const rawName = marker.nameTag || "이름 없는 점포";
    const storeName = rawName.replace(/§./g, "");

    let catalog = [];
    try { 
        catalog = JSON.parse(marker.getDynamicProperty("supplier_catalog") || "[]"); 
    } catch { 
        catalog = []; 
    }

    const form = new ActionFormData()
        .title(`§l🤝 [${storeName}] 물류 가맹`)
        .body(
            `§d【 ${storeName} 】 §7점포의 물류 및 도매 설정입니다.\n` +
            `§7이 점포를 다른 POS에 등록하면 발주를 받을 수 있습니다.\n\n` +
            `§e내 납품업체 ID: §a${supId}\n` +
            `§e도매업체 대표자: §f${player.name}\n` +
            `§7현재 등록된 도매 상품: §f${catalog.length}개`
        )
        .button("📦 도매 상품 등록/관리")
        .button("§c닫기");

    form.show(player).then(res => {
        if (res.canceled || res.selection === 1) return;
        showSupplierCatalogManageUI(player, marker);
    }).catch(e => console.error(`[Franchise UI Error] ${e}`));
}

function showSupplierCatalogManageUI(player, marker) {
    if (!player || !marker) return;

    const rawName = marker.nameTag || "이름 없는 점포";
    const storeName = rawName.replace(/§./g, "");

    // 납품업자 주인 이름 확정
    const supplierOwner = marker.getDynamicProperty("supplier_owner") || player.name;

    let catalog = [];
    try { 
        catalog = JSON.parse(marker.getDynamicProperty("supplier_catalog") || "[]"); 
    } catch { 
        catalog = []; 
    }

    const form = new ActionFormData()
        .title(`§l📦 [${storeName}] 도매 상품 목록`)
        .body(`§7대표자: §e${supplierOwner}\n§7현재 등록된 도매 상품 수: §e${catalog.length}개`);

    form.button("➕ 신규 도매 상품 등록");
    for (const c of catalog) {
        form.button(`§e${c.name}\n§f도매가: ${c.price?.toLocaleString() || 0}₩`);
    }
    form.button("§c닫기");

    form.show(player).then(res => {
        if (res.canceled || res.selection === catalog.length + 1) return;
        
        if (res.selection === 0) {
            // 신규 도매 상품 등록 UI
            new ModalFormData()
                .title(`§a[${storeName}] 상품 추가`)
                .textField("상품 이름", "예: 다이아몬드")
                .textField("아이템 ID", "예: minecraft:diamond")
                .textField("도매가 (₩)", "예: 5000")
                .show(player).then(r => {
                    if (r.canceled) return;
                    const name = r.formValues[0]?.trim();
                    const item = r.formValues[1]?.trim();
                    const price = parseInt(r.formValues[2] || "0");
                    if (!name || !item || isNaN(price) || price < 0) {
                        player.sendMessage("§c올바른 값을 입력하세요.");
                        return;
                    }
                    
                    catalog.push({ name, item, price });
                    const stringData = JSON.stringify(catalog);
                    
                    // 1. 마커 본체에 세팅
                    marker.setDynamicProperty("supplier_catalog", stringData);
                    // 2. ★ [실시간 연동 핵심] 가맹점이 확실하게 긁어갈 수 있도록 세계관 전역 백업 테이블에 세팅
                    world.setDynamicProperty(`supplier_catalog_${supplierOwner}`, stringData);
                    
                    player.sendMessage(`§a[도매] '${storeName}'에 '${name}' 상품이 등록되었습니다.`);
                    showSupplierCatalogManageUI(player, marker);
                }).catch(e => console.error(`[Supplier Product Add Error] ${e}`));
        } else {
            // 도매 상품 삭제 UI
            const idx = res.selection - 1;
            const prod = catalog[idx];
            new ActionFormData()
                .title(`§c[${storeName}] 상품 삭제`)
                .body(`§e${prod.name}§7 상품을 도매 카탈로그에서 삭제하시겠습니까?`)
                .button("§c삭제하기")
                .button("취소")
                .show(player).then(r => {
                    if (r.canceled || r.selection === 1) { showSupplierCatalogManageUI(player, marker); return; }
                    
                    catalog.splice(idx, 1);
                    const stringData = JSON.stringify(catalog);
                    
                    // 1. 마커 본체 데이터 갱신
                    marker.setDynamicProperty("supplier_catalog", stringData);
                    // 2. ★ [실시간 연동 핵심] 전역 백업 데이터에서도 삭제 동기화
                    world.setDynamicProperty(`supplier_catalog_${supplierOwner}`, stringData);
                    
                    player.sendMessage(`§c[도매] '${storeName}'에서 '${prod.name}' 상품이 삭제되었습니다.`);
                    showSupplierCatalogManageUI(player, marker);
                }).catch(e => console.error(`[Supplier Product Delete Error] ${e}`));
        }
    }).catch(e => console.error(`[Supplier Catalog Manage Error] ${e}`));
}

//상품 발주 UI
function showPosOrderUI(player, marker) {
    if (!player) return;
    if (!marker) {
        player.sendMessage("§c[상품 발주]\n§7연결된 납품 마커(업체)를 찾을 수 없습니다.");
        return;
    }

    // 진짜 납품업체 주인의 이름 판별
    let supplierOwnerName = marker.getDynamicProperty("supplier_owner") || marker.getDynamicProperty("pos_owner");
    if (!supplierOwnerName && marker.nameTag) {
        const cleanTag = marker.nameTag.replace(/§./g, "");
        if (cleanTag.includes("납품업체")) supplierOwnerName = cleanTag.split(" ")[0];
    }

    const storeName = supplierOwnerName ? `${supplierOwnerName} 납품업체` : "가맹 도매처";

    // 도매 카탈로그 데이터 불러오기
    let catalog = [];
    try {
        catalog = JSON.parse(marker.getDynamicProperty("supplier_catalog") || "[]");
    } catch {
        catalog = [];
    }

    if (catalog.length === 0 && supplierOwnerName) {
        try {
            const globalBackup = world.getDynamicProperty(`supplier_catalog_${supplierOwnerName}`);
            if (globalBackup) catalog = JSON.parse(globalBackup);
        } catch {}
    }

    if (catalog.length === 0) {
        player.sendMessage(`§c[발주 실패]\n§7'${storeName}'에 등록된 도매 상품이 없습니다.`);
        return;
    }

    const form = new ActionFormData()
        .title("§l§a📨 가맹점 상품 발주")
        .body(`§7납품처: §e${storeName}\n§7발주할 상품을 선택하세요.`);

    for (const prod of catalog) {
        form.button(`§e📦 ${prod.name}\n§f도매단가: ${prod.price.toLocaleString()}₩`);
    }
    form.button("§c닫기");

    form.show(player).then(res => {
        if (res.canceled || res.selection === catalog.length) return;

        const selectedProd = catalog[res.selection];

        new ModalFormData()
            .title(`§a[발주 신청] ${selectedProd.name}`)
            .textField(`§7도매가: ${selectedProd.price.toLocaleString()}₩\n\n§f발주할 수량을 입력하세요.`, "예: 64")
            .show(player).then(r => {
                if (r.canceled) { showPosOrderUI(player, marker); return; }

                const countInput = r.formValues[0]?.trim();
                const count = parseInt(countInput);

                if (!count || isNaN(count) || count <= 0) {
                    player.sendMessage("§c[발주 실패] 올바른 수량을 입력하세요.");
                    return;
                }

                const totalCost = selectedProd.price * count;

                // 잔액 검증 및 차감
                let playerMoney = 0;
                try {
                    playerMoney = world.scoreboard.getObjective("player_money")?.getScore(player) || 0;
                } catch {
                    playerMoney = 0;
                }

                if (playerMoney < totalCost) {
                    player.sendMessage(`§c[발주 실패] 가맹점 잔액이 부족합니다.\n§7필요 금액: ${totalCost.toLocaleString()}₩`);
                    return;
                }

                try {
                    player.runCommand(`scoreboard players remove @s player_money ${totalCost}`);
                } catch (e) {
                    player.sendMessage("§c[발주 실패] 경제 시스템 연동 에러");
                    return;
                }

                // ★ [핵심 고정] 마커가 아닌 world 전역 저장소에 납품업자별 독립 대기열 저장
                let globalOrders = [];
                if (supplierOwnerName) {
                    try {
                        const rawGlobal = world.getDynamicProperty(`orders_${supplierOwnerName}`);
                        if (rawGlobal) globalOrders = JSON.parse(rawGlobal);
                    } catch {
                        globalOrders = [];
                    }
                }

                const newOrder = {
                    name: selectedProd.name,
                    item: selectedProd.item,
                    count: count,
                    totalCost: totalCost,
                    orderPlayer: player.name,
                    timestamp: Date.now()
                };

                globalOrders.push(newOrder);
                
                // 전역 DB 및 백업용 마커 동시 저장 (리스트 안 뜨는 현상 완전 박멸)
                if (supplierOwnerName) {
                    world.setDynamicProperty(`orders_${supplierOwnerName}`, JSON.stringify(globalOrders));
                }
                marker.setDynamicProperty("orders", JSON.stringify(globalOrders));

                // 실시간 영수증 발송부
                if (supplierOwnerName) {
                    const supplierPlayer = world.getAllPlayers().find(p => p.name === supplierOwnerName);
                    if (supplierPlayer) {
                        try {
                            const supplierInv = supplierPlayer.getComponent("inventory")?.container;
                            if (supplierInv) {
                                const receiptItemType = ItemTypes.get("minecraft:paper");
                                if (receiptItemType) {
                                    const receipt = new ItemStack(receiptItemType, 1);
                                    receipt.nameTag = `§b[발주요청] §f${selectedProd.name} §e${count}개 §7(발주: ${player.name})`;
                                    const leftover = supplierInv.addItem(receipt);
                                    if (leftover && leftover.amount > 0) {
                                        supplierPlayer.dimension.spawnItem(receipt, supplierPlayer.location);
                                    }
                                    supplierPlayer.sendMessage(`§d[물류 가맹 알림] §e${player.name}§f 가맹점에서 §b${selectedProd.name} ${count}개§f를 발주했습니다! (영수증 지급됨)`);
                                }
                            }
                        } catch {}
                    }
                }

                player.sendMessage(
                    `§a[발주 완료]\n` +
                    `§f신청 상품: ${selectedProd.name} ${count}개\n` +
                    `§f선결제 금액: ${totalCost.toLocaleString()}₩\n` +
                    `§7납품업체 전역 대기열에 발주 데이터가 등록되었습니다.`
                );

            }).catch(e => console.error(e));
    }).catch(e => console.error(e));
}

// ====== 상품 납품 UI ======
// ★ 핵심 수정: marker null 체크 강화 + .catch() 추가
// ====== 상품 납품 및 발주 처리 UI ======
// ====== 상품 납품 및 직접 배송 처리 UI ======
// ====== 상품 납품 및 직접 배송 처리 UI ======
function showPosSupplyProcessUI(player, marker) {
    if (!player) return;

    // 1. 전역 DB에서 내 이름 앞으로 온 주문 목록 로딩
    let orders = [];
    try {
        const rawGlobalOrders = world.getDynamicProperty(`orders_${player.name}`);
        if (rawGlobalOrders && rawGlobalOrders.trim() !== "") {
            orders = JSON.parse(rawGlobalOrders);
        }
    } catch (err) {
        orders = [];
    }

    // 마커 백업본과 교차 검증 (방어 코드)
    if (orders.length === 0 && marker) {
        try {
            const rawMarkerOrders = marker.getDynamicProperty("orders");
            if (rawMarkerOrders) orders = JSON.parse(rawMarkerOrders);
        } catch {}
    }

    if (orders.length === 0) {
        player.sendMessage("§c[납품 처리]\n§7현재 본인에게 접수된 가맹점 발주 요청이 없습니다.");
        return;
    }

    const form = new ActionFormData()
        .title("§l§d🚛 가맹점 발주 직접 배송")
        .body(`§7현재 접수된 총 발주 건수: §e${orders.length}건\n§7가맹점으로 즉시 원격 배송할 항목을 선택하세요.`);

    for (const o of orders) {
        form.button(`§e📦 ${o.name}\n§f수량: ${o.count}개 | 발주자: ${o.orderPlayer}`);
    }
    form.button("§c닫기");

    form.show(player).then(res => {
        if (res.canceled || res.selection === orders.length) return;

        const orderIndex = res.selection;
        const order = orders[orderIndex];

        // 2. 주문자(가맹점주) 온라인 체크
        const targetPlayer = world.getAllPlayers().find(p => p.name === order.orderPlayer);
        if (!targetPlayer) {
            player.sendMessage(`§c[배송 실패] 발주자 '${order.orderPlayer}'님이 오프라인입니다.`);
            return;
        }

        // 3. 주문자(가맹점주) 인벤토리 컴포넌트 로드
        const targetInv = targetPlayer.getComponent("inventory")?.container;
        if (!targetInv) {
            player.sendMessage("§c[배송 실패] 가맹점주의 인벤토리를 참조할 수 없습니다.");
            return;
        }

        // =======================================================
        // ★ 변경 포인트: 도매업자의 인벤토리 검수 및 아이템 차감 로직 완전 삭제
        // =======================================================

        // 4. 가맹점주 인벤토리로 아이템 즉시 생성 및 원격 주입 (인벤 가득 참 방어 포함)
        try {
            const targetItemType = ItemTypes.get(order.item);
            if (targetItemType) {
                let remainGive = order.count;
                
                while (remainGive > 0) {
                    const giveAmount = Math.min(remainGive, 64);
                    const itemToGive = new ItemStack(targetItemType, giveAmount);
                    const leftover = targetInv.addItem(itemToGive);
                    
                    if (leftover && leftover.amount > 0) {
                        // 가맹점주 인벤토리가 다 차면 매장 바닥(발밑)에 떨어뜨려 드롭 배송
                        targetPlayer.dimension.spawnItem(new ItemStack(targetItemType, remainGive), targetPlayer.location);
                        targetPlayer.sendMessage("§e[물류 알림] 매장 인벤토리가 가득 차서 일부 물품이 발밑으로 직배송되었습니다.");
                        break;
                    }
                    remainGive -= giveAmount;
                }
            }
        } catch (e) {
            console.warn(`[Direct Delivery Error] ${e}`);
            // 치명적 예외 발생 시 월드 드롭으로 유실 방지
            try {
                const dropType = ItemTypes.get(order.item);
                if (dropType) targetPlayer.dimension.spawnItem(new ItemStack(dropType, order.count), targetPlayer.location);
            } catch {}
        }

        // 5. ★ [핵심] 완료 즉시 도매업자(나)의 스코어보드 지갑에 돈 추가
        try { 
            player.runCommand(`scoreboard players add @s player_money ${order.totalCost}`); 
        } catch (e) {
            console.warn(`[Payment Scoreboard Error] 대금 정산 중 오류: ${e}`);
        }

        // 6. 실시간 메시지 출력 및 주문 데이터 대기열에서 삭제
        player.sendMessage(`§a[배송 및 정산 완료]\n§e${order.orderPlayer}§f 가맹점에 §b${order.name} ${order.count}개§f 배송 완료!\n§6정산 금액 입금: +${order.totalCost.toLocaleString()}₩`);
        targetPlayer.sendMessage(`§a[본사 원격 배송 완료]\n§e${player.name}§f 본사에서 주문하신 §b${order.name} ${order.count}개§f를 매장으로 즉시 배송했습니다!`);

        // 대기열 목록에서 처리 완료된 주문 데이터 파기
        orders.splice(orderIndex, 1);
        
        // 전역 데이터베이스 및 마커 세이브 동시 동기화 갱신
        world.setDynamicProperty(`orders_${player.name}`, JSON.stringify(orders));
        if (marker) marker.setDynamicProperty("orders", JSON.stringify(orders));

    }).catch(e => console.error(`[Supply Process UI Error] ${e}`));
}

// ====== POS & 키오스크 제거 감지 ======

world.afterEvents.playerBreakBlock.subscribe((event) => {
    try {
        const perm = event.brokenBlockPermutation;
        if (!perm || !perm.type || typeof perm.type.id !== "string") return;

        const loc = { x: event.block.location.x, y: event.block.location.y, z: event.block.location.z };

        if (perm.type.id === "nf:pos_terminal") {
            const player = event.player;
            system.run(() => {
                try {
                    let terminals = safeParse("pos_terminals", {});
                    const posKey = `${loc.x},${loc.y},${loc.z}`;
                    if (terminals[posKey]) {
                        delete terminals[posKey];
                        world.setDynamicProperty("pos_terminals", JSON.stringify(terminals));
                    }
                    player.sendMessage("§e[POS 제거] POS 단말기가 제거되었습니다.");
                } catch (e) { }
            });
        }

        if (perm.type.id === "nf:kiosk") {
            const player = event.player;
            system.run(() => {
                try {
                    let linkedKiosks = safeParse("linked_kiosks", {});
                    const kioskKey = `${loc.x},${loc.y},${loc.z}`;
                    if (linkedKiosks[kioskKey]) {
                        delete linkedKiosks[kioskKey];
                        world.setDynamicProperty("linked_kiosks", JSON.stringify(linkedKiosks));
                    }
                    player.sendMessage("§e[키오스크 제거] 키오스크가 제거되었습니다.");
                } catch (e) { }
            });
        }
    } catch (error) {
        console.warn(`[POS BREAK ERROR] ${error}`);
    }
});

// ====== 신분증 및 은행 UI ======

function showIdCardUI(player) {
    if (!player) return;

    const nId = getNationId(player);
    let nationNames = safeParse("nation_names", {});

    if (!nId) {
        const availableNations = Object.keys(nationNames);
        const form = new ActionFormData()
            .title("§l국가 포털 (무국적 상태)")
            .body("현재 소속된 국가가 없습니다.\n원하시는 작업을 선택하세요.");

        if (availableNations.length > 0) form.button("§a국가 가입하기");
        else form.button("§7[가입 불가] 생성된 국가 없음");
        form.button("§b국가 건국 안내");
        form.button("닫기");

        form.show(player).then(res => {
            if (res.canceled) return;
            if (res.selection === 0 && availableNations.length > 0) {
                const options = availableNations.map(id => `${nationNames[id]} (ID: ${id.replace("nation_id_", "")})`);
                new ModalFormData().title("§l국가 가입")
                    .dropdown("가입할 국가를 선택하세요.", options)
                    .show(player).then(r => {
                        if (r.canceled) return;
                        const selectedId = availableNations[r.formValues[0]];
                        player.addTag("has_nation");
                        player.addTag(selectedId);
                        const numId = selectedId.replace("nation_id_", "");
                        player.runCommand(`scoreboard players set @s nation_id ${numId}`);
                        world.setDynamicProperty("player_nation_" + player.name, selectedId);
                        player.sendMessage(`§a[안내] '${nationNames[selectedId]}' 국가에 가입되었습니다!`);
                    }).catch(e => console.error(`[Nation Join Error] ${e}`));
            } else {
                player.sendMessage("§e[건국 안내] 모루에서 현수막의 이름을 국가명으로 변경 후, 손에 들고 클릭하면 건국됩니다!");
            }
        }).catch(e => console.error(`[ID Card UI Error] ${e}`));
        return;
    }

    let hasId = JSON.parse(world.getDynamicProperty("id_issued_" + player.name) || "false");
    if (!hasId) {
        new ModalFormData().title("§l신분증 발급")
            .textField("집 주소를 입력하세요.", "예: 서울시 강남구...")
            .show(player).then(res => {
                if (res.canceled) return;
                const address = res.formValues[0] || "알 수 없음";
                const passport = "M-" + Math.floor(Math.random() * 900000 + 100000);
                world.setDynamicProperty("id_address_" + player.name, JSON.stringify(address));
                world.setDynamicProperty("id_passport_" + player.name, JSON.stringify(passport));
                world.setDynamicProperty("id_issued_" + player.name, JSON.stringify(true));
                player.sendMessage("§a[안내] 신분증이 발급되었습니다.");
                showIdCardUI(player);
            }).catch(e => console.error(`[ID Issue Error] ${e}`));
        return;
    }

    const address = JSON.parse(world.getDynamicProperty("id_address_" + player.name) || '"알 수 없음"');
    const passport = JSON.parse(world.getDynamicProperty("id_passport_" + player.name) || '"M-000000"');
    const displayNationName = nationNames[nId] || nId.replace("nation_id_", "국가 ");
    const curr = getCurrencyInfo(nId);

    const form = new ActionFormData()
        .title("§l신분증 및 국가 관리")
        .body(
            `§b소속 국가: §f${displayNationName}\n§e이름: §f${player.name}\n§a집 주소: §f${address}\n§6여권 번호: §f${passport}\n\n` +
            `§7화폐: ${curr.symbol} | 세금: ${curr.tax_rate || 50}`
        );

    form.button("§e국고 및 경제 정보 조회");
    form.button("§b계좌 이체 (플레이어 송금)");
    form.button("§c국가 탈퇴하기");
    if (player.hasTag("nation_leader")) form.button("§6[지도자] 국가 설정");
    form.button("닫기");

    form.show(player).then(res => {
        if (res.canceled) return;
        if (res.selection === 0) {
            player.sendMessage(`§e[국가 정보] §b${displayNationName}§f | 환율: ${curr.rate.toFixed(4)}`);
        } else if (res.selection === 1) {
            showWireTransferUI(player);
        } else if (res.selection === 2) {
            new ActionFormData().title("§l국가 탈퇴 확인").body("정말로 탈퇴하시겠습니까?")
                .button("§c탈퇴하기").button("§a취소")
                .show(player).then(r => {
                    if (r.canceled || r.selection === 1) return;
                    player.getTags().forEach(t => {
                        if (t.startsWith("nation_id_") || t === "has_nation" || t === "nation_leader") player.removeTag(t);
                    });
                    player.runCommand("scoreboard players set @s nation_id 0");
                    world.setDynamicProperty("player_nation_" + player.name, undefined);
                    player.sendMessage("§c[안내] 국가에서 탈퇴했습니다.");
                }).catch(e => console.error(`[Nation Leave Error] ${e}`));
        } else if (player.hasTag("nation_leader") && res.selection === 3) {
            new ModalFormData().title("§l국가 설정 관리")
                .textField("국가명 변경", "새 국가명", displayNationName)
                .textField("화폐 기호 변경", "예: KRW, USD", curr.symbol)
                .textField("세금 징수액 (기본 50)", "숫자", String(curr.tax_rate || 50))
                .show(player).then(r => {
                    if (r.canceled) return;
                    const newName = r.formValues[0];
                    const newSym = String(r.formValues[1] || "").toUpperCase();
                    const newTax = parseInt(r.formValues[2] || "50");
                    if (newName && newName !== "") nationNames[nId] = newName;
                    if (newSym && newSym !== "") curr.symbol = newSym;
                    if (!isNaN(newTax) && newTax >= 0) curr.tax_rate = newTax;
                    let currencies = safeParse("currencies", {});
                    currencies[nId] = curr;
                    world.setDynamicProperty("currencies", JSON.stringify(currencies));
                    world.setDynamicProperty("nation_names", JSON.stringify(nationNames));
                    player.sendMessage(`§a[국가 설정] 변경 완료! 국가명: ${newName} | 화폐: ${newSym} | 세금: ${newTax}`);
                }).catch(e => console.error(`[Nation Setting Error] ${e}`));
        }
    }).catch(e => console.error(`[ID Card Menu Error] ${e}`));
}

function showWireTransferUI(player) {
    if (!player) return;

    const otherPlayers = world.getAllPlayers().filter(p => p && p.name !== player.name);
    if (otherPlayers.length === 0) { player.sendMessage("§c현재 접속 중인 다른 플레이어가 없습니다."); return; }

    const options = otherPlayers.map(p => p.name);
    const money = getPlayerMoney(player);

    new ModalFormData().title("§l계좌 이체 (송금)")
        .dropdown(`받는 사람 선택 (내 잔액: ${money.toLocaleString()}₩)`, options)
        .textField("송금할 금액 (₩)", "예: 10000")
        .show(player).then(r => {
            if (r.canceled) return;
            const targetPlayer = otherPlayers[r.formValues[0]];
            const amount = parseInt(r.formValues[1] || "0");
            if (isNaN(amount) || amount <= 0) { player.sendMessage("§c올바른 금액을 입력하세요."); return; }
            if (money < amount) { player.sendMessage("§c잔액이 부족합니다."); return; }

            try {
                player.runCommand(`scoreboard players remove @s player_money ${amount}`);
                targetPlayer.runCommand(`scoreboard players add @s player_money ${amount}`);
            } catch (e) { console.warn(`[Transfer Error] ${e}`); }

            player.sendMessage(`§a[송금 완료] ${targetPlayer.name}님에게 ${amount.toLocaleString()}₩을 송금했습니다.`);
            targetPlayer.sendMessage(`§a[은행 입금] ${player.name}님으로부터 ${amount.toLocaleString()}₩이 입금되었습니다!`);
        }).catch(e => console.error(`[Wire Transfer Error] ${e}`));
}

// =====================================================
// ★ 증권 거래소 UI
//   핵심 수정: lockKey를 체인 전체에 전달하여 열릴 때만 해제
//   → 서브 UI(detailForm, walletForm, 매수/매도 slider)는
//     별도 락 없이 동작 (메인 락 해제 후 진입)
// =====================================================

const defaultStocks = {
    "NFTECH": { name: "서버중앙연금공단", price: 5000, fluc: 0.05, revenue: 1000000, debt: 200000, history: [5000] },
    "NFTRADE": { name: "송클랜 무역", price: 3000, fluc: 0.07, revenue: 800000, debt: 100000, history: [3000] },
    "NFBANK": { name: "연방중앙은행", price: 8000, fluc: 0.03, revenue: 2000000, debt: 50000, history: [8000] },
    "NFENERGY": { name: "눈오리발전", price: 4000, fluc: 0.06, revenue: 1200000, debt: 300000, history: [4000] },
    "NFFOOD": { name: "도라지식품", price: 2000, fluc: 0.04, revenue: 600000, debt: 80000, history: [2000] }    
};

world.afterEvents.playerInteractWithBlock.subscribe((event) => {

    const player = event.player;
    const block = event.block;

    if (!player || !block) return;

    // 클릭한 블록 ID 확인
    if (block.typeId === "nf:trade_port") {

        showStockMarketUI(player, block.location, player.dimension.id);
    }
});


function showStockMarketUI(player) {
    if (!player) return;

    const lockKey = getUiKey(player, "stock");
    if (!acquireUiLock(lockKey, 120)) return;

    const stocks = safeParse("stock_market", defaultStocks);
    const playerStocks = safeParse("player_stocks_" + player.name, {});

    const form = new ActionFormData()
        .title("§l📈 증권 거래소")
        .body("§7주가는 1분마다 변동됩니다.\n\n§e원하는 종목을 선택하세요.");

    const keys = Object.keys(stocks);
    for (const key of keys) {
        if (!stocks[key]) continue;
        const st = stocks[key];
        const myCount = playerStocks[key] || 0;
        form.button(
            `§e${st.name}\n§f현재가: ${st.price?.toLocaleString() || 0}₩\n§7보유: ${myCount}주`
        );
    }
    form.button("§a💼 내 주식 지갑");
    form.button("§c❌ 닫기");

    form.show(player).then(res => {
        // ★ 메인 UI 닫히면 즉시 락 해제 → 서브 UI는 락 없이 진행
        releaseUiLock(lockKey);

        if (res.canceled || res.selection === keys.length + 1) return;

        // 종목 선택
        if (res.selection < keys.length) {
            const key = keys[res.selection];
            if (!stocks[key]) return;
            const st = stocks[key];
            const myCount = playerStocks[key] || 0;

            new ActionFormData()
                .title(`§l${st.name}`)
                .body(
                    `§a현재가: ${st.price?.toLocaleString() || 0}₩\n` +
                    `§b매출: ${(st.revenue || 0).toLocaleString()}₩\n` +
                    `§c채무: ${(st.debt || 0).toLocaleString()}₩\n` +
                    `§7보유: ${myCount}주`
                )
                .button("§a📈 매수")
                .button("§c📉 매도")
                .button("§7⬅ 뒤로")
                .show(player).then(r => {
                    if (r.canceled || r.selection === 2) {
                        showStockMarketUI(player);
                        return;
                    }

                    // 매수
                    if (r.selection === 0) {
                        const money = getPlayerMoney(player);
                        if (money < st.price) {
                            player.sendMessage("§c[증권]\n§7잔액 부족");
                            showStockMarketUI(player);
                            return;
                        }
                        const maxBuy = Math.max(1, Math.min(64, Math.floor(money / st.price)));

                        new ModalFormData()
                            .title(`§l매수 - ${st.name}`)
                            .slider(`수량\n1주 = ${st.price.toLocaleString()}₩`, 1, maxBuy, 1, 1)
                            .show(player).then(r2 => {
                                if (r2.canceled) { showStockMarketUI(player); return; }
                                const amount = r2.formValues[0];
                                const cost = st.price * amount;
                                const currentMoney = getPlayerMoney(player);
                                if (currentMoney < cost) {
                                    player.sendMessage("§c[증권]\n§7잔액 부족");
                                    showStockMarketUI(player);
                                    return;
                                }
                                try { player.runCommand(`scoreboard players remove @s player_money ${cost}`); }
                                catch (e) { console.warn(`[STOCK BUY ERROR] ${e}`); showStockMarketUI(player); return; }

                                // 최신 playerStocks 다시 로드
                                const ps2 = safeParse("player_stocks_" + player.name, {});
                                ps2[key] = (ps2[key] || 0) + amount;
                                world.setDynamicProperty("player_stocks_" + player.name, JSON.stringify(ps2));
                                player.sendMessage(`§a[증권]\n${st.name} ${amount}주 매수 완료`);
                                showStockMarketUI(player);
                            }).catch(e => { console.error(`[Buy Error] ${e}`); showStockMarketUI(player); });
                        return;
                    }

                    // 매도
                    if (r.selection === 1) {
                        const ps2 = safeParse("player_stocks_" + player.name, {});
                        const currentCount = ps2[key] || 0;
                        if (currentCount <= 0) {
                            player.sendMessage("§c[증권]\n§7보유 주식 없음");
                            showStockMarketUI(player);
                            return;
                        }
                        new ModalFormData()
                            .title(`§l매도 - ${st.name}`)
                            .slider(`수량\n보유: ${currentCount}주`, 1, currentCount, 1, 1)
                            .show(player).then(r2 => {
                                if (r2.canceled) { showStockMarketUI(player); return; }
                                const amount = r2.formValues[0];
                                const income = st.price * amount;
                                try { player.runCommand(`scoreboard players add @s player_money ${income}`); }
                                catch (e) { console.warn(`[STOCK SELL ERROR] ${e}`); showStockMarketUI(player); return; }

                                const ps3 = safeParse("player_stocks_" + player.name, {});
                                ps3[key] = (ps3[key] || 0) - amount;
                                if (ps3[key] <= 0) delete ps3[key];
                                world.setDynamicProperty("player_stocks_" + player.name, JSON.stringify(ps3));
                                player.sendMessage(`§a[증권]\n${st.name} ${amount}주 매도 완료`);
                                showStockMarketUI(player);
                            }).catch(e => { console.error(`[Sell Error] ${e}`); showStockMarketUI(player); });
                    }
                }).catch(e => { console.error(`[Stock Detail Error] ${e}`); showStockMarketUI(player); });
            return;
        }

        // 내 주식 지갑
        if (res.selection === keys.length) {
            const ps2 = safeParse("player_stocks_" + player.name, {});
            const ownedKeys = keys.filter(k => (ps2[k] || 0) > 0);

            const walletForm = new ActionFormData()
                .title("§l💼 내 주식 지갑")
                .body(ownedKeys.length === 0 ? "§c보유 주식 없음" : "§7매도할 종목 선택");

            if (ownedKeys.length === 0) {
                walletForm.button("닫기");
                walletForm.show(player).then(() => { showStockMarketUI(player); })
                    .catch(e => { console.error(`[Wallet Empty Error] ${e}`); showStockMarketUI(player); });
                return;
            }

            for (const k of ownedKeys) {
                if (!stocks[k]) continue;
                walletForm.button(`§c📉 ${stocks[k].name}\n§f${ps2[k]}주 보유`);
            }
            walletForm.button("§7⬅ 뒤로");

            walletForm.show(player).then(r => {
                if (r.canceled || r.selection === ownedKeys.length) { showStockMarketUI(player); return; }
                const k = ownedKeys[r.selection];
                if (!stocks[k]) { showStockMarketUI(player); return; }
                const st = stocks[k];
                const myCount = ps2[k];

                new ModalFormData()
                    .title(`§l매도 - ${st.name}`)
                    .slider(`수량\n보유: ${myCount}주`, 1, myCount, 1, 1)
                    .show(player).then(res2 => {
                        if (res2.canceled) { showStockMarketUI(player); return; }
                        const amount = res2.formValues[0];
                        const income = st.price * amount;
                        try { player.runCommand(`scoreboard players add @s player_money ${income}`); }
                        catch (e) { console.warn(`[WALLET SELL ERROR] ${e}`); showStockMarketUI(player); return; }

                        const ps3 = safeParse("player_stocks_" + player.name, {});
                        ps3[k] = (ps3[k] || 0) - amount;
                        if (ps3[k] <= 0) delete ps3[k];
                        world.setDynamicProperty("player_stocks_" + player.name, JSON.stringify(ps3));
                        player.sendMessage(`§a[증권]\n매도 완료 +${income.toLocaleString()}₩`);
                        showStockMarketUI(player);
                    }).catch(e => { console.error(`[Wallet Sell Error] ${e}`); showStockMarketUI(player); });
            }).catch(e => { console.error(`[Wallet Error] ${e}`); showStockMarketUI(player); });
        }
    }).catch(e => {
        releaseUiLock(lockKey);
        console.error(`[Stock Market UI Error] ${e}`);
    });
}

// ====== 카지노 환전소 UI ======

function showCasinoExchangeGuestUI(player, exKey, exData, lockKey) {
    if (!player || !exData) {
        if (lockKey) releaseUiLock(lockKey);
        return;
    }

    new ActionFormData()
        .title("§l카지노 칩 환전소")
        .body("§7환전 작업을 선택하세요.\n\n§e• 1k 칩 = 1,000₩\n§6• 10k 칩 = 10,000₩")
        .button("§e🪙 1k 칩 구매\n§f1,000₩")
        .button("§6🪙 10k 칩 구매\n§f10,000₩")
        .button("§b💵 칩 → 현금 환전")
        .button("§c❌ 닫기")
        .show(player).then(res => {
            if (lockKey) releaseUiLock(lockKey);
            if (res.canceled || res.selection === 3) return;

            const money = getPlayerMoney(player);

            if (res.selection === 0) {
                if (money < 1000) { player.sendMessage("§c[카지노]\n§7잔액 부족"); return; }
                try {
                    player.runCommand("scoreboard players remove @s player_money 1000");
                    player.runCommand("give @s nf:chip_1k 1");
                } catch (e) { console.warn(`[CASINO CHIP BUY ERROR] ${e}`); player.sendMessage("§c칩 지급 실패"); return; }
                exData.revenue = (exData.revenue || 0) + 1000;
                world.setDynamicProperty(exKey, JSON.stringify(exData));
                player.sendMessage("§a[카지노]\n§f1k 칩 구매 완료!");
                return;
            }

            if (res.selection === 1) {
                if (money < 10000) { player.sendMessage("§c[카지노]\n§7잔액 부족"); return; }
                try {
                    player.runCommand("scoreboard players remove @s player_money 10000");
                    player.runCommand("give @s nf:chip_10k 1");
                } catch (e) { console.warn(`[CASINO CHIP BUY ERROR] ${e}`); player.sendMessage("§c칩 지급 실패"); return; }
                exData.revenue = (exData.revenue || 0) + 10000;
                world.setDynamicProperty(exKey, JSON.stringify(exData));
                player.sendMessage("§a[카지노]\n§f10k 칩 구매 완료!");
                return;
            }

            if (res.selection === 2) {
                const equip = player.getComponent("equippable");
                const mainhand = equip?.getEquipment("Mainhand");
                if (!mainhand || !mainhand.typeId || (mainhand.typeId !== "nf:chip_1k" && mainhand.typeId !== "nf:chip_10k")) {
                    player.sendMessage("§c[카지노]\n§7손에 카지노 칩을 들고 실행하세요.");
                    return;
                }
                const val = mainhand.typeId === "nf:chip_1k" ? 1000 : 10000;
                const totalVal = val * mainhand.amount;
                try {
                    player.runCommand(`scoreboard players add @s player_money ${totalVal}`);
                    equip.setEquipment("Mainhand", undefined);
                } catch (e) { console.warn(`[CASINO EXCHANGE ERROR] ${e}`); player.sendMessage("§c환전 실패"); return; }
                exData.revenue = (exData.revenue || 0) - totalVal;
                world.setDynamicProperty(exKey, JSON.stringify(exData));
                player.sendMessage(`§a[카지노 환전 완료]\n§f${totalVal.toLocaleString()}₩ 지급 완료`);
            }
        }).catch(e => {
            if (lockKey) releaseUiLock(lockKey);
            console.error(`[Casino Exchange Error] ${e}`);
        });
}

// ====== 안내서 UI ======

function showGuideBookUI(player) {
    if (!player) return;

    new ActionFormData().title("§l📖 국가 및 금융 시스템 안내서")
        .body("§eNation Finance Addon에 오신 것을 환영합니다!\n\n§b목차를 선택하세요.")
        .button("§a🚩 1. 국가 건국 및 영토 점령")
        .button("§b🏛️ 2. 은행 업무 및 대출")
        .button("§6🏠 3. 부동산 매매 및 임대업")
        .button("§d🛒 4. POS 계산대 및 교환권")
        .button("§e🎰 5. 카지노")
        .button("닫기")
        .show(player).then(res => {
            if (res.canceled || res.selection === 5) return;
            const guides = [
                ["§l🚩 1. 국가 건국", "모루에서 현수막의 이름을 국가명으로 변경한 뒤, 손에 들고 허공을 클릭하면 건국됩니다!\n\n영토 확장: 현수막을 바닥에 설치하면 반경 50블록이 자국 영토로 편입됩니다."],
                ["§l🏛️ 2. 은행 업무", "신분증(nf:id_card)을 손에 들고 클릭하면 국가 포털이 열립니다.\n체크카드로 잔액 조회, 신용카드로 한도/빚 조회, 계좌 이체로 송금할 수 있습니다."],
                ["§l🏠 3. 부동산", "부동산 지팡이로 두 지점을 클릭하여 영역 설정 후 허공 클릭으로 매물을 등록하세요.\n부동산 중개인 NPC를 통해 계약이 가능합니다."],
                ["§l🛒 4. POS 계산대", "점포 임대 계약 시 POS 단말기가 지급됩니다.\n설치 후 클릭하면 상품명과 수량을 입력하여 교환권을 발급할 수 있습니다.\n교환권은 구매자 인벤토리와 POS 앞에 각 1장씩 출력됩니다."],
                ["§l🎰 5. 카지노", "칩(1k/10k)을 손에 들고 카지노 머신을 터치하면 충전됩니다.\n맨손으로 터치하면 슬롯이 작동하며 잭팟(3%)은 10배, 일반 승리(33%)는 2배 지급됩니다."]
            ];
            new ActionFormData().title(guides[res.selection][0]).body(guides[res.selection][1])
                .button("뒤로 가기").show(player)
                .then(r => { if (!r.canceled) showGuideBookUI(player); })
                .catch(e => console.error(`[Guide Detail Error] ${e}`));
        }).catch(e => console.error(`[Guide Book Error] ${e}`));
}

// ====== 서버 초기화 및 가이드북 지급 ======

world.afterEvents.playerSpawn.subscribe((event) => {
    try {
        const player = event.player;
        if (!event.initialSpawn || !player) return;
        system.run(() => {
            const given = JSON.parse(world.getDynamicProperty("guide_given_" + player.name) || "false");
            if (!given) {
                world.setDynamicProperty("guide_given_" + player.name, JSON.stringify(true));
                try { player.runCommand("give @s nf:guide_book 1"); } catch (e) { }
                player.sendMessage("§a[환영합니다] 안내서가 지급되었습니다. 손에 들고 클릭하여 확인하세요!");
            }
        });
    } catch (error) {
        console.error(`[Player Spawn Error] ${error}`);
    }
});

// ====== 정기 루프: 월세 출금 (48분 = 57600 틱) ======

system.runInterval(() => {
    try {
        const estates = safeParse("real_estates", []);
        const overworld = world.getDimension("overworld");
        if (!overworld) return;

        for (const estate of estates) {
            if (!estate) continue;

            if (estate.type === 1 && estate.tenant) {
                try {
                    overworld.runCommand(`scoreboard players remove "${estate.tenant}" player_money ${estate.price || 0}`);
                    overworld.runCommand(`scoreboard players add "${estate.owner}" player_money ${estate.price || 0}`);
                    overworld.runCommand(`tellraw "${estate.tenant}" {"rawtext":[{"text":"§e[부동산] 주택(${estate.name}) 월세 ${(estate.price || 0).toLocaleString()}₩이 출금되었습니다."}]}`);
                    overworld.runCommand(`tellraw "${estate.owner}" {"rawtext":[{"text":"§a[부동산 입금] 주택(${estate.name}) 월세 ${(estate.price || 0).toLocaleString()}₩이 입금되었습니다."}]}`);
                } catch (e) { }
            } else if (estate.type === 3) {
                for (const room of (estate.rooms || [])) {
                    if (!room || !room.tenant) continue;
                    try {
                        overworld.runCommand(`scoreboard players remove "${room.tenant}" player_money ${room.price || 0}`);
                        overworld.runCommand(`scoreboard players add "${estate.owner}" player_money ${room.price || 0}`);
                        overworld.runCommand(`tellraw "${room.tenant}" {"rawtext":[{"text":"§e[부동산] 점포(${estate.name} ${room.name}) 월세 ${(room.price || 0).toLocaleString()}₩이 출금되었습니다."}]}`);
                        overworld.runCommand(`tellraw "${estate.owner}" {"rawtext":[{"text":"§a[부동산 입금] 점포(${estate.name} ${room.name}) 월세 ${(room.price || 0).toLocaleString()}₩이 입금되었습니다."}]}`);
                    } catch (e) { }
                }
            }
        }
    } catch (error) {
        console.error(`[Rent Loop Error] ${error}`);
    }
}, 57600);

// ====== 정기 루프: 대출 이자 (20분 = 24000 틱) ======

system.runInterval(() => {
    try {
        const objMoney = world.scoreboard.getObjective("player_money");
        if (!objMoney) return;

        for (const player of world.getAllPlayers()) {
            if (!player) continue;
            let debt = JSON.parse(world.getDynamicProperty("debt_" + player.name) || "0");
            if (debt <= 0) continue;

            debt = debt * 1.05;
            player.sendMessage(`§c[은행] 대출 이자 발생. 빚: ₩${Math.floor(debt).toLocaleString()}`);

            let money = 0;
            try { money = objMoney.getScore(player) || 0; } catch (e) { }

            if (money > 0) {
                const repayAmt = Math.min(money, Math.floor(debt));
                try { player.runCommand(`scoreboard players remove @s player_money ${repayAmt}`); } catch (e) { }
                debt -= repayAmt;
                let cScore = JSON.parse(world.getDynamicProperty("credit_score_" + player.name) || "500");
                world.setDynamicProperty("credit_score_" + player.name, JSON.stringify(Math.min(1000, cScore + (repayAmt / 1000))));
                player.sendMessage(`§a[은행] ${repayAmt.toLocaleString()} 자동 상환. 남은 빚: ₩${Math.floor(debt).toLocaleString()}`);
            } else {
                let cScore = JSON.parse(world.getDynamicProperty("credit_score_" + player.name) || "500");
                world.setDynamicProperty("credit_score_" + player.name, JSON.stringify(Math.max(0, cScore - 5)));
                player.sendMessage(`§4[은행 경고] 연체 - 신용 점수 하락!`);
            }
            world.setDynamicProperty("debt_" + player.name, JSON.stringify(debt));
        }
    } catch (error) {
        console.error(`[Interest Loop Error] ${error}`);
    }
}, 24000);

// ====== 정기 루프: 주식 시세 변동 (1분 = 1200 틱) ======

system.runInterval(() => {
    try {
        let stocks = safeParse("stock_market", defaultStocks);
        for (const key of Object.keys(stocks)) {
            if (!stocks[key]) continue;
            const st = stocks[key];
            let changeRate = (Math.random() * (st.fluc * 2)) - st.fluc;
            if (Math.random() < 0.1) changeRate += (Math.random() > 0.5 ? 0.15 : -0.15);
            st.price = Math.max(500, Math.floor(st.price * (1 + changeRate)));
            st.revenue = Math.floor((st.revenue || 1000000) * (1 + (changeRate * 0.5)));
            st.history.push(st.price);
            if (st.history.length > 5) st.history.shift();
        }
        world.setDynamicProperty("stock_market", JSON.stringify(stocks));
    } catch (error) {
        console.error(`[Stock Loop Error] ${error}`);
    }
}, 1200);

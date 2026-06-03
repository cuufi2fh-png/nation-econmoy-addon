const fs = require('fs');

let code = fs.readFileSync('BP/scripts/main.js', 'utf-8');

// 1. Add itemUse for nf:property_wand
let wandItemUse = `    } else if (item.typeId === "nf:property_wand") {
        event.cancel = true;
        system.run(() => {
            const x1 = player.getDynamicProperty("re_pos1_x");
            const y1 = player.getDynamicProperty("re_pos1_y");
            const z1 = player.getDynamicProperty("re_pos1_z");
            const x2 = player.getDynamicProperty("re_pos2_x");
            const y2 = player.getDynamicProperty("re_pos2_y");
            const z2 = player.getDynamicProperty("re_pos2_z");
            
            if (x1 === undefined || x2 === undefined) {
                player.sendMessage("§c[부동산] 영역이 완전히 설정되지 않았습니다. 지팡이로 두 블록을 클릭(하나는 웅크리고)하세요.");
                return;
            }
            
            new ModalFormData().title("§l부동산 매물 등록")
            .textField("집 이름", "예: 강남빌라 101호")
            .textField("가격 (단위: ₩)", "예: 100000")
            .show(player).then(res => {
                if (res.canceled) return;
                const name = res.formValues[0] || "이름 없는 집";
                const price = parseInt(res.formValues[1]);
                if (isNaN(price) || price < 0) { player.sendMessage("§c가격을 올바르게 입력하세요."); return; }
                
                const minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
                const minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
                const minZ = Math.min(z1, z2), maxZ = Math.max(z1, z2);
                
                const reData = {
                    id: "re_" + Date.now(),
                    name: name,
                    price: price,
                    owner: player.name,
                    min: {x: minX, y: minY, z: minZ},
                    max: {x: maxX, y: maxY, z: maxZ},
                    dimension: player.dimension.id
                };
                
                let estates = JSON.parse(world.getDynamicProperty("real_estates") || "[]");
                estates.push(reData);
                world.setDynamicProperty("real_estates", JSON.stringify(estates));
                
                const signX = Math.floor((minX + maxX)/2);
                const signZ = Math.floor((minZ + maxZ)/2);
                const signY = maxY + 1; 
                
                const sign = player.dimension.spawnEntity("nf:property_sign", {x: signX + 0.5, y: signY, z: signZ + 0.5});
                sign.nameTag = "§b[부동산] §f" + name + "\\n§e가격: " + price + "₩\\n§a클릭하여 구매";
                sign.setDynamicProperty("re_id", reData.id);
                
                player.sendMessage("§a[부동산] 등록 완료! (" + minX + "," + minY + "," + minZ + " ~ " + maxX + "," + maxY + "," + maxZ + ")");
            });
        });
`;

code = code.replace('    } else if (item.typeId === "nf:id_card") {', wandItemUse + '    } else if (item.typeId === "nf:id_card") {');


// 2. Add interact with block for wand
let interactLogic = `    if (event.itemStack && event.itemStack.typeId === "nf:property_wand") {
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
`;

code = code.replace('world.beforeEvents.playerInteractWithBlock.subscribe((event) => {\\n    const block = event.block;\\n    const player = event.player;', 'world.beforeEvents.playerInteractWithBlock.subscribe((event) => {\\n    const block = event.block;\\n    const player = event.player;\\n' + interactLogic);


// 3. Add Entity Hit Entity for Property Sign purchasing
code += `
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
`;

// 4. Protection logic Helper
code += `
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
`;

// 5. Inject protection into Break and Place
let placeBreakProtect = `
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
`;

code += placeBreakProtect;

fs.writeFileSync('BP/scripts/main.js', code);

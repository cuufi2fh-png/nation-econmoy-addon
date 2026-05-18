# 건국 성공 시 실행되는 효과

# 사운드
playsound ui.toast.recipe.unlocked @s

# 파티클
particle minecraft:totem_particle ~ ~1 ~

# 타이틀 출력
title @s title §b건국 완료!
title @s subtitle 국가의 지도자가 되었습니다.

# 초기 자본 지급 (선택)
scoreboard players add @s player_money 50000
tellraw @s {"rawtext":[{"text":"§a건국 지원금 50,000원이 개인 계좌에 지급되었습니다."}]}
tellraw @s {"rawtext":[{"text":"§b국가 금고 초기 자본 100,000원이 지급되었습니다."}]}
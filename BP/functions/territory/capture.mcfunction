# 영토 점령 시 실행될 효과 (마커 엔티티 기준 실행)

# 1. 점령 효과 (소리 및 파티클)
playsound beacon.activate @a[r=20]
particle minecraft:totem_particle ~ ~1 ~
particle minecraft:huge_explosion_emitter ~ ~2 ~

# 2. 깃발 블록 교체
# (V0.1: 단순히 파란색 배너로 교체, 추후 플레이어의 국가 색상에 맞춰 동적 교체 가능)
setblock ~ ~1 ~ standing_banner

# 3. 주변 플레이어에게 점령 공지
tellraw @a[r=20] {"rawtext":[{"text":"§e[영토 점령] §f이 지역의 깃대가 점령되었습니다!"}]}

# 4. 마커 상태 변경 (예: 소유권 태그 업데이트를 위한 사전 작업)
# 이 부분은 추후 점령한 플레이어의 국가 태그를 넘겨받는 로직으로 고도화됩니다.
tag @s add captured

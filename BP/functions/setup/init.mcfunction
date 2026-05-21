# 시스템 스코어보드 초기화
scoreboard objectives add player_money dummy "개인 계좌 잔액"
scoreboard objectives add treasury dummy "국가 국고"
scoreboard objectives add nation_id dummy "국가 내부 ID"

# 기타 필요한 마커 처리 및 설정
tellraw @a {"rawtext":[{"text":"§a[시스템] 국가/금융 스코어보드 초기화 완료."}]}

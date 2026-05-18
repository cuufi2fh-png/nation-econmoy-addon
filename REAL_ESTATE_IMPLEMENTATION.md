# 부동산 거래 시스템 - 구현 완료 보고서

## 구현된 기능

### 1. 부동산 시스템 기반
✅ **Property Wand (부동산 지팡이)**
- 두 블록을 지정하여 부동산/건물 영역 등록
- 4가지 유형 지원: 주택 매매, 주택 임대, 상업용 건물 매매, 건물 임대업

✅ **부동산 표지판 (Property Sign)**
- 등록된 부동산 중앙에 자동 생성
- 클릭 시 부동산 사장 NPC 소환

### 2. 부동산 사장 NPC
✅ **Realtor NPC (realtor_npc.json)**
- Villager 기반 NPC 엔티티
- Property_sign 클릭 시 자동 소환
- NPC 클릭으로 거래 UI 표시

### 3. 거래 시스템
✅ **거래 UI**
- 부동산 정보 표시 (물건명, 가격, 판매자)
- 수수료 실시간 계산 (5.14%)
- 총액 자동 표시
- 구매/임대 확인 버튼

✅ **수수료 및 세금 체계**
```
구매 가격: 판매가격
수수료: 판매가격 × 5.14% (구매자 추가 부담)
총 결제액: 판매가격 + 수수료
판매자 수령액: 판매가격 - 국가세금
```

✅ **국가별 세금 계산**
- 각 국가의 tax_rate 적용
- 판매자 국가 기준으로 계산
- 자동 공제 후 판매자에게 입금

### 4. 거래 기록 관리
✅ **거래 기록 저장**
- 모든 부동산 거래 기록 저장
- 거래 ID, 날짜/시간, 구매자/판매자, 금액, 수수료, 세금 기록

✅ **실소유증명서 (Building Cert)**
- 부동산 매매 시 자동 발급
- 증명서 클릭 시 거래 정보 조회 가능
- 최근 3건의 거래 기록 표시

### 5. 계좌 관리
✅ **자동 계좌 이체**
- 구매자 → 판매자: 판매가격
- 구매자 → 서버계좌: 수수료 5.14%
- 판매자 → 국고: 국가세금 (자동 공제)

✅ **거래 알림**
- 구매자: 구매 완료, 결제액, 수수료 알림
- 판매자: 판매 완료, 수령액, 세금 알림

## 파일 변경 사항

### 신규 생성
- `/BP/entities/realtor_npc.json` - 부동산 사장 NPC 엔티티
- `/REAL_ESTATE_GUIDE.md` - 부동산 시스템 가이드

### 수정된 파일
- `/BP/scripts/main.js`
  - `calculateRealEstateFee()` - 수수료 및 세금 계산
  - `spawnRealtorNPC()` - NPC 소환 함수
  - `processPropertySale()` - 거래 처리 및 기록 저장
  - `showRealEstateTradingUI()` - 거래 UI 함수
  - `world.beforeEvents.playerInteractWithEntity` - NPC 상호작용 추가
  - `nf:building_cert` 사용 로직 개선

## 사용 방법

### 1단계: 부동산 등록
1. 부동산 지팡이 구하기
2. 첫 블록 클릭 (일반 클릭)
3. 두 번째 블록 클릭 (웅크리고 클릭)
4. 지팡이로 다시 클릭하여 UI 열기
5. 매물 정보 입력 및 등록

### 2단계: 거래
1. 부동산 표지판 클릭 → NPC 소환
2. NPC 클릭 → 거래 UI 표시
3. 거래 정보 확인 후 구매/임대 버튼 클릭
4. 자동으로 계좌 이체 및 소유권 이전

### 3단계: 증명서 조회
1. Building Cert 아이템 사용 (우클릭)
2. 부동산 목록 확인
3. 거래 기록 조회

## 기술 스펙

### 데이터 저장 형식
```javascript
// 거래 기록
{
  id: "trans_" + timestamp,
  timestamp: Date.now(),
  estate: estate.id,
  buyer: "플레이어명",
  seller: "플레이어명",
  basePrice: 가격,
  fee: 수수료,
  tax: 세금,
  finalPrice: 총액
}
```

### 함수 인터페이스
```javascript
// 수수료 계산
calculateRealEstateFee(basePrice, sellerNationId)
→ { basePrice, fee, totalPayment, taxAmount, sellerAmount, ... }

// NPC 소환
spawnRealtorNPC(dimension, location, estate)
→ NPC 엔티티

// 거래 처리
processPropertySale(player, estate, buyer, seller, basePrice)
→ transRecord
```

## 주요 특징
- ✅ 자동 수수료 및 세금 계산
- ✅ 국가별 차등 세율 지원
- ✅ 거래 기록 자동 저장
- ✅ 실소유증명서 발급 및 거래 정보 조회
- ✅ 직관적인 NPC 기반 UI
- ✅ 안전한 계좌 이체 시스템

## 추후 개선 사항 (선택사항)
- [ ] 부동산 임대료 연체 페널티
- [ ] 부동산 투기세 추가
- [ ] 자동 경매 시스템
- [ ] 부동산 가격 지수
- [ ] 거래 수수료율 조정 기능

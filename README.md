# Nation Economy & Finance Add-on (v1.8.0)

A comprehensive, highly optimized Minecraft Bedrock Edition Add-on that integrates a large-scale national warfare system with an advanced financial economy, real estate management, retail logistics, and an automated casino system.

---

## 🌟 Key Features (주요 기능)

### 1. National Warfare & Territory System (국가전쟁 및 영토 시스템)
- **Nation Creation (국가 창설)**: Players can establish nations, set custom tax rates, and manage national treasuries.
- **Territory Claiming & Capture (영토 점령 및 방어)**: Use flagpole markers (`nf:flagpole_marker`) to claim chunks. Capture enemy flags via action-bar progress mechanics.
- **National Treasury (국고 관리)**: Automated tax deduction on player transactions flows directly into the nation's treasury (`treasury` scoreboard).

### 2. Banking & Financial System (금융 및 은행 시스템)
- **Bank NPCs & Wire Transfers (은행원 및 송금)**: Spawn Bank NPCs (`nf:bank_npc`) to issue Debit/Credit cards (`nf:check_card`, `nf:credit_card`).
- **P2P Trade & Stock Market (P2P 무역 및 증권거래소)**: Trade Port blocks (`nf:trade_port`) allow secure P2P item/money bartering, stock IPO listings, and real-time stock trading.
- **Central Bank Fee (서버 중앙은행 수수료)**: A 5.14% server fee is automatically collected on commercial transactions to regulate the money supply.

### 3. Real Estate & Rental System (부동산 및 임대 시스템)
- **Property Registration (부동산 등기)**: Use the Property Wand (`nf:property_wand`) to designate residential/commercial zones.
- **Building Ownership Certificates (건물 소유주 인증서)**: Issue certificates (`nf:building_cert`) to manage sub-units (rooms/shops) within a building.
- **Automated Rental Cycles (자동 월세 수금)**: Every 48 minutes (2 in-game days), rent is automatically collected from tenants and deposited to property owners. Commercial tenants receive an automatic POS terminal upon leasing.

### 4. Retail Logistics & Kiosk System (유통 물류 및 키오스크 시스템)
- **POS Terminals (`nf:pos_terminal`)**: Advanced cash register for store owners to manage catalogs, IPOs, and supplier contracts.
- **Kiosk (`nf:kiosk`)**: A sleek, vertical 1.5-block interactive terminal for customers to browse items, add to cart, and pay via cards.
- **Supplier & Franchise Chain (물류망 및 가맹 계약)**: Store owners can contract suppliers (or the Gov Logistics Center). Orders generate Supply Receipts (`nf:supply_receipt`).

### 5. Automated Casino System (자동화 카지노 시스템)
- **Casino Exchange & Manager (`nf:casino_exchange`)**: Register as a casino owner to manage linked slot machines, set custom win rates (10% - 90%), and track total revenue (+/-) and paid taxes. Guests can buy 1k/10k chips or cash out.
- **Casino Slot Machines (`nf:casino_machine`)**: Insert chips (`nf:chip_1k`, `nf:chip_10k`) to bet. Touch with an empty hand to pull the lever. Jackpot awards 2x balance; losses are split between the server central bank and the nation's treasury.

---

## 🛠️ Installation & Setup (설치 및 사용법)

1. Download `nation_finance_1.4.0.mcaddon` and open it with Minecraft Bedrock Edition.
2. Apply both the **Behavior Pack (BP)** and **Resource Pack (RP)** to your world/Realm.
3. Enable **Beta APIs** in the world experimental settings.
4. Upon entering the world, players will automatically receive the **National Economy Guide Book (`nf:guide_book`)**. Hold and click to view detailed server instructions!

---

## 🖥️ Realm Server Optimization (Realm 서버 최적화 구조)
- **Zero Tick-Loop Overhead (틱 루프 탐색 제거)**: All heavy interactions (payments, stock checks, casino rolls) are entirely **Event-Driven** (`playerInteractWithBlock`, `playerPlaceBlock`, `button_click`).
- **Dynamic Properties**: System utilizes lightweight entity/world dynamic properties instead of heavy scoreboard polling or entity ticking.

---

## 📄 License & Credits
- Developed for Minecraft Bedrock Edition 1.20.50+
- Please refer to `LICENSE` and `COMMERCIALUSE.md` for distribution and commercial usage terms.

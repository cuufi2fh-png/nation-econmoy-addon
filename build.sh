#!/bin/bash

set -e

echo "========================"
echo "🚀 Mode Version & UUID Auto Updater"
echo "========================"

# 버전 입력
read -p "새 버전 (예: 2.2.0): " VERSION

# 입력값 검증 (X.Y.Z 형식인지 확인)
if [[ ! $VERSION =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "❌ 에러: 버전 형식이 올바르지 않습니다. (예: 2.2.0 형태로 입력하세요)"
    exit 1
fi

# 새 UUID 생성 (소문자로 변환)
NEW_BP_HEADER_UUID=$(uuidgen | tr 'A-Z' 'a-z')
NEW_BP_MODULE_UUID=$(uuidgen | tr 'A-Z' 'a-z')
NEW_RP_HEADER_UUID=$(uuidgen | tr 'A-Z' 'a-z')
NEW_RP_MODULE_UUID=$(uuidgen | tr 'A-Z' 'a-z')

echo "📦 BP manifest 업데이트 (버전 및 고유 UUID 갱신)..."
jq \
--arg name "Nation Finance BP - $VERSION" \
--arg ver_str "$VERSION" \
--arg h_uuid "$NEW_BP_HEADER_UUID" \
--arg m_uuid "$NEW_BP_MODULE_UUID" \
'
($ver_str | split(".") | map(tonumber)) as $ver |
.header.name = $name |
.header.uuid = $h_uuid |
.modules[0].uuid = $m_uuid |
(.. | objects | select(has("version"))).version = $ver
' BP/manifest.json > BP/tmp.json && mv BP/tmp.json BP/manifest.json

echo "📦 RP manifest 업데이트 (버전 및 고유 UUID 갱신)..."
jq \
--arg name "Nation Finance RP - $VERSION" \
--arg ver_str "$VERSION" \
--arg h_uuid "$NEW_RP_HEADER_UUID" \
--arg m_uuid "$NEW_RP_MODULE_UUID" \
'
($ver_str | split(".") | map(tonumber)) as $ver |
.header.name = $name |
.header.uuid = $h_uuid |
.modules[0].uuid = $m_uuid |
(.. | objects | select(has("version"))).version = $ver
' RP/manifest.json > RP/tmp.json && mv RP/tmp.json RP/manifest.json

echo "📦 기존 mcaddon 삭제..."
rm -f NationFinance.mcaddon

echo "📦 mcaddon 재패킹..."
BASE_DIR=$(pwd)
mkdir -p .build_tmp
cp -r BP .build_tmp/
cp -r RP .build_tmp/

cd .build_tmp
zip -q -r "$BASE_DIR/NationFinance.mcaddon" BP RP
cd "$BASE_DIR"
rm -rf .build_tmp

echo "📤 Git 업로드..."
git add .
git commit -m "업데이트 $VERSION (UUID 갱신)"

CURRENT_BRANCH=$(git branch --show-current)
git push origin "$CURRENT_BRANCH"

echo "========================"
echo "✅ 사본 오류 해결 및 패킹 완료: $VERSION"
echo "========================"
#!/bin/bash

set -e

echo "========================"
echo "🚀 Mode Version Auto Updater"
echo "========================"

# 버전 입력
read -p "새 버전 (예: 2.2.0): " VERSION

# 입력값 검증 (X.Y.Z 형식인지 확인)
if [[ ! $VERSION =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "❌ 에러: 버전 형식이 올바르지 않습니다. (예: 2.2.0 형태로 입력하세요)"
    exit 1
fi

echo "📦 BP manifest (헤더, 모듈, 의존성 모든 버전) 업데이트..."

# jq에서 내부 버전을 [2,2,0] 숫자로 바꾸고, 파일 내 모든 "version" 필드를 자동 추적해 변경
jq \
--arg name "Nation Finance BP - $VERSION" \
--arg ver_str "$VERSION" \
'
($ver_str | split(".") | map(tonumber)) as $ver |
.header.name = $name |
(.. | objects | select(has("version"))).version = $ver
' BP/manifest.json > BP/tmp.json && mv BP/tmp.json BP/manifest.json

echo "📦 RP manifest (헤더, 모듈, 의존성 모든 버전) 업데이트..."

jq \
--arg name "Nation Finance RP - $VERSION" \
--arg ver_str "$VERSION" \
'
($ver_str | split(".") | map(tonumber)) as $ver |
.header.name = $name |
(.. | objects | select(has("version"))).version = $ver
' RP/manifest.json > RP/tmp.json && mv RP/tmp.json RP/manifest.json

echo "📦 기존 mcaddon 삭제..."
rm -f NationFinance.mcaddon

echo "📦 mcaddon 생성..."
zip -r NationFinance.mcaddon BP/ RP/

echo "📤 Git 업로드..."
git add .
git commit -m "업데이트 $VERSION"

CURRENT_BRANCH=$(git branch --show-current)
git push origin "$CURRENT_BRANCH"

echo "========================"
echo "✅ 모드 버전 완벽 자동 업그레이드 완료: $VERSION"
echo "========================"
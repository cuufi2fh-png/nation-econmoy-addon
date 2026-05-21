#!/bin/bash

set -e

echo "========================"
echo "🚀 Version Up Builder"
echo "========================"

# 버전 입력
read -p "새 버전 (예: 2.2.0): " VERSION

# [2,2,0] 변환
VERSION_ARRAY=$(echo $VERSION | sed 's/\./,/g' | awk '{print "["$0"]"}')

echo "📦 BP manifest 업데이트..."

jq \
--arg name "Nation Finance BP - $VERSION" \
--argjson ver "$VERSION_ARRAY" \
'
.header.name = $name |
.header.version = $ver |
.modules[].version = $ver
' BP/manifest.json > BP/tmp.json && mv BP/tmp.json BP/manifest.json

echo "📦 RP manifest 업데이트..."

jq \
--arg name "Nation Finance RP - $VERSION" \
--argjson ver "$VERSION_ARRAY" \
'
.header.name = $name |
.header.version = $ver |
.modules[].version = $ver
' RP/manifest.json > RP/tmp.json && mv RP/tmp.json RP/manifest.json

echo "📦 mcaddon 생성..."
zip -r NationFinance.mcaddon BP RP

echo "========================"
echo "✅ 완료: $VERSION"
echo "========================"
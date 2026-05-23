#!/bin/bash

set -e
trap 'echo "❌ 오류 발생: 라인 $LINENO 에서 실패했습니다."' ERR

echo "========================"
echo "🚀 Pack Version Upgrade & Repack"
echo "========================"

# 버전 입력
read -p "새 버전 (예: 2.2.0): " VERSION

if [[ ! $VERSION =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "❌ 에러: 버전 형식이 올바르지 않습니다. (예: 2.2.0 형태)"
    exit 1
fi

# 입력받은 버전을 [2, 2, 0] 정수 배열로 변환
VERSION_ARRAY=$(echo $VERSION | sed 's/\./,/g' | awk '{print "["$0"]"}')

echo "📦 BP manifest 업데이트 중..."
jq \
--arg name "Nation Finance BP - $VERSION" \
--argjson ver "$VERSION_ARRAY" \
'
.header.name = $name |
.header.version = $ver |
.modules[0].version = $ver |
if .dependencies then (.dependencies[].version = $ver) else . end
' BP/manifest.json > BP/tmp.json && mv BP/tmp.json BP/manifest.json

echo "📦 RP manifest 업데이트 중..."
jq \
--arg name "Nation Finance RP - $VERSION" \
--argjson ver "$VERSION_ARRAY" \
'
.header.name = $name |
.header.version = $ver |
.modules[0].version = $ver |
if .dependencies then (.dependencies[].version = $ver) else . end
' RP/manifest.json > RP/tmp.json && mv RP/tmp.json RP/manifest.json

echo "📦 기존 mcaddon 삭제..."
rm -f NationFinance.mcaddon

echo "📦 mcaddon 압축 생성..."
# 폴더 구조가 내부에 꼬이지 않도록 대상 폴더만 지정하여 압축
zip -r NationFinance.mcaddon BP RP

echo "📤 Git 업로드..."
git add .
git commit -m "업데이트 $VERSION"

CURRENT_BRANCH=$(git branch --show-current)
git push origin "$CURRENT_BRANCH"

echo "========================"
echo "✅ 완료되었습니다! 마크에서 확인해 보세요: $VERSION"
echo "========================"
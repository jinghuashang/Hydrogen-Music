#!/bin/bash

# Hydrogen Music Vercel 部署脚本
# 使用前请确保已安装 Vercel CLI: npm i -g vercel

set -e

echo "=========================================="
echo "  Hydrogen Music - Vercel 部署脚本"
echo "=========================================="
echo ""

# 检查是否安装了 Vercel CLI
if ! command -v vercel &> /dev/null; then
    echo "❌ 未安装 Vercel CLI"
    echo "请先运行: npm i -g vercel"
    exit 1
fi

# 检查是否在项目根目录
if [ ! -f "package.json" ]; then
    echo "❌ 请在项目根目录运行此脚本"
    exit 1
fi

# 检查是否已配置 NCM API
if [ -z "$VITE_NCM_API_URL" ]; then
    echo "⚠️  未检测到 VITE_NCM_API_URL 环境变量"
    echo ""
    echo "请提供你的网易云 API 地址："
    echo "（如果你还没有部署 API，请先访问 https://github.com/Binaryify/NeteaseCloudMusicApi）"
    echo ""
    read -p "请输入 NCM API 地址 (如 https://your-api.vercel.app): " NCM_API_URL

    if [ -z "$NCM_API_URL" ]; then
        echo "❌ API 地址不能为空"
        exit 1
    fi
else
    NCM_API_URL="$VITE_NCM_API_URL"
fi

echo ""
echo "📦 开始构建..."
npm run web:build

echo ""
echo "🚀 开始部署到 Vercel..."
echo ""

# 创建临时 vercel.json
cat > vercel.json.tmp << EOF
{
  "rewrites": [
    {
      "source": "/api/:match*",
      "destination": "${NCM_API_URL}/:match*"
    }
  ]
}
EOF

# 备份原有 vercel.json（如果存在）
if [ -f "vercel.json" ]; then
    cp vercel.json vercel.json.bak
fi

mv vercel.json.tmp vercel.json

# 部署
vercel --prod

# 恢复原有 vercel.json
if [ -f "vercel.json.bak" ]; then
    mv vercel.json.bak vercel.json
fi

echo ""
echo "✅ 部署完成！"
echo ""
echo "📝 后续步骤："
echo "1. 访问 Vercel Dashboard 查看你的项目"
echo "2. 在 Environment Variables 中添加 VITE_NCM_API_URL=${NCM_API_URL}"
echo "3. 重新部署以使环境变量生效"
echo ""
echo "感谢使用 Hydrogen Music！"

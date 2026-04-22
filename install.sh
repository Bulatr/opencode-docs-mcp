#!/bin/bash

# OpenCode Docs MCP - Установка в любой проект
# Запустить: bash install.sh [путь_к_проекту]

TARGET_DIR="${1:-.}"

echo "📁 Target: $TARGET_DIR"

# Создаём директорию для MCP сервера
mkdir -p "$TARGET_DIR/opencode-docs-mcp"

# Копируем файлы
cp index.js "$TARGET_DIR/opencode-docs-mcp/"
cp package.json "$TARGET_DIR/opencode-docs-mcp/"

echo "📦 Installing dependencies..."
cd "$TARGET_DIR/opencode-docs-mcp"
npm install

# Запускаем Chroma сервер
echo "🚀 Starting Chroma..."
python -c "
import chromadb
from chromadb.config import Settings
client = chromadb.Client(Settings(anonymized_telemetry=False))
print('Chroma started on :8000')
" &
CHROMA_PID=$!
sleep 2

# Запускаем MCP сервер
echo "🚀 Starting MCP server..."
node index.js &
MCP_PID=$!
sleep 3

# Проверяем работу
echo "🧪 Testing search..."
curl -s -X POST http://localhost:3000/tools/search_docs \
  -H "Content-Type: application/json" \
  -d '{"query": "agents", "top_k": 2}' | head -c 200

echo ""
echo "✅ MCP server running on http://localhost:3000"

# Добавляем в конфигурацию OpenCode
CONFIG_FILE="$TARGET_DIR/.opencode/settings.json"
mkdir -p "$(dirname $CONFIG_FILE)"
cat > "$CONFIG_FILE" << 'EOF'
{
  "mcp": {
    "opencode_docs": {
      "type": "remote",
      "url": "http://localhost:3000"
    }
  }
}
EOF

echo "⚙️ Added to .opencode/settings.json"
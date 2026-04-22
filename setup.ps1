# OpenCode Docs MCP - Автоустановка
# Запустить: .\setup.ps1 [-ProjectPath <путь>]

param(
    [string]$ProjectPath = "."
)

$ErrorActionPreference = "Stop"

$TargetDir = if ($ProjectPath -eq ".") { $PWD.Path } else { $ProjectPath }
$McpDir = Join-Path $TargetDir "opencode-docs-mcp"

Write-Host "📁 Target: $TargetDir" -ForegroundColor Cyan

# Копируем файлы MCP сервера
if (-not (Test-Path $McpDir)) {
    New-Item -ItemType Directory -Path $McpDir -Force | Out-Null
}

$scriptRoot = $PSScriptRoot
Copy-Item (Join-Path $scriptRoot "index.js") -Destination $McpDir -Force
Copy-Item (Join-Path $scriptRoot "package.json") -Destination $McpDir -Force

Write-Host "📦 Installing dependencies..." -ForegroundColor Yellow
Push-Location $McpDir
npm install
Pop-Location

# Запускаем Chroma сервер
Write-Host "🚀 Starting Chroma server..." -ForegroundColor Yellow
$chromaScript = @"
import chromadb
from chromadb.config import Settings
client = chromadb.Client(Settings(anonymized_telemetry=False))
print('Chroma running on :8000')
"@

$chromaProc = Start-Process python -ArgumentList "-c", $chromaScript -PassThru -WindowStyle Hidden
Start-Sleep 2

# Запускаем MCP сервер
Write-Host "🚀 Starting MCP server..." -ForegroundColor Yellow
$mcpProc = Start-Process node -ArgumentList (Join-Path $McpDir "index.js") -PassThru -WindowStyle Hidden
Start-Sleep 4

# Тест
Write-Host "🧪 Testing search..." -ForegroundColor Yellow
try {
    $test = Invoke-RestMethod -Uri "http://localhost:3000/tools/search_docs" `
        -Method Post `
        -Body ([PSCustomObject]@{query="agents"; top_k=2} | ConvertTo-Json) `
        -ContentType "application/json" `
        -TimeoutSec 10
    Write-Host "✅ Search works!" -ForegroundColor Green
} catch {
    Write-Host "⚠️ Test failed: $($_.Exception.Message)" -ForegroundColor Red
}

# Добавляем в OpenCode настройки
$opencodeDir = Join-Path $TargetDir ".opencode"
if (-not (Test-Path $opencodeDir)) {
    New-Item -ItemType Directory -Path $opencodeDir -Force | Out-Null
}

$settingsFile = Join-Path $opencodeDir "settings.json"
$settings = @{
    mcp = @{
        opencode_docs = @{
            type = "local"
            url = "http://localhost:3000"
        }
    }
} | ConvertTo-Json -Depth 3

Set-Content -Path $settingsFile -Value $settings

Write-Host ""
Write-Host "✅ MCP server: http://localhost:3000" -ForegroundColor Green
Write-Host "✅ Added to .opencode/settings.json" -ForegroundColor Green
Write-Host ""
Write-Host "PIDs: Chroma=$($chromaProc.Id), MCP=$($mcpProc.Id)" -ForegroundColor Gray
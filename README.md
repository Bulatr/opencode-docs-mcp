# OpenCode Docs MCP Server

 сервер документации OpenCode с использованием RAG (Retrieval Augmented Generation). Обеспечивает поиск по официальной документации opencode.ai/docs через MCP-инструменты.

## Возможности

- Автоматический сбор документации с opencode.ai/docs
- Векторное хранение в ChromaDB
- Гибридный поиск (векторный + ключевые слова)
- Reranker (кросс-энкодер) для улучшения результатов
- Инкрементальная индексация (только новые/изменённые документы)
- Авто-восстановление при повреждении базы (до 3 попыток)
- Фоновая индексация (не блокирует старт сервера)
- Health-check, метрики и встроенные тесты
- dotenv для загрузки переменных окружения

## Требования

- Node.js 18+
- Python 3.8+ (для Chroma сервера)
- LM Studio с загруженной embedding-моделью:
  - `text-embedding-nomic-embed-text-v1.5` (рекомендуется)
  - `text-embedding-mxbai-embed-large-v1`
  - `text-embedding-bge-reranker-base` (для reranker)

## Установка

### 1. Клонирование и установка зависимостей

```bash
cd opencode-docs-mcp
npm install
```

### 2. Настройка LM Studio

1. Скачайте LM Studio с https://lmstudio.ai/
2. Откройте LM Studio
3. Скачайте embedding-модель (рекомендуется `nomic-embed-text` или `mxbai-embed-large`)
4. Загрузите модель вLM Studio (кнопка ▼ → Load)
5. В настройках (⚙️) включите API сервер:
   - API Server: Enable
   - Port: 1234
   - Require Auth: да (или настройте токен)

### 3. Запуск Chroma сервера

```bash
# Вариант 1: Скрипт (Windows)
python run-chroma.py

# Вариант 2: Вручную
pip install chromadb
chromamd --host localhost --port 8000
```

### 4. Запуск MCP сервера

```bash
npm start
# или
node index.js
```

Сервер запустится на http://localhost:3000

## Подключение к OpenCode

### Конфигурация OpenCode

Откройте конфигурационный файл OpenCode:

- **Windows**: `%APPDATA%\opencode\opencode.json`
- **macOS**: `~/Library/Application Support/opencode/opencode.json`
- **Linux**: `~/.config/opencode/opencode.json`

Добавьте в секцию `mcp`:

```json
{
  "mcp": {
    "opencode_docs": {
      "type": "remote",
      "url": "http://localhost:3000"
    }
  }
}
```

Или для удалённого сервера:

```json
{
  "mcp": {
    "opencode_docs": {
      "type": "remote",
      "url": "http://your-server:3000",
      "headers": {
        "Authorization": "Bearer YOUR_TOKEN"
      }
    }
  }
}
```

### Перезапуск OpenCode

После изменения конфигурации перезапустите OpenCode.

## Настройка

### Переменные окружения

| Переменная | Описание | По умолчанию |
|-----------|---------|-------------|
| `EMBEDDING_API` | URL LM Studio API | `http://localhost:1234/v1/embeddings` |
| `EMBEDDING_MODEL` | Модель для эмбеддингов | `text-embedding-nomic-embed-text-v1.5` |
| `LM_API_TOKEN` | Токен авторизации | (из .env) |
| `PORT` | Порт MCP сервера | `3000` |

### Создание .env файла

Создайте файл `.env` в корне проекта:

```env
LM_API_TOKEN=your-lm-studio-token
EMBEDDING_MODEL=text-embedding-nomic-embed-text-v1.5
```

Токен можно получить из LM Studio (настр��йки API → Copy Token).

### Конфигурация через cmd/terminal (Windows)

```cmd
set LM_API_TOKEN=your-token
set EMBEDDING_MODEL=text-embedding-nomic-embed-text-v1.5
node index.js
```

### Конфигурация через терминал (macOS/Linux)

```bash
export LM_API_TOKEN="your-token"
export EMBEDDING_MODEL="text-embedding-nomic-embed-text-v1.5"
node index.js
```

### Изменение параметров индексации

Отредактируйте `index.js`:

```javascript
// Размер чанка (слов)
const CHUNK_SIZE = 400;

// Перекрытие между чанками
const CHUNK_OVERLAP = 80;

// Количество результатов по умолчанию
const DEFAULT_TOP_K = 5;
```

## Использование

### Инструменты MCP

После подключения вам будут доступны два инструмента:

#### 1. search_docs

Поиск документации по запросу.

```
search_docs query="как настроить MCP сервер" top_k=5
```

**Параметры:**
- `query` (обязательно) - поисковый запрос
- `top_k` (опционально) - количество результатов (по умолчанию: 5)

#### 2. ask_docs

Получение ответов из документации.

```
ask_docs question="Как добавить OAuth к MCP серверу?"
```

**Параметры:**
- `question` (обязательно) - вопрос

### REST API

Также можно использовать напрямую:

#### Поиск

```bash
curl -X POST http://localhost:3000/tools/search_docs \
  -H "Content-Type: application/json" \
  -d '{"query": "MCP server oauth", "top_k": 5}'
```

#### Вопрос

```bash
curl -X POST http://localhost:3000/tools/ask_docs \
  -H "Content-Type: application/json" \
  -d '{"question": "Как настроить удалённый MCP сервер?"}'
```

### Дополнительные endpoints

| Endpoint | Метод | Описание |
|---------|-------|---------|
| `/api/v2/heartbeat` | GET | Проверка работоспособности |
| `/api/v2/search` | POST | Поиск (расширенный) |
| `/api/v2/index` | POST | Переиндексация |

## Обновление индекса

Индекс создаётся автоматически при первом запуске. Для принудительного обновления:

```bash
curl -X POST http://localhost:3000/api/v2/index
```

Или удалите папку `chroma_db` и перезапустите сервер.

## Удаление

### 1. Удаление MCP сервера из OpenCode

Удалите секцию `opencode_docs` из `opencode.json`:

```json
{
  "mcp": {
    // Удалите эту часть
  }
}
```

### 2. Остановка серверов

```bash
# Остановите Node.js сервер (Ctrl+C или Kill по PID)
taskkill /F /IM node.exe

# Остановите Chroma (если запущен отдельно)
taskkill /F /IM python.exe
```

### 3. Удаление файлов

 удалите папку проекта:

```bash
rm -rf opencode-docs-mcp
```

### 4. Очистка (опционально)

```bash
# Удаление данных Chroma
rm -rf ./chroma_db

# Удаление кэша
rm -rf ./node_modules
```

## Устранение проблем

### Ошибка: "Unexpected endpoint or method /v1/embeddings"

**Причина**: LM Studio не загружена embedding-модель.

**Решение**:
1. Откройте LM Studio
2. Загрузите мо��ель `nomic-embed-text-v1.5` или аналогичную
3. Убедитесь, что модель выбрана в настройках API

### Ошибка: "Connection refused" на порту 8000

**Причина**: Chroma сервер не запущен.

**Решение**:
```bash
python run-chroma.py
```

### Ошибка: "Connection refused" на порту 3000

**Причина**: MCP сервер не запущен.

**Решение**:
```bash
npm start
```

### Ошибка: "401 Unauthorized" от LM Studio

**Причина**: Неверный или отсутствует токен.

**Решение**:
1. Скопируйте токен из LM Studio (настройки API)
2. Добавьте в .env: `LM_API_TOKEN=ваш-токен`
3. Перезапустите сервер

### Пустые результаты поиска

**Причина**: Индекс пустой или не проиндексирован.

**Решение**:
```bash
rm -rf ./chroma_db
npm start
```

### Долгий первый запрос

**Причина**: Первая загрузка модели в LM Studio.

**Решение**: Дождитесь загрузки модели (строка вLM Studio: "Loaded").

## Production

### Auto-recovery

Сервер автоматически восстанавливает Chroma при повреждении:

```bash
# Принудительное восстановление
curl -X POST http://localhost:3000/admin/recover
```

### Фоновая индексация

Индексация происходит в фоне после старта сервера:

```bash
# Проверить статус
curl http://localhost:3000/health

# Принудительная переиндексация
curl -X POST http://localhost:3000/admin/reindex
```

### Endpoints

| Endpoint | Метод | Описание |
|---------|-------|---------|
| `/` | GET | Информация о сервисе |
| `/health` | GET | Статус сервера |
| `/metrics` | GET | Метрики (запросы, ошибки, latency) |
| `/tools/search_docs` | POST | Поиск документов |
| `/tools/ask_docs` | POST | Вопрос по документации |
| `/tools/run_tests` | POST | Запуск тестов |
| `/admin/recover` | POST | Авто-восстановление базы |
| `/admin/reindex` | POST | Полная переиндексация |

### Метрики

```json
{
  "requests": 150,
  "errors": 2,
  "avgSearchLatency": "45.3",
  "avgRerankLatency": "120.5"
}
```

## Тестирование

### Запуск тестов

```bash
# Запустить все тесты
npm run test:all

# Только API тесты
npm run test:api

# Только тесты агент-скилз
npm run test:skills
```

### Endpoint для тестов

```bash
curl -X POST http://localhost:3000/tools/run_tests \
  -H "Content-Type: application/json" \
  -d '{"type": "agent-skills"}'
```

### Пример результатов

```
📊 Results: 6/6 passed, 0/6 failed

✅ [Built-in Agents] - Results: 3
✅ [Custom Agent] - Results: 3
✅ [Skill Placement] - Results: 3
✅ [Skill Definition] - Results: 3
✅ [Agent Config] - Results: 3
✅ [Task Tool] - Results: 3

🎉 All tests passed!
```

### Test Coverage

| Категория | Тесты |
|-----------|-------|
| API Endpoints | `/health`, `/metrics`, `/tools/search_docs`, `/tools/ask_docs`, `/admin/recover`, `/admin/reindex` |
| Agent Skills | Built-in agents, Custom agent, Skill placement, Skill definition, Agent config, Task tool |

### Reranker

Для улучшения качества поиска загрузите в LM Studio модель `bge-reranker-base`:

```env
RERANK_API=http://localhost:1234/v1/rerank
```

## Архитектура

```
┌─────────────────────────────────────────────────────────┐
│                    Crawler (cheerio)                     │
│                     opencode.ai/docs                    │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│                      Cleaner                         │
│              HTML → text (400 words/chunk)              │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│                   Embeddings (LM Studio)                │
│              text-embedding-nomic-embed-text           │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│                     ChromaDB                        │
│                 (vector storage)                     │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│                    Hybrid Search                      │
│         vector + keyword scoring + reranker            │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│                     MCP API                         │
│    /tools/search_docs, /tools/ask_docs, /health     │
└─────────────────────────────────────────────────────────┘
```

## Автоустановка в любой проект

### PowerShell (Windows)

```powershell
# Скачать и запустить
irm https://raw.githubusercontent.com/Bulatr/opencode-docs-mcp/main/setup.ps1 | iex
```

Или скопировать `setup.ps1` в проект и запустить:

```powershell
.\setup.ps1 -ProjectPath "./мой-проект"
```

### Bash (Linux/Mac)

```bash
bash <(curl -sL https://raw.githubusercontent.com/Bulatr/opencode-docs-mcp/main/install.sh) ./мой-проект
```

### Промпт для OpenCode

Скопируйте содержимое `setup-prompt.txt` и вставьте как команду в OpenCode.

### Что делает автоустановка

1. Создаёт директорию `opencode-docs-mcp`
2. Копирует `index.js` и `package.json`
3. Устанавливает зависимости (`npm install`)
4. Запускает Chroma сервер (порт 8000)
5. Запускает MCP сервер (порт 3000)
6. Проверяет работу поиска
7. Добавляет конфигурацию в `.opencode/settings.json`

## Структура файлов

```
opencode-docs-mcp/
├── index.js           # Основной сервер (MCP + RAG)
├── package.json      # Зависимости npm
├── run-chroma.py    # Скрипт запуска Chroma
├── setup.ps1        # Автоустановка (PowerShell)
├── install.sh       # Автоустановка (Bash)
├── setup-prompt.txt  # Промпт для OpenCode
├── .opencode/       # Шаблон конфигурации
├── .env           # Переменные окружения
├── docker-compose.yml # Docker deployment
├── Dockerfile      # Container image
├── README.md      # Этот файл
├── AGENTS.md      # Инструкции для агентов
├── tests/         # Тесты
│   ├── runner.js
│   ├── api.test.js
│   └── agent-skills.test.js
├── chroma_db/     # Векторная база данных
└── data/         # Кэш документов
```

## Лицензия

MIT
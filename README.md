# OpenCode Docs MCP Server

 сервер документации OpenCode с использованием RAG (Retrieval Augmented Generation). Обеспечивает поиск по официальной документации opencode.ai/docs через MCP-инструменты.

## Возможности

- Автоматический сбор документации с opencode.ai/docs
- Векторное хранение в ChromaDB
- Гибридный поиск (векторный + ключевые слова)
- Переранжирование результатов по релевантности
- Инкрементальная индексация (только новые/изменённые документы)

## Требования

- Node.js 18+
- Python 3.8+ (для Chroma сервера)
- LM Studio с загруженной embedding-моделью

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

## Архитектура

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   opencode.ai   │────▶│   Crawler      │────▶│   Cleaner      │
│    (docs)      │     │ (cheerio)      │     │ (HTML→text)   │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                                                    │
                                                    ▼
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│    ChromaDB    │◀────│  Embeddings     │◀────│   Chunker     │
│   (vector DB)  │     │ (LM Studio)    │     │  (400 words)  │
└─────────────────┘     └──────────────────┘     └─────────────────┘
        │
        ▼
┌─────────────────┐
│   Hybrid      │
│   Search     │
│  (MCP API)  │
└─────────────────┘
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
├── index.js          # Основной сервер (MCP + RAG)
├── package.json      # Зависимости npm
├── run-chroma.py   # Скрипт запуска Chroma
├── setup.ps1       # Автоустановка (PowerShell)
├── install.sh      # Автоустановка (Bash)
├── setup-prompt.txt # Промпт для OpenCode
├── .opencode/      # Шаблон конфигурации
├── .env          # Переменные окружения
├── README.md     # Этот файл
├── AGENTS.md     # Инструкции для агентов
├── chroma_db/    # Векторная база данных
└── data/        # Кэш документов
```

## Лицензия

MIT
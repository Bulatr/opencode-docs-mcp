# Полное техническое исследование проекта OpenCode Docs MCP Server

## 1. Общее описание системы

OpenCode Docs MCP Server — это сервер документации для OpenCode, реализующий паттерн RAG (Retrieval Augmented Generation). Система обеспечивает поиск по официальной документации opencode.ai/docs через MCP-инструменты и REST API. Проект разработан как production-ready решение с автоматическим восстановлением, фоновая индексация и встроенное тестирование.

Проект написан на JavaScript (ES Modules) с использованием Node.js версии 18 и выше. Основной файл — index.js содержит 455 строк кода. Версия проекта — 2.0.0. Дата последних изменений — 22 апреля 2026 года. Проект расположен в директории D:/Projects/Opencode-docs-mcp/.

## 2. Архитектура системы

### 2.1 Высокоуровневая архитектура

Система состоит из следующих компонентов, соединённых в конвейер обработки данных:

```
Crawler (cheerio) → Cleaner → Chunker → Embeddings (LM Studio) → ChromaDB (vector storage) → Hybrid Search + Reranker → MCP API → Client
```

Каждый компонент выполняет определённую функцию в цепочке обработки документации. Crawler осуществляет сбор страниц с opencode.ai/docs. Cleaner очищает HTML от тегов script, style, nav, footer. Chunker разбивает текст на чанки размером 400 слов с перекрытием 80 слов. Embeddings преобразует текст в вектора через LM Studio API. ChromaDB хранит вектора. Hybrid Search выполняет поиск. Reranker улучшает результаты. MCP API предоставляет интерфейс для клиентов.

### 2.2 Компонентная диаграмма

Система содержит следующие основные компоненты: веб-сервер Express на порту 3000 (по умолчанию, настраивается через PORT). ChromaClient подключается к Chroma серверу на localhost:8000. LM Studio Integration обеспечивает работу с эмбеддингами через HTTP API на localhost:1234. Система метрик отслеживает производительность. Система автовосстановления обрабатывает сбои.

### 2.3 Сетевая архитектура

Система использует три сетевых сервиса: MCP сервер (port 3000) — основной API сервер проекта, Chroma сервер (port 8000) — векторная база данных. LM Studio API (port 1234) — генерация эмбеддингов и опционально reranker.

## 3. Алгоритм работы системы

### 3.1 Процесс запуска сервера

Процесс запуска начинается с загрузки переменных окружения из .env файла через dotenv/config. Далее происходит инициализация Express приложения с middleware express.json(). Затем система пытается подключиться к Chroma серверу (до 3 попыток). При успешном подключении создаётся или открывается коллекция opencode_docs_v2. После этого запускается HTTP сервер на порту 3000. Параллельно запускается фоновая индексация без блокировки основного потока.

### 3.2 Процесс инициализации (init function)

Функция init() расположена в index.js:252-279 и выполняет следующие шаги: обеспечивает существование директории DATA_DIR через fs.ensureDir. Выполняет цикл из 3 попыток подключения к Chroma. На каждой попытке пытается получить или создать коллекцию с именем COLLECTION_NAME. Проверяет размер коллекции через collection.count(). Устанавливает флаг isReady = true при успехе. При сбое вызывает autoRecovery() и ждёт 1 секунду перед повторной попыткой. После исчерпания попыток выводит ошибку но продолжает работу с isReady = true.

### 3.3 Процесс сбора документации (crawlAllDocs function)

Функция crawlAllDocs() расположена в index.js:130-164 и реализует breadth-first_search обход документации. Алгоритм работает следующим образом: начинает с пустой строки в очереди (главная страница). Создаёт множество visited для отслеживания посещённых страниц. Извлекает URL из очереди, проверяет visited set. Добавляет URL в visited. Выполняет HTTP GET запрос к BASE_URL + path. Очищает HTML через cleanHTML(). Сохраняет страницу в массив pages. Парсит HTML через cheerio для поиска ссылок. Для каждой ссылки a[href] начинающейся с /docs добавляет в очередь если не посещена. Повторяет пока очередь не пуста. Возвращает массив объектов {path, text}.

### 3.4 Процесс очистки HTML (cleanHTML function)

Функция cleanHTML() расположена в index.js:101-105 использует библиотеку cheerio. Загружает HTML через cheerio.load(html). Удаляет теги script, style, nav, footer через .remove(). Извлекает текст из body через .text(). Заменяет множественные пробелы на одиночные через /\s+/g. Обрезает пробелы по краям через .trim(). Возвращает очищенный текст.

### 3.5 Процесс разбиения на чанки (chunkText function)

Функция chunkText() расположена в index.js:107-116 принимает параметры size (по умолчанию 400) и overlap (по умолчанию 80). Разбивает текст на массив слов через text.split(" "). Создаёт пустой массив chunks. Итерирует по словам с шагом (size - overlap). На каждой итерации добавляет срез слов i до i+size в массив chunks. Возвращает массив чанков (строк).

### 3.6 Процесс индексации (indexDocs function)

Функция indexDocs() расположена в index.js:166-196 выполняет инкрементальную индексацию. Для каждой страницы из массива pages: получаем чанки через chunkText(page.text). Генерируем ID для каждого чанка по формуле path_index_hash. Проверяем существование ID через collection.get({ids}). Добавляем только новые чankи в newChunks массив. Если newChunks пуст — пропускаем страницу. Получаем эмбеддинги для текстов через getEmbeddingsBatch(). Добавляем в коллекцию через collection.add() с IDs, documents, embeddings, metadatas. Выводим лог с количеством добавленных чанков.

### 3.7 Процесс получения эмбеддингов (getEmbeddingsBatch function)

Функция getEmbeddingsBatch() расположена в index.js:52-67 принимает массив текстов. Формирует заголовки с Content-Type: application/json. Добавляет Authorization Bearer если LM_API_TOKEN задан. Выполняет POST запрос к EMBEDDING_API. Тело запроса содержит model: EMBEDDING_MODEL и input: texts. Таймаут запроса — 60000ms (1 минута). Возвращает массив векторов из res.data.data.map(e => e.embedding). При ошибке выбрасывает исключение.

### 3.8 Процесс гибридного поиска (hybridSearch function)

Функция hybridSearch() расположена в index.js:198-234 реализует гибридный поиск со следующими шагами: замеряет время начала. Получает эмбеддинг для запроса через getEmbeddingsBatch([query]). Выполняет векторный запрос к Chroma с топ_k * 3 результатами. Извлекает documents и metadatas из ответа. Для каждого документа вычисляет keywordScore через keywordScore(). Сортирует результаты по kScore по убыванию. Берёт top_k * 2 документов для reranking. Выполняет rerank через rerank() функцию. Создаёт Map из результатов reranking для быстрого поиска. Вычисляет финальный score как kScore + rerankScore. Сортирует финальные результаты по score. Добавляет latency в метрики. Возвращает top_k результатов.

### 3.9 Процесс вычисления keyword score (keywordScore function)

Функция keywordScore() расположена в index.js:118-128 принимает query и text. Токенизирует query через tokenizer.tokenize() — использует natural.WordTokenizer(). Токенизирует text аналогично. Для каждого токена из query: считает количество совпадений в text (фильтр по точному совпадению). Возвращает суммарный score (целое число).

### 3.10 Процесс reranking (rerank function)

Функция rerank() расположена в index.js:69-99 обрабатывает reranking результатов. Если RERANK_API не задан или docs пуст — возвращает fallback score (1 - i * 0.1). Замеряет время начала. Формирует заголовки с авторизацией. Выполняет POST к RERANK_API с моделью bge-reranker-base. Тело содержит query и documents массив. Таймаут — 30000ms. При успехе парсит results и маппит на text + score. Добавляет latency в метрики. При ошибке выводит сообщение и использует fallback. Возвращает массив объектов {text, score}.

### 3.11 Процесс фоновой индексации (backgroundIndex function)

Функция backgroundIndex() расположена в index.js:281-297 запускается п��сле старта сервера. Проверяет isReady и collection. Если коллекция не пустая (count > 0) — выходит. Выполняет crawlAllDocs(). Выполняет indexDocs(). При ошибке логирует в консоль.

### 3.12 Процесс автовосстановления (autoRecovery function)

Функция autoRecovery() расположена в index.js:236-250 выполняет сброс базы данных. Логирует начало восстановления. Проверяет существование CHROMA_PATH директории. Удаляет директорию через fs.removeSync(). Логирует завершение. Возвращает true. При ошибке логирует и возвращает false.

## 4. База данных ChromaDB

### 4.1 Конфигурация Chroma

ChromaClient инициализируется в index.js:22 следующим образом: const chroma = new ChromaClient({ path: "http://localhost:8000" }). Подключение к Chroma серверу осуществляется по протоколу HTTP на localhost порт 8000. Коллекция создаётся с именем COLLECTION_NAME = "opencode_docs_v2". Путь к персистентному хранилищу CHROMA_PATH = "./chroma_db". Chroma хранит данные локально в файловой системе.

### 4.2 Структура данных в Chroma

Каждый документ в коллекции содержит: id — формируется как path_index_hash (path + "_" + i + "_" + md5(chunk)), document — текст чанка, embedding — числовой вектор (768 или 1024 измерений в зависимости от модели), metadata — объект с полем path (путь документа). Индекс содержит 398 документов (проверено при тестировании).

### 4.3 Операции с базой данных

Система выполняет следующие операции с Chroma: getOrCreateCollection — создаёт или открывает коллекцию, get — получает документы по IDs для проверки существования, add — добавляет новые документы с эмбеддингами, query — выполняет векторный поиск, count — подсчитывает количество документов. Операции add и query выполняются асинхронно.

### 4.4 Персистентность

ChromaDB персистентна — данные сохраняются между запусками в директории ./chroma_db. При сбое (сервер падает без clean shutdown): возможно повреждение индекса, файлы могут остаться в заблокированном состоянии. Для восстановления используется /admin/recover endpoint который удаляет chroma_db и пересоздаёт коллекцию.

### 4.5 Инкрементальная индексация

Система поддерживает инкрементальную индексацию: при каждом запуске проверяет существующие ID через collection.get({ids}). Сравнивает полученные ID со списком планируемых к добавлению. Добавляет только новые чанки. Это предотвращает дублирование при перезапуске.

### 4.6 Дедупликация

Дедупликация реализована через MD5 хэш: хэшируется текст чанка через crypto.createHash("md5"). Формула ID: "${page.path}_${i}_${hash(c)}". При совпадении хэша документ не добавляется повторно.

## 5. API Endpoints

### 5.1 Основные endpoints

Система предоставляет следующие HTTP endpoints:

GET / — возвращает JSON с информацией о сервисе: {service, version, status}. Расположен в index.js:389-395.

GET /health — возвращает статус сервера. Расположен в index.js:299-314. При неготовности возвращает 503 с {status: "initializing"}. При готовности возвращает {status: "ok", documents: count, ready: true}. При ошибке возвращает 500 с {status: "error", message}.

GET /metrics — возвращает метрики. Расположен в index.js:316-318. Возвращает {requests, errors, avgSearchLatency, avgRerankLatency}.

POST /tools/search_docs — поиск документации. Расположен в index.js:351-367. Принимает {query, top_k}. Возвращает {results: [{text, metadata, score}]}. Инкрементирует счётчик requests.

POST /tools/ask_docs — вопрос к документации. Расположен в index.js:369-387. Принимает {question}. Возвращает {answer: joined text}. Инкрементирует счётчик requests.

POST /tools/run_tests — запуск тестов. Расположен в index.js:406-445. Принимает {type: "all" | "agent-skills"}. Возвращает {type, total, passed, failed, results: [...]}. Тестирует 6 категорий агент-скилзов.

POST /admin/reindex — полная переиндексация. Расположен в index.js:320-335. Вызывает autoRecovery(). Пересоздаёт коллекцию. Выполняет crawlAllDocs() + indexDocs(). Возвращает {status: "reindexed"}.

POST /admin/recover — автовосстановление. Расположен в index.js:337-349. Вызывает autoRecovery(). Пересоздаёт коллекцию. Возвращает {status: "recovered"}.

### 5.2 Обработка ошибок

Все endpoints обрабатывают ошибки следующим образом: try-catch блоки вокруг асинхронного кода. При ошибке инкрементируется metrics.errors. Возвращается HTTP 500 с JSON {error: message}. Исключение NeverError не перехватывается (顶层).

### 5.3 Коды HTTP ответов

Система использует следующие коды: 200 — успех, 500 — ошибка сервера, 503 — сервер инициализируется. Другие коды не используются.

## 6. Конфигурация и переменные окружения

### 6.1 Переменные окружения

Система использует следующие переменные окружения (из .env файла):

| Переменная | Значение по умолчанию | Описание |
|-----------|---------------------|----------|
| EMBEDDING_API | http://localhost:1234/v1/embeddings | URL LM Studio embeddings API |
| EMBEDDING_MODEL | text-embedding-nomic-embed-text-v1.5 | Имя модели эмбеддингов |
| RERANK_API | http://localhost:1234/v1/rerank | URL LM Studio rerank API (опционально) |
| LM_API_TOKEN | (пусто) | Bearer токен для LM Studio |
| PORT | 3000 | Порт MCP сервера |

Эти переменные загружаются через import "dotenv/config" в начале index.js:1.

### 6.2 Константы в коде

Следующие константы заданы в коде (index.js):

BASE_URL = "https://opencode.ai/docs" — источник документации. COLLECTION_NAME = "opencode_docs_v2" — имя коллекции Chroma. DATA_DIR = "./data" — директория для кэша. CHROMA_PATH = "./chroma_db" — директория Chroma. CHUNK_SIZE = 400 — размер чанка в словах. CHUNK_OVERLAP = 80 — перекрытие чанков. DEFAULT_TOP_K = 5 — количество результатов по умолчанию.

### 6.3 Файл .env

Файл .env в проекте содержит:

```
LM_API_TOKEN=sk-lm-tMIHNpro:HEZXMGgWqknUfxLlvi0j
EMBEDDING_MODEL=text-embedding-nomic-embed-text-v1.5
EMBEDDING_API=http://localhost:1234/v1/embeddings
PORT=3000
```

Файл загружается при старте через dotenv.

## 7. Внешние зависимости и интеграции

### 7.1 Node.js модули

Проект использует следующие npm пакеты (из package.json):

| Модуль | Версия | Назначение |
|--------|-------|------------|
| express | ^4.18.0 | HTTP сервер |
| axios | ^1.7.0 | HTTP клиент |
| cheerio | ^1.0.0 | HTML парсинг |
| chromadb | ^1.8.0 | Vector database client |
| natural | ^6.10.0 | Токенизация текста |
| dotenv | ^17.4.2 | Загрузка .env |
| fs-extra | ^11.2.0 | Файловые операции |
| crypto | built-in | MD5 хэширование |
| prom-client | ^15.1.0 | Метрики (подключён но не используется) |

### 7.2 LM Studio интеграция

LM Studio используется для двух задач: генерация эмбеддингов и опционально reranking.

Эмбеддинги: URL EMBEDDING_API (по умолчанию localhost:1234/v1/embeddings). Требует загруженную модель (рекомендуется nomic-embed-text или mxbai-embed-large). Требует Bearer токен (LM_API_TOKEN из .env). Таймаут 60 секунд.

Reranking: URL RERANK_API (опционально, по умолчанию localhost:1234/v1/rerank). Требует загруженную модель bge-reranker-base. При недоступности используется fallback (keyword scores). Таймаут 30 секунд.

### 7.3 Chroma сервер

Chroma требует запущенного Python сервера: порт 8000 (по умолчанию), путь к персистентному хранилищу ./chroma_db. Запускается через python run-chroma.py или chromamd --host localhost --port 8000.

## 8. Метрики и мониторинг

### 8.1 Система метрик

Объект metrics определён в index.js:28-33:

```javascript
const metrics = {
  requests: 0,
  errors: 0,
  searchLatency: [],
  rerankLatency: []
};
```

### 8.2 Отслеживаемые метрики

requests — общее количество запросов (инкрементируется в search_docs и ask_docs). errors — количество ошибок (инкрементируется в catch блоках). searchLatency — массив времен выполнения поиска в миллисекундах. rerankLatency — массив времен выполнения reranking в миллисекундах.

### 8.3 Функция getMetrics

Функция getMetrics() в index.js:39-50 вычисляет: requests — текущее значение, errors — текущее значение, avgSearchLatency — среднее время поиска (сумма / длина), avgRerankLatency — среднее время reranking (сумма / длина).

### 8.4 Endpoint метрик

GET /metrics возвращает JSON: {requests: number, errors: number, avgSearchLatency: string, avgRerankLatency: string}. Время пред��та��лено в миллисекундах как строка с одним знаком после запятой.

## 9. Тестирование

### 9.1 Тестовые категории

Система содержит тесты для 6 категорий агент-скилзов (AGENT_SKILLS_TESTS в index.js:397-404):

| # | Категория | Поисковый запрос |
|---|----------|-----------------|
| 1 | Built-in Agents | built-in agent types configuration |
| 2 | Custom Agent | create custom agent |
| 3 | Skill Placement | skill file placement location |
| 4 | Skill Definition | how to define skill |
| 5 | Agent Config | agent configuration settings |
| 6 | Task Tool | task tool usage agent |

### 9.2 Тестовый endpoint

POST /tools/run_tests принимает {type: "all" | "agent-skills"}. Для каждого теста: выполняет hybridSearch с query и top_k=3. Выполняет hybridSearch с query и top_k=1. Проверяет наличие результатов. Возвращает {type, total, passed, failed, results: [...]}. result содержит category, query, searchResults count, answer, status.

### 9.3 npm скрипты тестирования

| Команда | Описание |
|---------|----------|
| npm test | node tests/runner.js |
| npm run test:api | node tests/api.test.js |
| npm run test:skills | node tests/agent-skills.test.js |
| npm run test:all | node tests/runner.js --all |

### 9.4 Результаты тестирования

Последний запуск тестов показал: 398 документов в индексе, 6/6 тестов пройдено (100% pass rate). Все категории вернули результаты.

## 10. Production особенности

### 10.1 Автовосстановление

Система автоматически восстанавливается при сбое: функция init() делает 3 попытки подключения. При сбое вызывает autoRecovery(). Удаляет директорию chroma_db. Пересоздаёт коллекцию. Продолжает работу с isReady = true даже после исчерпания попыток.

### 10.2 Фоновая индексация

Индексация не блокирует старт сервера: backgroundIndex() вызывается после app.listen(). Проверяет существующий индекс перед переиндексацией. Выполняет crawl + index асинхронно. Ошибки логируются но не прерывают работу.

### 10.3 Обработка недоступности сервисов

Embeddings недоступны: функция getEmbeddingsBatch выбрасывает ошибку, запрос возвращает 500. Reranker недоступны: rerank() использует fallback (1 - i * 0.1), логирует "Rerank unavailable, using keyword scores". Chroma недоступны: init() пытается 3 раза + autoRecovery.

### 10.4 Graceful degradation

Система продолжает работу даже при недоступности компонентов: без Chroma — работает в режиме восстановления. Без reranker — использует keyword scores. Без LM Studio — запросы возвращают ошибку.

## 11. Поток данных от запроса до ответа

### 11.1 Полный поток для search_docs

Клиент отправляет POST /tools/search_docs с {query, top_k}. Express middleware парсит JSON. Инкрементируется metrics.requests. Вызывается hybridSearch(query, top_k). hybridSearch выполняет: getEmbeddingsBatch([query]) → LM Studio → вектор. collection.query({queryEmbeddings: [vector], nResults}) → Chroma. Для каждого результата: keywordScore(query, doc). Сортировка по kScore. rerank(query, topDocs) → LM Studio (если доступен). Вычисление финального score = kScore + rerankScore. Сортировка по финальному score. Добавление latency в метрики. Возврат top_k результатов. Клиент получает JSON {results: [...]}.

### 11.2 Поток для ask_docs

Клиент отправляет POST /tools/ask_docs с {question}. Инкрементируется metrics.requests. Вызывается hybridSearch(question, 3). Результаты преобразуются в текст через .join("\n\n"). Возвращается {answer: text}.

### 11.3 Поток для admin/reindex

Клиент отправляет POST /admin/reindex. Вызывается autoRecovery(). Удаляется chroma_db директория. Пересоздаётся коллекция. Выполняется crawlAllDocs(). Выполняется indexDocs(). Возвращается {status: "reindexed"}.

## 12. Структура файлов проекта

### 12.1 Основные файлы

| Файл | Строк | Описание |
|------|-------|----------|
| index.js | 455 | Основной сервер (MCP + RAG) |
| package.json | 25 | Зависимости npm |
| .env | 4 | Переменные окружения |

### 12.2 Файлы запуска

run-chroma.py — скрипт запуска Chroma сервера на Python. setup.ps1 — автоустановка PowerShell. install.sh — автоустановка Bash. setup-prompt.txt — промпт для OpenCode.

### 12.2 Конфигурационные файлы

docker-compose.yml — Docker deployment. Dockerfile — Container image. .opencode/ — шаблон конфигурации.

### 12.3 Тесты

tests/runner.js — Test runner. tests/api.test.js — API endpoint tests. tests/agent-skills.test.js — Agent skills query tests.

### 12.4 Директории

chroma_db/ — vector database (персистентная). data/ — кэш документов.

## 13. Ключевые алгоритмы

### 13.1 Алгоритм очистки HTML

Input: HTML string. Load with cheerio.load(). Remove script, style, nav, footer elements. Extract text from body. Replace multiple whitespace with single space. Trim leading/trailing whitespace. Output: Clean text string.

### 13.2 Алгоритм разбиения на чанки

Input: text string, size=400, overlap=80. Split text by space into words array. Initialize empty chunks array. For i = 0 to words.length step (size - overlap): Extract slice words[i:i+size]. Join with space. Push to chunks. Output: Array of chunk strings.

### 13.3 Алгоритм инкрементальной индексации

For each page in pages: Generate chunks. Generate IDs as path_index_hash. Get existing IDs from Chroma. Filter new chunks (not in existing). If newChunks empty: continue. Get embeddings for new chunks. Add to Chroma collection. Output: Indexed documents count.

### 13.4 Алгоритм гибридного поиска

Get embedding for query from LM Studio. Query Chroma with vector (top_k*3 results). Calculate keyword score for each document. Sort by keyword score descending. Take top_k*2 for reranking. Rerank (LM Studio if available). Combine keyword + rerank scores. Sort by combined score. Return top_k results.

### 13.5 Алгоритм дедупликации

For each chunk: Generate MD5 hash of chunk text. Generate ID as path_index_hash. Check if ID exists in Chroma. Skip if exists. Add only new chunks. Output: Unique chunks only.

## 14. Версии и история изменений

### 14.1 Текущая версия

Версия проекта: 2.0.0 (package.json:3). О��но��ные изменения v2.0.0: dotenv поддержка, авто-восстановление до 3 попыток, фоновая индексация, метрики, reranker интеграция, docker-compose, Dockerfile, встроенные тесты.

### 14.2 Предыдущие версии

v1.0.0 — базовая реализация RAG. Содержала crawler, cleaner, chunker, embeddings, Chroma storage, базовый поиск, MCP endpoints.

## 15. Известные ограничения и особенности

### 15.1 Ограничения reranker

Reranker требует загрузки модели bge-reranker-base в LM Studio. Если модель не загружена — используется fallback keyword scoring. Rerank endpoint должен быть включён в LM Studio настройках API. Fallback работает корректно но качество поиска ниже.

### 15.2 Ограничения Chroma

Chroma сервер должен быть запущен отдельно. При сбое сервера возможно повреждение индекса. Рекомендуется периодически делать /admin/reindex. Персистентная директория должна иметь права на запись.

### 15.3 Ограничения LM Studio

Требуется токен авторизации (LM_API_TOKEN). Модель должна быть загружена в LM Studio. При первом запросе модель загружается в память (может занять время). Таймаут запроса 60 секунд для embedding, 30 секунд для rerank.

### 15.4 Особенности индексации

При старте если индекс пуст — запускается фоновая индексация. Индексация может занять несколько минут для 398 страниц. Crawler.follows все ссылки /docs/* начиная с BASE_URL. Инкрементальная индексация пропускает существующие документы.

## 16. Диаграмма последовательности

### 16.1 Диаграмма запуска сервера

```
init() → fs.ensureDir(DATA_DIR)
init() → loop 0..2:
  init() → chroma.getOrCreateCollection()
  init() → collection.count()
  init() → isReady = true (if success)
  init() → autoRecovery() (if fail)
init() → app.listen(PORT)
init() → backgroundIndex()
backgroundIndex() → collection.count()
backgroundIndex() → if count==0:
  backgroundIndex() → crawlAllDocs()
  backgroundIndex() → indexDocs(pages)
```

### 16.2 Диаграмма запроса search_docs

```
Client → POST /tools/search_docs
→ express.json() middleware
→ metrics.requests++
→ hybridSearch(query, top_k)
→ getEmbeddingsBatch([query]) → LM Studio
→ collection.query() → Chroma
→ keywordScore() x N
→ sort by kScore
→ rerank() → LM Studio (if available)
→ calculate finalScore
→ sort by finalScore
→ metrics.searchLatency.push(latency)
→ Client ← {results: [...]}
```

### 16.3 Диаграмма admin/reindex

```
Client → POST /admin/reindex
→ autoRecovery()
→ fs.removeSync(CHROMA_PATH)
→ chroma.getOrCreateCollection()
→ crawlAllDocs()
→ indexDocs(pages)
→ Client ← {status: "reindexed"}
```

## 17. Зависимости между функциями

### 17.1 Граф вызовов функций

```
init()
├── fs.ensureDir(DATA_DIR)
├── chroma.getOrCreateCollection()
├── collection.count()
└── autoRecovery()
    └── fs.removeSync(CHROMA_PATH)

backgroundIndex()
├── collection.count()
├── crawlAllDocs()
│   ├── axios.get(url)
│   └── cleanHTML(html)
│       └── cheerio.load()
└── indexDocs(pages)
    ├── chunkText(text)
    │   └── text.split(" ")
    ├── collection.get(ids)
    ├── getEmbeddingsBatch(texts)
    │   └── axios.post(EMBEDDING_API)
    └── collection.add(data)

hybridSearch(query, top_k)
├── getEmbeddingsBatch([query])
│   └── axios.post(EMBEDDING_API)
├── collection.query()
│   └── Chroma HTTP
├── keywordScore(query, text)
│   └── tokenizer.tokenize()
├── rerank(query, docs)
│   └── axios.post(RERANK_API)
└── metrics.searchLatency.push()

search_docs endpoint
├── hybridSearch()
│   └── (see above)
└── metrics.requests++

ask_docs endpoint
├── hybridSearch()
│   └── (see above)
└── metrics.requests++

admin/reindex endpoint
├── autoRecovery()
│   └── (see above)
├── crawlAllDocs()
│   └── (see above)
└── indexDocs(pages)
    └── (see above)
```

## 18. Конфигурация для Production

### 18.1 Рекомендуемые настройки Production

Для продакшена рекомендуется: LM Studio загружает embedding модель при старте системы. LM Studio включает API server с authentication. Chroma запущен как отдельный сервис (docker или Python). Добавлен systemd service unit для автозапуска. Настроен мониторинг через /metrics endpoint. Периодический /admin/reindex через cron.

### 18.2 Docker Compose

Проект содержит docker-compose.yml для контейнеризации. Определяет сервис для MCP server. Требует внешний Chroma сервер. Требует внешний LM Studio. Пробрасывает порты 3000, 8000, 1234.

### 18.3 Мониторинг

Для мониторинга используются: GET /health — проверка статуса. GET /metrics — метрики производительности. Размер индекса collection.count(). Среднее время ответа avgSearchLatency. Количество ошибок errors.

---

## Заключение

Данное исследование представляет полную техническую документацию проекта OpenCode Docs MCP Server v2.0.0. Система реализует production-ready RAG решение для поиска документации OpenCode с автоматическим восстановлением, гибридным поиском и встроенным тестированием. Все факты основаны на анализе исходного кода index.js (455 строк), конфигурационных файлов и результатов тестирования.
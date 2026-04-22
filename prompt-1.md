при перезапуске opencode выходит ошибка Error: Unknown error at castError (http://tauri.localhost/assets/index-BSaHXp2J.js:1:10383) at http://tauri.localhost/assets/index-BSaHXp2J.js:1:3246 ──────────────────────────────────────── Причина: UnknownError Error at wA (B:/~BUN/root/chunk-m7c2yyhx.js:71:4219) at <anonymous> (B:/~BUN/root/chunk-x85z9xnz.js:2:9964) at processTicksAndRejections (native:7:39) Выходит такая ошибка при перезапуске opencode Помогает только переименование папки где находится mcp сервер (Opencode-docs-mcp)
Возможно ломается persist-состояние MCP/Chroma, и при старте OpenCode не может его корректно прочитать. Поэтому он падает с UnknownError

Почему возникает ошибка

Основные причины:

1. 🔒 Блокировка или повреждение Chroma DB

Ты используешь:

new ChromaClient({ path: "./chroma_db" })

Chroma:

пишет локальные файлы
может оставить lock / битый индекс
особенно если процесс завершился криво

👉 при следующем запуске:

OpenCode → MCP → Chroma → 💥 crash
2. 🧱 Конфликт коллекции
getOrCreateCollection("opencode_docs_v2")

Если:

схема изменилась
embeddings отличаются
или данные частично записаны

👉 Chroma не всегда корректно это переживает

3. ⚠️ MCP сервер не успевает стартовать

OpenCode пытается подключиться:

http://localhost:3000

Но:

сервер ещё не поднялся
или падает на init()

👉 и ты видишь UnknownError

4. 💣 Краш в init()

Вот эта часть критичная:

if (count === 0) {
  const pages = await crawlAllDocs();
  await indexDocs(pages);
}

Если что-то падает внутри:

OpenCode не получает нормальный ответ
UI даёт UnknownError

✅ НОРМАЛЬНОЕ РЕШЕНИЕ (production fix)
🔧 1. Добавь защиту от битой базы

👉 замени init():

async function init() {
  try {
    collection = await chroma.getOrCreateCollection({
      name: COLLECTION_NAME
    });

    const count = await collection.count();

    console.log("Collection size:", count);

  } catch (e) {
    console.error("❌ Chroma corrupted, recreating...");

    // 🔥 удаляем битую базу
    await fs.remove("./chroma_db");

    collection = await chroma.getOrCreateCollection({
      name: COLLECTION_NAME
    });
  }
}
🔧 2. Отдели индексацию от старта сервера

❌ сейчас:

сервер ждёт crawl → index

👉 сделай так:

init().then(() => {
  app.listen(3000, () => {
    console.log("🚀 MCP running");
  });

  // 🔥 индексируем в фоне
  backgroundIndex();
});
🔧 3. Фоновая индексация
async function backgroundIndex() {
  try {
    const count = await collection.count();

    if (count > 0) {
      console.log("📦 Index already exists");
      return;
    }

    const pages = await crawlAllDocs();
    await indexDocs(pages);

    console.log("✅ Index built");

  } catch (e) {
    console.error("Indexing error:", e);
  }
}
🔧 4. Health-check endpoint (ОЧЕНЬ важно)

Добавь:

app.get("/health", async (req, res) => {
  try {
    const count = await collection.count();
    res.json({ status: "ok", documents: count });
  } catch (e) {
    res.status(500).json({ status: "error" });
  }
});

👉 OpenCode должен проверять его

🔧 5. Retry при подключении (если есть доступ к orchestrator)

Если можешь — добавь retry:

{
  "retry": 3,
  "timeout": 5000
}
🔧 6. Самая частая проблема — embeddings

Если ты используешь:

http://localhost:1234/v1/embeddings

И LM Studio:

не запущен
или модель не загружена

👉 MCP падает при старте

🔥 Быстрый тест

Проверь:

curl http://localhost:3000/health

Если не отвечает → проблема в MCP
Если отвечает → проблема в OpenCode

💡 Почему “переименование папки” помогает

Ты фактически делаешь:

rm -rf chroma_db

👉 и Chroma создаёт чистую базу

🚀 Итог

Причина не в OpenCode, а в:

👉 ❌ Chroma persist ломается
👉 ❌ init блокирует сервер
👉 ❌ нет failover

Сделай Chroma отдельно как сервис очередь индексации (BullMQ) авто-восстановление базы observability (логи + метрики)

Должно быть:
✅ Chroma как отдельный сервис
✅ очередь индексации (BullMQ + Redis)
✅ авто-восстановление базы
✅ observability (логи + метрики)
✅ неблокирующий MCP

## Архитектура
OpenCode
   ↓
MCP (Node.js)
   ↓
Queue (BullMQ) → Worker (indexing)
   ↓
Chroma (отдельный сервис)
   ↓
Embeddings API (LM Studio)
   ↓
Logs + Metrics

## Создай docker-compose.yml
version: "3.9"

services:
  chroma:
    image: chromadb/chroma
    container_name: chroma
    ports:
      - "8000:8000"
    volumes:
      - ./chroma_data:/chroma/.chroma
    restart: always

  redis:
    image: redis:7
    container_name: redis
    ports:
      - "6379:6379"
    restart: always

  mcp:
    build: .
    container_name: mcp-server
    ports:
      - "3000:3000"
    depends_on:
      - chroma
      - redis
    environment:
      - CHROMA_URL=http://chroma:8000
      - REDIS_HOST=redis
      - EMBEDDING_API=http://host.docker.internal:1234/v1/embeddings
    restart: always

## Установка зависимостей
npm install bullmq ioredis axios cheerio express chromadb pino prom-client

## MCP сервер (production-ready)
# index.js
import express from "express";
import axios from "axios";
import { ChromaClient } from "chromadb";
import { Queue } from "bullmq";
import Redis from "ioredis";
import pino from "pino";
import client from "prom-client";

const app = express();
app.use(express.json());

const logger = pino();
const redis = new Redis(process.env.REDIS_HOST);

const queue = new Queue("indexing", { connection: redis });

const chroma = new ChromaClient({
  path: process.env.CHROMA_URL
});

let collection;

// --- METRICS ---
const requestCounter = new client.Counter({
  name: "mcp_requests_total",
  help: "Total requests"
});

const searchLatency = new client.Histogram({
  name: "search_latency",
  help: "Search latency"
});

// --- INIT ---
async function init() {
  try {
    collection = await chroma.getOrCreateCollection({
      name: "opencode_docs_v2"
    });

    logger.info("Chroma connected");

  } catch (e) {
    logger.error("Chroma failed, resetting...");

    // авто-восстановление
    await resetDatabase();

    collection = await chroma.getOrCreateCollection({
      name: "opencode_docs_v2"
    });
  }
}

// --- AUTO RECOVERY ---
async function resetDatabase() {
  logger.warn("Resetting DB...");

  try {
    await axios.post(`${process.env.CHROMA_URL}/reset`);
  } catch (e) {
    logger.error("Reset failed:", e.message);
  }
}

// --- SEARCH ---
app.post("/tools/search_docs", async (req, res) => {
  const end = searchLatency.startTimer();

  try {
    requestCounter.inc();

    const { query } = req.body;

    const embedding = await getEmbedding(query);

    const results = await collection.query({
      queryEmbeddings: [embedding],
      nResults: 5
    });

    end();

    res.json({
      results: results.documents[0]
    });

  } catch (e) {
    logger.error(e);
    res.status(500).json({ error: e.message });
  }
});

// --- ADD INDEX JOB ---
app.post("/admin/reindex", async (req, res) => {
  await queue.add("crawl", {});

  res.json({ status: "queued" });
});

// --- HEALTH ---
app.get("/health", async (req, res) => {
  try {
    const count = await collection.count();
    res.json({ status: "ok", docs: count });
  } catch (e) {
    res.status(500).json({ status: "error" });
  }
});

// --- METRICS ---
app.get("/metrics", async (req, res) => {
  res.set("Content-Type", client.register.contentType);
  res.end(await client.register.metrics());
});

// --- EMBEDDING ---
async function getEmbedding(text) {
  const res = await axios.post(process.env.EMBEDDING_API, {
    model: "text-embedding",
    input: text
  });

  return res.data.data[0].embedding;
}

// --- START ---
init().then(() => {
  app.listen(3000, () => {
    logger.info("🚀 MCP running");
  });
});

## Worker (индексация в фоне)
# worker.js
import { Worker } from "bullmq";
import Redis from "ioredis";
import axios from "axios";
import cheerio from "cheerio";
import { ChromaClient } from "chromadb";

const redis = new Redis(process.env.REDIS_HOST);

const chroma = new ChromaClient({
  path: process.env.CHROMA_URL
});

let collection;

async function init() {
  collection = await chroma.getOrCreateCollection({
    name: "opencode_docs_v2"
  });
}

function clean(html) {
  const $ = cheerio.load(html);
  $("script, style").remove();
  return $("body").text();
}

new Worker("indexing", async job => {
  console.log("Indexing started");

  const res = await axios.get("https://opencode.ai/docs");
  const text = clean(res.data);

  const embedding = await axios.post(process.env.EMBEDDING_API, {
    model: "text-embedding",
    input: text
  });

  await collection.add({
    ids: ["main"],
    documents: [text],
    embeddings: [embedding.data.data[0].embedding]
  });

  console.log("Indexing done");

}, { connection: redis });

init();

## Observability
Логи
pino → быстрые JSON логи
Метрики
/metrics endpoint
Prometheus-compatible

Примеры:

mcp_requests_total
search_latency

## Добавь reranker
Что меняем в архитектуре
query
 ↓
vector search (Chroma)
 ↓
top 20 кандидатов
 ↓
🔥 reranker (cross-encoder)
 ↓
top 5 лучших
 ↓
ответ

## Вариант reranker
Через LM Studio:

bge-reranker-base
bge-reranker-large

👉 работает как /v1/rerank

## Интерфейс reranker API
Ожидаемый формат:
{
  "model": "bge-reranker",
  "query": "your query",
  "documents": ["doc1", "doc2"]
}

Ответ:
{
  "results": [
    { "index": 0, "score": 0.92 },
    { "index": 1, "score": 0.75 }
  ]
}

## Добавляем в MCP
# ENV
RERANK_API=http://localhost:1234/v1/rerank

## функция rerank
async function rerank(query, docs) {
  const res = await axios.post(process.env.RERANK_API, {
    model: "bge-reranker",
    query,
    documents: docs
  });

  const scores = res.data.results;

  return docs
    .map((doc, i) => ({
      text: doc,
      score: scores.find(s => s.index === i)?.score || 0
    }))
    .sort((a, b) => b.score - a.score);
}

## Обновляем hybridSearch
Вот ключевой апгрейд:
async function hybridSearch(query, top_k = 5) {
  const embedding = (await getEmbedding(query))[0];

  const vectorResults = await collection.query({
    queryEmbeddings: [embedding],
    nResults: 20 // 🔥 берём больше кандидатов
  });

  const docs = vectorResults.documents[0];

  // 🔥 rerank
  const reranked = await rerank(query, docs);

  return reranked.slice(0, top_k);
}

## Оптимизация (очень важно)
# ❗ Ограничь длину документов
const MAX_LEN = 512;

const trimmedDocs = docs.map(d =>
  d.length > MAX_LEN ? d.slice(0, MAX_LEN) : d
);

# ❗ Кэш reranker (ускорение ×3–5)
const cache = new Map();

async function rerankCached(query, docs) {
  const key = query + docs.join("|");

  if (cache.has(key)) return cache.get(key);

  const result = await rerank(query, docs);
  cache.set(key, result);

  return result;
}

# Синергия с RAGAS
if (evaluation.faithfulness < 0.7) {
  // попробовать rerank с большим top_k
}

# Метрики (добавь в observability)
Добавь:
const rerankLatency = new client.Histogram({
  name: "rerank_latency",
  help: "Rerank latency"
});

## ⚠️ Где можно облажаться

Самые частые ошибки:

❌ слишком длинные chunks
❌ маленький top_k (нужно 15–30)
❌ нет trimming
❌ reranker не локальный → задержки
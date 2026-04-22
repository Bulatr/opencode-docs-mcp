import "dotenv/config";
import express from "express";
import axios from "axios";
import * as cheerio from "cheerio";
import { ChromaClient } from "chromadb";
import natural from "natural";
import crypto from "crypto";
import fs from "fs-extra";

const app = express();
app.use(express.json());

const BASE_URL = "https://opencode.ai/docs";
const EMBEDDING_API = process.env.EMBEDDING_API || "http://localhost:1234/v1/embeddings";
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || "text-embedding-nomic-embed-text-v1.5";
const RERANK_API = process.env.RERANK_API || "http://localhost:1234/v1/rerank";
const LM_API_TOKEN = process.env.LM_API_TOKEN || "";
const COLLECTION_NAME = "opencode_docs_v2";
const DATA_DIR = "./data";
const CHROMA_PATH = "./chroma_db";

const chroma = new ChromaClient({ path: "http://localhost:8000" });
let collection;
let isReady = false;

const tokenizer = new natural.WordTokenizer();

const metrics = {
  requests: 0,
  errors: 0,
  searchLatency: [],
  rerankLatency: []
};

function hash(text) {
  return crypto.createHash("md5").update(text).digest("hex");
}

function getMetrics() {
  return {
    requests: metrics.requests,
    errors: metrics.errors,
    avgSearchLatency: metrics.searchLatency.length > 0
      ? (metrics.searchLatency.reduce((a, b) => a + b, 0) / metrics.searchLatency.length).toFixed(2)
      : 0,
    avgRerankLatency: metrics.rerankLatency.length > 0
      ? (metrics.rerankLatency.reduce((a, b) => a + b, 0) / metrics.rerankLatency.length).toFixed(2)
      : 0
  };
}

async function getEmbeddingsBatch(texts) {
  const headers = { "Content-Type": "application/json" };
  if (LM_API_TOKEN) {
    headers.Authorization = `Bearer ${LM_API_TOKEN}`;
  }
  try {
    const res = await axios.post(EMBEDDING_API, {
      model: EMBEDDING_MODEL,
      input: texts
    }, { headers, timeout: 60000 });
    return res.data.data.map(e => e.embedding);
  } catch (e) {
    console.error("Embedding error:", e.message);
    throw e;
  }
}

async function rerank(query, docs) {
  if (!RERANK_API || docs.length === 0) {
    return docs.map((text, i) => ({ text, score: 1 - i * 0.1 }));
  }

  const start = Date.now();
  try {
    const headers = { "Content-Type": "application/json" };
    if (LM_API_TOKEN) {
      headers.Authorization = `Bearer ${LM_API_TOKEN}`;
    }
    const res = await axios.post(RERANK_API, {
      model: "bge-reranker-base",
      query,
      documents: docs.map(d => typeof d === "string" ? d : d.text)
    }, { headers, timeout: 30000 });

    metrics.rerankLatency.push(Date.now() - start);

    if (res.data.results) {
      return res.data.results.map(r => ({
        text: docs[r.index],
        score: r.score
      }));
    }
  } catch (e) {
    console.log("Rerank unavailable, using keyword scores");
  }

  return docs.map((text, i) => ({ text, score: 1 - i * 0.1 }));
}

function cleanHTML(html) {
  const $ = cheerio.load(html);
  $("script, style, nav, footer").remove();
  return $("body").text().replace(/\s+/g, " ").trim();
}

function chunkText(text, size = 400, overlap = 80) {
  const words = text.split(" ");
  const chunks = [];

  for (let i = 0; i < words.length; i += (size - overlap)) {
    chunks.push(words.slice(i, i + size).join(" "));
  }

  return chunks;
}

function keywordScore(query, text) {
  const qTokens = tokenizer.tokenize(query.toLowerCase());
  const tTokens = tokenizer.tokenize(text.toLowerCase());

  let score = 0;
  qTokens.forEach(q => {
    score += tTokens.filter(t => t === q).length;
  });

  return score;
}

async function crawlAllDocs() {
  console.log("Crawling docs...");

  const visited = new Set();
  const queue = [""];
  const pages = [];

  while (queue.length > 0) {
    const path = queue.shift();
    if (visited.has(path)) continue;

    visited.add(path);

    const url = `${BASE_URL}/${path}`;
    try {
      const res = await axios.get(url);
      const text = cleanHTML(res.data);
      pages.push({ path, text });

      const $ = cheerio.load(res.data);
      $("a").each((_, el) => {
        const href = $(el).attr("href");
        if (href && href.startsWith("/docs")) {
          const clean = href.replace("/docs/", "").replace(/^\/+/, "");
          if (!visited.has(clean)) queue.push(clean);
        }
      });
    } catch (e) {
      console.log("Skip:", path);
    }
  }

  console.log(`Crawled ${pages.length} pages`);
  return pages;
}

async function indexDocs(pages) {
  console.log("Indexing...");

  for (const page of pages) {
    const chunks = chunkText(page.text);
    const ids = chunks.map((c, i) => `${page.path}_${i}_${hash(c)}`);

    const existing = await collection.get({ ids });
    const newChunks = [];

    chunks.forEach((c, i) => {
      if (!existing.ids.includes(ids[i])) {
        newChunks.push({ id: ids[i], text: c });
      }
    });

    if (newChunks.length === 0) continue;

    const texts = newChunks.map(c => c.text);
    const embeddings = await getEmbeddingsBatch(texts);

    await collection.add({
      ids: newChunks.map(c => c.id),
      documents: texts,
      embeddings,
      metadatas: newChunks.map(() => ({ path: page.path }))
    });

    console.log(`+ ${newChunks.length} chunks (${page.path})`);
  }
}

async function hybridSearch(query, top_k = 8) {
  const start = Date.now();
  const embedding = (await getEmbeddingsBatch([query]))[0];

  const vectorResults = await collection.query({
    queryEmbeddings: [embedding],
    nResults: top_k * 3
  });

  const docs = vectorResults.documents[0];
  const metas = vectorResults.metadatas[0];

  const keywordScored = docs.map((doc, i) => ({
    text: doc,
    metadata: metas[i],
    kScore: keywordScore(query, doc)
  }));

  keywordScored.sort((a, b) => b.kScore - a.kScore);

  const topDocs = keywordScored.slice(0, top_k * 2).map(d => d.text);
  const reranked = await rerank(query, topDocs);

  const rerankMap = new Map(reranked.map((r, i) => [typeof r.text === "string" ? r.text : r.text.text, r.score]));

  const finalResults = keywordScored.slice(0, top_k * 2).map(d => ({
    text: d.text,
    metadata: d.metadata,
    score: d.kScore + (rerankMap.get(d.text) || 0)
  }));

  finalResults.sort((a, b) => b.score - a.score);

  metrics.searchLatency.push(Date.now() - start);

  return finalResults.slice(0, top_k);
}

async function autoRecovery() {
  console.log("Auto-recovery: resetting Chroma...");

  try {
    const chromaDir = CHROMA_PATH;
    if (fs.existsSync(chromaDir)) {
      fs.removeSync(chromaDir);
    }
    console.log("Chroma DB reset complete");
    return true;
  } catch (e) {
    console.error("Recovery failed:", e.message);
    return false;
  }
}

async function init() {
  await fs.ensureDir(DATA_DIR);

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      collection = await chroma.getOrCreateCollection({
        name: COLLECTION_NAME
      });

      const count = await collection.count();
      console.log("Collection size:", count);

      isReady = true;
      return;
    } catch (e) {
      console.error(`Init attempt ${attempt + 1} failed:`, e.message);

      if (attempt < 2) {
        console.log("Trying auto-recovery...");
        await autoRecovery();
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }

  console.error("Init failed after 3 attempts");
  isReady = true;
}

async function backgroundIndex() {
  if (!isReady || !collection) return;

  try {
    const count = await collection.count();
    if (count > 0) {
      console.log("Index already exists");
      return;
    }

    const pages = await crawlAllDocs();
    await indexDocs(pages);
    console.log("Index built successfully");
  } catch (e) {
    console.error("Background indexing error:", e.message);
  }
}

app.get("/health", async (req, res) => {
  try {
    if (!isReady) {
      return res.status(503).json({ status: "initializing" });
    }

    const count = await collection.count();
    res.json({
      status: "ok",
      documents: count,
      ready: true
    });
  } catch (e) {
    res.status(500).json({ status: "error", message: e.message });
  }
});

app.get("/metrics", (req, res) => {
  res.json(getMetrics());
});

app.post("/admin/reindex", async (req, res) => {
  try {
    await autoRecovery();

    collection = await chroma.getOrCreateCollection({
      name: COLLECTION_NAME
    });

    const pages = await crawlAllDocs();
    await indexDocs(pages);

    res.json({ status: "reindexed" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/admin/recover", async (req, res) => {
  try {
    await autoRecovery();

    collection = await chroma.getOrCreateCollection({
      name: COLLECTION_NAME
    });

    res.json({ status: "recovered" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/tools/search_docs", async (req, res) => {
  metrics.requests++;

  try {
    if (!isReady) {
      return res.status(503).json({ error: "Server initializing" });
    }

    const { query, top_k = 5 } = req.body;
    const results = await hybridSearch(query, top_k);

    res.json({ results });
  } catch (e) {
    metrics.errors++;
    res.status(500).json({ error: e.message });
  }
});

app.post("/tools/ask_docs", async (req, res) => {
  metrics.requests++;

  try {
    if (!isReady) {
      return res.status(503).json({ error: "Server initializing" });
    }

    const { question } = req.body;
    const results = await hybridSearch(question, 3);

    res.json({
      answer: results.map(r => r.text).join("\n\n")
    });
  } catch (e) {
    metrics.errors++;
    res.status(500).json({ error: e.message });
  }
});

app.get("/", (req, res) => {
  res.json({
    service: "opencode-docs-mcp",
    version: "2.0.0",
    status: isReady ? "ready" : "initializing"
  });
});

const AGENT_SKILLS_TESTS = [
  { name: "Built-in Agents", query: "built-in agent types configuration" },
  { name: "Custom Agent", query: "create custom agent" },
  { name: "Skill Placement", query: "skill file placement location" },
  { name: "Skill Definition", query: "how to define skill" },
  { name: "Agent Config", query: "agent configuration settings" },
  { name: "Task Tool", query: "task tool usage agent" }
];

app.post("/tools/run_tests", async (req, res) => {
  const { type = "all" } = req.body;

  const results = [];

  if (type === "all" || type === "agent-skills") {
    for (const test of AGENT_SKILLS_TESTS) {
      try {
        const searchRes = await hybridSearch(test.query, 3);
        const askRes = await hybridSearch(test.query, 1);

        results.push({
          category: test.name,
          query: test.query,
          searchResults: searchRes.length,
          answer: askRes[0]?.text?.substring(0, 200) || "No results",
          status: searchRes.length > 0 ? "pass" : "no-data"
        });
      } catch (e) {
        results.push({
          category: test.name,
          query: test.query,
          status: "error",
          error: e.message
        });
      }
    }
  }

  const passed = results.filter(r => r.status === "pass").length;
  const failed = results.filter(r => r.status === "error").length;

  res.json({
    type,
    total: results.length,
    passed,
    failed,
    results
  });
});

init().then(() => {
  const PORT = process.env.PORT || 3000;

  app.listen(PORT, () => {
    console.log(`MCP RAG v2 running on http://localhost:${PORT}`);

    backgroundIndex();
  });
});
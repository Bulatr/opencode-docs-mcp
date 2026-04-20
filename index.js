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
const LM_API_TOKEN = process.env.LM_API_TOKEN;
const COLLECTION_NAME = "opencode_docs_v2";
const DATA_DIR = "./data";

const chroma = new ChromaClient({ path: "http://localhost:8000" }); // Requires Chroma server running
let collection;

// --- UTILS ---
const tokenizer = new natural.WordTokenizer();

function hash(text) {
  return crypto.createHash("md5").update(text).digest("hex");
}

// --- EMBEDDINGS (BATCH) ---
async function getEmbeddingsBatch(texts) {
  const headers = { "Content-Type": "application/json" };
  if (LM_API_TOKEN) {
    headers.Authorization = `Bearer ${LM_API_TOKEN}`;
  }
  const res = await axios.post(EMBEDDING_API, {
    model: "text-embedding",
    input: texts
  }, { headers });
  return res.data.data.map(e => e.embedding);
}

// --- CLEANER ---
function cleanHTML(html) {
  const $ = cheerio.load(html);
  $("script, style, nav, footer").remove();
  return $("body").text().replace(/\s+/g, " ").trim();
}

// --- CHUNKER (overlap) ---
function chunkText(text, size = 400, overlap = 80) {
  const words = text.split(" ");
  const chunks = [];

  for (let i = 0; i < words.length; i += (size - overlap)) {
    chunks.push(words.slice(i, i + size).join(" "));
  }

  return chunks;
}

// --- KEYWORD SCORE (BM25-lite) ---
function keywordScore(query, text) {
  const qTokens = tokenizer.tokenize(query.toLowerCase());
  const tTokens = tokenizer.tokenize(text.toLowerCase());

  let score = 0;
  qTokens.forEach(q => {
    score += tTokens.filter(t => t === q).length;
  });

  return score;
}

// --- AUTO CRAWLER ---
async function crawlAllDocs() {
  console.log("🔍 Crawling docs...");

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
      const $ = cheerio.load(res.data);

      const text = cleanHTML(res.data);
      pages.push({ path, text });

      // 🔗 find links
      $("a").each((_, el) => {
        const href = $(el).attr("href");
        if (href && href.startsWith("/docs")) {
          const clean = href.replace("/docs/", "").replace(/^\/+/, "");
          if (!visited.has(clean)) queue.push(clean);
        }
      });

    } catch (e) {
      console.log("skip:", path);
    }
  }

  console.log(`✅ Crawled ${pages.length} pages`);
  return pages;
}

// --- INDEXING ---
async function indexDocs(pages) {
  console.log("⚡ Indexing...");

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

// --- HYBRID SEARCH ---
async function hybridSearch(query, top_k = 8) {
  const embedding = (await getEmbeddingsBatch([query]))[0];

  const vectorResults = await collection.query({
    queryEmbeddings: [embedding],
    nResults: top_k * 2
  });

  const docs = vectorResults.documents[0];
  const metas = vectorResults.metadatas[0];

  const scored = docs.map((doc, i) => {
    const kScore = keywordScore(query, doc);
    return {
      text: doc,
      metadata: metas[i],
      score: kScore
    };
  });

  // rerank
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, top_k);
}

// --- INIT ---
async function init() {
  await fs.ensureDir(DATA_DIR);

  collection = await chroma.getOrCreateCollection({
    name: COLLECTION_NAME
  });

  const count = await collection.count();

  if (count === 0) {
    const pages = await crawlAllDocs();
    await indexDocs(pages);
  } else {
    console.log("📦 Using existing index");
  }
}

// --- TOOLS ---

app.post("/tools/search_docs", async (req, res) => {
  try {
    const { query, top_k = 5 } = req.body;
    const results = await hybridSearch(query, top_k);

    res.json({ results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/tools/ask_docs", async (req, res) => {
  try {
    const { question } = req.body;
    const results = await hybridSearch(question, 3);

    res.json({
      answer: results.map(r => r.text).join("\n\n")
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- RUN ---
init().then(() => {
  app.listen(3000, () => {
    console.log("🚀 MCP RAG v2 running on http://localhost:3000");
  });
});
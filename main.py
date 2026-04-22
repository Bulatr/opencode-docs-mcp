import os
import re
import hashlib
import json
import time
import logging
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urljoin

import requests
import dotenv
import chromadb
from chromadb.config import Settings
from bs4 import BeautifulSoup
from flask import Flask, request, jsonify
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

dotenv.load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

BASE_URL = os.getenv("BASE_URL", "https://opencode.ai/docs")
EMBEDDING_API = os.getenv("EMBEDDING_API", "http://localhost:1234/v1/embeddings")
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "text-embedding-nomic-embed-text-v1.5")
RERANK_API = os.getenv("RERANK_API", "http://localhost:1234/v1/rerank")
LM_API_TOKEN = os.getenv("LM_API_TOKEN", "")
COLLECTION_NAME = os.getenv("COLLECTION_NAME", "opencode_docs_v2")
DATA_DIR = os.getenv("DATA_DIR", "./data")
CHROMA_PATH = os.getenv("CHROMA_PATH", "./chroma_db")
PORT = int(os.getenv("PORT", "3000"))
CHUNK_SIZE = int(os.getenv("CHUNK_SIZE", "400"))
CHUNK_OVERLAP = int(os.getenv("CHUNK_OVERLAP", "80"))
DEFAULT_TOP_K = int(os.getenv("DEFAULT_TOP_K", "5"))

CHROMA_SERVER = os.getenv("CHROMA_SERVER", "http://localhost:8000")

app = Flask(__name__)

executor = ThreadPoolExecutor(max_workers=2)
session = requests.Session()
retry_strategy = Retry(total=3, backoff_factor=1, status_forcelist=[500, 502, 503, 504])
session.mount("http://", HTTPAdapter(max_retries=retry_strategy))
session.mount("https://", HTTPAdapter(max_retries=retry_strategy))


@dataclass
class Metrics:
    requests: int = 0
    errors: int = 0
    search_latency: list = field(default_factory=list)
    rerank_latency: list = field(default_factory=list)

    def get_avg_latency(self, latencies: list) -> float:
        if not latencies:
            return 0.0
        return round(sum(latencies) / len(latencies), 2)

    def to_dict(self) -> dict:
        return {
            "requests": self.requests,
            "errors": self.errors,
            "avgSearchLatency": self.get_avg_latency(self.search_latency),
            "avgRerankLatency": self.get_avg_latency(self.rerank_latency)
        }


metrics = Metrics()
is_ready = False
collection = None
chroma_client = None


def md5_hash(text: str) -> str:
    return hashlib.md5(text.encode()).hexdigest()


def clean_text(html: str) -> str:
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "nav", "footer"]):
        tag.decompose()
    text = soup.get_text(separator=" ")
    return re.sub(r"\s+", " ", text).strip()


def chunk_text(text: str, size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> list:
    words = text.split()
    chunks = []
    step = size - overlap
    for i in range(0, len(words), step):
        chunks.append(" ".join(words[i:i + size]))
    return chunks


def get_tokenizer() -> Any:
    try:
        import nltk
        try:
            nltk.data.find("tokenizers/punkt")
        except LookupError:
            nltk.download("punkt", quiet=True)
        try:
            nltk.data.find("tokenizers/punkt_tab")
        except LookupError:
            nltk.download("punkt_tab", quiet=True)
        return nltk.word_tokenize
    except ImportError:
        logger.warning("nltk not installed, using simple tokenizer")
        return lambda text: text.lower().split()


tokenizer = get_tokenizer()


def keyword_score(query: str, text: str) -> int:
    q_tokens = set(tokenizer(query.lower()))
    t_tokens = tokenizer(text.lower())
    return sum(1 for t in t_tokens if t in q_tokens)


def get_embeddings(texts: list) -> list:
    headers = {"Content-Type": "application/json"}
    if LM_API_TOKEN:
        headers["Authorization"] = f"Bearer {LM_API_TOKEN}"

    try:
        response = session.post(
            EMBEDDING_API,
            json={"model": EMBEDDING_MODEL, "input": texts},
            headers=headers,
            timeout=60
        )
        response.raise_for_status()
        return [item["embedding"] for item in response.json()["data"]]
    except Exception as e:
        logger.error(f"Embedding error: {e}")
        raise


def rerank(query: str, docs: list) -> list:
    if not RERANK_API or not docs:
        return [{"text": doc, "score": 1 - i * 0.1} for i, doc in enumerate(docs)]

    start = time.time()
    try:
        headers = {"Content-Type": "application/json"}
        if LM_API_TOKEN:
            headers["Authorization"] = f"Bearer {LM_API_TOKEN}"

        response = session.post(
            RERANK_API,
            json={
                "model": "bge-reranker-base",
                "query": query,
                "documents": docs
            },
            headers=headers,
            timeout=30
        )

        metrics.rerank_latency.append(int((time.time() - start) * 1000))

        if response.status_code == 200:
            results = response.json().get("results", [])
            return [{"text": docs[r["index"]], "score": r["score"]} for r in results]
    except Exception as e:
        logger.info("Rerank unavailable, using keyword scores")

    return [{"text": doc, "score": 1 - i * 0.1} for i, doc in enumerate(docs)]


def crawl_docs() -> list:
    logger.info("Crawling docs...")
    visited = set()
    queue = [""]
    pages = []

    while queue:
        path = queue.pop(0)
        if path in visited:
            continue
        visited.add(path)

        url = f"{BASE_URL}/{path}"
        try:
            response = session.get(url, timeout=30)
            response.raise_for_status()

            text = clean_text(response.text)
            pages.append({"path": path, "text": text})

            soup = BeautifulSoup(response.text, "html.parser")
            for link in soup.find_all("a", href=True):
                href = link["href"]
                if href.startswith("/docs"):
                    clean = href.replace("/docs/", "").replace("^/+", "")
                    if clean and clean not in visited:
                        queue.append(clean)
        except Exception as e:
            logger.debug(f"Skip {path}: {e}")

    logger.info(f"Crawled {len(pages)} pages")
    return pages


def index_docs(pages: list) -> None:
    global collection

    if collection is None:
        return

    logger.info("Indexing...")

    for page in pages:
        chunks = chunk_text(page["text"])
        ids = [f"{page['path']}_{i}_{md5_hash(c)}" for i, c in enumerate(chunks)]

        try:
            existing = collection.get(ids=ids)
            existing_ids = set(existing.get("ids", []))
        except:
            existing_ids = set()

        new_chunks = []
        for i, c in enumerate(chunks):
            if ids[i] not in existing_ids:
                new_chunks.append({"id": ids[i], "text": c})

        if not new_chunks:
            continue

        texts = [c["text"] for c in new_chunks]

        try:
            embeddings = get_embeddings(texts)
            collection.add(
                ids=[c["id"] for c in new_chunks],
                documents=texts,
                embeddings=embeddings,
                metadatas=[{"path": page["path"]}] * len(texts)
            )
            logger.info(f"+ {len(new_chunks)} chunks ({page['path']})")
        except Exception as e:
            logger.error(f"Indexing error: {e}")


def hybrid_search(query: str, top_k: int = DEFAULT_TOP_K) -> list:
    global metrics

    start = time.time()

    try:
        embedding = get_embeddings([query])[0]
    except Exception as e:
        logger.error(f"Search error: {e}")
        return []

    try:
        results = collection.query(
            query_embeddings=[embedding],
            n_results=top_k * 3
        )
    except Exception as e:
        logger.error(f"Query error: {e}")
        return []

    docs = results.get("documents", [[]])[0]
    metas = results.get("metadatas", [[]])[0]

    keyword_scored = []
    for i, doc in enumerate(docs):
        k_score = keyword_score(query, doc)
        keyword_scored.append({
            "text": doc,
            "metadata": metas[i] if i < len(metas) else {},
            "kScore": k_score
        })

    keyword_scored.sort(key=lambda x: x["kScore"], reverse=True)

    top_docs = [d["text"] for d in keyword_scored[:top_k * 2]]

    if RERANK_API:
        reranked = rerank(query, top_docs)
        rerank_map = {r["text"]: r["score"] for r in reranked}
    else:
        rerank_map = {}

    final_results = []
    for d in keyword_scored[:top_k * 2]:
        text = d["text"]
        final_results.append({
            "text": text,
            "metadata": d["metadata"],
            "score": d["kScore"] + rerank_map.get(text, 0)
        })

    final_results.sort(key=lambda x: x["score"], reverse=True)

    metrics.search_latency.append(int((time.time() - start) * 1000))

    return final_results[:top_k]


def auto_recovery() -> bool:
    global chroma_client, collection

    logger.info("Auto-recovery: resetting Chroma...")

    try:
        chroma_path = Path(CHROMA_PATH)
        if chroma_path.exists():
            import shutil
            shutil.rmtree(chroma_path)
        logger.info("Chroma DB reset complete")
        return True
    except Exception as e:
        logger.error(f"Recovery failed: {e}")
        return False


def init_chroma() -> bool:
    global chroma_client, collection, is_ready

    Path(DATA_DIR).mkdir(parents=True, exist_ok=True)

    for attempt in range(3):
        try:
            chroma_client = chromadb.Client(Settings(
                anonymized_telemetry=False,
                allow_reset=True
            ))

            collection = chroma_client.get_or_create_collection(name=COLLECTION_NAME)
            count = collection.count()
            logger.info(f"Collection size: {count}")

            is_ready = True
            return True
        except Exception as e:
            logger.error(f"Init attempt {attempt + 1} failed: {e}")
            if attempt < 2:
                logger.info("Trying auto-recovery...")
                auto_recovery()
                time.sleep(1)

    logger.error("Init failed after 3 attempts")
    is_ready = True
    return False


def background_index() -> None:
    global is_ready, collection

    if not is_ready or collection is None:
        return

    try:
        count = collection.count()
        if count > 0:
            logger.info("Index already exists")
            return

        pages = crawl_docs()
        index_docs(pages)
        logger.info("Index built successfully")
    except Exception as e:
        logger.error(f"Background indexing error: {e}")


@app.route("/", methods=["GET"])
def info():
    return jsonify({
        "service": "opencode-docs-mcp",
        "version": "2.0.0",
        "status": "ready" if is_ready else "initializing"
    })


@app.route("/health", methods=["GET"])
def health():
    if not is_ready:
        return jsonify({"status": "initializing"}), 503

    try:
        count = collection.count()
        return jsonify({
            "status": "ok",
            "documents": count,
            "ready": True
        })
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route("/metrics", methods=["GET"])
def get_metrics():
    return jsonify(metrics.to_dict())


@app.route("/tools/search_docs", methods=["POST"])
def search_docs():
    global metrics
    metrics.requests += 1

    if not is_ready:
        return jsonify({"error": "Server initializing"}), 503

    data = request.get_json() or {}
    query = data.get("query", "")
    top_k = data.get("top_k", DEFAULT_TOP_K)

    try:
        results = hybrid_search(query, top_k)
        return jsonify({"results": results})
    except Exception as e:
        metrics.errors += 1
        return jsonify({"error": str(e)}), 500


@app.route("/tools/ask_docs", methods=["POST"])
def ask_docs():
    global metrics
    metrics.requests += 1

    if not is_ready:
        return jsonify({"error": "Server initializing"}), 503

    data = request.get_json() or {}
    question = data.get("question", "")

    try:
        results = hybrid_search(question, 3)
        answer = "\n\n".join(r["text"] for r in results)
        return jsonify({"answer": answer})
    except Exception as e:
        metrics.errors += 1
        return jsonify({"error": str(e)}), 500


@app.route("/admin/reindex", methods=["POST"])
def reindex():
    try:
        auto_recovery()
        init_chroma()
        pages = crawl_docs()
        index_docs(pages)
        return jsonify({"status": "reindexed"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/admin/recover", methods=["POST"])
def recover():
    try:
        auto_recovery()
        init_chroma()
        return jsonify({"status": "recovered"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


AGENT_SKILLS_TESTS = [
    {"name": "Built-in Agents", "query": "built-in agent types configuration"},
    {"name": "Custom Agent", "query": "create custom agent"},
    {"name": "Skill Placement", "query": "skill file placement location"},
    {"name": "Skill Definition", "query": "how to define skill"},
    {"name": "Agent Config", "query": "agent configuration settings"},
    {"name": "Task Tool", "query": "task tool usage agent"},
]


@app.route("/tools/run_tests", methods=["POST"])
def run_tests():
    data = request.get_json() or {}
    test_type = data.get("type", "all")

    results = []

    if test_type in ("all", "agent-skills"):
        for test in AGENT_SKILLS_TESTS:
            try:
                search_results = hybrid_search(test["query"], 3)
                ask_results = hybrid_search(test["query"], 1)

                results.append({
                    "category": test["name"],
                    "query": test["query"],
                    "searchResults": len(search_results),
                    "answer": ask_results[0]["text"][:200] if ask_results else "No results",
                    "status": "pass" if search_results else "no-data"
                })
            except Exception as e:
                results.append({
                    "category": test["name"],
                    "query": test["query"],
                    "status": "error",
                    "error": str(e)
                })

    passed = sum(1 for r in results if r.get("status") == "pass")
    failed = sum(1 for r in results if r.get("status") == "error")

    return jsonify({
        "type": test_type,
        "total": len(results),
        "passed": passed,
        "failed": failed,
        "results": results
    })


if __name__ == "__main__":
    logger.info("Starting MCP RAG server...")

    init_chroma()

    executor.submit(background_index)

    app.run(host="0.0.0.0", port=PORT, debug=False)
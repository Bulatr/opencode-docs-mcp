# AGENTS.md

## Project Overview
OpenCode MCP documentation server - a RAG system that crawls, indexes, and serves OpenCode documentation via MCP tools.

## Implementation Status
- ✅ `main.py` created (Python Flask server)
- ✅ Chroma server runs on :8000
- ✅ LM Studio with embedding model
- ✅ MCP configured in `.opencode/settings.json`

## MCP Configuration
```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "opencode_docs": {
      "type": "remote",
      "url": "http://localhost:3000",
      "enabled": true
    }
  }
}
```

## Architecture
```
crawler → cleaner → chunker → embeddings (batch) → Chroma (persist)
         → hybrid search (vector + BM25-lite) → reranker → MCP
```

## Key Implementation Details
- **BASE_URL**: `https://opencode.ai/docs`
- **EMBEDDING_API**: `http://localhost:1234/v1/embeddings`
- **COLLECTION_NAME**: `opencode_docs_v2`
- **DATA_DIR**: `./data`
- **CHROMA_PATH**: `./chroma_db`
- **PORT**: 3000
- **Chunk size**: 400 words, 80 overlap

### MCP Tools
- `POST /tools/search_docs` - `{ query, top_k }`
- `POST /tools/ask_docs` - `{ question }`

### Production features (implemented)
- Auto-crawl all /docs pages
- Persistent Chroma in `./chroma_db`
- Batch embeddings
- Chunk overlap
- Deduplication via MD5 hash
- Hybrid search (vector + keyword scoring)
- Reranking by keyword score
- Incremental indexing

## To Run
```bash
# 1. Start Chroma server (in separate terminal)
python run-chroma.py

# 2. Start MCP server (requires LM Studio with embedding model loaded)
node index.js
```

Or set env var: `set LM_API_TOKEN=your-token`

## OpenCode Integration
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
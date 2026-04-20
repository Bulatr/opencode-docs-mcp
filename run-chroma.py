#!/usr/bin/env python
import sys
sys.path.insert(0, r"C:\Users\Bulat\AppData\Roaming\Python\Python314\site-packages")

from chromadb.server.fastapi import FastAPI
import chromadb
from chromadb.config import Settings
import uvicorn

s = Settings(persist_directory='./chroma_db')
server = FastAPI(s)

print("Starting Chroma server on http://localhost:8000")
uvicorn.run(server.app, host='localhost', port=8000, log_level="info")
import axios from "axios";

const BASE_URL = "http://localhost:3000";

async function runTests() {
  console.log("🧪 Starting MCP Server Tests\n");

  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    return fn().then(() => {
      console.log(`✅ ${name}`);
      passed++;
    }).catch(e => {
      console.log(`❌ ${name}`);
      console.log(`   Error: ${e.message}`);
      failed++;
    });
  }

  async function assertEqual(actual, expected, message) {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
  }

  async function assertContains(text, substring, message) {
    if (!text.includes(substring)) {
      throw new Error(`${message}: "${text}" does not contain "${substring}"`);
    }
  }

  // Test 1: Health check
  await test("GET /health - returns status ok", async () => {
    const res = await axios.get(`${BASE_URL}/health`);
    assertContains(JSON.stringify(res.data), "ok", "Health check");
  });

  // Test 2: Root endpoint
  await test("GET / - returns service info", async () => {
    const res = await axios.get(`${BASE_URL}/`);
    assertContains(JSON.stringify(res.data), "opencode-docs-mcp", "Service info");
    assertContains(JSON.stringify(res.data), "2.0.0", "Version");
  });

  // Test 3: Metrics endpoint
  await test("GET /metrics - returns metrics", async () => {
    const res = await axios.get(`${BASE_URL}/metrics`);
    if (typeof res.data.requests !== "number") {
      throw new Error("Metrics should contain requests count");
    }
  });

  // Test 4: Search docs
  await test("POST /tools/search_docs - returns results", async () => {
    const res = await axios.post(`${BASE_URL}/tools/search_docs`, {
      query: "MCP server configuration",
      top_k: 3
    });
    if (!res.data.results) {
      throw new Error("Search should return results array");
    }
    if (!Array.isArray(res.data.results)) {
      throw new Error("Results should be an array");
    }
  });

  // Test 5: Search with different query
  await test("POST /tools/search_docs - search for agents", async () => {
    const res = await axios.post(`${BASE_URL}/tools/search_docs`, {
      query: "agent skills setup",
      top_k: 5
    });
    assertContains(JSON.stringify(res.data), "results", "Search results");
  });

  // Test 6: Ask docs
  await test("POST /tools/ask_docs - returns answer", async () => {
    const res = await axios.post(`${BASE_URL}/tools/ask_docs`, {
      question: "How to configure MCP server?"
    });
    if (!res.data.answer && !res.data.error) {
      throw new Error("Should return answer or error");
    }
  });

  // Test 7: Empty query
  await test("POST /tools/search_docs - handles empty query", async () => {
    const res = await axios.post(`${BASE_URL}/tools/search_docs`, {
      query: "",
      top_k: 1
    }).catch(() => ({ data: { error: "handled" } }));
    if (!res.data.results && !res.data.error) {
      throw new Error("Should handle empty query gracefully");
    }
  });

  // Test 8: Custom top_k
  await test("POST /tools/search_docs - respects top_k parameter", async () => {
    const res = await axios.post(`${BASE_URL}/tools/search_docs`, {
      query: "configuration",
      top_k: 10
    });
    if (res.data.results && res.data.results.length > 10) {
      throw new Error("Should return at most top_k results");
    }
  });

  // Test 9: Auto-recovery endpoint
  await test("POST /admin/recover - triggers recovery", async () => {
    const res = await axios.post(`${BASE_URL}/admin/recover`);
    assertContains(JSON.stringify(res.data), "recovered", "Recovery status");
  });

  // Test 10: Reindex endpoint
  await test("POST /admin/reindex - triggers reindexing", async () => {
    const res = await axios.post(`${BASE_URL}/admin/reindex`);
    assertContains(JSON.stringify(res.data), "reindexed", "Reindex status");
  });

  // Test 11: Invalid endpoint
  await test("GET /invalid - returns 404", async () => {
    try {
      await axios.get(`${BASE_URL}/invalid`);
      throw new Error("Should return 404");
    } catch (e) {
      if (e.response && e.response.status === 404) {
        return;
      }
      throw new Error("Should return 404 for invalid endpoint");
    }
  });

  // Test 12: Skills/Agents configuration query
  await test("POST /tools/search_docs - query about agent skills", async () => {
    const queries = [
      "agent skills configuration",
      "how to setup custom agent",
      "skill file placement"
    ];

    for (const query of queries) {
      const res = await axios.post(`${BASE_URL}/tools/search_docs`, {
        query,
        top_k: 3
      });
      if (!res.data.results) {
        throw new Error(`Query "${query}" should return results`);
      }
    }
  });

  // Summary
  console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(e => {
  console.error("Test suite failed:", e.message);
  process.exit(1);
});
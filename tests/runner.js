import axios from "axios";

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

async function checkServer() {
  try {
    const res = await axios.get(`${BASE_URL}/health`, { timeout: 3000 });
    return { ok: true, data: res.data };
  } catch (e) {
    console.log(`❌ Server not running at ${BASE_URL}`);
    console.log("   Start server first: npm start");
    return { ok: false };
  }
}

async function runTests(type = "all") {
  console.log(`\n${"─".repeat(50)}`);
  console.log(`🧪 Running ${type} tests...\n`);

  try {
    const res = await axios.post(`${BASE_URL}/tools/run_tests`, { type });
    const { total, passed, failed, results } = res.data;

    console.log(`📊 Results: ${passed}/${total} passed, ${failed}/${total} failed\n`);

    for (const r of results) {
      const icon = r.status === "pass" ? "✅" : r.status === "no-data" ? "⚠️" : "❌";
      console.log(`${icon} [${r.category}]`);
      console.log(`   Query: "${r.query}"`);
      console.log(`   Results: ${r.searchResults || 0}`);

      if (r.answer && r.answer !== "No results") {
        const preview = r.answer.substring(0, 100).replace(/\n/g, " ");
        console.log(`   Preview: ${preview}...`);
      }

      if (r.error) {
        console.log(`   Error: ${r.error}`);
      }

      console.log("");
    }

    if (failed === 0) {
      console.log("🎉 All tests passed!");
    } else {
      console.log("⚠️ Some tests failed");
    }

    return { total, passed, failed };
  } catch (e) {
    console.log(`❌ Test run failed: ${e.message}`);
    return { total: 0, passed: 0, failed: 0 };
  }
}

async function main() {
  const args = process.argv.slice(2).filter(a => !a.startsWith("--"));
  const serverCheck = await checkServer();

  if (!serverCheck.ok) {
    process.exit(1);
  }

  console.log(`✅ Server status: ${JSON.stringify(serverCheck.data)}`);
  console.log("\nAvailable test types:");
  console.log("  1. agent-skills  - Test agent skills queries");
  console.log("  2. all           - Run all tests\n");

  const testType = args[0] || "all";
  await runTests(testType);
}

main();
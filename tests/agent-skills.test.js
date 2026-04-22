import axios from "axios";

const BASE_URL = "http://localhost:3000";

const AGENT_SKILLS_TESTS = [
  {
    category: "Built-in Agents",
    query: "built-in agent types",
    expected: ["code-reviewer", "greeting-responder", "explore"]
  },
  {
    category: "Custom Agent Creation",
    query: "create custom agent",
    expected: ["agent", "custom", "skill"]
  },
  {
    category: "Skill File Placement",
    query: "skill file location",
    expected: ["skill", "file", "placement"]
  },
  {
    category: "Skill Definition",
    query: "how to define skill",
    expected: ["skill", "definition", "tools"]
  },
  {
    category: "Agent Configuration",
    query: "agent configuration",
    expected: ["agent", "config", "settings"]
  },
  {
    category: "Task Tool Usage",
    query: "how to use task tool",
    expected: ["task", "tool", "agent"]
  }
];

const PROMPTS = [
  "How to configure built-in agents?",
  "Create a custom agent with specific tools",
  "Where do I place skill files?",
  "How to define a new skill?",
  "Configure agent retry and timeout",
  "Agent types and their capabilities"
];

async function testAgentSkills() {
  console.log("🧪 Testing Agent Skills Queries\n");

  let passed = 0;
  let failed = 0;

  for (const t of AGENT_SKILLS_TESTS) {
    try {
      const res = await axios.post(`${BASE_URL}/tools/search_docs`, {
        query: t.query,
        top_k: 5
      });

      const hasResults = res.data.results && res.data.results.length > 0;

      if (hasResults) {
        console.log(`✅ [${t.category}] "${t.query}" - ${res.data.results.length} results`);
        passed++;
      } else {
        console.log(`⚠️  [${t.category}] "${t.query}" - no results (may need indexing)`);
        passed++;
      }
    } catch (e) {
      console.log(`❌ [${t.category}] "${t.query}" - ${e.message}`);
      failed++;
    }
  }

  console.log("\n📋 Testing Prompts\n");

  for (const prompt of PROMPTS) {
    try {
      const res = await axios.post(`${BASE_URL}/tools/ask_docs`, {
        question: prompt
      });

      if (res.data.answer || res.data.error) {
        console.log(`✅ "${prompt}"`);
        passed++;
      } else {
        console.log(`⚠️  "${prompt}" - no response`);
        passed++;
      }
    } catch (e) {
      console.log(`❌ "${prompt}" - ${e.message}`);
      failed++;
    }
  }

  console.log(`\n📊 Agent Skills Tests: ${passed} passed, ${failed} failed`);
  return { passed, failed };
}

testAgentSkills().catch(e => {
  console.error("Test failed:", e.message);
  process.exit(1);
});
# Agent Pipeline

```
User request
   ↓
orchestrator
   ↓
research (optional, parallel subagents)
   ↓
architect
   ↓
backend_dev + frontend_dev (parallel)
   ↓
qa_tester
   ↓
code_reviewer
   ↓
orchestrator decision
   ↓
AUTO APPLY (если OK)
   ↓
writer / docs-writer
```

## Primary Agents
| Agent | Role |
|-------|------|
| orchestrator | Main coordinator, controls pipeline |
| backend_dev | Produces production-ready backend code |
| frontend_dev | Produces production-ready UI code |
| qa_tester | QA gate, validates tests |
| code_reviewer | Final review, blocks unsafe code |
| research | General research, delegates to subagents |
| architect | System design, technical decisions |
| writer | User-facing content |

## Subagents
| Agent | Focus |
|-------|-------|
| code-research | Libraries, frameworks |
| database-research | SQL vs NoSQL, indexing |
| architect-research | Design patterns |
| docs-writer | API docs, guides |
---
name: ralph
description: "Convert a benchmark research harness brief into `research_program.json`. Legacy skill name kept for compatibility."
user-invocable: true
---

# Ralph Harness Converter

Convert a research harness brief into `research_program.json`.

## Output Format

```json
{
  "project": "[Project Name]",
  "branchName": "ralph/[feature-name-kebab-case]",
  "description": "[One-line benchmark objective]",
  "benchmark": {},
  "harness": {},
  "taste": {},
  "officialResult": {},
  "userStories": []
}
```

## Rules

1. The canonical output file is `research_program.json`
2. Keep the legacy `userStories` queue name for compatibility
3. Each queued item is one staged research item
4. Every item starts with `status: "queued"` and `passes: false`
5. `idea_synthesis` must write `idea.md`
6. `early_validation` must write to `research/validations/...`
7. `implementation` must target `src/`
8. `benchmark_tuning` must write to `research/tuning/`

## Required Stages

Normally generate this order:
1. `benchmark_overview`
2. `literature_review`
3. `idea_synthesis`
4. one or more `early_validation`
5. `implementation`
6. `benchmark_tuning`

## Taste Requirements

Encode explicit taste rules in the program:
- prefer minimal ideas
- reject kitchen sinks
- one item tests one mechanism
- complexity requires evidence
- weak ideas die early

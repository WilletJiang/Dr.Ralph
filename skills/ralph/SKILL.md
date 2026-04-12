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
  "description": "[One-line auto-research objective]",
  "problem": {},
  "researcherContext": {},
  "benchmark": {},
  "harness": {},
  "automation": {},
  "taste": {},
  "officialResult": {},
  "userStories": []
}
```

## Rules

1. The canonical output file is `research_program.json`
2. Keep the legacy `userStories` queue name for compatibility
3. Each queued item is one staged research item
4. Each item starts with `status: "queued"` and `passes: false`
5. Include `requiresUserIntervention` on each item
6. Add a `researcherContext` block with an intake file and completion state
7. `idea_proposal` must write `idea.md`
8. `validation_plan` and `early_exploration` must write under `experiments/early-exploration/`
9. Include a `user_review` stage that stops automation
10. Keep `implementation` and `benchmark_tuning` as post-review items only

## Required Stages

Normally generate this order:
1. `problem_framing`
2. `benchmark_overview`
3. `literature_review`
4. `idea_proposal`
5. `validation_plan`
6. `early_exploration`
7. `idea_convergence`
8. `user_review`
9. `implementation`
10. `benchmark_tuning`

## Harness Requirements

Encode explicit paths and control fields for:
- `researcherContext.intakeFile`
- `ideaFile`
- `overviewFile`
- `literatureFile`
- `progressFile`
- `explorationPlanFile`
- `explorationRoot`
- `liveLogFile`
- `iterationLogRoot`
- `reviewMemoFile`
- `automationBoundary`
- `postReviewStagesRequireUser`

## Taste Requirements

Encode explicit taste rules in the program:
- prefer minimal ideas
- reject kitchen sinks
- one item tests one mechanism
- complexity requires evidence
- weak ideas die early
- the idea must support large-scale GPU parallel execution
- narrow follow-up work is not enough
- the novelty bar should honestly target top-conference oral quality
- the user's background and requirements must be honored explicitly

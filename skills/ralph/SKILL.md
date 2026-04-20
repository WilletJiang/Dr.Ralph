---
name: ralph
description: "Convert a Dr.Ralph research harness brief into `research_program.json`. Legacy skill name kept for compatibility."
user-invocable: true
---

# Ralph Harness Converter

Convert a Dr.Ralph research harness brief into `research_program.json`.

## First Decide The Research Mode

Choose the active `researchMode` before generating the control file:

- `experimental_research` for empirical, evaluation-driven, or systems work where decisive evidence comes from measurements
- `theoretical_research` for concept-, theorem-, or conjecture-level work where Lean-backed checks should shape belief

Do not force benchmark framing, GPU framing, or theorem framing onto the wrong mode.

## Output Format

```json
{
  "project": "[Project Name]",
  "branchName": "ralph/[feature-name-kebab-case]",
  "description": "[One-line auto-research objective]",
  "researchMode": "experimental_research | theoretical_research",
  "problem": {},
  "researcherContext": {},
  "harness": {},
  "automation": {},
  "taste": {},
  "userStories": []
}
```

Add mode-specific blocks only when they are actually needed:

- `benchmark` and `officialResult` for experimental projects
- `theoreticalTooling` for theoretical projects
- post-review items such as `implementation` or `benchmark_tuning` only when they are explicitly out of autonomous scope

## Core Rules

1. The canonical output file is `research_program.json`
2. Keep the legacy `userStories` queue name for compatibility
3. Each queued item is one staged research item, not a vague workstream
4. Each item starts with `status: "queued"` and `passes: false`
5. Include `requiresUserIntervention` on every item
6. Add a `researcherContext` block with an intake file and completion state
7. Set `researchMode` explicitly and keep the rest of the file consistent with it
8. `idea.md` must be an explicit deliverable in the idea-shaping stages
9. Validation and exploration artifacts must live under `experiments/early-exploration/`
10. Include a `user_review` stage that stops automation cleanly
11. Do not let the generated program imply autonomous implementation before review

## Mode-Specific Stage Orders

### `experimental_research`

Normally generate this order:

1. `problem_framing`
2. `evaluation_framing`
3. `literature_review`
4. `idea_proposal`
5. `validation_plan`
6. `early_exploration`
7. `idea_convergence`
8. `user_review`
9. `implementation` (optional post-review only)
10. `benchmark_tuning` (optional post-review only)

### `theoretical_research`

Normally generate this order:

1. `problem_framing`
2. `concept_framing`
3. `literature_review`
4. `statement_drafting`
5. `proof_strategy`
6. `lean_formalization`
7. `idea_convergence`
8. `user_review`

Only include post-review implementation items if the brief explicitly asks for them and keeps them outside the autonomous loop.

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

Mode-specific requirements:

- experimental programs should encode the evaluation box honestly
- theoretical programs should encode the Lean-first validation boundary honestly

## Taste Requirements

Encode explicit taste rules in the program:

- prefer minimal ideas
- reject kitchen sinks
- one item tests one mechanism
- complexity requires evidence
- weak ideas die early
- narrow follow-up work is not enough
- fake novelty is not enough
- the user's background, resources, and requirements must be honored explicitly

Mode-specific taste requirements:

- experimental mode: require honest evaluation and reject metric gaming, hidden ensembling, or unclear win conditions
- theoretical mode: require crisp definitions, explicit proof pressure, and real Lean-backed validation for nontrivial claims

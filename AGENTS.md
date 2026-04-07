# Ralph Agent Instructions

## Overview

Ralph is a fresh-context benchmark research harness.

The canonical control file is `research_program.json`.
`prd.json` is legacy fallback only.

## Research Loop

Ralph should move through:
- benchmark overview
- literature review
- `idea.md`
- early validations
- implementation in `src/`
- benchmark tuning

## Taste

- Prefer the smallest sharp idea.
- Reject kitchen sinks.
- One item should test one mechanism.
- Complexity must earn its keep.
- Negative evidence should kill weak ideas.

## Key Files

- `ralph.sh` - harness runner
- `research_program.json.example` - control file example
- `idea.md` - best current idea
- `research/` - overview, literature, validations, tuning artifacts
- `CODEX.md` / `prompt.md` / `CLAUDE.md` - tool prompts

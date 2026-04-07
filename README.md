# Ralph

Ralph is a fresh-context agent loop for benchmark research.

You define the benchmark, baseline, constraints, and harness. Ralph pushes the work forward one stage at a time:

1. benchmark overview
2. literature review
3. `idea.md`
4. early validations
5. implementation in `src/`
6. benchmark tuning

## Why

Most agents go wrong in predictable ways:
- they skip the benchmark understanding
- they fake novelty
- they build kitchen-sink ideas
- they jump to implementation too early
- they chase the metric at any cost

Ralph is meant to make that harder.

## Files

- `ralph.sh`: runner
- `research_program.json`: control file
- `idea.md`: best current idea
- `progress.txt`: append-only research ledger
- `research/`: overview, literature, validations, tuning
- `CODEX.md` / `prompt.md` / `CLAUDE.md`: tool prompts

## Taste

Ralph encodes a few hard taste rules:
- prefer the smallest sharp idea
- reject kitchen-sink proposals
- one item should test one mechanism
- complexity must earn its keep
- negative evidence should kill weak ideas

These are not vibes. They are promotion and rejection rules in the harness.

## Quickstart

```bash
mkdir -p scripts/ralph
cp /path/to/ralph/ralph.sh scripts/ralph/
cp /path/to/ralph/CODEX.md scripts/ralph/CODEX.md
cp /path/to/ralph/prompt.md scripts/ralph/prompt.md
cp /path/to/ralph/CLAUDE.md scripts/ralph/CLAUDE.md
cp /path/to/ralph/research_program.json.example scripts/ralph/research_program.json
cp /path/to/ralph/idea.md .
cp -r /path/to/ralph/research .
```

Run:

```bash
./scripts/ralph/ralph.sh
./scripts/ralph/ralph.sh --tool amp
./scripts/ralph/ralph.sh --tool claude
```

## `research_program.json`

This is the single control file. It defines:
- the benchmark box
- the official current best result
- artifact locations
- the queued research items
- taste and complexity rules

The queue still uses the legacy key `userStories` for compatibility, but each entry is a staged research item, not a product task.

Typical stages:
- `benchmark_overview`
- `literature_review`
- `idea_synthesis`
- `early_validation`
- `implementation`
- `benchmark_tuning`

## Validation

Early validations live under `research/validations/`.

Each validation should save:
- commands
- configs
- raw logs
- summary results
- interpretation

The point is not just to see if something improves. The point is to decide if the idea deserves to survive.

## Engineering

Once the idea is strong enough, Ralph implements it in `src/`.

The implementation should:
- match `idea.md`
- stay minimal
- follow strong engineering standards
- avoid smuggling in extra unvalidated tricks

## Benchmark Wins

A result only counts if it is both:
- better
- trustworthy

That means:
- no forbidden data
- no leakage
- no disallowed scaling
- no unjustified complexity
- no fragile one-off cherry picks

## Example Commands

```bash
jq '.benchmark, .officialResult, .userStories[] | {id, stage, title, status, passes}' research_program.json
cat progress.txt
git log --oneline -10
```

## Notes

- `research_program.json` is the new canonical name
- `prd.json` is still supported as a legacy fallback
- `idea.md` is expected to evolve as evidence changes the best method

## References

- [Geoffrey Huntley's Ralph article](https://ghuntley.com/ralph/)
- [Codex CLI documentation](https://developers.openai.com/codex/cli)
- [Amp documentation](https://ampcode.com/manual)
- [Claude Code documentation](https://docs.anthropic.com/en/docs/claude-code)

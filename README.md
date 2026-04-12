# Ralph

Ralph is a fresh-context agent loop for benchmark research, but the autonomous boundary is intentionally narrow. It starts by requiring the user to provide research background and explicit requirements, then takes the project from question framing through benchmark grounding, literature review, initial idea formation, validation planning, and early exploration, and finally stops once `idea.md` and the review memo are strong enough for a human to inspect.

The point is not to let the agent wander into implementation theater. The point is to force a higher-taste loop: sharpen the question, propose an idea that is concise and modern, test it early under real constraints, professionalize the writeup, and pause before `src/` or benchmark tuning work begins.

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
cp -r /path/to/ralph/experiments .

./scripts/ralph/ralph.sh --init-intake
./scripts/ralph/ralph.sh
```

Use `--tool amp` or `--tool claude` if you do not want the default Codex CLI runner.

## How It Works

The main control file is `research_program.json`. It defines the research question, researcher context, benchmark box, artifact locations, taste rules, automation boundary, and the queued research items. The queue still uses the legacy key `userStories` for compatibility, but each entry is a staged research item rather than a product task.

In practice, the operator flow is:

1. define the benchmark and create `research_program.json`
2. run `./ralph.sh --init-intake` and tell Ralph your background, hard requirements, resources, and stop rules
3. run `./ralph.sh` to let the autonomous research loop execute until the review gate
4. inspect `idea.md`, `research/final-review.md`, and the evidence under `experiments/early-exploration/`
5. decide manually whether to unlock implementation or kill the idea

The intended autonomous stage order is:

1. researcher intake
2. problem framing
3. benchmark overview
4. literature review
5. `idea.md`
6. validation plan
7. early exploration
8. idea convergence
9. user review gate

Implementation in `src/` and benchmark tuning remain in the control file as post-review stages, but the autonomous loop must not start them on its own.

Each iteration gets fresh context. Long-term memory lives in git history, the configured progress log, `idea.md`, `research/final-review.md`, and the artifacts under `research/` and `experiments/early-exploration/`.

## Taste

Ralph prefers the smallest sharp idea that could matter. It rejects kitchen-sink proposals. One item should test one mechanism. Complexity has to earn its keep. Negative evidence should kill weak ideas instead of triggering rescue complexity.

There are additional hard filters now:
- the idea must stay compatible with large-scale GPU parallel execution
- the mechanism must be explainable crisply
- narrow follow-up work is not enough
- the novelty bar should be high enough to be discussable at top-conference oral level

Those are not just README vibes. They are encoded into the prompt templates and the example control schema.

## Files

`ralph.sh` is the runner. `research_program.json` is the control file. `idea.md` is the best current version of the idea. `progress.txt` is the append-only ledger by default. `research/` holds the benchmark overview, literature notes, and review memo. `experiments/early-exploration/` holds the validation plan, live log, per-run artifacts, and iteration transcripts. `CODEX.md`, `prompt.md`, and `CLAUDE.md` are the tool-specific prompt templates.

Before the loop can start, run the harness with `--init-intake` or fill [research/intake.md](research/intake.md) and mark `researcherContext.isComplete=true` in the control file. Ralph treats that intake as hard context, not optional prose.

The intake asks for:
- research background and current agenda
- hard requirements and evaluation bar
- available resources and constraints
- collaboration boundary and escalation preferences

`prd.json` is still supported as a legacy fallback, but `research_program.json` is the canonical name now.

## Early Exploration

Early exploration lives under `experiments/early-exploration/`. The plan should define the smallest decisive experiments. Each run should save commands, configs, raw logs, result summaries, and interpretation. `live-log.md` should capture the running research narrative as the agent discovers problems and responds to them.

When the major unknowns are resolved, the loop should stop exploring, rewrite `idea.md` professionally, write `research/final-review.md`, set `automation.state` to `awaiting_user_review`, and halt.

## Notes

```bash
jq '.researcherContext, .problem, .automation, .userStories[] | {id, stage, status, passes, requiresUserIntervention}' research_program.json
cat progress.txt
find experiments/early-exploration -maxdepth 2 -type f | sort
git log --oneline -10
```

The flowchart source is in `flowchart/`:

```bash
cd flowchart
npm install
npm run dev
```

## References

- [karpathy/micrograd](https://github.com/karpathy/micrograd)
- [karpathy/minGPT](https://github.com/karpathy/minGPT)
- [Geoffrey Huntley's Ralph article](https://ghuntley.com/ralph/)

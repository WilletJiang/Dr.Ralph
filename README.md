# Ralph

Ralph is a fresh-context agent loop for benchmark research. You give it a benchmark, a baseline, a set of constraints, and a staged harness. It then advances the work one step at a time: understanding the benchmark, reading the literature, writing and revising `idea.md`, running early validations, implementing the best validated idea in `src/`, and finally integrating and tuning against the benchmark.

The point is not to let the agent wander. The point is to make it much harder for the agent to do the usual low-taste things: skip the benchmark analysis, fake novelty, build a kitchen sink, overfit the metric, or jump into full implementation before the idea deserves to survive.

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

./scripts/ralph/ralph.sh
```

Use `--tool amp` or `--tool claude` if you do not want the default Codex CLI runner.

## How it works

The main control file is `research_program.json`. It defines the benchmark box, the current trusted result, the artifact locations, the taste rules, and the queued research items. The queue still uses the legacy key `userStories` for compatibility, but each entry is a staged research item rather than a product task.

The intended stage order is:

1. benchmark overview
2. literature review
3. `idea.md`
4. early validation
5. implementation
6. benchmark tuning

Each iteration gets fresh context. Long-term memory lives in git history, `progress.txt`, `idea.md`, and the artifacts under `research/`.

## Taste

Ralph has a fairly opinionated view of research taste. It prefers the smallest sharp idea that could matter. It rejects kitchen-sink proposals. One item should test one mechanism. Complexity has to earn its keep. Negative evidence should kill weak ideas instead of triggering more rescue complexity.

Those are not just vibes in the README. They are encoded into the prompts and the harness schema as promotion and rejection rules.

## Files

`ralph.sh` is the runner. `research_program.json` is the control file. `idea.md` is the best current version of the method. `progress.txt` is the append-only ledger. `research/` holds the benchmark overview, literature notes, validation artifacts, and tuning logs. `CODEX.md`, `prompt.md`, and `CLAUDE.md` are the tool-specific prompt templates.

`prd.json` is still supported as a legacy fallback, but `research_program.json` is the canonical name now.

## Validation

Early validations live under `research/validations/`. Each validation should save the commands, configs, logs, results, and short interpretation. The question is not only whether the score moved. The question is whether the idea deserves to stay alive.

Once the idea is strong enough, Ralph implements it in `src/`. The implementation should track `idea.md` closely, stay minimal, and avoid sneaking in extra unvalidated tricks.

## Notes

```bash
jq '.benchmark, .officialResult, .userStories[] | {id, stage, title, status, passes}' research_program.json
cat progress.txt
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

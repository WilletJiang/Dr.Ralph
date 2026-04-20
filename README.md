# Ralph

Ralph is a fresh-context research harness with a deliberately narrow autonomous boundary. It helps turn a vague research direction into a reviewable idea package, then stops before implementation theater takes over. Today it supports two flows: `experimental_research` for evaluation-driven work, and `theoretical_research` for theorem- or concept-level work.

Fresh-context here means each autonomous iteration starts a new underlying model conversation. Continuity comes from the repository files and Ralph session logs, not from reusing backend thread history.

The intended loop is simple: define the question, collect hard constraints from the researcher, work through framing and early exploration, professionalize `idea.md` and the review memo, then hand the result back to a human. Ralph is not trying to replace judgment. It is trying to structure the part of research work that benefits from discipline and repeatability.

## Quickstart

```bash
git clone git@github.com:WilletJiang/Dr.Ralph.git
cd Dr.Ralph
./install-global-commands.sh
ralph init --research-mode theoretical_research /path/to/your/project
cd /path/to/your/project
ralph intake
ralph run
```

If you omit `--research-mode` in an interactive terminal, `ralph init` will prompt you to choose one. In non-interactive contexts, including MCP, the mode must be passed explicitly. The default runtime backend is Codex; `--tool amp` and `--tool claude` are also supported. For Codex runs, Ralph prefers the Codex SDK backend and falls back to the local Codex CLI only if the SDK path fails.

## Install

Right now the official install path is still source-based rather than npm-published. `./install-global-commands.sh` builds the TypeScript CLI and symlinks `ralph` into `~/.local/bin`. You need Node.js 20+, `npm`, and `git`. If `~/.local/bin` is not already on your `PATH`, the installer prints the export command you need.

Theory-mode init has extra requirements: `python3`, `uv`, and network access during `ralph init`. That is because theoretical projects provision Lean tooling as part of setup rather than treating it as an optional extra.

## CLI

The CLI is the primary entrypoint. Most people will use four commands: `init`, `intake`, `run`, and `status`.

To initialize a project, run one of:

```bash
ralph init --research-mode experimental_research /path/to/project
ralph init --research-mode theoretical_research /path/to/project
```

Once you are inside the project directory, you can fill intake interactively with `ralph intake`, or non-interactively with:

```bash
ralph intake set \
  --background "..." \
  --requirements "..." \
  --resources "..." \
  --collaboration "..." \
  --extra "..."
```

Then start the loop with `ralph run`. A typical invocation is just `ralph run`, but you can also pass `--tool`, `--model`, and `--max-iterations`. To inspect state, use `ralph status`, `ralph doctor`, and `ralph paths`. To continue a prior Ralph session log, use `ralph resume <session-id>`; this continues the file-driven workflow, but each new iteration still starts a fresh backend conversation. If you run `ralph` with no arguments inside an initialized project, it opens a small interactive REPL with `status`, `intake`, `run`, `resume`, `show paths`, and `doctor`.

## MCP

Ralph also exposes a stdio MCP server:

```bash
ralph mcp serve
```

The MCP surface mirrors the CLI. The available tools are `ralph_init`, `ralph_status`, `ralph_intake_get`, `ralph_intake_set`, `ralph_run`, `ralph_resume`, `ralph_doctor`, and `ralph_paths`.

A minimal MCP flow is: call `ralph_init` with `path` and `researchMode`, call `ralph_intake_set`, call `ralph_run`, then poll with `ralph_status`.

Example `ralph_init` payload:

```json
{
  "path": "/tmp/my-ralph-project",
  "researchMode": "theoretical_research"
}
```

Example `ralph_run` payload:

```json
{
  "projectRoot": "/tmp/my-ralph-project",
  "tool": "codex",
  "model": "gpt5.4-xhigh",
  "maxIterations": 10
}
```

## Research Modes

`experimental_research` is for empirical or evaluation-driven work: benchmark studies, algorithm comparisons, ablations, systems experiments, or any project where decisive evidence comes from measurements and controlled runs.

`theoretical_research` is for theorem-level or concept-level work where AI-generated reasoning needs strong verification. Ralph treats this mode as Lean-first by default. During init it provisions a `lean4_skills_plus_lsp` stack, clones `cameronfreer/lean4-skills` into `~/.codex/tooling/lean4-skills`, force-installs `lean-lsp-mcp`, and writes project-local Lean configuration so later theory work can use Lean-backed checks instead of trusting long freehand derivations.

## Lean Integration

For theoretical projects, Lean is part of the normal workflow rather than an optional flourish. Ralph uses:

- `lean4-skills` from [cameronfreer/lean4-skills](https://github.com/cameronfreer/lean4-skills)
- `lean-lsp-mcp` as the required MCP sidecar

What `ralph init --research-mode theoretical_research` actually writes:
- `.mcp.json` in the project root
- `.ralph/tooling/lean4-env.sh`
- `research_program.json.theoreticalTooling` with the resolved paths and commands

It also ensures `~/.codex/tooling/lean4-skills` exists and force-installs `lean-lsp-mcp`.

Two practical notes matter here. First, if your host only reads `.mcp.json` on startup, you may need to restart or reload it before `lean-lsp-mcp` becomes visible. Second, if you want to run Lean helper scripts directly in your shell, source the generated env file first:

```bash
source .ralph/tooling/lean4-env.sh
```

That file exports `LEAN4_PLUGIN_ROOT`, `LEAN4_SCRIPTS`, and `LEAN4_REFS`.

## How It Works

The main control file is `research_program.json`. A supported Ralph project uses the canonical layout: `research_program.json` and `.ralph/project.json` in the project root. The control file defines the `researchMode`, research question, researcher context, artifact locations, taste rules, automation boundary, and queued research items. The queue still uses the legacy key `userStories` for compatibility, but each entry is a staged research item rather than a product task.

In practice, the flow is: initialize the project with `ralph init`, fill intake, run the loop, inspect `idea.md`, `research/final-review.md`, and the evidence under `experiments/early-exploration/`, then make a human decision about whether the idea deserves anything beyond review. The repo files are the durable state; individual model conversations are intentionally disposable.

The autonomous stage order depends on `researchMode`. Experimental projects move through problem framing, evaluation framing, literature review, idea proposal, validation planning, early exploration, and idea convergence. Theoretical projects move through problem framing, concept framing, literature review, statement drafting, proof strategy, Lean-backed formalization checks, and then convergence.

## Taste

Some taste rules are global: prefer the smallest sharp idea, reject kitchen sinks, let one item test one mechanism, make complexity earn its keep, and treat negative evidence as real evidence. The user's stated background and requirements are hard context.

Mode-specific hard filters live inside the selected scaffold and prompt instructions instead of being treated as universal law. That keeps experimental evaluation constraints hard where they belong without forcing the same worldview onto theory work.

## Files

`research_program.json` is the canonical control file. `.ralph/project.json` marks the directory as a Ralph project. `templates/` contains the mode-specific scaffold packs used by `ralph init`. `idea.md` is the current best version of the idea. `research/` holds overview, literature, and final review artifacts. `experiments/early-exploration/` holds the exploration plan, live log, and per-run evidence. `CODEX.md`, `prompt.md`, and `CLAUDE.md` are the packaged prompt templates used by the backends.

Theoretical projects also get `.mcp.json`, `.ralph/tooling/lean4-env.sh`, and `research_program.json.theoreticalTooling` as part of Lean setup.

## Intake And Exploration

Before the loop can start, run `ralph intake` or fill `research/intake.md` and mark `researcherContext.isComplete=true` in the control file. Intake captures the researcher's background, hard requirements, resources, and collaboration boundary. Ralph treats that intake as hard context, not optional prose.

Early exploration always lives under `experiments/early-exploration/`, but the content differs by mode. Experimental projects save decisive runs, configs, logs, and summaries. Theoretical projects save statement drafts, Lean-backed checks, proof fragments, and blocker analysis.

When the major unknowns are resolved, the loop should stop exploring, rewrite `idea.md` professionally, write `research/final-review.md`, set `automation.state` to `awaiting_user_review`, and halt.

## Notes

```bash
jq '.researchMode, .researcherContext, .problem, .automation, .userStories[] | {id, stage, status, passes, requiresUserIntervention}' research_program.json
cat progress.txt
find experiments/early-exploration -maxdepth 2 -type f | sort
git log --oneline -10
```

## Smoke Tests

```bash
npm run smoke:mcp
npm run smoke:codex-sdk
```

`smoke:mcp` verifies the stdio MCP server end-to-end with a real MCP client. `smoke:codex-sdk` verifies the live Codex SDK backend adapter against the current local Codex authentication state.

## References

- [Geoffrey Huntley's Ralph article](https://ghuntley.com/ralph/)

# Ralph

Ralph is a fresh-context agent loop for research, but the autonomous boundary is intentionally narrow. It scaffolds and runs two research flows:
- `experimental_research`
- `theoretical_research`

The point is not to let the agent wander into implementation theater. The point is to sharpen the question, propose a concise idea, test it early under the right constraints for that mode, professionalize the writeup, and stop at a human review gate.

## Requirements

For all projects:
- Node.js 20+
- `npm`
- `git`

Additional requirements for `theoretical_research`:
- `python3`
- `uv`
- network access during `ralph init`

Theory-mode init is not a no-op. It writes to both the project and the user environment:
- clones `lean4-skills` into `~/.codex/tooling/lean4-skills`
- installs `lean-lsp-mcp` into your user tool directory (typically `~/.local/bin`)
- writes project-local `.mcp.json`
- writes `.ralph/tooling/lean4-env.sh`

## Quickstart

```bash
git clone git@github.com:WilletJiang/Dr.Ralph.git
cd Dr.Ralph
./install-global-commands.sh
ralph-bootstrap --research-mode theoretical_research /path/to/your/project
cd /path/to/your/project
ralph --init-intake
ralph
```

If you omit `--research-mode` in an interactive terminal, `ralph init` will prompt you to choose one.
For non-interactive init or MCP-driven init, `researchMode` must be provided explicitly.

Use `--tool amp` or `--tool claude` if you do not want the default Codex backend.
For Codex runs, Ralph prefers the Codex SDK backend and falls back to the local Codex CLI only when the SDK path fails.
The default Codex model is `gpt5.4-xhigh`.
Use `--force` with `ralph-bootstrap` if you intentionally want to replace an existing Ralph setup.
If `~/.local/bin` is not already on your `PATH`, run the export command printed by `install-global-commands.sh`.

## CLI Usage

The CLI is the primary entrypoint.

Initialize a project:

```bash
ralph init --research-mode experimental_research /path/to/project
ralph init --research-mode theoretical_research /path/to/project
```

If you run `ralph init` in a TTY without `--research-mode`, Ralph prompts you to choose one. In non-interactive contexts, the flag is required.

Fill intake interactively:

```bash
cd /path/to/project
ralph intake
```

Fill intake non-interactively:

```bash
ralph intake set \
  --background "..." \
  --requirements "..." \
  --resources "..." \
  --collaboration "..." \
  --extra "..."
```

Run the research loop:

```bash
ralph run
ralph run --tool claude
ralph run --tool codex --model gpt5.4-xhigh --max-iterations 10
```

Inspect and recover state:

```bash
ralph status
ralph status --json
ralph doctor
ralph paths
ralph resume <session-id>
```

If you run `ralph` with no arguments inside an initialized project, it opens the interactive REPL with `status`, `intake`, `run`, `resume`, `show paths`, and `doctor`.

## MCP Usage

Ralph also exposes a stdio MCP server for agent hosts:

```bash
ralph mcp serve
```

Available MCP tools:
- `ralph_init`
- `ralph_status`
- `ralph_intake_get`
- `ralph_intake_set`
- `ralph_run`
- `ralph_resume`
- `ralph_doctor`
- `ralph_paths`

Important MCP inputs:
- `ralph_init`: `path`, `researchMode`, optional `force`
- `ralph_intake_set`: `background`, `requirements`, optional `resources`, `collaboration`, `extra`, `projectRoot`
- `ralph_run`: optional `tool`, `model`, `maxIterations`, `session`, `projectRoot`
- `ralph_resume`: `sessionId`, optional `tool`, `model`, `maxIterations`, `projectRoot`

Minimal MCP flow:

1. Call `ralph_init` with `path` and `researchMode`
2. Call `ralph_intake_set`
3. Call `ralph_run`
4. Poll with `ralph_status`

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

## How It Works

The main control file is `research_program.json`. It defines the `researchMode`, research question, researcher context, artifact locations, taste rules, automation boundary, and queued research items. The queue still uses the legacy key `userStories` for compatibility, but each entry is a staged research item rather than a product task.

In practice, the operator flow is:

1. clone the Ralph repository, enter it, and install the global commands
2. bootstrap Ralph into a project directory, choosing a `researchMode`
3. run `ralph --init-intake` and tell Ralph your background, hard requirements, resources, and stop rules
4. run `ralph` to let the autonomous research loop execute until the review gate
5. inspect `idea.md`, `research/final-review.md`, and the evidence under `experiments/early-exploration/`
6. decide manually whether to unlock any post-review work or kill the idea

The autonomous stage order depends on `researchMode`:

- `experimental_research`: researcher intake, problem framing, evaluation framing, literature review, idea proposal, validation plan, early exploration, idea convergence, user review
- `theoretical_research`: researcher intake, problem framing, concept framing, literature review, statement drafting, proof strategy, Lean-backed formalization checks, idea convergence, user review

## Research Modes

### `experimental_research`

Use this for empirical or evaluation-driven work: benchmark studies, algorithm comparisons, ablations, systems experiments, or any project where decisive evidence comes from measurements and controlled runs.

### `theoretical_research`

Use this for theorem-level or concept-level work where AI-generated reasoning needs strong verification. Ralph treats this mode as Lean-first by default:

- it provisions a local `lean4_skills_plus_lsp` stack
- it clones `cameronfreer/lean4-skills` into `~/.codex/tooling/lean4-skills`
- it force-installs `lean-lsp-mcp`
- it writes project-local Lean env and MCP config so the theory flow can use Lean-backed checks instead of trusting long freehand derivations

## Lean Integration

Theoretical projects use:
- `lean4-skills` from [cameronfreer/lean4-skills](https://github.com/cameronfreer/lean4-skills)
- `lean-lsp-mcp` as the required MCP sidecar

This is not treated as an optional flourish. Once a theoretical project is past basic framing, the default expectation is to validate statements, search libraries, and check proof shape with the configured Lean stack.

What `ralph init --research-mode theoretical_research` actually does:
- ensures `~/.codex/tooling/lean4-skills` exists
- force-installs `lean-lsp-mcp`
- writes `.mcp.json` in the project root
- writes `.ralph/tooling/lean4-env.sh`
- records the resolved paths under `research_program.json.theoreticalTooling`

What you may still need to do after init:
- if your host reads `.mcp.json` only on startup, restart or reload the host so `lean-lsp-mcp` becomes visible
- if you want to run Lean helper scripts manually in your shell, source the generated env file first:

```bash
source .ralph/tooling/lean4-env.sh
```

That file exports:
- `LEAN4_PLUGIN_ROOT`
- `LEAN4_SCRIPTS`
- `LEAN4_REFS`

## Taste

Cross-mode taste rules:
- prefer the smallest sharp idea
- reject kitchen-sink proposals
- one item should test one mechanism
- complexity must earn its keep
- negative evidence should kill weak ideas
- the user's stated background and requirements are hard context

Mode-specific hard filters now live inside the selected scaffold and prompt instructions instead of being treated as universal law. That keeps experimental evaluation constraints hard where they belong without forcing the same worldview onto theory work.

## Files

`install-global-commands.sh` builds the TypeScript CLI and installs the global `ralph-bootstrap` and `ralph` commands. `ralph-bootstrap` delegates to `ralph init`. `.ralph/project.json` is the canonical project marker. `research_program.json` is the control file. `templates/` holds the mode-specific scaffold packs used by `ralph init`. `idea.md` is the best current version of the idea. `progress.txt` is the append-only ledger by default. `research/` holds the overview, literature notes, and review memo. `experiments/early-exploration/` holds the validation or exploration plan, live log, per-run artifacts, and iteration transcripts. `CODEX.md`, `prompt.md`, and `CLAUDE.md` remain the packaged prompt templates used by the backends.

Theoretical projects also get:
- `.mcp.json` for `lean-lsp-mcp`
- `.ralph/tooling/lean4-env.sh` with the required Lean env vars
- `research_program.json.theoreticalTooling` describing the provisioned Lean stack

`ralph.sh` is now a deprecated compatibility layer for old shell-based workflows. The new primary entrypoint is the `ralph` CLI.

Before the loop can start, run the harness with `--init-intake` or fill [research/intake.md](research/intake.md) and mark `researcherContext.isComplete=true` in the control file. Ralph treats that intake as hard context, not optional prose.

The intake asks for:
- research background and current agenda
- hard requirements and evaluation or proof bar
- available resources and constraints
- collaboration boundary and escalation preferences

`research_program.json` is the canonical control file. Current CLI and MCP workflows expect it directly.

## Early Exploration

Early exploration lives under `experiments/early-exploration/` in every mode, but the content differs:
- experimental projects save decisive runs, configs, logs, and summaries
- theoretical projects save statement drafts, Lean-backed checks, proof fragments, and blocker analysis

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

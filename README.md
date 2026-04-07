# Ralph

![Ralph](ralph.webp)

Ralph is an autonomous AI agent loop that runs AI coding tools repeatedly until all PRD items are complete. It now supports [Codex CLI](https://developers.openai.com/codex/cli), [Amp](https://ampcode.com), and [Claude Code](https://docs.anthropic.com/en/docs/claude-code). Each iteration starts with fresh context; memory persists through git history, `progress.txt`, and `prd.json`.

Based on [Geoffrey Huntley's Ralph pattern](https://ghuntley.com/ralph/).

[Read my in-depth article on how I use Ralph](https://x.com/ryancarson/status/2008548371712135632)

## Prerequisites

- One of the following AI coding tools installed and authenticated:
  - [Codex CLI](https://developers.openai.com/codex/cli) (default)
  - [Amp CLI](https://ampcode.com)
  - [Claude Code](https://docs.anthropic.com/en/docs/claude-code) (`npm install -g @anthropic-ai/claude-code`)
- `jq` installed (`brew install jq` on macOS)
- A git repository for your project

## Setup

### Option 1: Copy into your project

```bash
# From your project root
mkdir -p scripts/ralph
cp /path/to/ralph/ralph.sh scripts/ralph/
cp /path/to/ralph/CODEX.md scripts/ralph/CODEX.md      # For Codex CLI
cp /path/to/ralph/prompt.md scripts/ralph/prompt.md    # For Amp
cp /path/to/ralph/CLAUDE.md scripts/ralph/CLAUDE.md    # For Claude Code

chmod +x scripts/ralph/ralph.sh
```

### Option 2: Install skills globally for Amp or Claude Code

Codex users do not need a marketplace install path for Ralph itself. Amp and Claude users can still install the bundled PRD skills globally:

For Amp:
```bash
cp -r skills/prd ~/.config/amp/skills/
cp -r skills/ralph ~/.config/amp/skills/
```

For Claude Code:
```bash
cp -r skills/prd ~/.claude/skills/
cp -r skills/ralph ~/.claude/skills/
```

### Option 3: Use as Claude Code Marketplace

This is only for Claude Code distribution of the bundled skills:

```bash
/plugin marketplace add snarktank/ralph
/plugin install ralph-skills@ralph-marketplace
```

Available skills after installation:
- `/prd` - Generate Product Requirements Documents
- `/ralph` - Convert PRDs to `prd.json` format

### Optional: Configure Amp auto-handoff

Add to `~/.config/amp/settings.json`:

```json
{
  "amp.experimental.autoHandoff": { "context": 90 }
}
```

This helps Amp continue large stories that exceed a single context window. Codex and Claude Code use their own native session behavior.

## Workflow

### 1. Create a PRD

Use the PRD skill to generate a detailed requirements document:

```text
Load the prd skill and create a PRD for [your feature description]
```

The skill saves output to `tasks/prd-[feature-name].md`.

### 2. Convert the PRD to Ralph format

```text
Load the ralph skill and convert tasks/prd-[feature-name].md to prd.json
```

This creates `prd.json` with user stories structured for autonomous execution.

### 3. Run Ralph

```bash
# Using Codex CLI (default)
./scripts/ralph/ralph.sh [max_iterations]

# Using Amp
./scripts/ralph/ralph.sh --tool amp [max_iterations]

# Using Claude Code
./scripts/ralph/ralph.sh --tool claude [max_iterations]
```

Default is 10 iterations. Use `--tool codex`, `--tool amp`, or `--tool claude` to select the runner explicitly.

Ralph will:
1. Create a feature branch from PRD `branchName`
2. Pick the highest-priority story where `passes: false`
3. Implement that single story
4. Run quality checks
5. Commit if checks pass
6. Update `prd.json` to mark the story as `passes: true`
7. Append learnings to `progress.txt`
8. Repeat until all stories pass or max iterations is reached

## Key Files

| File | Purpose |
|------|---------|
| `ralph.sh` | The bash loop that spawns fresh tool instances (`codex`, `amp`, or `claude`) |
| `CODEX.md` | Prompt template for Codex CLI |
| `prompt.md` | Prompt template for Amp |
| `CLAUDE.md` | Prompt template for Claude Code |
| `prd.json` | User stories with `passes` status |
| `prd.json.example` | Example PRD format |
| `progress.txt` | Append-only learnings for future iterations |
| `skills/prd/` | Skill for generating PRDs |
| `skills/ralph/` | Skill for converting PRDs to JSON |
| `.claude-plugin/` | Claude Code marketplace metadata for bundled skills |
| `flowchart/` | Interactive visualization of how Ralph works |

## Critical Concepts

### Each Iteration Uses Fresh Context

Each iteration spawns a fresh AI coding agent instance. The only memory between iterations is:
- Git history
- `progress.txt`
- `prd.json`

### Small Tasks Matter

Each PRD item should be small enough to complete in one context window.

Right-sized stories:
- Add a database column and migration
- Add a UI component to an existing page
- Update a server action with new logic
- Add a filter dropdown to a list

Too big:
- Build the entire dashboard
- Add authentication
- Refactor the API

### AGENTS.md Updates Are Critical

After each iteration, Ralph updates relevant `AGENTS.md` files with reusable learnings. This is how future iterations inherit patterns, gotchas, and local conventions.

### Feedback Loops Must Exist

Ralph only works if the codebase has real checks:
- Typecheck catches type errors
- Tests verify behavior
- CI stays green

### Browser Verification for UI Stories

Frontend stories should include browser verification in acceptance criteria. Use available browser automation when it exists; otherwise record that manual browser verification is required.

### Stop Condition

When all stories have `passes: true`, Ralph outputs `<promise>COMPLETE</promise>` and the loop exits.

## Debugging

```bash
# See which stories are done
jq '.userStories[] | {id, title, passes}' prd.json

# See learnings from previous iterations
cat progress.txt

# Check git history
git log --oneline -10
```

## Customizing the Prompts

After copying `CODEX.md`, `prompt.md`, or `CLAUDE.md` to your project, customize them for your stack:
- Add project-specific quality check commands
- Add codebase conventions
- Add common gotchas

## Archiving

Ralph automatically archives previous runs when you start a new feature with a different `branchName`. Archives are saved to `archive/YYYY-MM-DD-feature-name/`.

## Flowchart

[![Ralph Flowchart](ralph-flowchart.png)](https://snarktank.github.io/ralph/)

**[View Interactive Flowchart](https://snarktank.github.io/ralph/)** to click through the loop visually.

Run locally:

```bash
cd flowchart
npm install
npm run dev
```

## References

- [Geoffrey Huntley's Ralph article](https://ghuntley.com/ralph/)
- [Codex CLI documentation](https://developers.openai.com/codex/cli)
- [Amp documentation](https://ampcode.com/manual)
- [Claude Code documentation](https://docs.anthropic.com/en/docs/claude-code)

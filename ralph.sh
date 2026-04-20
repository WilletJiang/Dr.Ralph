#!/bin/bash
# Ralph Wiggum - Long-running AI research harness loop
# Usage: ./ralph.sh [--init-intake] [--tool codex|amp|claude] [max_iterations]

set -e

TOOL="codex"
MAX_ITERATIONS=10
INIT_INTAKE=false
CODEX_MODEL="gpt5.4-xhigh"

while [[ $# -gt 0 ]]; do
  case $1 in
    --tool)
      TOOL="$2"
      shift 2
      ;;
    --tool=*)
      TOOL="${1#*=}"
      shift
      ;;
    --init-intake)
      INIT_INTAKE=true
      shift
      ;;
    *)
      if [[ "$1" =~ ^[0-9]+$ ]]; then
        MAX_ITERATIONS="$1"
      fi
      shift
      ;;
  esac
done

if [[ "$TOOL" != "codex" && "$TOOL" != "amp" && "$TOOL" != "claude" ]]; then
  echo "Error: Invalid tool '$TOOL'. Must be 'codex', 'amp', or 'claude'."
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR"
RESEARCH_PROGRAM_FILE="$SCRIPT_DIR/research_program.json"
LEGACY_PRD_FILE="$SCRIPT_DIR/prd.json"
CONTROL_FILE="$RESEARCH_PROGRAM_FILE"
ARCHIVE_DIR="$SCRIPT_DIR/archive"
LAST_BRANCH_FILE="$SCRIPT_DIR/.last-branch"

# When Ralph is installed into project/scripts/ralph, treat the project root
# as the base for research artifacts like idea.md, research/, and experiments/.
if [ "$(basename "$SCRIPT_DIR")" = "ralph" ] && [ "$(basename "$(dirname "$SCRIPT_DIR")")" = "scripts" ]; then
  PROJECT_ROOT="$(dirname "$(dirname "$SCRIPT_DIR")")"
fi

if [ -f "$RESEARCH_PROGRAM_FILE" ]; then
  CONTROL_FILE="$RESEARCH_PROGRAM_FILE"
elif [ -f "$LEGACY_PRD_FILE" ]; then
  CONTROL_FILE="$LEGACY_PRD_FILE"
fi

if [ -f "$SCRIPT_DIR/dist/cli-bin.js" ]; then
  if [ "$INIT_INTAKE" = "true" ]; then
    exec node "$SCRIPT_DIR/dist/cli-bin.js" intake
  fi

  exec node "$SCRIPT_DIR/dist/cli-bin.js" run --tool "$TOOL" --model "$CODEX_MODEL" --max-iterations "$MAX_ITERATIONS"
fi

json_get() {
  local filter="$1"
  if [ -f "$CONTROL_FILE" ]; then
    jq -r "$filter" "$CONTROL_FILE" 2>/dev/null || true
  fi
}

resolve_path() {
  local path="$1"
  if [ -z "$path" ]; then
    return 1
  fi

  case "$path" in
    /*)
      printf '%s\n' "$path"
      ;;
    *)
      printf '%s\n' "$PROJECT_ROOT/$path"
      ;;
  esac
}

setup_paths() {
  local configured_progress
  local configured_exploration
  local configured_iteration_logs
  local configured_intake

  configured_progress="$(json_get '.harness.progressFile // empty')"
  configured_exploration="$(json_get '.harness.explorationRoot // empty')"
  configured_iteration_logs="$(json_get '.harness.iterationLogRoot // empty')"
  configured_intake="$(json_get '.researcherContext.intakeFile // empty')"

  PROGRESS_FILE="$(resolve_path "${configured_progress:-progress.txt}")"
  EXPLORATION_ROOT="$(resolve_path "${configured_exploration:-experiments/early-exploration}")"
  ITERATION_LOG_ROOT="$(resolve_path "${configured_iteration_logs:-experiments/early-exploration/agent-runs}")"
  INTAKE_FILE="$(resolve_path "${configured_intake:-research/intake.md}")"
}

automation_state() {
  json_get '.automation.state // empty'
}

should_stop_for_user_review() {
  [ "$(automation_state)" = "awaiting_user_review" ]
}

researcher_intake_required() {
  local required
  required="$(json_get '.researcherContext.required // .automation.userIntakeRequired // true')"
  [ "$required" = "true" ]
}

researcher_intake_complete() {
  local complete
  complete="$(json_get '.researcherContext.isComplete // false')"
  [ "$complete" = "true" ]
}

ensure_intake_template() {
  mkdir -p "$(dirname "$INTAKE_FILE")"
  if [ ! -f "$INTAKE_FILE" ]; then
    cat > "$INTAKE_FILE" <<'EOF'
# Research Intake

## Research Background

What is your research background, domain familiarity, and current agenda?

## Hard Requirements

What must Ralph optimize for, preserve, or avoid?

## Available Resources

What compute, models, datasets, time budget, or tooling are available?

## Collaboration Preferences

Where should the autonomous loop stop, and what kinds of decisions must be escalated to you?

## Additional Context

Anything else Ralph should treat as a hard constraint or a strong preference.
EOF
  fi
}

update_researcher_context() {
  local background="$1"
  local requirements="$2"
  local resources="$3"
  local collaboration="$4"
  local timestamp="$5"
  local intake_path_for_json
  local tmp_file

  if [[ "$INTAKE_FILE" == "$SCRIPT_DIR/"* ]]; then
    intake_path_for_json="${INTAKE_FILE#$PROJECT_ROOT/}"
  elif [[ "$INTAKE_FILE" == "$PROJECT_ROOT/"* ]]; then
    intake_path_for_json="${INTAKE_FILE#$PROJECT_ROOT/}"
  else
    intake_path_for_json="$INTAKE_FILE"
  fi

  tmp_file="$(mktemp)"
  jq \
    --arg bg "$background" \
    --arg req "$requirements" \
    --arg res "$resources" \
    --arg collab "$collaboration" \
    --arg ts "$timestamp" \
    --arg intake "$intake_path_for_json" \
    '
    .researcherContext = ((.researcherContext // {}) + {
      required: true,
      isComplete: true,
      intakeFile: $intake,
      backgroundSummary: $bg,
      requirementsSummary: $req,
      availableResources: $res,
      collaborationPreferences: $collab,
      lastUpdated: $ts
    })
    | .automation = ((.automation // {}) + { userIntakeRequired: true })
    ' "$CONTROL_FILE" > "$tmp_file"
  mv "$tmp_file" "$CONTROL_FILE"
}

run_intake_wizard() {
  local background
  local requirements
  local resources
  local collaboration
  local extra_context
  local timestamp

  if [ ! -f "$CONTROL_FILE" ]; then
    echo "Error: $(basename "$CONTROL_FILE") not found."
    echo "Create research_program.json first, or copy research_program.json.example into place."
    exit 1
  fi

  setup_paths
  ensure_intake_template

  echo ""
  echo "Research intake is required before autonomous research starts."
  echo "Please answer the following questions."
  echo ""

  printf "1. Your research background and current agenda: "
  IFS= read -r background
  printf "2. Your hard requirements or evaluation bar: "
  IFS= read -r requirements
  printf "3. Available resources and constraints (GPU, time, models, data): "
  IFS= read -r resources
  printf "4. Collaboration preferences and where Ralph must stop/escalate: "
  IFS= read -r collaboration
  printf "5. Any additional context Ralph should treat as important: "
  IFS= read -r extra_context

  if [ -z "$background" ] || [ -z "$requirements" ]; then
    echo "Error: research background and hard requirements are required."
    exit 1
  fi

  timestamp="$(date '+%Y-%m-%d %H:%M:%S %z')"

  cat > "$INTAKE_FILE" <<EOF
# Research Intake

Last updated: $timestamp

## Research Background

$background

## Hard Requirements

$requirements

## Available Resources

$resources

## Collaboration Preferences

$collaboration

## Additional Context

$extra_context
EOF

  update_researcher_context "$background" "$requirements" "$resources" "$collaboration" "$timestamp"

  echo ""
  echo "Research intake captured."
  echo "Intake file: $INTAKE_FILE"
  echo "Control file updated: $(basename "$CONTROL_FILE")"
}

setup_paths

if [ "$INIT_INTAKE" = "true" ]; then
  run_intake_wizard
  exit 0
fi

if [ ! -f "$CONTROL_FILE" ]; then
  echo "Error: research_program.json not found."
  echo "Create research_program.json first, or copy research_program.json.example into place."
  exit 1
fi

if researcher_intake_required && ! researcher_intake_complete; then
  ensure_intake_template

  echo "Research intake is required before auto research can start."
  echo "Intake file: $INTAKE_FILE"

  if [ -t 0 ] && [ -t 1 ]; then
    printf "Start intake now? [Y/n] "
    IFS= read -r start_intake
    case "${start_intake:-Y}" in
      [Nn]*)
        echo "Run ./ralph.sh --init-intake after filling the control file, or edit $INTAKE_FILE and mark researcherContext.isComplete=true."
        exit 1
        ;;
      *)
        run_intake_wizard
        echo "Re-run ./ralph.sh to start the autonomous loop."
        exit 0
        ;;
    esac
  else
    echo "Run ./ralph.sh --init-intake, or fill $INTAKE_FILE and mark researcherContext.isComplete=true."
    exit 1
  fi
fi

# Archive previous run if branch changed
if [ -f "$CONTROL_FILE" ] && [ -f "$LAST_BRANCH_FILE" ]; then
  CURRENT_BRANCH="$(jq -r '.branchName // empty' "$CONTROL_FILE" 2>/dev/null || echo "")"
  LAST_BRANCH="$(cat "$LAST_BRANCH_FILE" 2>/dev/null || echo "")"

  if [ -n "$CURRENT_BRANCH" ] && [ -n "$LAST_BRANCH" ] && [ "$CURRENT_BRANCH" != "$LAST_BRANCH" ]; then
    DATE="$(date +%Y-%m-%d)"
    FOLDER_NAME="$(echo "$LAST_BRANCH" | sed 's|^ralph/||')"
    ARCHIVE_FOLDER="$ARCHIVE_DIR/$DATE-$FOLDER_NAME"

    echo "Archiving previous run: $LAST_BRANCH"
    mkdir -p "$ARCHIVE_FOLDER"
    [ -f "$CONTROL_FILE" ] && cp "$CONTROL_FILE" "$ARCHIVE_FOLDER/"
    [ -f "$PROGRESS_FILE" ] && cp "$PROGRESS_FILE" "$ARCHIVE_FOLDER/"
    echo "   Archived to: $ARCHIVE_FOLDER"

    mkdir -p "$(dirname "$PROGRESS_FILE")"
    {
      echo "# Ralph Progress Log"
      echo "Started: $(date)"
      echo "---"
    } > "$PROGRESS_FILE"
  fi
fi

if [ -f "$CONTROL_FILE" ]; then
  CURRENT_BRANCH="$(jq -r '.branchName // empty' "$CONTROL_FILE" 2>/dev/null || echo "")"
  if [ -n "$CURRENT_BRANCH" ]; then
    echo "$CURRENT_BRANCH" > "$LAST_BRANCH_FILE"
  fi
fi

mkdir -p "$(dirname "$PROGRESS_FILE")" "$EXPLORATION_ROOT" "$ITERATION_LOG_ROOT"

if [ ! -f "$PROGRESS_FILE" ]; then
  {
    echo "# Ralph Progress Log"
    echo "Started: $(date)"
    echo "---"
  } > "$PROGRESS_FILE"
fi

if should_stop_for_user_review; then
  echo "Automation is already paused for user review."
  echo "Inspect the review package and update $(basename "$CONTROL_FILE") before resuming."
  exit 0
fi

echo "Starting Ralph - Tool: $TOOL - Control file: $(basename "$CONTROL_FILE") - Max iterations: $MAX_ITERATIONS"
echo "Research intake: $INTAKE_FILE"
echo "Progress log: $PROGRESS_FILE"
echo "Iteration transcripts: $ITERATION_LOG_ROOT"

for i in $(seq 1 "$MAX_ITERATIONS"); do
  if should_stop_for_user_review; then
    echo ""
    echo "Ralph reached the user review gate."
    echo "Auto research is complete for now."
    exit 0
  fi

  echo ""
  echo "==============================================================="
  echo "  Ralph Iteration $i of $MAX_ITERATIONS ($TOOL)"
  echo "==============================================================="

  ITERATION_TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
  ITERATION_LOG_FILE="$ITERATION_LOG_ROOT/iteration-$(printf '%03d' "$i")-$ITERATION_TIMESTAMP.log"

  case "$TOOL" in
    codex)
      OUTPUT="$(codex exec --model "$CODEX_MODEL" --dangerously-bypass-approvals-and-sandbox - < "$SCRIPT_DIR/CODEX.md" 2>&1 | tee "$ITERATION_LOG_FILE" /dev/stderr)" || true
      ;;
    amp)
      OUTPUT="$(amp --dangerously-allow-all < "$SCRIPT_DIR/prompt.md" 2>&1 | tee "$ITERATION_LOG_FILE" /dev/stderr)" || true
      ;;
    claude)
      OUTPUT="$(claude --dangerously-skip-permissions --print < "$SCRIPT_DIR/CLAUDE.md" 2>&1 | tee "$ITERATION_LOG_FILE" /dev/stderr)" || true
      ;;
  esac

  if echo "$OUTPUT" | grep -q "<promise>COMPLETE</promise>"; then
    echo ""
    echo "Ralph completed the autonomous research loop."
    echo "Completed at iteration $i of $MAX_ITERATIONS"
    exit 0
  fi

  if should_stop_for_user_review; then
    echo ""
    echo "Ralph reached the user review gate."
    echo "Completed at iteration $i of $MAX_ITERATIONS"
    exit 0
  fi

  echo "Iteration $i complete. Transcript saved to: $ITERATION_LOG_FILE"
  sleep 2
done

echo ""
echo "Ralph reached max iterations ($MAX_ITERATIONS) without reaching the review gate."
echo "Check $PROGRESS_FILE and $ITERATION_LOG_ROOT for status."
exit 1

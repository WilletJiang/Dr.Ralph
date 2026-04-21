import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { findPackageRoot } from "./package-root.js";
import {
  asString,
  getAutomationState,
  getResearchMode,
  getResearchModeWarning,
  getReviewPanel,
  getReviewReworkPolicy,
} from "./project.js";
import { ResearchMode, ToolName } from "./types.js";

export interface PromptBuildContext {
  tool: ToolName;
  control: Record<string, unknown>;
  currentStage: string | null;
  currentItemId: string | null;
}

type StoryRecord = Record<string, unknown>;

const PROGRESS_REPORT_FORMAT = `APPEND to the configured progress file:
\`\`\`
## [Date/Time] - [Research Item ID]
- Stage
- Goal of this iteration
- Files and artifacts updated
- Exploration log paths touched
- What was learned
- Evidence summary
- Review findings addressed (if on a reopened loop)
- Decision: promoted / rejected / blocked / autonomous_rework / handoff_to_user / awaiting_user_review
- How \`idea.md\` changed, if it changed
- Next best move
---
\`\`\``;

const STOP_CONDITION = `Reply with:
<promise>COMPLETE</promise>

only when either:
- \`automation.state\` is \`awaiting_user_review\`
- there are no remaining auto-eligible queued items before the review gate
- the control file explicitly says the autonomous loop should stop`;

const SHARED_RIGOR_BLOCK = [
  "Operate with greater rigor, attention to detail, and multi-angle verification than a normal research pass.",
  "Start each iteration by outlining the exact stage task and decomposing it into the smallest meaningful subtasks.",
  "For every important subtask, inspect multiple perspectives, including serious alternative explanations or initially unlikely angles when they could change the conclusion.",
  "Deliberately challenge your current assumptions, working hypotheses, and intermediate conclusions at every step; prefer finding disproofs, counterexamples, or mechanism failures over defending the first plausible story.",
  "Treat every important conclusion as needing the moral equivalent of triple verification through independent evidence rather than repeated restatement.",
  "Cross-check facts, inferences, and conclusions with the strongest relevant evidence available for this stage: direct artifact inspection, raw logs, calculations, literature, authoritative sources, tool-based validation, formal systems, or controlled experiments.",
  "Use mathematical checks, web research, logic or formal evaluation, and additional tools when they are genuinely relevant and add independent signal; do not perform ceremonial verification that fails to reduce uncertainty.",
  "Keep uncertainties, alternative viewpoints, hidden assumptions, and residual risks explicit instead of smoothing them away.",
  "Even when you feel confident, spend additional effort searching for weaknesses, logical gaps, overlooked edge cases, and untested assumptions. Document the strongest remaining doubt and how it was handled.",
  "Before promoting, rejecting, or finalizing a stage artifact, pause and reconsider the reasoning chain at a high level from scratch. If that fresh pass changes the judgment, revise the artifacts honestly.",
].join("\n- ");

const CROSS_MODE_TASTE_RULES = [
  "Prefer the smallest idea that could plausibly matter.",
  "Reject kitchen-sink proposals.",
  "One research item should test one sharp mechanism.",
  "If the mechanism cannot be explained crisply in 1-2 sentences, it is not ready.",
  "Negative evidence is valuable; do not rescue weak ideas with more complexity.",
  "Treat the user's stated background, resources, and requirements as hard context.",
].join("\n- ");

const MODE_BLOCKS: Record<ResearchMode, string> = {
  experimental_research: [
    "Focus on evaluation framing, literature review, idea proposal, validation planning, early exploration, convergence, and clean handoff.",
    "Treat benchmark, evaluation, systems constraints, and invalid-win conditions in the control file as hard.",
    "Do not claim wins that depend on hidden ensembling, metric gaming, benchmark leakage, or vague evaluation.",
    "When proposing an idea, explain the mechanism, why it is genuinely new enough to matter, and how it will be evaluated honestly.",
  ].join("\n- "),
  theoretical_research: [
    "This mode is Lean-first by default. Treat `theoreticalTooling.profile = lean4_skills_plus_lsp` as the standard verification stack, not an optional suggestion.",
    "Read the local Lean skill file at `theoreticalTooling.lean4SkillPath` before doing serious theory work.",
    "Treat `theoreticalTooling.leanLspMcpRequired = true` as a real constraint. If the configured stack is missing, bootstrap it or mark the run blocked instead of freehanding long proofs.",
    "Use Lean-backed checks, statement drafting, library search, proof-shape validation, and obstruction hunting as early as possible once claims become nontrivial.",
    "When proposing a claim, explain why it matters, what Lean should validate, and what negative formalization evidence would kill it.",
  ].join("\n- "),
};

const STAGE_HARNESSES: Record<ResearchMode, Record<string, string>> = {
  experimental_research: {
    problem_framing: [
      "Lock the exact research question, success definition, and non-goals with zero ambiguity.",
      "Verify that the framing is falsifiable, resistant to fake wins, and does not silently smuggle in a preferred method or implementation plan.",
      "Pressure-test whether the problem statement has been distorted to fit the method you want to build instead of the question that matters.",
      "Surface the strongest alternative framing and the most dangerous ambiguity before finalizing the writeup.",
    ].join("\n- "),
    evaluation_framing: [
      "Map the evaluation setup, baselines, failure slices, confounders, and invalid-win conditions in enough detail to prevent self-deception later.",
      "Verify what the benchmark or task actually rewards, where noise can enter, and which failure modes would make a claimed win dishonest.",
      "Challenge whether the metric can be gamed, whether a surface improvement would be rewarded incorrectly, and whether a baseline already captures the proposed mechanism.",
      "Prefer evaluation rules that can quickly falsify weak ideas rather than only confirm favored ones.",
    ].join("\n- "),
    literature_review: [
      "Identify the strongest relevant prior work, its true mechanisms, its failure boundaries, and the real gap that remains.",
      "Verify that the gap is substantive rather than a naming change, recombination, or cosmetic novelty claim.",
      "Challenge whether the current idea is already implied, already solved, or ruled out by the closest literature.",
      "Keep the review narrow and adversarial: strongest work first, weakest novelty claims first.",
    ].join("\n- "),
    idea_proposal: [
      "State the mechanism crisply, including the smallest defensible version of the idea and why it could matter.",
      "Verify that the idea is not merely a narrow follow-up tweak and that its evaluation path is honest and concrete.",
      "Challenge whether existing methods are already sufficient, whether the mechanism is overcomplicated, and whether the idea survives simplification.",
      "Make falsification conditions explicit and prefer killing a weak idea over dressing it up.",
    ].join("\n- "),
    validation_plan: [
      "Design the smallest decisive experiments, kill criteria, promotion criteria, and ordering constraints needed to test the mechanism honestly.",
      "Verify that each planned experiment meaningfully reduces uncertainty and that the plan can distinguish the target mechanism from confounds.",
      "Challenge whether the plan is proving the idea right instead of trying to prove it wrong quickly.",
      "Be explicit about what must remain sequential, what can be parallelized, and what evidence would stop the line of work immediately.",
    ].join("\n- "),
    early_exploration: [
      "Run the planned decisive experiments and anchor all conclusions in raw logs, configs, commands, and observed results.",
      "Verify whether the observed behavior actually supports the claimed mechanism rather than accidental implementation effects, leakage, noise, or benchmark quirks.",
      "Challenge every seemingly positive observation with alternative explanations, counterexamples, or sanity checks.",
      "Update `idea.md` and the live evidence trail whenever the best current idea strengthens, weakens, or dies.",
    ].join("\n- "),
    idea_convergence: [
      "Converge only the claims that survive evidence, and remove or downgrade any claim that is not honestly supported.",
      "Verify that the final writeup separates what is established from what remains risky, fragile, or merely plausible.",
      "Challenge whether sunk-cost bias, elegance bias, or narrative neatness is keeping a weak idea alive.",
      "Professionalize `idea.md` so that a later final review can judge the idea cleanly instead of reverse-engineering a messy draft.",
    ].join("\n- "),
    final_review: [
      "Treat this stage as the final AI review controller: inspect the whole research chain, not just the prose quality of the current writeup.",
      "Write the top-level `review` panel in `research_program.json` before drafting or revising `research/final-review.md`, and keep the panel and memo consistent.",
      "Verify mechanism evidence separately from result evidence, and challenge whether any apparent win could still be explained by noise, leakage, implementation bias, confounds, or metric gaming.",
      "Require a positive handoff recommendation to clear a modernity bar: the algorithm should look current rather than stale, and it should have a credible path to large-scale GPU execution rather than collapsing outside toy-scale settings.",
      "Challenge whether the method is algorithmically dated, architecturally obsolete, serial by design, memory-inefficient at scale, or mismatched to modern accelerator-heavy training or inference regimes.",
      "If rework is warranted, name a concrete earlier `reopenStage` and explicit `reworkGoals` that can materially improve evidence quality rather than merely polishing prose.",
    ].join("\n- "),
    user_review: [
      "Treat this stage as a pure handoff and stop gate after `final_review`, not as another chance to continue exploring.",
      "Verify that `review.status` is `complete`, `review.nextAction` is `handoff_to_user`, and the repository is ready for human inspection.",
      "Set `automation.state` to `awaiting_user_review` only after the final review package is complete and consistent.",
      "Leave a human reviewer with a clean stop point and no hidden autonomous continuation.",
    ].join("\n- "),
  },
  theoretical_research: {
    problem_framing: [
      "Lock the exact theoretical question, what would count as genuine progress, and which outcomes are explicitly out of scope.",
      "Verify that the question is precise enough to attack and that the success definition is not a vague statement of ambition.",
      "Challenge whether the current framing is chasing an unattackable, underspecified, or artificially inflated claim.",
      "Surface the strongest alternative framing and the most dangerous ambiguity before proceeding.",
    ].join("\n- "),
    concept_framing: [
      "Clarify the key definitions, objects, and conceptual bottlenecks as sharply as possible.",
      "Verify that each definition is necessary, coherent, and directly tied to the eventual argument rather than decorative generality.",
      "Challenge whether you are introducing unnecessary concepts, excessive abstraction, or ambiguity that only looks sophisticated.",
      "Record which ambiguities still block theorem shaping and which definitions already seem stable.",
    ].join("\n- "),
    literature_review: [
      "Study the most relevant prior results, argument shapes, mechanisms, and known obstructions first.",
      "Verify the actual unresolved conceptual gap instead of accepting novelty claims at face value.",
      "Challenge whether the current idea is merely an old framework in new language or already blocked by a known counterexample or limitation.",
      "Keep the review focused on work that can genuinely validate, refute, or narrow the target claim.",
    ].join("\n- "),
    statement_drafting: [
      "Draft the sharpest plausible claim, theorem shape, or obstruction that current evidence can honestly support.",
      "Verify that the statement is precise, falsifiable where possible, and clear about uncertainty or missing conditions.",
      "Challenge whether the statement is too strong, too weak, unnatural, or smuggles in assumptions that have not been earned.",
      "Prefer a smaller, defensible claim over a grand but fragile one.",
    ].join("\n- "),
    proof_strategy: [
      "Design the main proof route, the key lemmas or reductions, and the places where Lean should pressure-test the argument.",
      "Verify which subgoals are truly load-bearing and which apparent routes are only intuitive sketches.",
      "Challenge whether the proof strategy is real progress or merely a narrative built from unvalidated intuitions.",
      "Make the most likely blockers and failure routes explicit before treating the strategy as credible.",
    ].join("\n- "),
    lean_formalization: [
      "Run Lean-backed statement search, library search, proof-shape feasibility checks, and obstruction hunting using the configured stack.",
      "Verify paper intuitions against Lean results, examples, failed proof attempts, and counterexamples.",
      "Challenge whether negative formalization evidence is already strong enough to kill or significantly narrow the claim.",
      "Record both positive and negative findings, and let formal blockers materially update belief.",
    ].join("\n- "),
    idea_convergence: [
      "Converge the final formulation only after separating supported claims from unsupported aspirations.",
      "Verify the evidence level behind each remaining claim, reduction, or obstruction, including what Lean did and did not confirm.",
      "Challenge whether 'not yet refuted' is being mistaken for 'credible contribution'.",
      "Professionalize `idea.md` so that a later final review can judge the formulation cleanly instead of decoding a moving target.",
    ].join("\n- "),
    final_review: [
      "Treat this stage as the final AI review controller: inspect the entire theoretical reasoning chain, not just the elegance of the writeup.",
      "Write the top-level `review` panel in `research_program.json` before drafting or revising `research/final-review.md`, and keep the panel and memo consistent.",
      "Verify the formulation against Lean-backed findings, paper-only intuitions, hidden assumptions, counterexamples, and known obstructions, and keep those evidence classes explicitly separated.",
      "If rework is warranted, name a concrete earlier `reopenStage` and explicit `reworkGoals` that can materially change credibility, such as statement drafting, proof strategy, or Lean formalization.",
    ].join("\n- "),
    user_review: [
      "Treat this stage as a transparent handoff and stop gate after `final_review`, not as a chance to continue speculative theory search.",
      "Verify that `review.status` is `complete`, `review.nextAction` is `handoff_to_user`, and the repository is reviewer-ready.",
      "Set `automation.state` to `awaiting_user_review` only after the final review package is complete and consistent.",
      "Leave the human reviewer with a crisp stop point and no hidden autonomous continuation.",
    ].join("\n- "),
  },
};

function resolvePromptFile(): string {
  const packageRoot = findPackageRoot();
  return join(packageRoot, "prompt.md");
}

async function loadProviderShell(): Promise<string> {
  return readFile(resolvePromptFile(), "utf8");
}

function findCurrentItem(
  control: Record<string, unknown>,
  currentItemId: string | null,
  currentStage: string | null,
): StoryRecord | null {
  const stories = Array.isArray(control.userStories) ? (control.userStories as StoryRecord[]) : [];
  if (currentItemId) {
    const byId = stories.find((story) => asString(story.id) === currentItemId);
    if (byId) {
      return byId;
    }
  }
  if (currentStage) {
    const byStage = stories.find(
      (story) =>
        asString(story.stage) === currentStage &&
        story.status === "queued" &&
        story.requiresUserIntervention !== true,
    );
    if (byStage) {
      return byStage;
    }
  }
  return null;
}

function formatList(value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) {
    return "- none specified";
  }
  const items = value
    .map((entry) => asString(entry))
    .filter((entry): entry is string => Boolean(entry));
  return items.length > 0 ? items.map((entry) => `- ${entry}`).join("\n") : "- none specified";
}

function formatCurrentItemContract(currentItem: StoryRecord | null, currentStage: string | null): string {
  if (!currentItem) {
    return [
      "## Current Item Contract",
      "",
      `- Current stage: \`${currentStage ?? "none"}\``,
      "- No auto-eligible current item could be derived from `userStories`.",
      "- Do not improvise a new research item. Inspect the control file, report the gap, and stop cleanly if no item is available.",
    ].join("\n");
  }

  return [
    "## Current Item Contract",
    "",
    `- ID: \`${asString(currentItem.id) ?? "unknown"}\``,
    `- Stage: \`${asString(currentItem.stage) ?? currentStage ?? "unknown"}\``,
    `- Title: ${asString(currentItem.title) ?? "none specified"}`,
    `- Hypothesis: ${asString(currentItem.hypothesis) ?? "none specified"}`,
    "",
    "### Deliverables",
    formatList(currentItem.deliverables),
    "",
    "### Constraints",
    formatList(currentItem.constraints),
    "",
    "### Acceptance Criteria",
    formatList(currentItem.acceptanceCriteria),
  ].join("\n");
}

function buildStageHarness(
  researchMode: ResearchMode | undefined,
  currentStage: string | null,
): string {
  if (!currentStage) {
    return [
      "## Stage-Specific Outer-Loop Harness",
      "",
      "- No current auto-eligible stage was derived from the control file.",
      "- Do not drift into a new stage on your own. Reconcile the control file, review the stop condition, and stop cleanly if no stage remains.",
    ].join("\n");
  }

  if (!researchMode) {
    return [
      "## Stage-Specific Outer-Loop Harness",
      "",
      `### Current Stage: \`${currentStage}\``,
      "- `researchMode` is missing or invalid, so the stage harness cannot be trusted.",
      "- Report the malformed control file instead of improvising stage behavior.",
    ].join("\n");
  }

  const harness = STAGE_HARNESSES[researchMode][currentStage];
  if (harness) {
    return [
      "## Stage-Specific Outer-Loop Harness",
      "",
      `### Current Stage: \`${currentStage}\``,
      `- ${harness}`,
    ].join("\n");
  }

  if (currentStage === "implementation" || currentStage === "benchmark_tuning") {
    return [
      "## Stage-Specific Outer-Loop Harness",
      "",
      `### Current Stage: \`${currentStage}\``,
      "- This is a post-review stage that requires explicit human approval and is outside autonomous scope.",
      "- Do not behave as if approval was granted, and do not inject a full autonomous research-stage harness here.",
      "- Limit yourself to preserving the stop boundary and making the need for human intervention explicit.",
    ].join("\n");
  }

  return [
    "## Stage-Specific Outer-Loop Harness",
    "",
    `### Current Stage: \`${currentStage}\``,
    "- No dedicated stage harness is defined for this stage.",
    "- Respect the current item contract, avoid inventing new workflow rules, and stop if the control file no longer matches the supported research loop.",
  ].join("\n");
}

function buildControlContext(
  control: Record<string, unknown>,
  researchModeWarning: string | null,
  currentStage: string | null,
  currentItemId: string | null,
): string {
  const problem = (control.problem ?? {}) as Record<string, unknown>;
  const question = asString(problem.question);
  const review = getReviewPanel(control);
  const reviewPolicy = getReviewReworkPolicy(control);

  return [
    "## Current Control-File Context",
    "",
    `- Research mode: \`${String(control.researchMode ?? "missing")}\``,
    `- Current stage: \`${currentStage ?? "none"}\``,
    `- Current item id: \`${currentItemId ?? "none"}\``,
    `- Automation state: \`${getAutomationState(control) ?? "unknown"}\``,
    `- Review status: \`${review.status}\``,
    `- Review cycle: ${String(review.cycle)}`,
    `- Review next action: \`${review.nextAction || "unset"}\``,
    `- Autonomous review rework allowed: \`${String(reviewPolicy.allowAutonomousRework)}\``,
    `- Review max cycles: ${reviewPolicy.maxCycles === null ? "none" : String(reviewPolicy.maxCycles)}`,
    `- Problem question: ${question ?? "not specified"}`,
    ...(researchModeWarning
      ? [
          `- Research mode warning: ${researchModeWarning}`,
          "- If the warning indicates a malformed control file, stop and report it rather than improvising.",
        ]
      : []),
  ].join("\n");
}

function buildModeBlock(researchMode: ResearchMode | undefined): string {
  if (!researchMode) {
    return [
      "## Research-Mode Harness",
      "",
      "- The control file does not define a valid `researchMode`.",
      "- Stop and report the malformed control file instead of continuing with an assumed mode.",
    ].join("\n");
  }

  return [
    "## Research-Mode Harness",
    "",
    `### Active Mode: \`${researchMode}\``,
    `- ${MODE_BLOCKS[researchMode]}`,
  ].join("\n");
}

function formatOptionalListSection(title: string, items: string[]): string {
  if (items.length === 0) {
    return [`### ${title}`, "- none recorded"].join("\n");
  }

  return [`### ${title}`, ...items.map((item) => `- ${item}`)].join("\n");
}

function buildReworkContext(
  control: Record<string, unknown>,
  currentStage: string | null,
): string {
  const review = getReviewPanel(control);
  if (
    review.status !== "complete" ||
    review.nextAction !== "autonomous_rework" ||
    !review.reopenStage ||
    currentStage === null ||
    currentStage === "final_review" ||
    currentStage === "user_review" ||
    currentStage === "implementation" ||
    currentStage === "benchmark_tuning"
  ) {
    return "";
  }

  return [
    "## Active Rework Context",
    "",
    `- This stage is running on a reopened path triggered by the most recent \`final_review\`.`,
    `- Reopened from stage: \`${review.reopenStage}\``,
    `- Current rework cycle: ${String(review.cycle)}`,
    "- Treat the review findings below as hard scope for the reopened loop rather than optional background context.",
    "- Do not spend the reopened loop on unrelated polishing, novelty hunting, or exploratory branches that fail to reduce these review concerns.",
    "- Each reopened iteration must directly address at least one review finding and record which finding moved, which stayed unresolved, and what new evidence changed.",
    "",
    formatOptionalListSection("Rework Goals", review.reworkGoals),
    "",
    formatOptionalListSection("Reviewer Questions", review.reviewerQuestions),
    "",
    formatOptionalListSection("Strongest Counterevidence", review.strongestCounterevidence),
    "",
    formatOptionalListSection("Hidden Assumptions", review.hiddenAssumptions),
    "",
    formatOptionalListSection("Residual Risks", review.residualRisks),
    "",
    "If the current stage cannot materially reduce these concerns, say so explicitly and justify whether the loop should continue to a later stage or return to final review quickly.",
  ].join("\n");
}

export async function buildRunPrompt(context: PromptBuildContext): Promise<string> {
  const providerShell = await loadProviderShell();
  const researchMode = getResearchMode(context.control);
  const researchModeWarning = getResearchModeWarning(context.control);
  const currentItem = findCurrentItem(context.control, context.currentItemId, context.currentStage);

  return [
    providerShell.trim(),
    "",
    "# Compiled Ralph Research Harness",
    "",
    "## Read First",
    "",
    "1. Read `research_program.json`.",
    "2. Read `researchMode`. If it is missing or invalid, stop and report that the control file is malformed.",
    "3. Read `researcherContext` and the intake file it points to.",
    "4. If `researcherContext.required` is true and `isComplete` is false, stop and ask the user to complete the intake before doing any autonomous work.",
    "5. Read the paths named in `harness`, especially the progress log, `idea.md`, overview, literature review, exploration plan, live log, and final review memo if they already exist.",
    "6. Read `problem`, `automation`, `review`, and `taste`. Read `benchmark`, `officialResult`, or `theoreticalTooling` only when they are present.",
    "7. Check out the branch named in `branchName`.",
    "8. Treat each iteration as fresh-context work: rely on the repository files and Ralph session artifacts, not on prior backend thread memory.",
    "",
    "## Mission",
    "",
    "Move through the queued autonomous research loop defined by `researchMode` and `userStories`, then stop at the user review gate.",
    "",
    "Do not auto-start implementation in `src/`, benchmark tuning, or other post-review execution unless the control file is explicitly changed by a human.",
    "",
    "## Outer-Loop Research Discipline",
    "",
    `- ${SHARED_RIGOR_BLOCK}`,
    "",
    "## Cross-Mode Taste Rules",
    "",
    `- ${CROSS_MODE_TASTE_RULES}`,
    "",
    buildControlContext(context.control, researchModeWarning, context.currentStage, context.currentItemId),
    "",
    buildModeBlock(researchMode),
    "",
    "## Iteration Contract",
    "",
    "1. Work on exactly one current item per iteration.",
    "2. Keep the work aligned with both the active `researchMode` and the user's stated constraints.",
    "3. Update `idea.md` whenever evidence changes the best current idea.",
    "4. Append a research log entry to the configured progress file.",
    "5. `final_review` decides whether to reopen an earlier stage or hand off to the user; only `user_review` sets `automation.state` to `awaiting_user_review` and stops.",
    "6. When an `Active Rework Context` block is present, its review findings are the mandatory agenda for the reopened loop.",
    "",
    formatCurrentItemContract(currentItem, context.currentStage),
    "",
    buildReworkContext(context.control, context.currentStage),
    "",
    buildStageHarness(researchMode, context.currentStage),
    "",
    "## Common Stage Rules",
    "",
    "### Researcher Intake",
    "- Treat the user-provided background and requirements as hard context, not optional flavor.",
    "- If the intake is missing or incomplete, stop instead of hallucinating context.",
    "",
    "### Idea Convergence",
    "- Stop exploration once the major unknowns are resolved or the idea is invalidated.",
    "- Rewrite `idea.md` into a clean, professional final version grounded in evidence.",
    "- Do not use this stage to decide the final handoff versus rework judgment; that belongs to `final_review`.",
    "",
    "### Final Review",
    "- Update the structured `review` panel in `research_program.json` before rewriting `research/final-review.md`.",
    "- Fill `review.status`, `review.confidence`, `review.evidenceStrength`, `review.finalClaim`, `review.strongestSupport`, `review.strongestCounterevidence`, `review.hiddenAssumptions`, `review.alternativeExplanationsOrObstructions`, `review.fitToRequirements`, `review.residualRisks`, `review.reviewerQuestions`, and `review.suggestedNextStep` explicitly.",
    "- Choose exactly one `review.nextAction`: `handoff_to_user` or `autonomous_rework`.",
    "- If `review.nextAction` is `autonomous_rework`, specify a concrete earlier `review.reopenStage` and explicit `review.reworkGoals`.",
    "- If `review.nextAction` is `handoff_to_user`, specify `review.handoffRecommendation` and leave `automation.state` unchanged for `user_review` to handle.",
    "",
    "### User Review",
    "- Do not perform another substantive research review here; treat this as the stop boundary only.",
    "- Require `review.status = complete` and `review.nextAction = handoff_to_user` before stopping.",
    "- Set `automation.state` to `awaiting_user_review`.",
    "- Leave the repository ready for a human reviewer to inspect `idea.md` and `research/final-review.md`.",
    "",
    "## Promotion Rules",
    "",
    "An item may be marked `status: \"promoted\"` with `passes: true` only if:",
    "- its required deliverables were produced",
    "- its acceptance criteria were met",
    "- its constraints still hold",
    "- the evidence is strong enough for that stage",
    "",
    "Use:",
    "- `status: \"rejected\"` for ideas invalidated on evidence or taste grounds",
    "- `status: \"blocked\"` for infrastructure or prerequisite issues",
    "- `status: \"queued\"` for the reopened stage path after `final_review` selects `autonomous_rework`",
    "- `status: \"awaiting_user_review\"` for the review-gate item once the handoff package is ready",
    "",
    "## Progress Report Format",
    "",
    PROGRESS_REPORT_FORMAT,
    "",
    "## Stop Condition",
    "",
    STOP_CONDITION,
  ].join("\n");
}

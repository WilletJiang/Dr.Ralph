import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  applyFinalReviewDecision,
  evaluateHandoffReadiness,
  getCurrentStage,
  getHandoffGuards,
  getReviewPanel,
  repairInvalidUserReviewHandoff,
} from "../src/project.js";
import { ResearchMode } from "../src/types.js";

function packageRoot(): string {
  return fileURLToPath(new URL("../", import.meta.url));
}

async function loadTemplateControl(researchMode: ResearchMode): Promise<Record<string, unknown>> {
  const root = packageRoot();
  return JSON.parse(
    await readFile(join(root, "templates", researchMode, "research_program.json"), "utf8"),
  ) as Record<string, unknown>;
}

function promoteUntilStage(control: Record<string, unknown>, stopStage: string): void {
  const stories = (control.userStories ?? []) as Record<string, unknown>[];
  for (const story of stories) {
    if (story.stage === stopStage) {
      break;
    }
    if (story.requiresUserIntervention === true) {
      continue;
    }
    story.status = "promoted";
    story.passes = true;
  }
}

function findStory(control: Record<string, unknown>, id: string): Record<string, unknown> {
  const story = ((control.userStories ?? []) as Record<string, unknown>[]).find(
    (entry) => entry.id === id,
  );
  if (!story) {
    throw new Error(`Missing story ${id}`);
  }
  return story;
}

describe("final review rework helper", () => {
  it("requeues the chosen stage path through final_review for autonomous rework", async () => {
    const control = await loadTemplateControl("experimental_research");
    promoteUntilStage(control, "final_review");

    control.review = {
      status: "complete",
      cycle: 0,
      nextAction: "autonomous_rework",
      handoffRecommendation: "",
      reopenStage: "validation_plan",
      reworkGoals: ["Tighten the decisive experiment plan"],
      confidence: "medium",
      evidenceStrength: "mixed",
      finalClaim: "Current evidence is not yet clean enough for handoff.",
      strongestSupport: ["The mechanism still looks plausible."],
      strongestCounterevidence: ["Current evidence does not separate mechanism from confounds."],
      hiddenAssumptions: ["The planned experiments are decisive enough."],
      alternativeExplanationsOrObstructions: ["Observed wins could still be benchmark artifacts."],
      fitToRequirements: ["The work still fits the user's setup."],
      residualRisks: ["The evaluation plan is not yet sharp enough."],
      reviewerQuestions: ["Should this be reopened from validation_plan?"],
      suggestedNextStep: "Reopen validation planning and rerun early exploration if needed.",
      completedAt: "",
    };

    const result = applyFinalReviewDecision(control);

    expect(result).toMatchObject({ controlChanged: true, reopenedStage: "validation_plan" });
    expect(getCurrentStage(control)).toBe("validation_plan");
    expect(findStory(control, "ER-005").status).toBe("queued");
    expect(findStory(control, "ER-006").status).toBe("queued");
    expect(findStory(control, "ER-007").status).toBe("queued");
    expect(findStory(control, "ER-008").status).toBe("queued");
    expect(findStory(control, "ER-009").status).toBe("queued");
    expect(findStory(control, "ER-004").status).toBe("promoted");
    expect(getReviewPanel(control).cycle).toBe(1);
    expect(getReviewPanel(control).completedAt).not.toBe("");
  });

  it("advances from final_review to user_review on handoff", async () => {
    const control = await loadTemplateControl("experimental_research");
    promoteUntilStage(control, "final_review");

    control.review = {
      status: "complete",
      cycle: 1,
      nextAction: "handoff_to_user",
      handoffRecommendation: "redirect",
      reopenStage: "",
      reworkGoals: [],
      confidence: "medium",
      evidenceStrength: "mixed",
      finalClaim: "The current idea is clear enough for a human redirect decision.",
      strongestSupport: ["The main mechanism and evidence are documented."],
      strongestCounterevidence: ["Residual uncertainty remains."],
      hiddenAssumptions: ["Scaling behavior is not yet proven."],
      alternativeExplanationsOrObstructions: ["A simpler baseline may still explain part of the gain."],
      fitToRequirements: ["The idea fits the user's stated constraints."],
      residualRisks: ["The next step needs human approval."],
      reviewerQuestions: ["Should the idea be redirected or approved?"],
      suggestedNextStep: "Hand off for human review.",
      completedAt: "",
    };

    const result = applyFinalReviewDecision(control);

    expect(result).toEqual({ controlChanged: true });
    expect(getCurrentStage(control)).toBe("user_review");
    expect(findStory(control, "ER-008").status).toBe("promoted");
    expect(findStory(control, "ER-008").passes).toBe(true);
    expect(findStory(control, "ER-009").status).toBe("queued");
    expect(getReviewPanel(control).cycle).toBe(1);
    expect(getReviewPanel(control).handoffRecommendation).toBe("redirect");
  });

  it("auto-reopens theoretical handoff when lean_formalization is still blocked", async () => {
    const control = await loadTemplateControl("theoretical_research");
    promoteUntilStage(control, "final_review");

    const lean = findStory(control, "TR-006");
    lean.status = "blocked";
    lean.passes = false;

    control.review = {
      status: "complete",
      cycle: 1,
      nextAction: "handoff_to_user",
      handoffRecommendation: "approve",
      reopenStage: "",
      reworkGoals: [],
      confidence: "medium",
      evidenceStrength: "mixed",
      finalClaim: "The idea seems ready.",
      strongestSupport: ["The framing is crisp."],
      strongestCounterevidence: ["Lean validation did not run."],
      hiddenAssumptions: ["The missing Lean pass does not matter."],
      alternativeExplanationsOrObstructions: [],
      fitToRequirements: ["The framing is small."],
      residualRisks: ["Lean validation is still missing."],
      reviewerQuestions: [],
      suggestedNextStep: "Hand off now.",
      completedAt: "",
    };

    const result = applyFinalReviewDecision(control);

    expect(result.controlChanged).toBe(true);
    expect(result.reopenedStage).toBe("lean_formalization");
    expect(getCurrentStage(control)).toBe("lean_formalization");
    expect(getReviewPanel(control).nextAction).toBe("autonomous_rework");
    expect(getReviewPanel(control).reopenStage).toBe("lean_formalization");
    expect(getReviewPanel(control).reworkGoals.join("\n")).toContain("Resolve handoff guard");
  });

  it("honors custom handoff guard stages when deciding readiness", async () => {
    const control = await loadTemplateControl("experimental_research");
    promoteUntilStage(control, "final_review");

    ((control.automation ?? {}) as Record<string, unknown>).handoffGuards = {
      requiredPassingStages: ["literature_review"],
      forbidBlockedPriorStages: false,
    };

    expect(getHandoffGuards(control)).toMatchObject({
      requiredPassingStages: ["literature_review"],
      forbidBlockedPriorStages: false,
    });
    expect(evaluateHandoffReadiness(control).ready).toBe(true);

    const literature = findStory(control, "ER-003");
    literature.status = "queued";
    literature.passes = false;

    const readiness = evaluateHandoffReadiness(control);
    expect(readiness.ready).toBe(false);
    expect(readiness.failingStage).toBe("literature_review");
  });

  it("blocks handoff readiness when a prior stage is blocked even if required stages pass", async () => {
    const control = await loadTemplateControl("experimental_research");
    promoteUntilStage(control, "final_review");

    const literature = findStory(control, "ER-003");
    literature.status = "blocked";
    literature.passes = false;

    const readiness = evaluateHandoffReadiness(control);
    expect(readiness.ready).toBe(false);
    expect(readiness.failingStage).toBe("literature_review");
    expect(readiness.reason).toContain("blocked");
  });

  it("repairs an invalid awaiting_user_review handoff back to the earliest failing stage", async () => {
    const control = await loadTemplateControl("theoretical_research");
    promoteUntilStage(control, "final_review");

    const finalReview = findStory(control, "TR-008");
    finalReview.status = "promoted";
    finalReview.passes = true;
    const userReview = findStory(control, "TR-009");
    userReview.status = "awaiting_user_review";
    userReview.passes = true;
    const lean = findStory(control, "TR-006");
    lean.status = "blocked";
    lean.passes = false;

    ((control.automation ?? {}) as Record<string, unknown>).state = "awaiting_user_review";
    control.review = {
      status: "complete",
      cycle: 1,
      nextAction: "handoff_to_user",
      handoffRecommendation: "redirect",
      reopenStage: "",
      reworkGoals: [],
      confidence: "medium",
      evidenceStrength: "mixed",
      finalClaim: "Current handoff is invalid.",
      strongestSupport: [],
      strongestCounterevidence: [],
      hiddenAssumptions: [],
      alternativeExplanationsOrObstructions: [],
      fitToRequirements: [],
      residualRisks: [],
      reviewerQuestions: [],
      suggestedNextStep: "Hand off now.",
      completedAt: "",
    };

    const result = repairInvalidUserReviewHandoff(control);

    expect(result.controlChanged).toBe(true);
    expect(result.reopenedStage).toBe("lean_formalization");
    expect(((control.automation ?? {}) as Record<string, unknown>).state).toBe("running");
    expect(getCurrentStage(control)).toBe("lean_formalization");
    expect(getReviewPanel(control).nextAction).toBe("autonomous_rework");
  });

  it("blocks autonomous rework requests that exceed maxCycles", async () => {
    const control = await loadTemplateControl("experimental_research");
    promoteUntilStage(control, "final_review");
    ((control.automation ?? {}) as Record<string, unknown>).reviewReworkPolicy = {
      allowAutonomousRework: true,
      maxCycles: 1,
    };
    control.review = {
      status: "complete",
      cycle: 1,
      nextAction: "autonomous_rework",
      handoffRecommendation: "",
      reopenStage: "literature_review",
      reworkGoals: ["Re-audit the gap"],
      confidence: "low",
      evidenceStrength: "weak",
      finalClaim: "The gap may still be fake novelty.",
      strongestSupport: [],
      strongestCounterevidence: ["The review budget is exhausted."],
      hiddenAssumptions: [],
      alternativeExplanationsOrObstructions: [],
      fitToRequirements: [],
      residualRisks: [],
      reviewerQuestions: [],
      suggestedNextStep: "Hand off or revise policy.",
      completedAt: "",
    };

    const result = applyFinalReviewDecision(control);

    expect(result.controlChanged).toBe(false);
    expect(result.blockedReason).toContain("maxCycles");
    expect(getCurrentStage(control)).toBe("final_review");
  });
});

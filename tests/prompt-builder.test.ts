import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { buildRunPrompt } from "../src/prompt-builder.js";
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

const STAGE_MARKERS: Record<ResearchMode, Record<string, string>> = {
  experimental_research: {
    problem_framing: "resistant to fake wins",
    evaluation_framing: "invalid-win conditions",
    literature_review: "naming change, recombination, or cosmetic novelty claim",
    idea_proposal: "smallest defensible version of the idea",
    validation_plan: "proving the idea right instead of trying to prove it wrong quickly",
    early_exploration: "accidental implementation effects, leakage, noise, or benchmark quirks",
    idea_convergence: "sunk-cost bias, elegance bias, or narrative neatness",
    final_review: "final AI review controller",
    user_review: "pure handoff and stop gate after `final_review`",
  },
  theoretical_research: {
    problem_framing: "unattackable, underspecified, or artificially inflated claim",
    concept_framing: "decorative generality",
    literature_review: "old framework in new language",
    statement_drafting: "too strong, too weak, unnatural",
    proof_strategy: "narrative built from unvalidated intuitions",
    lean_formalization: "negative formalization evidence",
    idea_convergence: "not yet refuted",
    final_review: "final AI review controller",
    user_review: "transparent handoff and stop gate after `final_review`",
  },
};

describe("prompt builder", () => {
  it("includes shared rigor, mode-specific guidance, stage harness, and current item contract for every auto stage", async () => {
    for (const researchMode of ["experimental_research", "theoretical_research"] as const) {
      const control = await loadTemplateControl(researchMode);
      const stories = ((control.userStories ?? []) as Record<string, unknown>[]).filter(
        (story) => story.requiresUserIntervention !== true,
      );

      for (const story of stories) {
        const stage = String(story.stage);
        const prompt = await buildRunPrompt({
          tool: "codex",
          control,
          currentStage: stage,
          currentItemId: String(story.id),
        });

        expect(prompt).toContain("## Outer-Loop Research Discipline");
        expect(prompt).toContain("moral equivalent of triple verification");
        expect(prompt).toContain("## Research-Mode Harness");
        expect(prompt).toContain(`### Active Mode: \`${researchMode}\``);
        expect(prompt).toContain("## Current Item Contract");
        expect(prompt).toContain(`- ID: \`${story.id}\``);
        expect(prompt).toContain(`- Title: ${story.title}`);
        expect(prompt).toContain("## Stage-Specific Outer-Loop Harness");
        expect(prompt).toContain(`### Current Stage: \`${stage}\``);
        expect(prompt).toContain(STAGE_MARKERS[researchMode][stage]);
        expect(prompt).toContain("Review status");
        expect(prompt).toContain("Autonomous review rework allowed");
        expect(prompt).toContain("Required passing stages before handoff");
        expect(prompt).toContain("Blocked prior stages forbid handoff");

        if (researchMode === "experimental_research") {
          expect(prompt).toContain("metric gaming");
          expect(prompt).not.toContain("Lean-first by default");
          expect(prompt).not.toContain("conjecture");
        } else {
          expect(prompt).toContain("Lean-first by default");
          if (stage === "lean_formalization") {
            expect(prompt).toContain("bootstrap a viable project first");
            expect(prompt).toContain("toy-only model");
            expect(prompt).toContain("Formalize the strongest current theorem");
          }
          expect(prompt).not.toContain("metric gaming");
          expect(prompt).not.toContain("benchmark leakage");
        }

        if (stage === "final_review") {
          expect(prompt).toContain("review.nextAction");
          expect(prompt).toContain("review.reopenStage");
          expect(prompt).toContain("review.reworkGoals");
          expect(prompt).toContain("configured handoff guards");

          if (researchMode === "experimental_research") {
            expect(prompt).toContain("large-scale GPU execution");
            expect(prompt).toContain("algorithmically dated");
          } else {
            expect(prompt).not.toContain("large-scale GPU execution");
            expect(prompt).not.toContain("algorithmically dated");
          }
        }
      }
    }
  });

  it("injects a mandatory rework context block for reopened stages", async () => {
    const control = await loadTemplateControl("experimental_research");
    control.review = {
      status: "complete",
      cycle: 1,
      nextAction: "autonomous_rework",
      handoffRecommendation: "",
      reopenStage: "validation_plan",
      reworkGoals: ["Tighten the decisive experiment plan"],
      confidence: "medium",
      evidenceStrength: "mixed",
      finalClaim: "The idea is not ready for handoff.",
      strongestSupport: ["The mechanism still looks plausible."],
      strongestCounterevidence: ["The current evidence does not isolate the mechanism cleanly."],
      hiddenAssumptions: ["The plan is decisive enough."],
      alternativeExplanationsOrObstructions: ["Observed gains may still be confounded."],
      fitToRequirements: ["The work still fits the setup."],
      residualRisks: ["The evaluation plan is not sharp enough."],
      reviewerQuestions: ["Which experiment would actually disambiguate the mechanism?"],
      suggestedNextStep: "Reopen validation planning.",
      completedAt: "2026-04-21T00:00:00.000Z",
    };

    const prompt = await buildRunPrompt({
      tool: "codex",
      control,
      currentStage: "validation_plan",
      currentItemId: "ER-005",
    });

    expect(prompt).toContain("## Active Rework Context");
    expect(prompt).toContain("This stage is running on a reopened path");
    expect(prompt).toContain("Tighten the decisive experiment plan");
    expect(prompt).toContain("Which experiment would actually disambiguate the mechanism?");
    expect(prompt).toContain("The current evidence does not isolate the mechanism cleanly.");
    expect(prompt).toContain("its review findings are the mandatory agenda for the reopened loop");
  });

  it("uses a post-review boundary block for implementation and benchmark_tuning", async () => {
    const control = await loadTemplateControl("experimental_research");
    for (const stage of ["implementation", "benchmark_tuning"] as const) {
      const story = ((control.userStories ?? []) as Record<string, unknown>[]).find(
        (entry) => entry.stage === stage,
      );
      expect(story).toBeDefined();

      const prompt = await buildRunPrompt({
        tool: "codex",
        control,
        currentStage: stage,
        currentItemId: String(story?.id),
      });

      expect(prompt).toContain("requires explicit human approval and is outside autonomous scope");
      expect(prompt).not.toContain("accidental implementation effects, leakage, noise, or benchmark quirks");
      expect(prompt).not.toContain("naming change, recombination, or cosmetic novelty claim");
    }
  });
});

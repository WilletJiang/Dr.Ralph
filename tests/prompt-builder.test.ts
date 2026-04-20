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
    user_review: "handoff and stop gate",
  },
  theoretical_research: {
    problem_framing: "unattackable, underspecified, or artificially inflated claim",
    concept_framing: "decorative generality",
    literature_review: "old framework in new language",
    statement_drafting: "too strong, too weak, unnatural",
    proof_strategy: "narrative built from unvalidated intuitions",
    lean_formalization: "negative formalization evidence",
    idea_convergence: "not yet refuted",
    user_review: "transparent handoff to human review",
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

        if (researchMode === "experimental_research") {
          expect(prompt).toContain("metric gaming");
          expect(prompt).not.toContain("Lean-first by default");
          expect(prompt).not.toContain("conjecture");
        } else {
          expect(prompt).toContain("Lean-first by default");
          expect(prompt).not.toContain("metric gaming");
          expect(prompt).not.toContain("benchmark leakage");
        }
      }
    }
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

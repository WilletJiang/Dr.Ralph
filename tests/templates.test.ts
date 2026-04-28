import { access, readFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

function packageRoot(): string {
  return fileURLToPath(new URL("../", import.meta.url));
}

describe("research mode templates", () => {
  it("keeps the theoretical template free of gpu-parallel language", async () => {
    const root = packageRoot();
    const theoryIdea = await readFile(join(root, "templates", "theoretical_research", "idea.md"), "utf8");

    expect(theoryIdea.toLowerCase()).not.toContain("gpu");
  });

  it("keeps the experimental example on the experimental research mode", async () => {
    const root = packageRoot();
    const example = JSON.parse(await readFile(join(root, "research_program.json.example"), "utf8")) as {
      researchMode?: string;
    };

    expect(example.researchMode).toBe("experimental_research");
  });

  it("includes lean-first guidance in the theoretical template", async () => {
    const root = packageRoot();
    const [overview, plan] = await Promise.all([
      readFile(join(root, "templates", "theoretical_research", "research", "overview.md"), "utf8"),
      readFile(
        join(root, "templates", "theoretical_research", "experiments", "early-exploration", "plan.md"),
        "utf8",
      ),
    ]);

    expect(overview).toContain("Lean-first");
    expect(plan).toContain("Lean-Backed Checks");
  });

  it("requires substantive Lean validation in the theoretical control template", async () => {
    const root = packageRoot();
    const control = JSON.parse(
      await readFile(join(root, "templates", "theoretical_research", "research_program.json"), "utf8"),
    ) as Record<string, unknown>;
    const leanStage = ((control.userStories ?? []) as Record<string, unknown>[]).find(
      (story) => story.stage === "lean_formalization",
    );

    expect(leanStage?.hypothesis).toContain("Substantive Lean-backed checks");
    expect(leanStage?.constraints).toContain(
      "Do not promote this stage on toy-only models, vacuous headers, or purely cosmetic theorem skeletons",
    );
    expect(leanStage?.acceptanceCriteria).toContain(
      "Run the strongest available project build, sorry, and axiom checks",
    );
  });

  it("does not ship a separate formalized_research template anymore", async () => {
    const root = packageRoot();
    await expect(
      access(join(root, "templates", "formalized_research"), fsConstants.F_OK),
    ).rejects.toBeDefined();
  });

  it("ships final_review and structured review policy in both mode templates", async () => {
    const root = packageRoot();

    for (const researchMode of ["experimental_research", "theoretical_research"] as const) {
      const control = JSON.parse(
        await readFile(join(root, "templates", researchMode, "research_program.json"), "utf8"),
      ) as Record<string, unknown>;
      const automation = (control.automation ?? {}) as Record<string, unknown>;
      const review = (control.review ?? {}) as Record<string, unknown>;
      const stages = ((control.userStories ?? []) as Record<string, unknown>[]).map((story) =>
        String(story.stage),
      );

      expect(stages).toContain("final_review");
      expect(stages).toContain("user_review");
      expect((automation.reviewReworkPolicy ?? {}) as Record<string, unknown>).toMatchObject({
        allowAutonomousRework: true,
        maxCycles: null,
      });
      expect((automation.handoffGuards ?? {}) as Record<string, unknown>).toMatchObject({
        forbidBlockedPriorStages: true,
      });
      expect(review).toMatchObject({
        status: "pending",
        cycle: 0,
        nextAction: "",
        reopenStage: "",
      });
    }
  });

  it("assigns the expected default handoff guards by research mode", async () => {
    const root = packageRoot();
    const experimental = JSON.parse(
      await readFile(join(root, "templates", "experimental_research", "research_program.json"), "utf8"),
    ) as Record<string, unknown>;
    const theoretical = JSON.parse(
      await readFile(join(root, "templates", "theoretical_research", "research_program.json"), "utf8"),
    ) as Record<string, unknown>;

    expect((((experimental.automation ?? {}) as Record<string, unknown>).handoffGuards ?? {}) as Record<string, unknown>).toMatchObject({
      requiredPassingStages: [],
      forbidBlockedPriorStages: true,
    });
    expect((((theoretical.automation ?? {}) as Record<string, unknown>).handoffGuards ?? {}) as Record<string, unknown>).toMatchObject({
      requiredPassingStages: ["lean_formalization"],
      forbidBlockedPriorStages: true,
    });
  });
});

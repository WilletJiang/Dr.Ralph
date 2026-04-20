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

  it("does not ship a separate formalized_research template anymore", async () => {
    const root = packageRoot();
    await expect(
      access(join(root, "templates", "formalized_research"), fsConstants.F_OK),
    ).rejects.toBeDefined();
  });
});

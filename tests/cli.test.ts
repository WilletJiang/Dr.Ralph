import { execFile } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { parseResearchModeSelection, resolveInitResearchMode } from "../src/cli.js";

const execFileAsync = promisify(execFile);

function packageRoot(): string {
  return fileURLToPath(new URL("../", import.meta.url));
}

describe("cli research mode helpers", () => {
  it("maps friendly research mode selections to canonical values", () => {
    expect(parseResearchModeSelection("1")).toBe("experimental_research");
    expect(parseResearchModeSelection("experimental")).toBe("experimental_research");
    expect(parseResearchModeSelection("2")).toBe("theoretical_research");
    expect(parseResearchModeSelection("theoretical")).toBe("theoretical_research");
    expect(parseResearchModeSelection("unknown")).toBeNull();
  });

  it("requires an explicit research mode for non-interactive init", async () => {
    await expect(resolveInitResearchMode(undefined, { interactive: false })).rejects.toThrow(
      "Research mode is required for non-interactive init.",
    );
  });

  it("uses the interactive prompt hook when init runs in a tty", async () => {
    await expect(
      resolveInitResearchMode(undefined, {
        interactive: true,
        prompt: async () => "theoretical_research",
      }),
    ).resolves.toBe("theoretical_research");
  });

  it("rejects the removed --init-intake alias", async () => {
    const root = packageRoot();
    const tsxPath = join(root, "node_modules", ".bin", "tsx");

    await expect(
      execFileAsync(tsxPath, ["src/cli-bin.ts", "--init-intake"], { cwd: root }),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("unknown option '--init-intake'"),
    });
  });
});

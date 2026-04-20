import { describe, expect, it } from "vitest";

import { parseResearchModeSelection, resolveInitResearchMode } from "../src/cli.js";

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
});

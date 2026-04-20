import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { LocalCliBackend } from "../src/backends.js";
import { intakeSet } from "../src/intake.js";
import { getStatus, initProject, readControlFile } from "../src/project.js";
import { runResearch } from "../src/run.js";

const tempDirs: string[] = [];

async function makeProject() {
  const dir = await mkdtemp(join(tmpdir(), "ralph-test-"));
  tempDirs.push(dir);
  return initProject(join(dir, "proj"), false, "experimental_research");
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("intake and run behavior", () => {
  it("writes intake artifacts and updates status", async () => {
    const project = await makeProject();
    const result = await intakeSet(project, {
      background: "systems researcher",
      requirements: "gpu parallelism",
      resources: "4x A100",
      collaboration: "stop before implementation",
      extra: "prefer simple ideas",
    });

    const control = await readControlFile(project);
    expect(((control.researcherContext ?? {}) as { isComplete?: boolean }).isComplete).toBe(true);

    const intakeMarkdown = await readFile(join(project.rootDir, "research", "intake.md"), "utf8");
    expect(intakeMarkdown).toContain("systems researcher");
    expect(result.session.lifecycleState).toBe("completed");

    const status = await getStatus(project);
    expect(status.intakeComplete).toBe(true);
    expect(status.latestSessionId).toBe(result.session.sessionId);
  });

  it("blocks run when intake is incomplete", async () => {
    const project = await makeProject();
    const session = await runResearch(project, {
      tool: "amp",
      model: "gpt5.4-xhigh",
      maxIterations: 1,
    });

    expect(session.lifecycleState).toBe("blocked");
    expect(session.latestError).toContain("intake");
    expect(session.backend).toBe("local-cli");
  });

  it("records the chosen backend before starting a non-codex run", async () => {
    const project = await makeProject();
    await intakeSet(project, {
      background: "systems researcher",
      requirements: "gpu parallelism",
      resources: "local test only",
      collaboration: "stop before implementation",
      extra: "prefer simple ideas",
    });

    const runTurn = vi.spyOn(LocalCliBackend.prototype, "runTurn").mockResolvedValue({
      lifecycleState: "completed",
      finalResponse: "<promise>COMPLETE</promise>",
    });

    try {
      const session = await runResearch(project, {
        tool: "amp",
        model: "gpt5.4-xhigh",
        maxIterations: 1,
      });

      expect(session.backend).toBe("local-cli");

      const eventsPath = join(project.rootDir, ".ralph", "sessions", session.sessionId, "events.jsonl");
      const events = (await readFile(eventsPath, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as { type: string; data?: Record<string, unknown> });
      const started = events.find((event) => event.type === "run.started");

      expect(started?.data?.backend).toBe("local-cli");
      expect(runTurn).toHaveBeenCalledOnce();
    } finally {
      runTurn.mockRestore();
    }
  });
});

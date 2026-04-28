import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  buildDashboardSnapshot,
  parseTimelineItems,
  startDashboardServer,
} from "../src/dashboard.js";
import { intakeSet } from "../src/intake.js";
import { initProject, readControlFile } from "../src/project.js";
import { appendSessionEvent, createSession } from "../src/sessions.js";

const tempDirs: string[] = [];

async function makeProject() {
  const dir = await mkdtemp(join(tmpdir(), "ralph-dashboard-test-"));
  tempDirs.push(dir);
  return initProject(join(dir, "proj"), false, "theoretical_research");
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("dashboard helpers", () => {
  it("parses a condensed timeline from session events", () => {
    const events = [
      {
        timestamp: "2026-01-01T00:00:00.000Z",
        sessionId: "s1",
        type: "session.started",
        data: { provider: "codex", backend: "codex-sdk", model: "gpt5.5-xhigh" },
      },
      {
        timestamp: "2026-01-01T00:00:01.000Z",
        sessionId: "s1",
        type: "run.repaired",
        data: { reopenedStage: "lean_formalization", reason: "guard unmet" },
      },
      {
        timestamp: "2026-01-01T00:00:02.000Z",
        sessionId: "s1",
        type: "run.model_fallback",
        data: { fromModel: "gpt5.5-xhigh", toModel: "gpt5.4-xhigh", reason: "unavailable" },
      },
      {
        timestamp: "2026-01-01T00:00:03.000Z",
        sessionId: "s1",
        type: "run.backend.event",
        data: {
          type: "item.completed",
          item: { type: "command_execution", command: "lake init proj math", exit_code: 0 },
        },
      },
    ];

    const timeline = parseTimelineItems(events.map((event) => JSON.stringify(event)).join("\n"));

    expect(timeline).toHaveLength(4);
    expect(timeline[0].label).toContain("Command completed");
    expect(timeline[1].label).toContain("Model fallback");
    expect(timeline[2].label).toContain("Auto-reopened");
    expect(timeline[3].label).toContain("Session started");
  });

  it("builds a snapshot with latest session metadata and timeline entries", async () => {
    const project = await makeProject();
    await intakeSet(project, {
      background: "theory researcher",
      requirements: "show progress cleanly",
      resources: "local test only",
      collaboration: "review before implementation",
      extra: "prefer honest blockers",
    });

    const control = await readControlFile(project);
    const session = await createSession(project, {
      provider: "codex",
      backend: "codex-sdk",
      model: "gpt5.5-xhigh",
      lifecycleState: "running",
      currentStage: "lean_formalization",
      currentItemId: "TR-006",
      currentQuestion: null,
      projectRoot: project.rootDir,
      controlFilePath: project.controlFilePath,
      artifacts: {
        controlFile: project.controlFilePath,
        ideaFile: join(project.rootDir, "idea.md"),
        intakeFile: join(project.rootDir, "research", "intake.md"),
        reviewMemoFile: join(project.rootDir, "research", "final-review.md"),
        progressFile: join(project.rootDir, "progress.txt"),
        explorationRoot: join(project.rootDir, "experiments", "early-exploration"),
        liveLogFile: join(project.rootDir, "experiments", "early-exploration", "live-log.md"),
        iterationLogRoot: join(project.rootDir, "experiments", "early-exploration", "agent-runs"),
      },
    });

    await appendSessionEvent(project, {
      timestamp: new Date().toISOString(),
      sessionId: session.sessionId,
      type: "run.repaired",
      data: { reopenedStage: "lean_formalization", reason: "guard unmet" },
    });
    await writeFile(join(project.rootDir, "progress.txt"), "## [now] - TR-006\n- Decision: reopened\n---\n");
    await writeFile(
      join(project.rootDir, "experiments", "early-exploration", "live-log.md"),
      "# Live Log\n\n## [now]\n- Question or lemma under test: bootstrap\n- Decision: continue\n",
    );
    await writeFile(join(project.rootDir, "research", "final-review.md"), "# Final Review Memo\n\n## Recommendation\n\nReopen.\n");

    const snapshot = await buildDashboardSnapshot(project);

    expect(snapshot.latestSession?.sessionId).toBe(session.sessionId);
    expect(snapshot.latestSession?.backend).toBe("codex-sdk");
    expect(snapshot.latestSession?.model).toBe("gpt5.5-xhigh");
    expect(snapshot.handoffGuards.requiredPassingStages).toEqual(["lean_formalization"]);
    expect(snapshot.latestProgressEntry).toContain("Decision: reopened");
    expect(snapshot.timeline[0]?.label).toContain("Auto-reopened");
    expect(snapshot.stages.some((stage) => stage.stage === "lean_formalization")).toBe(true);
    expect(control.researchMode).toBe("theoretical_research");
  });

  it("serves the dashboard HTML and snapshot API", async () => {
    const project = await makeProject();
    await intakeSet(project, {
      background: "theory researcher",
      requirements: "serve dashboard",
      resources: "local test only",
      collaboration: "review before implementation",
      extra: "prefer no frameworks",
    });

    const { server, url } = await startDashboardServer(project, { port: 0 });
    try {
      const [htmlResponse, apiResponse] = await Promise.all([
        fetch(url),
        fetch(new URL("/api/snapshot", url)),
      ]);

      expect(await htmlResponse.text()).toContain("Dr.Ralph Progress Dashboard");
      const snapshot = (await apiResponse.json()) as Awaited<ReturnType<typeof buildDashboardSnapshot>>;
      expect(snapshot.projectRoot).toBe(project.rootDir);
      expect(snapshot.artifacts.ideaFile).toContain("idea.md");
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  });
});

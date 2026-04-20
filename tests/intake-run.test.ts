import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { CodexBackend, LocalCliBackend } from "../src/backends.js";
import { intakeSet } from "../src/intake.js";
import { createSession } from "../src/sessions.js";
import { getArtifactPaths, getStatus, initProject, readControlFile, writeControlFile } from "../src/project.js";
import { runResearch } from "../src/run.js";
import type { BackendRunContext } from "../src/types.js";

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

  it("starts a fresh Codex SDK thread for each turn", async () => {
    const project = await makeProject();
    await intakeSet(project, {
      background: "systems researcher",
      requirements: "file-driven fresh context",
      resources: "codex auth available",
      collaboration: "stop before implementation",
      extra: "prefer simple ideas",
    });

    const control = await readControlFile(project);
    const session = await createSession(project, {
      provider: "codex",
      backend: "codex-sdk",
      model: "gpt5.4-xhigh",
      lifecycleState: "idle",
      currentStage: "fresh_context_test",
      currentItemId: "FC-001",
      currentQuestion: null,
      projectRoot: project.rootDir,
      controlFilePath: project.controlFilePath,
      artifacts: getArtifactPaths(project, control),
    });

    const events = (async function* () {
      yield {
        type: "item.completed",
        item: { type: "agent_message", text: "TEST_OK" },
      };
    })();

    const runStreamed = vi.fn().mockResolvedValue({ events });
    const startThread = vi.fn().mockReturnValue({ runStreamed });
    const fakeAgent = { startThread } as unknown as ConstructorParameters<typeof CodexBackend>[0];
    const backend = new CodexBackend(fakeAgent);

    const context: BackendRunContext = {
      session,
      project,
      maxIterations: 1,
      prompt: "Reply with exactly TEST_OK and nothing else.",
    };

    const result = await backend.runTurn(context);

    expect(startThread).toHaveBeenCalledOnce();
    expect(result.finalResponse).toContain("TEST_OK");
  });

  it("uses fresh codex cli exec calls instead of exec resume", async () => {
    const project = await makeProject();
    await intakeSet(project, {
      background: "systems researcher",
      requirements: "file-driven fresh context",
      resources: "local codex cli only",
      collaboration: "stop before implementation",
      extra: "prefer simple ideas",
    });

    const control = await readControlFile(project);
    const session = await createSession(project, {
      provider: "codex",
      backend: "local-cli",
      model: "gpt5.4-xhigh",
      lifecycleState: "idle",
      currentStage: "fresh_context_test",
      currentItemId: "FC-002",
      currentQuestion: null,
      projectRoot: project.rootDir,
      controlFilePath: project.controlFilePath,
      artifacts: getArtifactPaths(project, control),
    });

    const commandRunner = vi.fn().mockResolvedValue({
      exitCode: 0,
      output: '{"type":"item.completed","item":{"type":"agent_message","text":"TEST_OK"}}\n',
    });

    const backend = new LocalCliBackend(commandRunner);
    const context: BackendRunContext = {
      session,
      project,
      maxIterations: 1,
      prompt: "Reply with exactly TEST_OK and nothing else.",
    };

    const result = await backend.runTurn(context);

    expect(commandRunner).toHaveBeenCalledOnce();
    expect(commandRunner).toHaveBeenCalledWith(
      "codex",
      [
        "exec",
        "--json",
        "--model",
        "gpt5.4-xhigh",
        "--dangerously-bypass-approvals-and-sandbox",
        "-",
      ],
      "Reply with exactly TEST_OK and nothing else.",
      project.rootDir,
    );
    expect(result.finalResponse).toContain("TEST_OK");
  });

  it("rebuilds the compiled prompt when the active outer-loop stage changes between iterations", async () => {
    const project = await makeProject();
    await intakeSet(project, {
      background: "systems researcher",
      requirements: "stage-aware compiled prompts",
      resources: "local test only",
      collaboration: "stop before implementation",
      extra: "prefer simple ideas",
    });

    const prompts: string[] = [];
    const runTurn = vi.spyOn(LocalCliBackend.prototype, "runTurn").mockImplementation(async (context) => {
      prompts.push(context.prompt);

      if (prompts.length === 1) {
        const control = await readControlFile(project);
        const first = ((control.userStories ?? []) as Record<string, unknown>[]).find(
          (story) => story.id === "ER-001",
        );
        if (first) {
          first.status = "promoted";
          first.passes = true;
        }
        await writeControlFile(project, control);
        return {
          lifecycleState: "completed",
          finalResponse: "continue",
        };
      }

      return {
        lifecycleState: "completed",
        finalResponse: "<promise>COMPLETE</promise>",
      };
    });

    try {
      const session = await runResearch(project, {
        tool: "amp",
        model: "gpt5.4-xhigh",
        maxIterations: 2,
      });

      expect(session.lifecycleState).toBe("completed");
      expect(prompts).toHaveLength(2);
      expect(prompts[0]).toContain("### Current Stage: `problem_framing`");
      expect(prompts[1]).toContain("### Current Stage: `evaluation_framing`");
      expect(prompts[0]).not.toBe(prompts[1]);
    } finally {
      runTurn.mockRestore();
    }
  });
});

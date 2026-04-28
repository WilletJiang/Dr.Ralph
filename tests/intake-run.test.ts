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

async function makeTheoreticalProject() {
  const dir = await mkdtemp(join(tmpdir(), "ralph-theory-test-"));
  tempDirs.push(dir);
  return initProject(join(dir, "proj"), false, "theoretical_research");
}

async function moveProjectToFinalReview(project: Awaited<ReturnType<typeof makeProject>>) {
  const control = await readControlFile(project);
  for (const story of (control.userStories ?? []) as Record<string, unknown>[]) {
    if (story.stage === "final_review") {
      break;
    }
    if (story.requiresUserIntervention === true) {
      continue;
    }
    story.status = "promoted";
    story.passes = true;
  }
  await writeControlFile(project, control);
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
    expect(status.latestSessionProvider).toBe("codex");
    expect(status.latestSessionBackend).toBe("local-cli");
    expect(status.latestSessionModel).toBe("gpt5.5-xhigh");
  });

  it("blocks run when intake is incomplete", async () => {
    const project = await makeProject();
    const session = await runResearch(project, {
      tool: "amp",
      model: "gpt5.5-xhigh",
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
        model: "gpt5.5-xhigh",
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
      model: "gpt5.5-xhigh",
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
    expect(startThread).toHaveBeenCalledWith(expect.objectContaining({
      model: "gpt-5.5",
      modelReasoningEffort: "xhigh",
    }));
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
      model: "gpt5.5-xhigh",
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
        "gpt-5.5",
        "--config",
        'model_reasoning_effort="xhigh"',
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
        model: "gpt5.5-xhigh",
        maxIterations: 2,
      });

      expect(session.lifecycleState).toBe("blocked");
      expect(prompts).toHaveLength(2);
      expect(prompts[0]).toContain("### Current Stage: `problem_framing`");
      expect(prompts[1]).toContain("### Current Stage: `evaluation_framing`");
      expect(prompts[0]).not.toBe(prompts[1]);
    } finally {
      runTurn.mockRestore();
    }
  });

  it("requeues an earlier stage after final_review requests autonomous rework", async () => {
    const project = await makeProject();
    await intakeSet(project, {
      background: "systems researcher",
      requirements: "review-driven autonomous rework",
      resources: "local test only",
      collaboration: "stop before implementation",
      extra: "prefer sharp evidence",
    });
    await moveProjectToFinalReview(project);

    const prompts: string[] = [];
    const runTurn = vi.spyOn(LocalCliBackend.prototype, "runTurn").mockImplementation(async (context) => {
      prompts.push(context.prompt);

      if (prompts.length === 1) {
        const control = await readControlFile(project);
        control.review = {
          status: "complete",
          cycle: 0,
          nextAction: "autonomous_rework",
          handoffRecommendation: "",
          reopenStage: "validation_plan",
          reworkGoals: ["Tighten the decisive experiment plan"],
          confidence: "medium",
          evidenceStrength: "mixed",
          finalClaim: "The idea is not yet ready for handoff.",
          strongestSupport: ["The mechanism still looks plausible."],
          strongestCounterevidence: ["The current evidence does not cleanly isolate the mechanism."],
          hiddenAssumptions: ["The experiment plan is decisive enough."],
          alternativeExplanationsOrObstructions: ["Observed gains may still be confounded."],
          fitToRequirements: ["The work still fits the user's setup."],
          residualRisks: ["The review still finds unresolved confounds."],
          reviewerQuestions: ["Should validation planning be reopened?"],
          suggestedNextStep: "Reopen validation planning before handoff.",
          completedAt: "",
        };
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
      await runResearch(project, {
        tool: "amp",
        model: "gpt5.5-xhigh",
        maxIterations: 2,
      });

      expect(prompts).toHaveLength(2);
      expect(prompts[0]).toContain("### Current Stage: `final_review`");
      expect(prompts[1]).toContain("### Current Stage: `validation_plan`");
      expect(prompts[1]).toContain("## Active Rework Context");
      expect(prompts[1]).toContain("Tighten the decisive experiment plan");
      expect(prompts[1]).toContain("Should validation planning be reopened?");
    } finally {
      runTurn.mockRestore();
    }
  });

  it("advances to user_review after final_review chooses handoff_to_user", async () => {
    const project = await makeProject();
    await intakeSet(project, {
      background: "systems researcher",
      requirements: "review-driven handoff",
      resources: "local test only",
      collaboration: "stop before implementation",
      extra: "prefer honest rejection over weak wins",
    });
    await moveProjectToFinalReview(project);

    const prompts: string[] = [];
    const runTurn = vi.spyOn(LocalCliBackend.prototype, "runTurn").mockImplementation(async (context) => {
      prompts.push(context.prompt);

      if (prompts.length === 1) {
        const control = await readControlFile(project);
        control.review = {
          status: "complete",
          cycle: 1,
          nextAction: "handoff_to_user",
          handoffRecommendation: "reject",
          reopenStage: "",
          reworkGoals: [],
          confidence: "medium",
          evidenceStrength: "mixed",
          finalClaim: "The idea is reviewer-ready but not strong enough to approve automatically.",
          strongestSupport: ["The evidence trail is complete."],
          strongestCounterevidence: ["The core claim still has material weaknesses."],
          hiddenAssumptions: ["The mechanism may not generalize."],
          alternativeExplanationsOrObstructions: ["A baseline may explain some of the result."],
          fitToRequirements: ["The work stayed within the user's constraints."],
          residualRisks: ["Human judgment is still required."],
          reviewerQuestions: ["Should this line of work be rejected or redirected?"],
          suggestedNextStep: "Hand off for human review.",
          completedAt: "",
        };
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
      await runResearch(project, {
        tool: "amp",
        model: "gpt5.5-xhigh",
        maxIterations: 2,
      });

      expect(prompts).toHaveLength(2);
      expect(prompts[0]).toContain("### Current Stage: `final_review`");
      expect(prompts[1]).toContain("### Current Stage: `user_review`");
    } finally {
      runTurn.mockRestore();
    }
  });

  it("runs without a default iteration cap until the workflow reaches user review", async () => {
    const project = await makeProject();
    await intakeSet(project, {
      background: "systems researcher",
      requirements: "complete the workflow by default",
      resources: "local test only",
      collaboration: "stop at user review",
      extra: "prefer explicit terminal states",
    });
    await moveProjectToFinalReview(project);

    const prompts: string[] = [];
    const runTurn = vi.spyOn(LocalCliBackend.prototype, "runTurn").mockImplementation(async (context) => {
      prompts.push(context.prompt);
      const control = await readControlFile(project);

      if (prompts.length === 1) {
        control.review = {
          status: "complete",
          cycle: 1,
          nextAction: "handoff_to_user",
          handoffRecommendation: "approve",
          reopenStage: "",
          reworkGoals: [],
          confidence: "high",
          evidenceStrength: "strong",
          finalClaim: "The workflow is ready for handoff.",
          strongestSupport: ["The final review is complete."],
          strongestCounterevidence: [],
          hiddenAssumptions: [],
          alternativeExplanationsOrObstructions: [],
          fitToRequirements: ["The workflow reached final review."],
          residualRisks: [],
          reviewerQuestions: [],
          suggestedNextStep: "Stop at user review.",
          completedAt: "",
        };
        await writeControlFile(project, control);
        return { lifecycleState: "completed", finalResponse: "continue" };
      }

      const userReview = ((control.userStories ?? []) as Record<string, unknown>[]).find(
        (story) => story.stage === "user_review",
      );
      if (userReview) {
        userReview.status = "awaiting_user_review";
        userReview.passes = true;
      }
      (control.automation as Record<string, unknown>).state = "awaiting_user_review";
      await writeControlFile(project, control);
      return { lifecycleState: "awaiting_user_review", finalResponse: "<promise>COMPLETE</promise>" };
    });

    try {
      const session = await runResearch(project, {
        tool: "amp",
        model: "gpt5.5-xhigh",
        maxIterations: null,
      });

      expect(session.lifecycleState).toBe("awaiting_user_review");
      expect(session.latestError).toBeUndefined();
      expect(prompts).toHaveLength(2);
      expect(prompts[0]).toContain("### Current Stage: `final_review`");
      expect(prompts[1]).toContain("### Current Stage: `user_review`");
    } finally {
      runTurn.mockRestore();
    }
  });

  it("falls back when the preferred Codex model is unavailable", async () => {
    const project = await makeProject();
    await intakeSet(project, {
      background: "systems researcher",
      requirements: "prefer latest model but keep workflow moving",
      resources: "local test only",
      collaboration: "do not stop on unavailable model",
      extra: "record degradations",
    });

    const runTurn = vi
      .spyOn(CodexBackend.prototype, "runTurn")
      .mockResolvedValueOnce({
        lifecycleState: "failed",
        latestError: "The model `gpt-5.5` does not exist or you do not have access to it.",
      })
      .mockImplementationOnce(async () => {
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
      });

    try {
      const session = await runResearch(project, {
        tool: "codex",
        model: "gpt5.5-xhigh",
        maxIterations: 1,
      });

      expect(runTurn).toHaveBeenCalledTimes(2);
      expect(session.model).toBe("gpt5.4-xhigh");

      const eventsPath = join(project.rootDir, ".ralph", "sessions", session.sessionId, "events.jsonl");
      const events = (await readFile(eventsPath, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as { type: string; data?: Record<string, unknown> });
      const fallback = events.find((event) => event.type === "run.model_fallback");
      expect(fallback?.data).toMatchObject({
        fromModel: "gpt5.5-xhigh",
        toModel: "gpt5.4-xhigh",
      });
    } finally {
      runTurn.mockRestore();
    }
  });

  it("repairs an invalid awaiting_user_review project and reopens the earliest failing stage before running", async () => {
    const project = await makeTheoreticalProject();
    await intakeSet(project, {
      background: "theory researcher",
      requirements: "lean-backed validation before handoff",
      resources: "local test only",
      collaboration: "stop before implementation",
      extra: "prefer small theorem skeletons",
    });

    const control = await readControlFile(project);
    for (const story of (control.userStories ?? []) as Record<string, unknown>[]) {
      if (story.stage === "final_review") {
        break;
      }
      if (story.requiresUserIntervention === true) {
        continue;
      }
      story.status = "promoted";
      story.passes = true;
    }

    const lean = ((control.userStories ?? []) as Record<string, unknown>[]).find(
      (story) => story.stage === "lean_formalization",
    );
    if (!lean) {
      throw new Error("Missing lean_formalization story");
    }
    lean.status = "blocked";
    lean.passes = false;

    const finalReview = ((control.userStories ?? []) as Record<string, unknown>[]).find(
      (story) => story.stage === "final_review",
    );
    const userReview = ((control.userStories ?? []) as Record<string, unknown>[]).find(
      (story) => story.stage === "user_review",
    );
    if (!finalReview || !userReview) {
      throw new Error("Missing final_review or user_review story");
    }
    finalReview.status = "promoted";
    finalReview.passes = true;
    userReview.status = "awaiting_user_review";
    userReview.passes = true;
    (control.automation as Record<string, unknown>).state = "awaiting_user_review";
    control.review = {
      status: "complete",
      cycle: 1,
      nextAction: "handoff_to_user",
      handoffRecommendation: "approve",
      reopenStage: "",
      reworkGoals: [],
      confidence: "medium",
      evidenceStrength: "mixed",
      finalClaim: "Current handoff should be reopened.",
      strongestSupport: ["The framing is clear."],
      strongestCounterevidence: ["Lean validation is still blocked."],
      hiddenAssumptions: [],
      alternativeExplanationsOrObstructions: [],
      fitToRequirements: [],
      residualRisks: [],
      reviewerQuestions: [],
      suggestedNextStep: "Hand off immediately.",
      completedAt: "",
    };
    await writeControlFile(project, control);

    const prompts: string[] = [];
    const runTurn = vi.spyOn(LocalCliBackend.prototype, "runTurn").mockImplementation(async (context) => {
      prompts.push(context.prompt);
      return {
        lifecycleState: "completed",
        finalResponse: "continue",
      };
    });

    try {
      const session = await runResearch(project, {
        tool: "amp",
        model: "gpt5.5-xhigh",
        maxIterations: 1,
      });

      const repairedControl = await readControlFile(project);
      expect(prompts).toHaveLength(1);
      expect(prompts[0]).toContain("### Current Stage: `lean_formalization`");
      expect((repairedControl.automation as Record<string, unknown>).state).toBe("running");
      expect((repairedControl.review as Record<string, unknown>).nextAction).toBe("autonomous_rework");
      expect((((repairedControl.userStories ?? []) as Record<string, unknown>[]).find(
        (story) => story.stage === "lean_formalization",
      ) ?? {}).status).toBe("queued");
      expect(session.lifecycleState).toBe("blocked");

      const eventsPath = join(project.rootDir, ".ralph", "sessions", session.sessionId, "events.jsonl");
      const events = (await readFile(eventsPath, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as { type: string; data?: Record<string, unknown> });
      const repairEvent = events.find((event) => event.type === "run.repaired");
      expect(repairEvent?.data?.reopenedStage).toBe("lean_formalization");
    } finally {
      runTurn.mockRestore();
    }
  });
});

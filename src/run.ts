import { stat } from "node:fs/promises";

import { appendSessionEvent, createSession, readSessionState, writeSessionState } from "./sessions.js";
import { FALLBACK_CODEX_MODEL } from "./defaults.js";
import {
  applyFinalReviewDecision,
  getArtifactPaths,
  getCurrentItemId,
  getCurrentStage,
  getAutomationState,
  repairInvalidUserReviewHandoff,
  readControlFile,
  writeControlFile,
} from "./project.js";
import {
  chooseBackend,
  CodexBackend,
  defaultBackendForTool,
  LocalCliBackend,
  syncSessionFromControl,
} from "./backends.js";
import { buildRunPrompt } from "./prompt-builder.js";
import { BackendRunContext, LocatedProject, SessionState, ToolName } from "./types.js";

function isModelAvailabilityFailure(errorText: string | undefined): boolean {
  if (!errorText) {
    return false;
  }
  return /model .*does not exist|do not have access to it|model .*not supported|not supported when using/i.test(errorText);
}

async function snapshotArtifacts(paths: ReturnType<typeof getArtifactPaths>) {
  const entries = Object.values(paths);
  const snapshot = new Map<string, number>();
  for (const entry of entries) {
    try {
      const metadata = await stat(entry);
      snapshot.set(entry, metadata.mtimeMs);
    } catch {
      snapshot.set(entry, -1);
    }
  }
  return snapshot;
}

async function emitArtifactDiff(
  project: LocatedProject,
  session: SessionState,
  before: Map<string, number>,
  after: Map<string, number>,
) {
  for (const [path, previous] of before) {
    const next = after.get(path);
    if (next !== undefined && next !== previous) {
      await appendSessionEvent(project, {
        timestamp: new Date().toISOString(),
        sessionId: session.sessionId,
        type: "artifact.updated",
        data: { path },
      });
    }
  }
}

export interface RunOptions {
  tool: ToolName;
  model: string;
  maxIterations: number | null;
  sessionId?: string;
}

export async function runResearch(
  project: LocatedProject,
  options: RunOptions,
): Promise<SessionState> {
  let control = await readControlFile(project);
  const artifacts = getArtifactPaths(project, control);

  let session = options.sessionId
    ? await readSessionState(project, options.sessionId)
    : await createSession(project, {
        provider: options.tool,
        backend: defaultBackendForTool(options.tool),
        model: options.model,
        lifecycleState: "idle",
        currentStage: getCurrentStage(control),
        currentItemId: getCurrentItemId(control),
        currentQuestion: null,
        projectRoot: project.rootDir,
        controlFilePath: project.controlFilePath,
        artifacts,
      });

  if (((control.researcherContext ?? {}) as Record<string, unknown>).isComplete !== true) {
    session.lifecycleState = "blocked";
    session.latestError = "Research intake is incomplete. Run 'ralph intake' first.";
    await appendSessionEvent(project, {
      timestamp: new Date().toISOString(),
      sessionId: session.sessionId,
      type: "run.blocked",
      data: { reason: session.latestError },
    });
    await writeSessionState(project, session);
    return session;
  }

  let iteration = 1;
  while (options.maxIterations === null || iteration <= options.maxIterations) {
    control = await readControlFile(project);
    const preflightRepair = repairInvalidUserReviewHandoff(control);
    if (preflightRepair.blockedReason) {
      session.lifecycleState = "blocked";
      session.latestError = preflightRepair.blockedReason;
      await appendSessionEvent(project, {
        timestamp: new Date().toISOString(),
        sessionId: session.sessionId,
        type: "run.blocked",
        data: { reason: session.latestError },
      });
      await writeSessionState(project, session);
      return session;
    }
    if (preflightRepair.controlChanged) {
      await writeControlFile(project, control);
      await appendSessionEvent(project, {
        timestamp: new Date().toISOString(),
        sessionId: session.sessionId,
        type: "run.repaired",
        data: {
          iteration,
          phase: "preflight",
          reopenedStage: preflightRepair.reopenedStage ?? null,
          reason: preflightRepair.repairReason ?? "Auto-reopened an invalid handoff.",
        },
      });
    }
    if (getAutomationState(control) === "awaiting_user_review") {
      session.lifecycleState = "awaiting_user_review";
      await appendSessionEvent(project, {
        timestamp: new Date().toISOString(),
        sessionId: session.sessionId,
        type: "run.awaiting_user_review",
        data: { iteration },
      });
      await writeSessionState(project, session);
      return session;
    }

    session.currentStage = getCurrentStage(control);
    session.currentItemId = getCurrentItemId(control);
    const prompt = await buildRunPrompt({
      tool: options.tool,
      control,
      currentStage: session.currentStage,
      currentItemId: session.currentItemId,
    });
    const context: BackendRunContext = {
      session,
      prompt,
      project,
      maxIterations: options.maxIterations,
    };
    const backendType = await chooseBackend(context);
    session.backend = backendType;
    session.lifecycleState = "running";
    await writeSessionState(project, session);
    await appendSessionEvent(project, {
      timestamp: new Date().toISOString(),
      sessionId: session.sessionId,
      type: "run.started",
      data: {
        iteration,
        backend: session.backend,
        provider: session.provider,
        model: session.model,
      },
    });

    const before = await snapshotArtifacts(artifacts);
    const backend =
      backendType === "codex-sdk" ? new CodexBackend() : new LocalCliBackend();

    let result;
    try {
      result = await backend.runTurn(context);
    } catch (error) {
      if (backendType === "codex-sdk") {
        session.backend = "local-cli";
        result = await new LocalCliBackend().runTurn(context);
      } else {
        throw error;
      }
    }

    if (
      options.tool === "codex" &&
      session.model !== FALLBACK_CODEX_MODEL &&
      isModelAvailabilityFailure([result.latestError, result.finalResponse].filter(Boolean).join("\n"))
    ) {
      const previousModel = session.model;
      session.model = FALLBACK_CODEX_MODEL;
      session.backend = defaultBackendForTool(options.tool);
      session.lifecycleState = "running";
      session.latestError = undefined;
      await writeSessionState(project, session);
      await appendSessionEvent(project, {
        timestamp: new Date().toISOString(),
        sessionId: session.sessionId,
        type: "run.model_fallback",
        data: {
          iteration,
          fromModel: previousModel,
          toModel: FALLBACK_CODEX_MODEL,
          reason: "Requested Codex model is unavailable to the active account.",
        },
      });

      const fallbackContext: BackendRunContext = {
        ...context,
        session,
      };
      const fallbackBackendType = await chooseBackend(fallbackContext);
      session.backend = fallbackBackendType;
      await writeSessionState(project, session);
      try {
        result =
          fallbackBackendType === "codex-sdk"
            ? await new CodexBackend().runTurn(fallbackContext)
            : await new LocalCliBackend().runTurn(fallbackContext);
      } catch (error) {
        if (fallbackBackendType === "codex-sdk") {
          session.backend = "local-cli";
          result = await new LocalCliBackend().runTurn(fallbackContext);
        } else {
          throw error;
        }
      }
    }

    control = await readControlFile(project);
    const reviewTransition = applyFinalReviewDecision(control);
    if (reviewTransition.blockedReason) {
      session.currentStage = getCurrentStage(control);
      session.currentItemId = getCurrentItemId(control);
      session.lifecycleState = "blocked";
      session.latestError = reviewTransition.blockedReason;
      await appendSessionEvent(project, {
        timestamp: new Date().toISOString(),
        sessionId: session.sessionId,
        type: "run.blocked",
        data: { reason: session.latestError },
      });
      await writeSessionState(project, session);
      return session;
    }
    if (reviewTransition.controlChanged) {
      await writeControlFile(project, control);
      if (reviewTransition.reopenedStage) {
        await appendSessionEvent(project, {
          timestamp: new Date().toISOString(),
          sessionId: session.sessionId,
          type: "run.repaired",
          data: {
            iteration,
            phase: "post-turn",
            reopenedStage: reviewTransition.reopenedStage,
            reason: reviewTransition.repairReason ?? "Auto-reopened for autonomous rework.",
          },
        });
      }
    }
    syncSessionFromControl(context, result, control);
    const after = await snapshotArtifacts(artifacts);
    await emitArtifactDiff(project, session, before, after);

    if (session.lifecycleState === "failed") {
      await appendSessionEvent(project, {
        timestamp: new Date().toISOString(),
        sessionId: session.sessionId,
        type: "run.failed",
        data: { iteration, error: session.latestError ?? "Unknown error" },
      });
      await writeSessionState(project, session);
      return session;
    }

    if (getAutomationState(control) === "awaiting_user_review") {
      session.lifecycleState = "awaiting_user_review";
      await appendSessionEvent(project, {
        timestamp: new Date().toISOString(),
        sessionId: session.sessionId,
        type: "run.awaiting_user_review",
        data: { iteration },
      });
      await writeSessionState(project, session);
      return session;
    }

    if (reviewTransition.reopenedStage) {
      session.lifecycleState = "running";
      await writeSessionState(project, session);
      iteration += 1;
      continue;
    }

    if (result.finalResponse?.includes("<promise>COMPLETE</promise>") && !getCurrentStage(control)) {
      session.lifecycleState = "completed";
      await appendSessionEvent(project, {
        timestamp: new Date().toISOString(),
        sessionId: session.sessionId,
        type: "run.completed",
        data: { iteration },
      });
      await writeSessionState(project, session);
      return session;
    }

    await writeSessionState(project, session);
    iteration += 1;
  }

  session.lifecycleState = "blocked";
  session.latestError = `Reached max iterations (${String(options.maxIterations)}) without completion.`;
  await appendSessionEvent(project, {
    timestamp: new Date().toISOString(),
    sessionId: session.sessionId,
    type: "run.blocked",
    data: { reason: session.latestError },
  });
  await writeSessionState(project, session);
  return session;
}

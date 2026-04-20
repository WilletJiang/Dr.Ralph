import { stat } from "node:fs/promises";

import { appendSessionEvent, createSession, readSessionState, writeSessionState } from "./sessions.js";
import {
  getArtifactPaths,
  getCurrentItemId,
  getCurrentStage,
  getAutomationState,
  readControlFile,
} from "./project.js";
import {
  chooseBackend,
  CodexBackend,
  defaultBackendForTool,
  loadPromptTemplate,
  LocalCliBackend,
  syncSessionFromControl,
} from "./backends.js";
import { BackendRunContext, LocatedProject, SessionState, ToolName } from "./types.js";

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
  maxIterations: number;
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

  const prompt = await loadPromptTemplate(options.tool);

  for (let iteration = 1; iteration <= options.maxIterations; iteration += 1) {
    control = await readControlFile(project);
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

    control = await readControlFile(project);
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

    if (result.finalResponse?.includes("<promise>COMPLETE</promise>")) {
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
  }

  session.lifecycleState = "blocked";
  session.latestError = `Reached max iterations (${options.maxIterations}) without completion.`;
  await appendSessionEvent(project, {
    timestamp: new Date().toISOString(),
    sessionId: session.sessionId,
    type: "run.blocked",
    data: { reason: session.latestError },
  });
  await writeSessionState(project, session);
  return session;
}

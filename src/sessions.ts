import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { LocatedProject, RalphEvent, SessionState } from "./types.js";

function sessionsRoot(project: LocatedProject): string {
  return join(project.rootDir, ".ralph", "sessions");
}

function sessionDir(project: LocatedProject, sessionId: string): string {
  return join(sessionsRoot(project), sessionId);
}

export async function createSession(
  project: LocatedProject,
  seed: Omit<SessionState, "sessionId" | "createdAt" | "updatedAt">,
): Promise<SessionState> {
  const sessionId = randomUUID();
  const now = new Date().toISOString();
  const state: SessionState = {
    ...seed,
    sessionId,
    createdAt: now,
    updatedAt: now,
  };

  await mkdir(sessionDir(project, sessionId), { recursive: true });
  await writeSessionState(project, state);
  await appendSessionEvent(project, {
    timestamp: now,
    sessionId,
    type: "session.started",
    data: {
      provider: state.provider,
      backend: state.backend,
      model: state.model,
    },
  });
  return state;
}

export async function writeSessionState(project: LocatedProject, state: SessionState): Promise<void> {
  const dir = sessionDir(project, state.sessionId);
  await mkdir(dir, { recursive: true });
  const nextState = { ...state, updatedAt: new Date().toISOString() };
  await writeFile(join(dir, "state.json"), JSON.stringify(nextState, null, 2) + "\n");
}

export async function readSessionState(
  project: LocatedProject,
  sessionId: string,
): Promise<SessionState> {
  return JSON.parse(
    await readFile(join(sessionDir(project, sessionId), "state.json"), "utf8"),
  ) as SessionState;
}

export async function appendSessionEvent(
  project: LocatedProject,
  event: RalphEvent,
): Promise<void> {
  const dir = sessionDir(project, event.sessionId);
  await mkdir(dir, { recursive: true });
  const eventPath = join(dir, "events.jsonl");
  await writeFile(eventPath, JSON.stringify(event) + "\n", { flag: "a" });
}

export async function getLatestSession(project: LocatedProject): Promise<SessionState | null> {
  const root = sessionsRoot(project);
  try {
    const entries = await readdir(root);
    const states: { state: SessionState; mtimeMs: number }[] = [];
    for (const entry of entries) {
      const path = join(root, entry, "state.json");
      try {
        const [raw, metadata] = await Promise.all([readFile(path, "utf8"), stat(path)]);
        states.push({ state: JSON.parse(raw) as SessionState, mtimeMs: metadata.mtimeMs });
      } catch {
        // Ignore invalid or incomplete session directories.
      }
    }
    states.sort((left, right) => right.mtimeMs - left.mtimeMs);
    return states[0]?.state ?? null;
  } catch {
    return null;
  }
}

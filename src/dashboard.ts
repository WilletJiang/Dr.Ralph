import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { basename } from "node:path";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";

import {
  evaluateHandoffReadiness,
  getArtifactPaths,
  getHandoffGuards,
  getStatus,
  readControlFile,
} from "./project.js";
import { getLatestSession, readSessionState } from "./sessions.js";
import { LocatedProject, RalphEvent } from "./types.js";

interface DashboardTimelineItem {
  timestamp: string;
  kind: string;
  label: string;
  detail?: string;
  level: "info" | "warn" | "error";
}

interface DashboardStageSummary {
  id: string;
  stage: string;
  title: string;
  status: string;
  passes: boolean;
}

interface DashboardSnapshot {
  generatedAt: string;
  projectRoot: string;
  researchMode?: string;
  automationState?: string | null;
  currentStage?: string | null;
  latestSessionId?: string | null;
  latestSession?: {
    sessionId: string;
    provider: string;
    backend: string;
    model: string;
    lifecycleState: string;
    createdAt: string;
    updatedAt: string;
  } | null;
  handoffGuards: {
    requiredPassingStages: string[];
    forbidBlockedPriorStages: boolean;
    readiness: {
      ready: boolean;
      failingStage?: string;
      reason?: string;
    };
  };
  review: Record<string, unknown>;
  stageCounts: Record<string, number>;
  stages: DashboardStageSummary[];
  artifacts: ReturnType<typeof getArtifactPaths>;
  latestProgressEntry: string | null;
  liveLogExcerpt: string | null;
  finalReviewExcerpt: string | null;
  timeline: DashboardTimelineItem[];
}

export async function readOptionalText(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

function trimForDisplay(text: string, limit = 280): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) {
    return normalized;
  }
  return normalized.slice(0, limit - 1) + "…";
}

export function extractLatestProgressEntry(markdown: string | null): string | null {
  if (!markdown) {
    return null;
  }

  const entries = markdown
    .split(/^---\s*$/m)
    .map((entry) => entry.trim())
    .filter(Boolean);
  return entries.at(-1) ?? null;
}

export function extractLatestSection(markdown: string | null): string | null {
  if (!markdown) {
    return null;
  }

  const parts = markdown.split(/^##\s+/m).map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) {
    return markdown.trim() || null;
  }
  const latest = parts.at(-1) ?? "";
  return latest.startsWith("[") ? `## ${latest}` : latest;
}

export function extractInitialExcerpt(markdown: string | null, maxLines = 40): string | null {
  if (!markdown) {
    return null;
  }
  const lines = markdown.trim().split(/\r?\n/).slice(0, maxLines);
  return lines.join("\n").trim() || null;
}

function parseSingleTimelineEvent(event: RalphEvent): DashboardTimelineItem | null {
  switch (event.type) {
    case "session.started": {
      const data = (event.data ?? {}) as Record<string, unknown>;
      return {
        timestamp: event.timestamp,
        kind: "session",
        label: `Session started (${String(data.provider ?? "unknown")} / ${String(data.backend ?? "unknown")} / ${String(data.model ?? "unknown")})`,
        level: "info",
      };
    }
    case "run.started": {
      const data = (event.data ?? {}) as Record<string, unknown>;
      return {
        timestamp: event.timestamp,
        kind: "run",
        label: `Run iteration ${String(data.iteration ?? "?")} started`,
        detail: `backend=${String(data.backend ?? "unknown")} model=${String(data.model ?? "unknown")}`,
        level: "info",
      };
    }
    case "run.repaired": {
      const data = (event.data ?? {}) as Record<string, unknown>;
      return {
        timestamp: event.timestamp,
        kind: "repair",
        label: `Auto-reopened to ${String(data.reopenedStage ?? "unknown")}`,
        detail: String(data.reason ?? ""),
        level: "warn",
      };
    }
    case "run.model_fallback": {
      const data = (event.data ?? {}) as Record<string, unknown>;
      return {
        timestamp: event.timestamp,
        kind: "run",
        label: `Model fallback: ${String(data.fromModel ?? "unknown")} -> ${String(data.toModel ?? "unknown")}`,
        detail: String(data.reason ?? ""),
        level: "warn",
      };
    }
    case "artifact.updated": {
      const data = (event.data ?? {}) as Record<string, unknown>;
      return {
        timestamp: event.timestamp,
        kind: "artifact",
        label: `Artifact updated: ${basename(String(data.path ?? "unknown"))}`,
        detail: String(data.path ?? ""),
        level: "info",
      };
    }
    case "run.blocked": {
      const data = (event.data ?? {}) as Record<string, unknown>;
      return {
        timestamp: event.timestamp,
        kind: "blocked",
        label: "Run blocked",
        detail: String(data.reason ?? ""),
        level: "error",
      };
    }
    case "run.awaiting_user_review": {
      const data = (event.data ?? {}) as Record<string, unknown>;
      return {
        timestamp: event.timestamp,
        kind: "review",
        label: `Waiting for user review after iteration ${String(data.iteration ?? "?")}`,
        level: "warn",
      };
    }
    case "run.completed": {
      const data = (event.data ?? {}) as Record<string, unknown>;
      return {
        timestamp: event.timestamp,
        kind: "completed",
        label: `Run completed after iteration ${String(data.iteration ?? "?")}`,
        level: "info",
      };
    }
    case "run.failed": {
      const data = (event.data ?? {}) as Record<string, unknown>;
      return {
        timestamp: event.timestamp,
        kind: "failed",
        label: "Run failed",
        detail: String(data.error ?? ""),
        level: "error",
      };
    }
    case "run.backend.event": {
      const data = (event.data ?? {}) as Record<string, unknown>;
      const type = String(data.type ?? "");
      if (type === "thread.started") {
        return {
          timestamp: event.timestamp,
          kind: "backend",
          label: `Backend thread started`,
          detail: `thread_id=${String(data.thread_id ?? "unknown")}`,
          level: "info",
        };
      }
      if (type === "turn.started") {
        return {
          timestamp: event.timestamp,
          kind: "backend",
          label: "Backend turn started",
          level: "info",
        };
      }
      if (type === "turn.completed") {
        const usage = (data.usage ?? {}) as Record<string, unknown>;
        return {
          timestamp: event.timestamp,
          kind: "backend",
          label: "Backend turn completed",
          detail: `input=${String(usage.input_tokens ?? "?")} output=${String(usage.output_tokens ?? "?")}`,
          level: "info",
        };
      }
      if (type === "turn.failed" || type === "error") {
        return {
          timestamp: event.timestamp,
          kind: "backend",
          label: "Backend error",
          detail: trimForDisplay(JSON.stringify(data)),
          level: "error",
        };
      }
      const item = (data.item ?? {}) as Record<string, unknown>;
      const itemType = String(item.type ?? "");
      if ((type === "item.completed" || type === "item.updated") && itemType === "agent_message") {
        return {
          timestamp: event.timestamp,
          kind: "agent",
          label: "Agent message",
          detail: trimForDisplay(String(item.text ?? "")),
          level: "info",
        };
      }
      if ((type === "item.started" || type === "item.completed") && itemType === "command_execution") {
        const exitCode = item.exit_code === null || item.exit_code === undefined ? "…" : String(item.exit_code);
        return {
          timestamp: event.timestamp,
          kind: "command",
          label: `${type === "item.started" ? "Command started" : "Command completed"} (${exitCode})`,
          detail: trimForDisplay(String(item.command ?? "")),
          level: type === "item.completed" && Number(item.exit_code) !== 0 ? "warn" : "info",
        };
      }
      if ((type === "item.updated" || type === "item.completed") && itemType === "todo_list") {
        const items = Array.isArray(item.items) ? item.items.length : 0;
        return {
          timestamp: event.timestamp,
          kind: "todo",
          label: `Todo list ${type === "item.updated" ? "updated" : "completed"} (${items} items)`,
          level: "info",
        };
      }
      return null;
    }
    default:
      return null;
  }
}

export function parseTimelineItems(eventsText: string | null, limit = 80): DashboardTimelineItem[] {
  if (!eventsText) {
    return [];
  }

  const lines = eventsText
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const items: DashboardTimelineItem[] = [];
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as RalphEvent;
      const item = parseSingleTimelineEvent(parsed);
      if (item) {
        items.push(item);
      }
    } catch {
      // Ignore malformed event lines.
    }
  }

  return items.slice(-limit).reverse();
}

export async function buildDashboardSnapshot(
  project: LocatedProject,
  requestedSessionId?: string,
): Promise<DashboardSnapshot> {
  const [status, control] = await Promise.all([getStatus(project), readControlFile(project)]);
  const latestSession = requestedSessionId
    ? await readSessionState(project, requestedSessionId)
    : await getLatestSession(project);
  const artifacts = getArtifactPaths(project, control);
  const [progressText, liveLogText, finalReviewText, eventsText] = await Promise.all([
    readOptionalText(artifacts.progressFile),
    readOptionalText(artifacts.liveLogFile),
    readOptionalText(artifacts.reviewMemoFile),
    latestSession
      ? readOptionalText(`${project.rootDir}/.ralph/sessions/${latestSession.sessionId}/events.jsonl`)
      : Promise.resolve(null),
  ]);
  const stories = Array.isArray(control.userStories) ? (control.userStories as Record<string, unknown>[]) : [];
  const handoffGuards = getHandoffGuards(control);
  const readiness = evaluateHandoffReadiness(control);

  return {
    generatedAt: new Date().toISOString(),
    projectRoot: project.rootDir,
    researchMode: status.researchMode,
    automationState: status.automationState,
    currentStage: status.currentStage,
    latestSessionId: latestSession?.sessionId ?? null,
    latestSession: latestSession
      ? {
          sessionId: latestSession.sessionId,
          provider: latestSession.provider,
          backend: latestSession.backend,
          model: latestSession.model,
          lifecycleState: latestSession.lifecycleState,
          createdAt: latestSession.createdAt,
          updatedAt: latestSession.updatedAt,
        }
      : null,
    handoffGuards: {
      requiredPassingStages: handoffGuards.requiredPassingStages,
      forbidBlockedPriorStages: handoffGuards.forbidBlockedPriorStages,
      readiness,
    },
    review: (control.review ?? {}) as Record<string, unknown>,
    stageCounts: status.stageCounts ?? {},
    stages: stories.map((story) => ({
      id: String(story.id ?? ""),
      stage: String(story.stage ?? ""),
      title: String(story.title ?? ""),
      status: String(story.status ?? ""),
      passes: story.passes === true,
    })),
    artifacts,
    latestProgressEntry: extractLatestProgressEntry(progressText),
    liveLogExcerpt: extractLatestSection(liveLogText),
    finalReviewExcerpt: extractInitialExcerpt(finalReviewText),
    timeline: parseTimelineItems(eventsText),
  };
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function renderDashboardHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Dr.Ralph Dashboard</title>
  <style>
    :root {
      --bg: #f6f4ed;
      --panel: #fffdf7;
      --ink: #162025;
      --muted: #68737a;
      --line: #d7d1c5;
      --accent: #125b50;
      --warn: #8b5e00;
      --err: #9b2226;
      --ok: #2a6f3e;
      --shadow: 0 14px 32px rgba(18, 24, 29, 0.08);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background:
        radial-gradient(circle at top left, rgba(18,91,80,0.08), transparent 28%),
        linear-gradient(180deg, #f8f6ef 0%, var(--bg) 100%);
      color: var(--ink);
      font: 14px/1.45 "SF Pro Text", "Helvetica Neue", Helvetica, Arial, sans-serif;
    }
    header {
      padding: 28px 32px 18px;
      border-bottom: 1px solid rgba(22, 32, 37, 0.08);
    }
    header h1 {
      margin: 0 0 6px;
      font-size: 28px;
      letter-spacing: -0.03em;
    }
    header p {
      margin: 0;
      color: var(--muted);
      max-width: 960px;
    }
    main {
      padding: 24px 28px 40px;
      display: grid;
      gap: 18px;
    }
    .grid {
      display: grid;
      gap: 18px;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    }
    .panel {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 18px;
      padding: 18px;
      box-shadow: var(--shadow);
    }
    .panel h2 {
      margin: 0 0 12px;
      font-size: 16px;
      letter-spacing: -0.02em;
    }
    .summary {
      display: grid;
      gap: 14px;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    }
    .metric {
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 12px 14px;
      background: rgba(255,255,255,0.72);
    }
    .metric .label {
      color: var(--muted);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
    .metric .value {
      margin-top: 6px;
      font-size: 18px;
      font-weight: 650;
    }
    .pipeline {
      display: grid;
      gap: 10px;
    }
    .stage {
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 12px 14px;
      background: rgba(255,255,255,0.72);
    }
    .stage-head {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: baseline;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      padding: 4px 8px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      background: rgba(18,91,80,0.12);
      color: var(--accent);
    }
    .badge.warn { background: rgba(139,94,0,0.15); color: var(--warn); }
    .badge.err { background: rgba(155,34,38,0.14); color: var(--err); }
    .badge.ok { background: rgba(42,111,62,0.14); color: var(--ok); }
    pre {
      margin: 0;
      white-space: pre-wrap;
      word-break: break-word;
      font: 12px/1.45 ui-monospace, "SFMono-Regular", Menlo, monospace;
      background: rgba(24, 30, 37, 0.04);
      border-radius: 12px;
      padding: 12px;
      border: 1px solid rgba(24, 30, 37, 0.08);
    }
    .timeline {
      display: grid;
      gap: 10px;
      max-height: 720px;
      overflow: auto;
      padding-right: 4px;
    }
    .timeline-item {
      border-left: 3px solid var(--line);
      padding: 8px 0 8px 14px;
    }
    .timeline-item.info { border-color: var(--accent); }
    .timeline-item.warn { border-color: var(--warn); }
    .timeline-item.error { border-color: var(--err); }
    .timeline-meta {
      color: var(--muted);
      font-size: 12px;
      margin-bottom: 4px;
    }
    .muted { color: var(--muted); }
    .small { font-size: 12px; }
    code {
      font: 12px ui-monospace, "SFMono-Regular", Menlo, monospace;
      background: rgba(24, 30, 37, 0.06);
      padding: 2px 6px;
      border-radius: 8px;
    }
    @media (max-width: 700px) {
      header, main { padding-left: 18px; padding-right: 18px; }
    }
  </style>
</head>
<body>
  <header>
    <h1>Dr.Ralph Progress Dashboard</h1>
    <p>Live view of project status, stage progression, review state, and backend activity. Refreshes every 2 seconds from the local project state.</p>
  </header>
  <main>
    <section class="panel">
      <h2>Summary</h2>
      <div id="summary" class="summary"></div>
    </section>
    <section class="grid">
      <div class="panel">
        <h2>Stage Pipeline</h2>
        <div id="pipeline" class="pipeline"></div>
      </div>
      <div class="panel">
        <h2>Review & Guards</h2>
        <div id="review"></div>
      </div>
    </section>
    <section class="grid">
      <div class="panel">
        <h2>Recent Progress</h2>
        <pre id="progress">Loading…</pre>
      </div>
      <div class="panel">
        <h2>Live Log</h2>
        <pre id="liveLog">Loading…</pre>
      </div>
      <div class="panel">
        <h2>Final Review Memo</h2>
        <pre id="finalReview">Loading…</pre>
      </div>
    </section>
    <section class="panel">
      <h2>Timeline</h2>
      <div id="timeline" class="timeline"></div>
    </section>
  </main>
  <script>
    const summary = document.getElementById("summary");
    const pipeline = document.getElementById("pipeline");
    const review = document.getElementById("review");
    const progress = document.getElementById("progress");
    const liveLog = document.getElementById("liveLog");
    const finalReview = document.getElementById("finalReview");
    const timeline = document.getElementById("timeline");

    function escapeHtml(text) {
      return text
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
    }

    function badgeClass(status) {
      if (status === "blocked" || status === "failed") return "badge err";
      if (status === "promoted" || status === "completed") return "badge ok";
      if (status === "queued" || status === "awaiting_user_review") return "badge warn";
      return "badge";
    }

    function renderSummary(data) {
      const metrics = [
        ["Project", data.projectRoot],
        ["Mode", data.researchMode ?? "unknown"],
        ["Automation", data.automationState ?? "unknown"],
        ["Current Stage", data.currentStage ?? "none"],
        ["Session", data.latestSession?.sessionId ?? data.latestSessionId ?? "none"],
        ["Backend", data.latestSession ? \`\${data.latestSession.provider} / \${data.latestSession.backend}\` : "none"],
        ["Model", data.latestSession?.model ?? "none"],
        ["Lifecycle", data.latestSession?.lifecycleState ?? "none"],
      ];
      summary.innerHTML = metrics.map(([label, value]) => \`
        <div class="metric">
          <div class="label">\${escapeHtml(String(label))}</div>
          <div class="value">\${escapeHtml(String(value))}</div>
        </div>
      \`).join("");
    }

    function renderPipeline(data) {
      pipeline.innerHTML = data.stages.map((stage) => \`
        <div class="stage">
          <div class="stage-head">
            <strong>\${escapeHtml(stage.title || stage.stage)}</strong>
            <span class="\${badgeClass(stage.status)}">\${escapeHtml(stage.status)}</span>
          </div>
          <div class="small muted" style="margin-top:6px;">
            <code>\${escapeHtml(stage.id)}</code> · <code>\${escapeHtml(stage.stage)}</code> · passes=\${stage.passes ? "true" : "false"}
          </div>
        </div>
      \`).join("");
    }

    function renderReview(data) {
      const guard = data.handoffGuards;
      const reviewPanel = data.review || {};
      review.innerHTML = \`
        <div class="metric" style="margin-bottom:12px;">
          <div class="label">Handoff Readiness</div>
          <div class="value">\${guard.readiness.ready ? "ready" : "not ready"}</div>
          <div class="small muted" style="margin-top:8px;">
            required=\${guard.requiredPassingStages.length ? guard.requiredPassingStages.join(", ") : "none"}<br/>
            blocked-prior-forbidden=\${String(guard.forbidBlockedPriorStages)}
          </div>
        </div>
        <pre>\${escapeHtml(JSON.stringify({
          status: reviewPanel.status ?? null,
          nextAction: reviewPanel.nextAction ?? null,
          reopenStage: reviewPanel.reopenStage ?? null,
          suggestedNextStep: reviewPanel.suggestedNextStep ?? null,
          failingStage: guard.readiness.failingStage ?? null,
          reason: guard.readiness.reason ?? null,
        }, null, 2))}</pre>
      \`;
    }

    function renderTimeline(data) {
      timeline.innerHTML = data.timeline.map((item) => \`
        <div class="timeline-item \${item.level}">
          <div class="timeline-meta">\${escapeHtml(item.timestamp)} · \${escapeHtml(item.kind)}</div>
          <div><strong>\${escapeHtml(item.label)}</strong></div>
          \${item.detail ? '<div class="small muted" style="margin-top:4px;">' + escapeHtml(item.detail) + '</div>' : ""}
        </div>
      \`).join("");
    }

    async function refresh() {
      const response = await fetch("/api/snapshot", { cache: "no-store" });
      const data = await response.json();
      renderSummary(data);
      renderPipeline(data);
      renderReview(data);
      renderTimeline(data);
      progress.textContent = data.latestProgressEntry || "No progress entry recorded yet.";
      liveLog.textContent = data.liveLogExcerpt || "No live log excerpt recorded yet.";
      finalReview.textContent = data.finalReviewExcerpt || "No final review memo recorded yet.";
    }

    refresh().catch((error) => {
      progress.textContent = "Dashboard failed to load: " + error.message;
    });
    setInterval(() => {
      refresh().catch((error) => {
        progress.textContent = "Dashboard refresh failed: " + error.message;
      });
    }, 2000);
  </script>
</body>
</html>`;
}

function sendJson(response: ServerResponse, payload: unknown, statusCode = 200): void {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload, null, 2));
}

function sendHtml(response: ServerResponse, html: string): void {
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  response.end(html);
}

async function handleRequest(
  project: LocatedProject,
  requestedSessionId: string | undefined,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");

  if (url.pathname === "/api/snapshot") {
    const snapshot = await buildDashboardSnapshot(project, requestedSessionId);
    sendJson(response, snapshot);
    return;
  }

  if (url.pathname === "/" || url.pathname === "/index.html") {
    sendHtml(response, renderDashboardHtml());
    return;
  }

  sendJson(response, { error: "Not found" }, 404);
}

export async function startDashboardServer(
  project: LocatedProject,
  options?: { sessionId?: string; port?: number },
): Promise<{ server: Server; url: string; port: number }> {
  const server = createServer((request, response) => {
    handleRequest(project, options?.sessionId, request, response).catch((error) => {
      sendJson(response, { error: error instanceof Error ? error.message : String(error) }, 500);
    });
  });

  const port = options?.port ?? 0;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Dashboard server did not expose a TCP address.");
  }

  return {
    server,
    port: address.port,
    url: `http://127.0.0.1:${address.port}/`,
  };
}

export function openDashboardInBrowser(url: string): void {
  if (process.platform !== "darwin") {
    return;
  }

  const child = spawn("open", [url], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

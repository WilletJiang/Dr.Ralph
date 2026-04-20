import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { Codex, type ThreadEvent, type ThreadOptions } from "@openai/codex-sdk";

import { findPackageRoot } from "./package-root.js";
import { appendSessionEvent } from "./sessions.js";
import { readControlFile, getCurrentItemId, getCurrentStage, getAutomationState } from "./project.js";
import { BackendRunContext, BackendRunResult, LocatedProject, RalphEvent, ToolName } from "./types.js";

function resolvePromptFile(tool: ToolName): string {
  const packageRoot = findPackageRoot();
  switch (tool) {
    case "claude":
      return join(packageRoot, "CLAUDE.md");
    case "amp":
      return join(packageRoot, "prompt.md");
    case "codex":
    default:
      return join(packageRoot, "CODEX.md");
  }
}

export async function loadPromptTemplate(tool: ToolName): Promise<string> {
  return readFile(resolvePromptFile(tool), "utf8");
}

function normalizeCodexThreadOptions(context: BackendRunContext): ThreadOptions {
  const model = context.session.model === "gpt5.4-xhigh" ? "gpt-5.4" : context.session.model;
  const modelReasoningEffort = context.session.model === "gpt5.4-xhigh" ? "xhigh" : undefined;

  return {
    model,
    modelReasoningEffort,
    workingDirectory: context.project.rootDir,
    sandboxMode: "danger-full-access",
    approvalPolicy: "never",
    skipGitRepoCheck: true,
  };
}

function threadEventToRalphEvent(
  sessionId: string,
  event: ThreadEvent,
): RalphEvent {
  return {
    timestamp: new Date().toISOString(),
    sessionId,
    type: "run.backend.event",
    data: event,
  };
}

export class CodexBackend {
  private readonly agent = new Codex({});

  async runTurn(context: BackendRunContext): Promise<BackendRunResult> {
    const options = normalizeCodexThreadOptions(context);
    const thread = context.session.backendSessionId
      ? this.agent.resumeThread(context.session.backendSessionId, options)
      : this.agent.startThread(options);

    const streamed = await thread.runStreamed(context.prompt);
    let backendSessionId = context.session.backendSessionId;
    let finalResponse = "";
    let latestError: string | undefined;

    for await (const event of streamed.events) {
      await appendSessionEvent(context.project, threadEventToRalphEvent(context.session.sessionId, event));

      if (event.type === "thread.started") {
        backendSessionId = event.thread_id;
      }

      if ((event.type === "item.updated" || event.type === "item.completed") && event.item.type === "agent_message") {
        finalResponse = event.item.text;
      }

      if (event.type === "turn.failed" || event.type === "error") {
        latestError = "error" in event ? event.message : event.error.message;
      }
    }

    const control = await readControlFile(context.project);
    const awaitingReview = getAutomationState(control) === "awaiting_user_review";

    return {
      backendSessionId,
      lifecycleState: awaitingReview ? "awaiting_user_review" : latestError ? "failed" : "completed",
      latestError,
      finalResponse,
    };
  }
}

async function runCommand(
  command: string,
  args: string[],
  inputText: string,
  cwd: string,
): Promise<{ exitCode: number; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: "pipe" });
    let output = "";

    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ exitCode: code ?? 1, output });
    });

    child.stdin.write(inputText);
    child.stdin.end();
  });
}

export class LocalCliBackend {
  async runTurn(context: BackendRunContext): Promise<BackendRunResult> {
    if (context.session.provider === "codex") {
      return this.runCodexCli(context);
    }

    if (context.session.provider === "claude") {
      const result = await runCommand(
        "claude",
        ["--dangerously-skip-permissions", "--print"],
        context.prompt,
        context.project.rootDir,
      );
      await appendSessionEvent(context.project, {
        timestamp: new Date().toISOString(),
        sessionId: context.session.sessionId,
        type: "run.backend.event",
        data: { command: "claude", output: result.output, exitCode: result.exitCode },
      });
      return {
        lifecycleState: result.exitCode === 0 ? "completed" : "failed",
        latestError: result.exitCode === 0 ? undefined : result.output,
        finalResponse: result.output,
      };
    }

    const ampResult = await runCommand(
      "amp",
      ["--dangerously-allow-all"],
      context.prompt,
      context.project.rootDir,
    );
    await appendSessionEvent(context.project, {
      timestamp: new Date().toISOString(),
      sessionId: context.session.sessionId,
      type: "run.backend.event",
      data: { command: "amp", output: ampResult.output, exitCode: ampResult.exitCode },
    });
    return {
      lifecycleState: ampResult.exitCode === 0 ? "completed" : "failed",
      latestError: ampResult.exitCode === 0 ? undefined : ampResult.output,
      finalResponse: ampResult.output,
    };
  }

  private async runCodexCli(context: BackendRunContext): Promise<BackendRunResult> {
    const args = context.session.backendSessionId
      ? [
          "exec",
          "resume",
          context.session.backendSessionId,
          "-",
          "--json",
          "--model",
          context.session.model,
          "--dangerously-bypass-approvals-and-sandbox",
        ]
      : [
          "exec",
          "--json",
          "--model",
          context.session.model,
          "--dangerously-bypass-approvals-and-sandbox",
          "-",
        ];
    const result = await runCommand("codex", args, context.prompt, context.project.rootDir);

    let backendSessionId = context.session.backendSessionId;
    let finalResponse = "";
    let latestError: string | undefined;

    for (const line of result.output.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      try {
        const parsed = JSON.parse(trimmed) as ThreadEvent;
        await appendSessionEvent(context.project, threadEventToRalphEvent(context.session.sessionId, parsed));
        if (parsed.type === "thread.started") {
          backendSessionId = parsed.thread_id;
        }
        if ((parsed.type === "item.updated" || parsed.type === "item.completed") && parsed.item.type === "agent_message") {
          finalResponse = parsed.item.text;
        }
        if (parsed.type === "turn.failed" || parsed.type === "error") {
          latestError = "error" in parsed ? parsed.message : parsed.error.message;
        }
      } catch {
        await appendSessionEvent(context.project, {
          timestamp: new Date().toISOString(),
          sessionId: context.session.sessionId,
          type: "run.backend.event",
          data: { raw: trimmed },
        });
      }
    }

    const control = await readControlFile(context.project);
    const awaitingReview = getAutomationState(control) === "awaiting_user_review";

    return {
      backendSessionId,
      lifecycleState:
        awaitingReview || finalResponse.includes("<promise>COMPLETE</promise>")
          ? "awaiting_user_review"
          : latestError || result.exitCode !== 0
            ? "failed"
            : "completed",
      latestError: latestError ?? (result.exitCode === 0 ? undefined : result.output),
      finalResponse,
    };
  }
}

export function defaultBackendForTool(tool: ToolName): "codex-sdk" | "local-cli" {
  return tool === "codex" ? "codex-sdk" : "local-cli";
}

export async function chooseBackend(context: BackendRunContext): Promise<"codex-sdk" | "local-cli"> {
  return defaultBackendForTool(context.session.provider);
}

export function syncSessionFromControl(
  context: BackendRunContext,
  result: BackendRunResult,
  control: Record<string, unknown>,
): void {
  context.session.backendSessionId = result.backendSessionId;
  context.session.currentStage = getCurrentStage(control);
  context.session.currentItemId = getCurrentItemId(control);
  context.session.lifecycleState = result.lifecycleState;
  context.session.latestError = result.latestError;
}

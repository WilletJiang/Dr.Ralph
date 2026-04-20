#!/usr/bin/env node

import { resolve } from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { Command } from "commander";
import { z } from "zod";

import packageJson from "../package.json" with { type: "json" };
import { runInteractiveIntake, intakeSet } from "./intake.js";
import { startMcpServer } from "./mcp-server.js";
import { getDoctor, getStatus, initProject, locateProject, readControlFile, writeControlFile } from "./project.js";
import { runResearch } from "./run.js";
import { getLatestSession, readSessionState } from "./sessions.js";
import { RESEARCH_MODES, type DoctorResult, type LocatedProject, type ResearchMode, type StatusResult } from "./types.js";

function printJson(value: unknown): void {
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
}

function printStatus(status: StatusResult): void {
  if (!status.projectFound) {
    process.stdout.write("No Dr.Ralph project found.\n");
    return;
  }

  process.stdout.write(`Project root: ${status.projectRoot}\n`);
  process.stdout.write(`Layout: ${status.layout}\n`);
  if (status.legacyWarning) {
    process.stdout.write(`Warning: ${status.legacyWarning}\n`);
  }
  process.stdout.write(`Control file: ${status.controlFilePath}\n`);
  process.stdout.write(`Research mode: ${status.researchMode ?? "unknown"}\n`);
  if (status.researchModeWarning) {
    process.stdout.write(`Warning: ${status.researchModeWarning}\n`);
  }
  process.stdout.write(`Intake complete: ${status.intakeComplete ? "yes" : "no"}\n`);
  process.stdout.write(`Automation state: ${status.automationState ?? "unknown"}\n`);
  process.stdout.write(`Current stage: ${status.currentStage ?? "none"}\n`);
  process.stdout.write(`Latest session: ${status.latestSessionId ?? "none"}\n`);
  process.stdout.write(`Latest session state: ${status.latestSessionState ?? "none"}\n`);
  if (status.awaitingUserReview) {
    process.stdout.write("Project is waiting for user review.\n");
  }
}

function printDoctor(result: DoctorResult): void {
  if (!result.projectFound) {
    process.stdout.write("No Dr.Ralph project found.\n");
    for (const check of result.checks) {
      process.stdout.write(`- ${check.name}: ${check.detail}\n`);
    }
    return;
  }

  process.stdout.write(`Layout: ${result.layout}\n`);
  for (const check of result.checks) {
    process.stdout.write(`- ${check.name}: ${check.ok ? "ok" : "fail"} (${check.detail})\n`);
  }
  for (const warning of result.warnings) {
    process.stdout.write(`Warning: ${warning}\n`);
  }
}

async function ensureProject(): Promise<LocatedProject> {
  const project = await locateProject(process.cwd());
  if (!project) {
    throw new Error("No Dr.Ralph project found. Run 'ralph init <path>' first.");
  }
  return project;
}

const RESEARCH_MODE_LABELS: Record<ResearchMode, string> = {
  experimental_research: "Experimental research",
  theoretical_research: "Theoretical research",
};

export function parseResearchModeSelection(selection: string): ResearchMode | null {
  const normalized = selection.trim().toLowerCase();
  switch (normalized) {
    case "1":
    case "experimental":
    case "experimental_research":
      return "experimental_research";
    case "2":
    case "theoretical":
    case "theoretical_research":
      return "theoretical_research";
    default:
      return null;
  }
}

async function promptForResearchMode(): Promise<ResearchMode> {
  const rl = readline.createInterface({ input, output });
  try {
    while (true) {
      process.stdout.write("Choose a research mode:\n");
      for (const [index, mode] of RESEARCH_MODES.entries()) {
        process.stdout.write(`  ${index + 1}. ${RESEARCH_MODE_LABELS[mode]} (${mode})\n`);
      }
      const answer = await rl.question("Research mode: ");
      const parsed = parseResearchModeSelection(answer);
      if (parsed) {
        return parsed;
      }
      process.stdout.write(`Please choose one of: ${RESEARCH_MODES.join(", ")}\n`);
    }
  } finally {
    rl.close();
  }
}

export async function resolveInitResearchMode(
  requestedMode?: string,
  options?: {
    interactive?: boolean;
    prompt?: () => Promise<ResearchMode>;
  },
): Promise<ResearchMode> {
  if (requestedMode) {
    return z.enum(RESEARCH_MODES).parse(requestedMode);
  }
  const interactive = options?.interactive ?? (input.isTTY && output.isTTY);
  if (interactive) {
    return (options?.prompt ?? promptForResearchMode)();
  }
  throw new Error(
    `Research mode is required for non-interactive init. Use --research-mode <${RESEARCH_MODES.join(" | ")}>.`,
  );
}

async function printPaths(project: LocatedProject, json: boolean): Promise<void> {
  const status = await getStatus(project);
  if (json) {
    printJson(status.paths ?? {});
    return;
  }
  for (const [key, value] of Object.entries(status.paths ?? {})) {
    process.stdout.write(`${key}: ${value}\n`);
  }
}

async function startRepl(project: LocatedProject): Promise<void> {
  const rl = readline.createInterface({ input, output });

  process.stdout.write("Dr.Ralph interactive mode. Type 'help' for commands.\n");

  try {
    while (true) {
      const line = (await rl.question("ralph> ")).trim();
      if (!line) {
        continue;
      }
      if (line === "exit" || line === "quit") {
        return;
      }
      if (line === "help") {
        process.stdout.write("Commands: status, intake, run, resume <id>, show paths, doctor, help, exit\n");
        continue;
      }
      if (line === "status") {
        printStatus(await getStatus(project));
        continue;
      }
      if (line === "intake") {
        const result = await runInteractiveIntake(project);
        process.stdout.write(
          result.completed
            ? `Intake completed under session ${result.session.sessionId}.\n`
            : `Intake exited early. Session ${result.session.sessionId} saved.\n`,
        );
        continue;
      }
      if (line === "run") {
        const state = await runResearch(project, {
          tool: "codex",
          model: "gpt5.4-xhigh",
          maxIterations: 10,
        });
        process.stdout.write(`Run finished with state ${state.lifecycleState}. Session ${state.sessionId}.\n`);
        continue;
      }
      if (line.startsWith("resume ")) {
        const sessionId = line.slice("resume ".length).trim();
        const state = await runResearch(project, {
          tool: "codex",
          model: "gpt5.4-xhigh",
          maxIterations: 10,
          sessionId,
        });
        process.stdout.write(`Resumed session ${state.sessionId}: ${state.lifecycleState}\n`);
        continue;
      }
      if (line === "show paths") {
        await printPaths(project, false);
        continue;
      }
      if (line === "doctor") {
        printDoctor(await getDoctor(project));
        continue;
      }

      process.stdout.write(`Unknown command: ${line}\n`);
    }
  } finally {
    rl.close();
  }
}

export async function runCli(argv = process.argv.slice(2)): Promise<void> {
  if (argv[0] === "--init-intake") {
    argv = ["intake", ...argv.slice(1)];
  }

  const program = new Command();
  program
    .name("ralph")
    .description("Agent-native CLI runtime for the Dr.Ralph research harness.")
    .version(packageJson.version);

  program
    .command("init")
    .argument("[path]", "Target directory for the Dr.Ralph project", ".")
    .option("--research-mode <mode>", `Research mode (${RESEARCH_MODES.join(", ")})`)
    .option("--force", "Replace any existing Dr.Ralph-managed files")
    .option("--json", "Print JSON output")
    .action(async (path, options) => {
      const researchMode = await resolveInitResearchMode(options.researchMode);
      const project = await initProject(resolve(path), Boolean(options.force), researchMode);
      const status = await getStatus(project);
      if (options.json) {
        printJson(status);
      } else {
        process.stdout.write(`Initialized Dr.Ralph project at ${project.rootDir}\n`);
      }
    });

  const intake = program.command("intake").description("Collect researcher context and requirements.");
  intake
    .option("--json", "Print JSON output")
    .action(async (options) => {
      const project = await ensureProject();
      const result = await runInteractiveIntake(project);
      if (options.json) {
        printJson(result);
      } else {
        process.stdout.write(
          result.completed
            ? `Intake completed under session ${result.session.sessionId}.\n`
            : `Intake exited early. Session ${result.session.sessionId} saved.\n`,
        );
      }
    });

  intake
    .command("set")
    .requiredOption("--background <text>", "Research background")
    .requiredOption("--requirements <text>", "Hard requirements")
    .option("--resources <text>", "Available resources")
    .option("--collaboration <text>", "Collaboration preferences")
    .option("--extra <text>", "Additional context")
    .option("--json", "Print JSON output")
    .action(async (options) => {
      const project = await ensureProject();
      const result = await intakeSet(project, {
        background: options.background,
        requirements: options.requirements,
        resources: options.resources,
        collaboration: options.collaboration,
        extra: options.extra,
      });
      if (options.json) {
        printJson(result);
      } else {
        process.stdout.write(`Intake completed under session ${result.session.sessionId}.\n`);
      }
    });

  program
    .command("run")
    .option("--tool <tool>", "Execution backend tool", "codex")
    .option("--model <model>", "Model to use", "gpt5.4-xhigh")
    .option("--max-iterations <number>", "Maximum iterations", "10")
    .option("--session <id>", "Resume an existing session")
    .option("--json", "Print JSON output")
    .action(async (options) => {
      const parsed = z.object({
        tool: z.enum(["codex", "amp", "claude"]),
        model: z.string(),
        maxIterations: z.coerce.number().int().positive(),
        session: z.string().optional(),
      }).parse(options);
      const project = await ensureProject();
      const state = await runResearch(project, parsed);
      if (options.json) {
        printJson(state);
      } else {
        process.stdout.write(`Session ${state.sessionId} finished with state ${state.lifecycleState}.\n`);
      }
    });

  program
    .command("resume")
    .argument("<sessionId>", "Session to resume")
    .option("--tool <tool>", "Execution backend tool", "codex")
    .option("--model <model>", "Model to use", "gpt5.4-xhigh")
    .option("--max-iterations <number>", "Maximum iterations", "10")
    .option("--json", "Print JSON output")
    .action(async (sessionId, options) => {
      const parsed = z.object({
        tool: z.enum(["codex", "amp", "claude"]),
        model: z.string(),
        maxIterations: z.coerce.number().int().positive(),
      }).parse(options);
      const project = await ensureProject();
      const state = await runResearch(project, { ...parsed, sessionId });
      if (options.json) {
        printJson(state);
      } else {
        process.stdout.write(`Session ${state.sessionId} finished with state ${state.lifecycleState}.\n`);
      }
    });

  program
    .command("status")
    .option("--session <id>", "Inspect a specific session")
    .option("--json", "Print JSON output")
    .action(async (options) => {
      const project = await locateProject(process.cwd());
      if (!project) {
        const result = { projectFound: false };
        if (options.json) {
          printJson(result);
        } else {
          process.stdout.write("No Dr.Ralph project found.\n");
        }
        return;
      }
      const status = await getStatus(project);
      if (options.session) {
        const session = await readSessionState(project, options.session);
        const payload = { ...status, requestedSession: session };
        if (options.json) {
          printJson(payload);
        } else {
          printStatus(status);
          process.stdout.write(`Requested session state: ${session.lifecycleState}\n`);
        }
        return;
      }
      if (options.json) {
        printJson(status);
      } else {
        printStatus(status);
      }
    });

  program
    .command("doctor")
    .option("--json", "Print JSON output")
    .action(async (options) => {
      const result = await getDoctor(await locateProject(process.cwd()));
      if (options.json) {
        printJson(result);
      } else {
        printDoctor(result);
      }
    });

  program
    .command("paths")
    .option("--json", "Print JSON output")
    .action(async (options) => {
      const project = await ensureProject();
      await printPaths(project, Boolean(options.json));
    });

  const mcp = program.command("mcp");
  mcp
    .command("serve")
    .description("Start a stdio MCP server for AI agents.")
    .action(async () => {
      await startMcpServer();
    });

  if (argv.length === 0) {
    const project = await locateProject(process.cwd());
    if (project) {
      await startRepl(project);
      return;
    }
    program.outputHelp();
    return;
  }

  await program.parseAsync(["node", "ralph", ...argv], { from: "node" });
}

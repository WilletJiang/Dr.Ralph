import * as z from "zod/v4";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import packageJson from "../package.json" with { type: "json" };
import { resolve } from "node:path";
import { chdir, cwd } from "node:process";
import { getDoctor, getStatus, initProject, locateProject } from "./project.js";
import { intakeSet } from "./intake.js";
import { runResearch } from "./run.js";
import { RESEARCH_MODES } from "./types.js";

function textResult(payload: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}

async function withProjectCwd<T>(handler: () => Promise<T>): Promise<T> {
  const original = cwd();
  try {
    return await handler();
  } finally {
    chdir(original);
  }
}

async function resolveProject(targetRoot?: string) {
  const base = targetRoot ? resolve(targetRoot) : cwd();
  return locateProject(base);
}

export async function startMcpServer(): Promise<void> {
  const server = new McpServer({
    name: "dr-ralph",
    version: packageJson.version,
  });

  server.registerTool(
    "ralph_init",
    {
      description: "Initialize a Dr.Ralph project in the target directory.",
      inputSchema: {
        path: z.string(),
        researchMode: z.enum(RESEARCH_MODES),
        force: z.boolean().optional(),
      },
    },
    async ({ path, researchMode, force }) =>
      withProjectCwd(async () => {
        const project = await initProject(resolve(path), Boolean(force), researchMode);
        return textResult(await getStatus(project));
      }),
  );

  server.registerTool(
    "ralph_status",
    {
      description: "Get current Dr.Ralph project status.",
      inputSchema: {
        projectRoot: z.string().optional(),
      },
    },
    async ({ projectRoot }) => {
      const project = await resolveProject(projectRoot);
      if (!project) {
        return textResult({ projectFound: false });
      }
      return textResult(await getStatus(project));
    },
  );

  server.registerTool(
    "ralph_intake_get",
    {
      description: "Get current intake completion status.",
      inputSchema: {
        projectRoot: z.string().optional(),
      },
    },
    async ({ projectRoot }) => {
      const project = await resolveProject(projectRoot);
      if (!project) {
        return textResult({ projectFound: false });
      }
      const status = await getStatus(project);
      return textResult({
        projectFound: true,
        intakeComplete: status.intakeComplete,
        paths: status.paths,
      });
    },
  );

  server.registerTool(
    "ralph_intake_set",
    {
      description: "Write Dr.Ralph intake answers non-interactively.",
      inputSchema: {
        background: z.string(),
        requirements: z.string(),
        resources: z.string().optional(),
        collaboration: z.string().optional(),
        extra: z.string().optional(),
        projectRoot: z.string().optional(),
      },
    },
    async ({ background, requirements, resources, collaboration, extra, projectRoot }) => {
      const project = await resolveProject(projectRoot);
      if (!project) {
        return textResult({ projectFound: false });
      }
      const result = await intakeSet(project, {
        background,
        requirements,
        resources,
        collaboration,
        extra,
      });
      return textResult({
        sessionId: result.session.sessionId,
        completed: true,
      });
    },
  );

  server.registerTool(
    "ralph_run",
    {
      description: "Run or continue a Dr.Ralph research session.",
      inputSchema: {
        tool: z.enum(["codex", "amp", "claude"]).optional(),
        model: z.string().optional(),
        maxIterations: z.number().int().positive().optional(),
        session: z.string().optional(),
        projectRoot: z.string().optional(),
      },
    },
    async ({ tool, model, maxIterations, session, projectRoot }) => {
      const project = await resolveProject(projectRoot);
      if (!project) {
        return textResult({ projectFound: false });
      }
      const state = await runResearch(project, {
        tool: tool ?? "codex",
        model: model ?? "gpt5.4-xhigh",
        maxIterations: maxIterations ?? 10,
        sessionId: session,
      });
      return textResult(state);
    },
  );

  server.registerTool(
    "ralph_resume",
    {
      description: "Resume a Dr.Ralph session by session id.",
      inputSchema: {
        sessionId: z.string(),
        tool: z.enum(["codex", "amp", "claude"]).optional(),
        model: z.string().optional(),
        maxIterations: z.number().int().positive().optional(),
        projectRoot: z.string().optional(),
      },
    },
    async ({ sessionId, tool, model, maxIterations, projectRoot }) => {
      const project = await resolveProject(projectRoot);
      if (!project) {
        return textResult({ projectFound: false });
      }
      const state = await runResearch(project, {
        tool: tool ?? "codex",
        model: model ?? "gpt5.4-xhigh",
        maxIterations: maxIterations ?? 10,
        sessionId,
      });
      return textResult(state);
    },
  );

  server.registerTool(
    "ralph_doctor",
    {
      description: "Run diagnostics for the current Dr.Ralph workspace.",
      inputSchema: {
        projectRoot: z.string().optional(),
      },
    },
    async ({ projectRoot }) => textResult(await getDoctor(await resolveProject(projectRoot))),
  );

  server.registerTool(
    "ralph_paths",
    {
      description: "Return canonical Dr.Ralph path information for the current project.",
      inputSchema: {
        projectRoot: z.string().optional(),
      },
    },
    async ({ projectRoot }) => {
      const project = await resolveProject(projectRoot);
      if (!project) {
        return textResult({ projectFound: false });
      }
      const status = await getStatus(project);
      return textResult(status.paths ?? {});
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

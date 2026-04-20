import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

function packageRoot(): string {
  return fileURLToPath(new URL("../../", import.meta.url));
}

function parseToolText(result: { content?: Array<{ type: string; text?: string }> }): unknown {
  const text = result.content?.find((item) => item.type === "text")?.text;
  if (!text) {
    throw new Error("MCP tool returned no text content.");
  }
  return JSON.parse(text);
}

async function main(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "ralph-smoke-mcp-"));
  const projectPath = join(root, "proj");
  const cliPath = join(packageRoot(), "dist", "cli-bin.js");

  const transport = new StdioClientTransport({
    command: "node",
    args: [cliPath, "mcp", "serve"],
    cwd: packageRoot(),
    env: { ...process.env, NODE_ENV: "test" },
    stderr: "pipe",
  });

  const client = new Client({ name: "ralph-smoke-client", version: "1.0.0" });

  try {
    await client.connect(transport);

    const listed = await client.listTools();
    const toolNames = listed.tools.map((tool) => tool.name).sort();

    const expectedTools = [
      "ralph_init",
      "ralph_status",
      "ralph_intake_get",
      "ralph_intake_set",
      "ralph_run",
      "ralph_resume",
      "ralph_doctor",
      "ralph_paths",
    ];

    for (const name of expectedTools) {
      if (!toolNames.includes(name)) {
        throw new Error(`Missing MCP tool: ${name}`);
      }
    }

    const initResult = parseToolText(
      await client.callTool({
        name: "ralph_init",
        arguments: { path: projectPath, researchMode: "experimental_research" },
      }),
    ) as { projectFound?: boolean; projectRoot?: string; researchMode?: string };

    if (
      !initResult.projectFound ||
      initResult.projectRoot !== projectPath ||
      initResult.researchMode !== "experimental_research"
    ) {
      throw new Error(`Unexpected init result: ${JSON.stringify(initResult)}`);
    }

    const runBlocked = parseToolText(
      await client.callTool({
        name: "ralph_run",
        arguments: {
          tool: "codex",
          model: "gpt5.4-xhigh",
          maxIterations: 1,
          projectRoot: projectPath,
        },
      }),
    ) as { lifecycleState?: string; latestError?: string };

    if (runBlocked.lifecycleState !== "blocked") {
      throw new Error(`Expected blocked run before intake, got ${JSON.stringify(runBlocked)}`);
    }

    await client.callTool({
      name: "ralph_intake_set",
      arguments: {
        background: "mcp smoke researcher",
        requirements: "verify mcp end-to-end",
        resources: "local test only",
        collaboration: "stop before implementation",
        extra: "none",
        projectRoot: projectPath,
      },
    });

    const status = parseToolText(
      await client.callTool({
        name: "ralph_status",
        arguments: { projectRoot: projectPath },
      }),
    ) as { intakeComplete?: boolean; projectFound?: boolean; researchMode?: string };

    if (!status.projectFound || status.intakeComplete !== true || status.researchMode !== "experimental_research") {
      throw new Error(`Unexpected status after intake: ${JSON.stringify(status)}`);
    }

    const doctor = parseToolText(
      await client.callTool({
        name: "ralph_doctor",
        arguments: { projectRoot: projectPath },
      }),
    ) as { checks?: Array<{ name: string; ok: boolean }> };

    if (!doctor.checks?.some((check) => check.name === "control_file" && check.ok)) {
      throw new Error(`Doctor checks missing successful control_file entry: ${JSON.stringify(doctor)}`);
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          tools: toolNames,
          status,
          blockedRun: runBlocked.lifecycleState,
        },
        null,
        2,
      ),
    );
  } finally {
    await client.close();
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

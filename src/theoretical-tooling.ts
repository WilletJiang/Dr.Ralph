import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import { TheoreticalToolingProfile } from "./types.js";

const execFileAsync = promisify(execFile);

const LEAN4_SKILLS_REPO_URL = "https://github.com/cameronfreer/lean4-skills.git";
const LEAN4_SKILLS_CLONE_ROOT = join(homedir(), ".codex", "tooling", "lean4-skills");
const LEAN_LSP_MCP_INSTALL_COMMAND = "uv tool install --force lean-lsp-mcp";

export interface TheoreticalToolingConfig {
  profile: TheoreticalToolingProfile;
  required: true;
  lean4SkillsRepoUrl: string;
  lean4SkillsRoot: string;
  lean4PluginRoot: string;
  lean4SkillPath: string;
  lean4Scripts: string;
  lean4References: string;
  leanLspMcpRequired: true;
  leanLspMcpInstallCommand: string;
  leanLspMcpCommand: string;
  leanLspMcpArgs: string[];
  envScriptPath: string;
  mcpConfigPath: string;
}

function shouldSkipProvisioning(): boolean {
  return process.env.NODE_ENV === "test" || process.env.RALPH_SKIP_TOOL_PROVISION === "1";
}

function buildToolingConfig(projectRoot: string): TheoreticalToolingConfig {
  const lean4PluginRoot = join(LEAN4_SKILLS_CLONE_ROOT, "plugins", "lean4");
  return {
    profile: "lean4_skills_plus_lsp",
    required: true,
    lean4SkillsRepoUrl: LEAN4_SKILLS_REPO_URL,
    lean4SkillsRoot: LEAN4_SKILLS_CLONE_ROOT,
    lean4PluginRoot,
    lean4SkillPath: join(lean4PluginRoot, "skills", "lean4", "SKILL.md"),
    lean4Scripts: join(lean4PluginRoot, "lib", "scripts"),
    lean4References: join(lean4PluginRoot, "skills", "lean4", "references"),
    leanLspMcpRequired: true,
    leanLspMcpInstallCommand: LEAN_LSP_MCP_INSTALL_COMMAND,
    leanLspMcpCommand: "lean-lsp-mcp",
    leanLspMcpArgs: ["--project", "."],
    envScriptPath: join(projectRoot, ".ralph", "tooling", "lean4-env.sh"),
    mcpConfigPath: join(projectRoot, ".mcp.json"),
  };
}

async function runCommand(command: string, args: string[]): Promise<void> {
  try {
    await execFileAsync(command, args, { maxBuffer: 1024 * 1024 * 16 });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Command failed: ${command} ${args.join(" ")}\n${detail}`);
  }
}

async function ensureLean4SkillsClone(): Promise<void> {
  if (shouldSkipProvisioning()) {
    return;
  }
  await mkdir(dirname(LEAN4_SKILLS_CLONE_ROOT), { recursive: true });
  try {
    await execFileAsync("git", ["-C", LEAN4_SKILLS_CLONE_ROOT, "rev-parse", "--is-inside-work-tree"]);
    return;
  } catch {
    await runCommand("git", ["clone", "--depth", "1", LEAN4_SKILLS_REPO_URL, LEAN4_SKILLS_CLONE_ROOT]);
  }
}

async function ensureLeanLspMcpInstalled(): Promise<void> {
  if (shouldSkipProvisioning()) {
    return;
  }
  await runCommand("uv", ["tool", "install", "--force", "lean-lsp-mcp"]);
}

async function writeLeanEnvScript(config: TheoreticalToolingConfig): Promise<void> {
  await mkdir(dirname(config.envScriptPath), { recursive: true });
  const contents = `#!/bin/sh
export LEAN4_PLUGIN_ROOT="${config.lean4PluginRoot}"
export LEAN4_SCRIPTS="${config.lean4Scripts}"
export LEAN4_REFS="${config.lean4References}"
`;
  await writeFile(config.envScriptPath, contents);
}

async function writeLeanMcpConfig(config: TheoreticalToolingConfig): Promise<void> {
  const payload = {
    mcpServers: {
      "lean-lsp": {
        command: config.leanLspMcpCommand,
        args: config.leanLspMcpArgs,
      },
    },
  };
  await writeFile(config.mcpConfigPath, JSON.stringify(payload, null, 2) + "\n");
}

export async function provisionTheoreticalTooling(projectRoot: string): Promise<TheoreticalToolingConfig> {
  const config = buildToolingConfig(projectRoot);
  await Promise.all([
    ensureLean4SkillsClone(),
    ensureLeanLspMcpInstalled(),
  ]);
  await Promise.all([
    writeLeanEnvScript(config),
    writeLeanMcpConfig(config),
  ]);
  return config;
}

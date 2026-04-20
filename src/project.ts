import { access, cp, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { basename, dirname, join, relative } from "node:path";

import packageJson from "../package.json" with { type: "json" };
import { findPackageRoot } from "./package-root.js";
import {
  ArtifactPaths,
  DEFAULT_RESEARCH_MODE,
  DoctorCheck,
  DoctorResult,
  LocatedProject,
  ProjectMetadata,
  ProjectLayout,
  ResearchMode,
  RESEARCH_MODES,
  SessionState,
  StatusResult,
} from "./types.js";
import { provisionTheoreticalTooling } from "./theoretical-tooling.js";

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function rootDirFromControl(controlFilePath: string, layout: ProjectLayout): string {
  if (layout === "legacy") {
    return dirname(dirname(dirname(controlFilePath)));
  }
  return dirname(controlFilePath);
}

export async function locateProject(startDir = process.cwd()): Promise<LocatedProject | null> {
  let current = startDir;

  while (true) {
    const projectFilePath = join(current, ".ralph", "project.json");
    if (await pathExists(projectFilePath)) {
      const metadata = JSON.parse(await readFile(projectFilePath, "utf8")) as ProjectMetadata;
      const configuredControl = join(current, metadata.controlFile || "research_program.json");
      const controlFilePath = (await pathExists(configuredControl))
        ? configuredControl
        : join(current, "research_program.json");
      return {
        rootDir: current,
        layout: "canonical",
        controlFilePath,
        projectFilePath,
      };
    }

    const canonicalControl = join(current, "research_program.json");
    if (await pathExists(canonicalControl)) {
      return {
        rootDir: current,
        layout: "canonical",
        controlFilePath: canonicalControl,
      };
    }

    const legacyControl = join(current, "scripts", "ralph", "research_program.json");
    if (await pathExists(legacyControl)) {
      return {
        rootDir: current,
        layout: "legacy",
        controlFilePath: legacyControl,
        legacyWarning: "Legacy layout detected: control file is stored under scripts/ralph/.",
      };
    }

    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

export async function readControlFile(project: LocatedProject): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(project.controlFilePath, "utf8")) as Record<string, unknown>;
}

export async function writeControlFile(
  project: LocatedProject,
  control: Record<string, unknown>,
): Promise<void> {
  await writeFile(project.controlFilePath, JSON.stringify(control, null, 2) + "\n");
}

export function toProjectRelative(project: LocatedProject, path: string): string {
  return relative(project.rootDir, path) || ".";
}

export function getArtifactPaths(
  project: LocatedProject,
  control: Record<string, unknown>,
): ArtifactPaths {
  const harness = (control.harness ?? {}) as Record<string, string | boolean | string[]>;
  const resolve = (candidate: string | undefined, fallback: string): string =>
    join(project.rootDir, candidate ?? fallback);

  return {
    controlFile: project.controlFilePath,
    ideaFile: resolve(asString(harness.ideaFile), "idea.md"),
    intakeFile: resolve(
      asString(((control.researcherContext ?? {}) as Record<string, unknown>).intakeFile),
      "research/intake.md",
    ),
    reviewMemoFile: resolve(asString(harness.reviewMemoFile), "research/final-review.md"),
    progressFile: resolve(asString(harness.progressFile), "progress.txt"),
    explorationRoot: resolve(asString(harness.explorationRoot), "experiments/early-exploration"),
    liveLogFile: resolve(asString(harness.liveLogFile), "experiments/early-exploration/live-log.md"),
    iterationLogRoot: resolve(
      asString(harness.iterationLogRoot),
      "experiments/early-exploration/agent-runs",
    ),
  };
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function parseResearchMode(value: unknown): ResearchMode | undefined {
  return RESEARCH_MODES.find((mode) => mode === value);
}

export function getResearchMode(control: Record<string, unknown>): ResearchMode {
  return parseResearchMode(control.researchMode) ?? DEFAULT_RESEARCH_MODE;
}

export function getResearchModeWarning(control: Record<string, unknown>): string | null {
  const raw = control.researchMode;
  if (raw === undefined) {
    return `Legacy project: researchMode is missing, defaulting to ${DEFAULT_RESEARCH_MODE}.`;
  }
  if (parseResearchMode(raw)) {
    return null;
  }
  return `Unrecognized researchMode '${String(raw)}'; defaulting to ${DEFAULT_RESEARCH_MODE}.`;
}

export function getCurrentStage(control: Record<string, unknown>): string | null {
  const stories = Array.isArray(control.userStories) ? control.userStories : [];
  for (const item of stories as Record<string, unknown>[]) {
    const status = item.status;
    const requiresUserIntervention = item.requiresUserIntervention;
    if (status === "queued" && requiresUserIntervention !== true) {
      return asString(item.stage) ?? null;
    }
  }

  return null;
}

export function getCurrentItemId(control: Record<string, unknown>): string | null {
  const stories = Array.isArray(control.userStories) ? control.userStories : [];
  for (const item of stories as Record<string, unknown>[]) {
    const status = item.status;
    const requiresUserIntervention = item.requiresUserIntervention;
    if (status === "queued" && requiresUserIntervention !== true) {
      return asString(item.id) ?? null;
    }
  }

  return null;
}

export function isIntakeComplete(control: Record<string, unknown>): boolean {
  return ((control.researcherContext ?? {}) as Record<string, unknown>).isComplete === true;
}

export function getAutomationState(control: Record<string, unknown>): string | null {
  return asString(((control.automation ?? {}) as Record<string, unknown>).state) ?? null;
}

export async function initProject(
  targetDir: string,
  force: boolean,
  researchMode: ResearchMode,
): Promise<LocatedProject> {
  const packageRoot = findPackageRoot();
  const rootDir = targetDir;
  const projectName = basename(rootDir);
  const controlFilePath = join(rootDir, "research_program.json");
  const projectFilePath = join(rootDir, ".ralph", "project.json");
  const templateRoot = join(packageRoot, "templates", researchMode);

  const collisions = [
    controlFilePath,
    join(rootDir, "idea.md"),
    join(rootDir, "research"),
    join(rootDir, "experiments"),
    join(rootDir, ".ralph"),
    ...(researchMode === "theoretical_research" ? [join(rootDir, ".mcp.json")] : []),
  ];

  if (!force) {
    const existing = [];
    for (const collision of collisions) {
      if (await pathExists(collision)) {
        existing.push(collision);
      }
    }
    if (existing.length > 0) {
      throw new Error(
        `ralph init would overwrite existing paths:\n${existing.map((item) => `  ${item}`).join("\n")}`,
      );
    }
  }

  await mkdir(rootDir, { recursive: true });
  await mkdir(join(rootDir, ".ralph", "sessions"), { recursive: true });

  if (force) {
    for (const collision of collisions) {
      if (!(await pathExists(collision))) {
        continue;
      }
      await import("node:fs/promises").then(({ rm }) =>
        rm(collision, { recursive: true, force: true }),
      );
    }
    await mkdir(join(rootDir, ".ralph", "sessions"), { recursive: true });
  }

  for (const entry of ["research_program.json", "idea.md", "research", "experiments"] as const) {
    await cp(join(templateRoot, entry), join(rootDir, entry), { recursive: true });
  }

  const control = JSON.parse(await readFile(join(rootDir, "research_program.json"), "utf8")) as Record<string, unknown>;
  control.project = projectName;
  control.branchName = `ralph/${slugify(projectName)}`;
  control.researchMode = researchMode;
  if (researchMode === "theoretical_research") {
    control.theoreticalTooling = await provisionTheoreticalTooling(rootDir);
  }
  if (typeof control.description === "string") {
    control.description = `Auto-research harness for ${projectName}.`;
  }
  await writeFile(controlFilePath, JSON.stringify(control, null, 2) + "\n");

  const metadata: ProjectMetadata = {
    version: 1,
    layout: "canonical",
    createdAt: new Date().toISOString(),
    cliVersion: packageJson.version,
    controlFile: "research_program.json",
  };
  await writeFile(projectFilePath, JSON.stringify(metadata, null, 2) + "\n");

  return {
    rootDir,
    layout: "canonical",
    controlFilePath,
    projectFilePath,
  };
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

async function findLatestSessionState(project: LocatedProject): Promise<SessionState | null> {
  const sessionsRoot = join(project.rootDir, ".ralph", "sessions");
  if (!(await pathExists(sessionsRoot))) {
    return null;
  }

  const entries = await readdir(sessionsRoot);
  const candidates: { state: SessionState; mtimeMs: number }[] = [];

  for (const entry of entries) {
    const statePath = join(sessionsRoot, entry, "state.json");
    if (!(await pathExists(statePath))) {
      continue;
    }
    const [raw, metadata] = await Promise.all([readFile(statePath, "utf8"), stat(statePath)]);
    candidates.push({
      state: JSON.parse(raw) as SessionState,
      mtimeMs: metadata.mtimeMs,
    });
  }

  candidates.sort((left, right) => right.mtimeMs - left.mtimeMs);
  return candidates[0]?.state ?? null;
}

export async function getStatus(project: LocatedProject): Promise<StatusResult> {
  const control = await readControlFile(project);
  const latestSession = await findLatestSessionState(project);
  const paths = getArtifactPaths(project, control);
  const automationState = getAutomationState(control);
  const researchModeWarning = getResearchModeWarning(control);

  return {
    projectFound: true,
    projectRoot: project.rootDir,
    layout: project.layout,
    legacyWarning: project.legacyWarning,
    controlFilePath: project.controlFilePath,
    researchMode: getResearchMode(control),
    researchModeWarning,
    intakeComplete: isIntakeComplete(control),
    automationState,
    currentStage: getCurrentStage(control),
    latestSessionId: latestSession?.sessionId ?? null,
    latestSessionState: latestSession?.lifecycleState ?? null,
    awaitingUserReview: automationState === "awaiting_user_review",
    paths,
  };
}

export async function getDoctor(project: LocatedProject | null): Promise<DoctorResult> {
  const checks: DoctorCheck[] = [];
  const warnings: string[] = [];

  if (!project) {
    checks.push({
      name: "project",
      ok: false,
      detail: "No Dr.Ralph project found in the current directory or any parent.",
    });
    return { projectFound: false, checks, warnings };
  }

  const controlExists = await pathExists(project.controlFilePath);
  checks.push({
    name: "control_file",
    ok: controlExists,
    detail: controlExists
      ? `Found control file at ${project.controlFilePath}`
      : `Missing control file at ${project.controlFilePath}`,
  });

  const projectFilePath = join(project.rootDir, ".ralph", "project.json");
  const projectFileExists = await pathExists(projectFilePath);
  checks.push({
    name: "project_metadata",
    ok: project.layout === "legacy" ? true : projectFileExists,
    detail:
      project.layout === "legacy"
        ? "Legacy layout does not require .ralph/project.json"
        : projectFileExists
          ? `Found metadata file at ${projectFilePath}`
          : `Missing metadata file at ${projectFilePath}`,
  });

  for (const [name, command] of [
    ["codex_cli", "codex"],
    ["claude_cli", "claude"],
    ["amp_cli", "amp"],
    ["jq", "jq"],
  ] as const) {
    const available = await import("node:child_process").then(
      ({ execFileSync }) => {
        try {
          execFileSync("bash", ["-lc", `command -v ${command}`], { stdio: "ignore" });
          return true;
        } catch {
          return false;
        }
      },
    );
    checks.push({
      name,
      ok: available,
      detail: available ? `${command} is available on PATH` : `${command} is not available on PATH`,
    });
  }

  checks.push({
    name: "codex_sdk",
    ok: true,
    detail: "Codex SDK dependency is installed with the CLI package.",
  });

  if (project.layout === "legacy") {
    warnings.push(project.legacyWarning ?? "Legacy layout detected.");
  }

  if (controlExists) {
    const control = await readControlFile(project);
    const researchModeWarning = getResearchModeWarning(control);
    if (researchModeWarning) {
      warnings.push(researchModeWarning);
    }
    if (!isIntakeComplete(control)) {
      warnings.push("Research intake is not complete.");
    }
  }

  return {
    projectFound: true,
    layout: project.layout,
    checks,
    warnings,
  };
}

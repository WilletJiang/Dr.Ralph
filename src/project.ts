import { access, cp, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { basename, dirname, join, relative } from "node:path";

import packageJson from "../package.json" with { type: "json" };
import { findPackageRoot } from "./package-root.js";
import {
  ArtifactPaths,
  DoctorCheck,
  DoctorResult,
  LocatedProject,
  ProjectMetadata,
  ResearchMode,
  RESEARCH_MODES,
  ReviewPanel,
  ReviewReworkPolicy,
  REVIEW_CONFIDENCE_LEVELS,
  REVIEW_EVIDENCE_STRENGTHS,
  REVIEW_HANDOFF_RECOMMENDATIONS,
  REVIEW_NEXT_ACTIONS,
  REVIEW_STATUSES,
  SessionState,
  StatusResult,
} from "./types.js";
import { provisionTheoreticalTooling } from "./theoretical-tooling.js";

type StoryRecord = Record<string, unknown>;

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function locateProject(startDir = process.cwd()): Promise<LocatedProject | null> {
  let current = startDir;

  while (true) {
    const projectFilePath = join(current, ".ralph", "project.json");
    if (await pathExists(projectFilePath)) {
      const metadata = JSON.parse(await readFile(projectFilePath, "utf8")) as ProjectMetadata;
      const controlFilePath = join(current, metadata.controlFile || "research_program.json");
      if (await pathExists(controlFilePath)) {
        return {
          rootDir: current,
          layout: "canonical",
          controlFilePath,
          projectFilePath,
        };
      }
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

export function getResearchMode(control: Record<string, unknown>): ResearchMode | undefined {
  return parseResearchMode(control.researchMode);
}

export function getResearchModeWarning(control: Record<string, unknown>): string | null {
  const raw = control.researchMode;
  if (raw === undefined) {
    return `Missing required researchMode. Expected one of: ${RESEARCH_MODES.join(", ")}.`;
  }
  if (parseResearchMode(raw)) {
    return null;
  }
  return `Unrecognized researchMode '${String(raw)}'. Expected one of: ${RESEARCH_MODES.join(", ")}.`;
}

export function requireResearchMode(control: Record<string, unknown>): ResearchMode {
  const researchMode = getResearchMode(control);
  if (researchMode) {
    return researchMode;
  }

  throw new Error(getResearchModeWarning(control) ?? "Missing required researchMode.");
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

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => asString(entry))
    .filter((entry): entry is string => Boolean(entry));
}

function asNonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

export function getReviewPanel(control: Record<string, unknown>): ReviewPanel {
  const raw = asRecord(control.review) ?? {};

  return {
    status: REVIEW_STATUSES.find((value) => value === raw.status) ?? "pending",
    cycle: asNonNegativeInteger(raw.cycle) ?? 0,
    nextAction: REVIEW_NEXT_ACTIONS.find((value) => value === raw.nextAction) ?? "",
    handoffRecommendation:
      REVIEW_HANDOFF_RECOMMENDATIONS.find((value) => value === raw.handoffRecommendation) ?? "",
    reopenStage: asString(raw.reopenStage) ?? "",
    reworkGoals: asStringList(raw.reworkGoals),
    confidence: REVIEW_CONFIDENCE_LEVELS.find((value) => value === raw.confidence) ?? "",
    evidenceStrength:
      REVIEW_EVIDENCE_STRENGTHS.find((value) => value === raw.evidenceStrength) ?? "",
    finalClaim: asString(raw.finalClaim) ?? "",
    strongestSupport: asStringList(raw.strongestSupport),
    strongestCounterevidence: asStringList(raw.strongestCounterevidence),
    hiddenAssumptions: asStringList(raw.hiddenAssumptions),
    alternativeExplanationsOrObstructions: asStringList(
      raw.alternativeExplanationsOrObstructions,
    ),
    fitToRequirements: asStringList(raw.fitToRequirements),
    residualRisks: asStringList(raw.residualRisks),
    reviewerQuestions: asStringList(raw.reviewerQuestions),
    suggestedNextStep: asString(raw.suggestedNextStep) ?? "",
    completedAt: asString(raw.completedAt) ?? "",
  };
}

export function getReviewReworkPolicy(control: Record<string, unknown>): ReviewReworkPolicy {
  const automation = asRecord(control.automation) ?? {};
  const raw = asRecord(automation.reviewReworkPolicy) ?? {};

  return {
    allowAutonomousRework:
      typeof raw.allowAutonomousRework === "boolean" ? raw.allowAutonomousRework : true,
    maxCycles: raw.maxCycles === null ? null : asNonNegativeInteger(raw.maxCycles),
  };
}

function writeReviewPanel(control: Record<string, unknown>, review: ReviewPanel): void {
  control.review = {
    status: review.status,
    cycle: review.cycle,
    nextAction: review.nextAction,
    handoffRecommendation: review.handoffRecommendation,
    reopenStage: review.reopenStage,
    reworkGoals: [...review.reworkGoals],
    confidence: review.confidence,
    evidenceStrength: review.evidenceStrength,
    finalClaim: review.finalClaim,
    strongestSupport: [...review.strongestSupport],
    strongestCounterevidence: [...review.strongestCounterevidence],
    hiddenAssumptions: [...review.hiddenAssumptions],
    alternativeExplanationsOrObstructions: [...review.alternativeExplanationsOrObstructions],
    fitToRequirements: [...review.fitToRequirements],
    residualRisks: [...review.residualRisks],
    reviewerQuestions: [...review.reviewerQuestions],
    suggestedNextStep: review.suggestedNextStep,
    completedAt: review.completedAt,
  };
}

function findStoryIndex(stories: StoryRecord[], stage: string, maxIndex = stories.length - 1): number {
  for (let index = 0; index <= maxIndex; index += 1) {
    const story = stories[index];
    if (asString(story.stage) === stage && story.requiresUserIntervention !== true) {
      return index;
    }
  }
  return -1;
}

export function applyFinalReviewDecision(control: Record<string, unknown>): {
  controlChanged: boolean;
  blockedReason?: string;
} {
  if (getCurrentStage(control) !== "final_review") {
    return { controlChanged: false };
  }

  const review = getReviewPanel(control);
  if (review.status !== "complete" || review.nextAction === "") {
    return { controlChanged: false };
  }

  const stories = Array.isArray(control.userStories) ? (control.userStories as StoryRecord[]) : [];
  const finalReviewIndex = findStoryIndex(stories, "final_review");
  if (finalReviewIndex < 0) {
    return {
      controlChanged: false,
      blockedReason: "Current stage is final_review, but no auto-eligible final_review item exists.",
    };
  }

  const userReviewIndex = stories.findIndex(
    (story, index) =>
      index > finalReviewIndex &&
      asString(story.stage) === "user_review" &&
      story.requiresUserIntervention !== true,
  );
  if (userReviewIndex < 0) {
    return {
      controlChanged: false,
      blockedReason: "Current stage is final_review, but no downstream user_review gate exists.",
    };
  }

  const finalReviewItem = stories[finalReviewIndex];
  const userReviewItem = stories[userReviewIndex];
  const completedAt = review.completedAt || new Date().toISOString();

  if (review.nextAction === "handoff_to_user") {
    if (review.handoffRecommendation === "") {
      return {
        controlChanged: false,
        blockedReason:
          "final_review selected handoff_to_user without a structured handoffRecommendation.",
      };
    }

    finalReviewItem.status = "promoted";
    finalReviewItem.passes = true;
    userReviewItem.status = "queued";
    userReviewItem.passes = false;
    writeReviewPanel(control, { ...review, completedAt });
    return { controlChanged: true };
  }

  const policy = getReviewReworkPolicy(control);
  if (!policy.allowAutonomousRework) {
    return {
      controlChanged: false,
      blockedReason:
        "final_review requested autonomous_rework, but automation.reviewReworkPolicy disallows it.",
    };
  }

  if (!review.reopenStage) {
    return {
      controlChanged: false,
      blockedReason: "final_review requested autonomous_rework without a concrete reopenStage.",
    };
  }

  if (policy.maxCycles !== null && review.cycle >= policy.maxCycles) {
    return {
      controlChanged: false,
      blockedReason:
        "final_review requested autonomous_rework after reaching automation.reviewReworkPolicy.maxCycles.",
    };
  }

  const reopenIndex = findStoryIndex(stories, review.reopenStage, finalReviewIndex - 1);
  if (reopenIndex < 0) {
    return {
      controlChanged: false,
      blockedReason:
        "final_review requested autonomous_rework with a reopenStage that is not a valid earlier auto stage.",
    };
  }

  for (let index = reopenIndex; index <= finalReviewIndex; index += 1) {
    const story = stories[index];
    if (story.requiresUserIntervention === true) {
      continue;
    }
    story.status = "queued";
    story.passes = false;
  }

  userReviewItem.status = "queued";
  userReviewItem.passes = false;
  writeReviewPanel(control, {
    ...review,
    cycle: review.cycle + 1,
    completedAt,
  });

  return { controlChanged: true };
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
  const researchMode = getResearchMode(control);

  return {
    projectFound: true,
    projectRoot: project.rootDir,
    layout: project.layout,
    controlFilePath: project.controlFilePath,
    researchMode,
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
    ok: projectFileExists,
    detail: projectFileExists
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

  if (controlExists) {
    const control = await readControlFile(project);
    const researchMode = getResearchMode(control);
    const researchModeWarning = getResearchModeWarning(control);
    checks.push({
      name: "research_mode",
      ok: researchModeWarning === null,
      detail: researchModeWarning ?? `Found researchMode '${researchMode}'.`,
    });
    if (researchModeWarning) {
      warnings.push(researchModeWarning);
    }
    if (!isIntakeComplete(control)) {
      warnings.push("Research intake is not complete.");
    }
  } else {
    checks.push({
      name: "research_mode",
      ok: false,
      detail: "Cannot validate researchMode because the control file is missing.",
    });
  }

  return {
    projectFound: true,
    layout: project.layout,
    checks,
    warnings,
  };
}

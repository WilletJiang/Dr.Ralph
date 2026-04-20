export type ToolName = "codex" | "amp" | "claude";

export type ProjectLayout = "canonical" | "legacy";

export const RESEARCH_MODES = [
  "experimental_research",
  "theoretical_research",
] as const;

export type ResearchMode = (typeof RESEARCH_MODES)[number];

export const DEFAULT_RESEARCH_MODE: ResearchMode = "experimental_research";

export const THEORETICAL_TOOLING_PROFILES = [
  "lean4_skills_plus_lsp",
] as const;

export type TheoreticalToolingProfile = (typeof THEORETICAL_TOOLING_PROFILES)[number];

export type LifecycleState =
  | "idle"
  | "awaiting_input"
  | "running"
  | "blocked"
  | "awaiting_user_review"
  | "completed"
  | "failed";

export type EventType =
  | "session.started"
  | "intake.question.presented"
  | "intake.answer.recorded"
  | "run.started"
  | "run.backend.event"
  | "artifact.updated"
  | "run.blocked"
  | "run.awaiting_user_review"
  | "run.completed"
  | "run.failed";

export type IntakeField =
  | "background"
  | "requirements"
  | "resources"
  | "collaboration"
  | "extra";

export interface ProjectMetadata {
  version: 1;
  layout: "canonical";
  createdAt: string;
  cliVersion: string;
  controlFile: string;
}

export interface LocatedProject {
  rootDir: string;
  layout: ProjectLayout;
  controlFilePath: string;
  projectFilePath?: string;
  legacyWarning?: string;
}

export interface ArtifactPaths {
  controlFile: string;
  ideaFile: string;
  intakeFile: string;
  reviewMemoFile: string;
  progressFile: string;
  explorationRoot: string;
  liveLogFile: string;
  iterationLogRoot: string;
}

export interface SessionState {
  sessionId: string;
  provider: ToolName;
  backend: "codex-sdk" | "local-cli";
  model: string;
  lifecycleState: LifecycleState;
  currentStage: string | null;
  currentItemId: string | null;
  currentQuestion: IntakeField | null;
  projectRoot: string;
  controlFilePath: string;
  createdAt: string;
  updatedAt: string;
  backendSessionId?: string;
  artifacts: ArtifactPaths;
  latestError?: string;
}

export interface RalphEvent<TData = unknown> {
  timestamp: string;
  sessionId: string;
  type: EventType;
  data: TData;
}

export interface IntakeAnswers {
  background?: string;
  requirements?: string;
  resources?: string;
  collaboration?: string;
  extra?: string;
}

export interface StatusResult {
  projectFound: boolean;
  projectRoot?: string;
  layout?: ProjectLayout;
  legacyWarning?: string;
  controlFilePath?: string;
  researchMode?: ResearchMode;
  researchModeWarning?: string | null;
  intakeComplete?: boolean;
  automationState?: string | null;
  currentStage?: string | null;
  latestSessionId?: string | null;
  latestSessionState?: LifecycleState | null;
  awaitingUserReview?: boolean;
  paths?: ArtifactPaths;
}

export interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface DoctorResult {
  projectFound: boolean;
  layout?: ProjectLayout;
  checks: DoctorCheck[];
  warnings: string[];
}

export interface BackendRunContext {
  session: SessionState;
  prompt: string;
  project: LocatedProject;
  maxIterations: number;
}

export interface BackendRunResult {
  backendSessionId?: string;
  lifecycleState: LifecycleState;
  latestError?: string;
  finalResponse?: string;
}

export type ToolName = "codex" | "amp" | "claude";

export type ProjectLayout = "canonical";

export const RESEARCH_MODES = [
  "experimental_research",
  "theoretical_research",
] as const;

export type ResearchMode = (typeof RESEARCH_MODES)[number];

export const THEORETICAL_TOOLING_PROFILES = [
  "lean4_skills_plus_lsp",
] as const;

export type TheoreticalToolingProfile = (typeof THEORETICAL_TOOLING_PROFILES)[number];

export const REVIEW_STATUSES = ["pending", "complete"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const REVIEW_NEXT_ACTIONS = ["handoff_to_user", "autonomous_rework"] as const;
export type ReviewNextAction = (typeof REVIEW_NEXT_ACTIONS)[number];

export const REVIEW_HANDOFF_RECOMMENDATIONS = [
  "approve",
  "reject",
  "redirect",
  "",
] as const;
export type ReviewHandoffRecommendation = (typeof REVIEW_HANDOFF_RECOMMENDATIONS)[number];

export const REVIEW_CONFIDENCE_LEVELS = ["low", "medium", "high"] as const;
export type ReviewConfidence = (typeof REVIEW_CONFIDENCE_LEVELS)[number];

export const REVIEW_EVIDENCE_STRENGTHS = ["weak", "mixed", "strong"] as const;
export type ReviewEvidenceStrength = (typeof REVIEW_EVIDENCE_STRENGTHS)[number];

export interface ReviewPanel {
  status: ReviewStatus;
  cycle: number;
  nextAction: ReviewNextAction | "";
  handoffRecommendation: ReviewHandoffRecommendation;
  reopenStage: string;
  reworkGoals: string[];
  confidence: ReviewConfidence | "";
  evidenceStrength: ReviewEvidenceStrength | "";
  finalClaim: string;
  strongestSupport: string[];
  strongestCounterevidence: string[];
  hiddenAssumptions: string[];
  alternativeExplanationsOrObstructions: string[];
  fitToRequirements: string[];
  residualRisks: string[];
  reviewerQuestions: string[];
  suggestedNextStep: string;
  completedAt: string;
}

export interface ReviewReworkPolicy {
  allowAutonomousRework: boolean;
  maxCycles: number | null;
}

export interface HandoffGuards {
  requiredPassingStages: string[];
  forbidBlockedPriorStages: boolean;
}

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
  | "run.repaired"
  | "run.model_fallback"
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
  controlFilePath?: string;
  researchMode?: ResearchMode;
  researchModeWarning?: string | null;
  intakeComplete?: boolean;
  automationState?: string | null;
  currentStage?: string | null;
  latestSessionId?: string | null;
  latestSessionState?: LifecycleState | null;
  latestSessionProvider?: ToolName | null;
  latestSessionBackend?: "codex-sdk" | "local-cli" | null;
  latestSessionModel?: string | null;
  awaitingUserReview?: boolean;
  stageCounts?: Record<string, number>;
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
  maxIterations: number | null;
}

export interface BackendRunResult {
  lifecycleState: LifecycleState;
  latestError?: string;
  finalResponse?: string;
}

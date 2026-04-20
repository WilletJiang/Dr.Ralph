import { writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { appendSessionEvent, createSession, writeSessionState } from "./sessions.js";
import { getArtifactPaths, readControlFile, requireResearchMode, writeControlFile } from "./project.js";
import { IntakeAnswers, IntakeField, LocatedProject, ResearchMode, SessionState } from "./types.js";

const INTAKE_QUESTIONS: Record<ResearchMode, { field: IntakeField; prompt: string }[]> = {
  experimental_research: [
    { field: "background", prompt: "Your research background and current agenda" },
    { field: "requirements", prompt: "Your hard requirements or evaluation bar" },
    { field: "resources", prompt: "Available resources and constraints (compute, data, evaluation setup, tooling)" },
    { field: "collaboration", prompt: "Collaboration preferences and where Ralph must stop/escalate" },
    { field: "extra", prompt: "Any additional context Ralph should treat as important" },
  ],
  theoretical_research: [
    { field: "background", prompt: "Your research background and current theory agenda" },
    { field: "requirements", prompt: "Your hard requirements or mathematical and proof-verification bar" },
    { field: "resources", prompt: "Available resources and constraints (literature, time, Lean/mathlib familiarity, tooling)" },
    { field: "collaboration", prompt: "Collaboration preferences and where Ralph must stop/escalate" },
    { field: "extra", prompt: "Any additional context Ralph should treat as important" },
  ],
};

function buildMarkdown(answers: IntakeAnswers, timestamp: string, researchMode: ResearchMode): string {
  return `# Research Intake

Last updated: ${timestamp}

Research mode: ${researchMode}

## Research Background

${answers.background ?? ""}

## Hard Requirements

${answers.requirements ?? ""}

## Available Resources

${answers.resources ?? ""}

## Collaboration Preferences

${answers.collaboration ?? ""}

## Additional Context

${answers.extra ?? ""}
`;
}

async function updateControlWithIntake(
  project: LocatedProject,
  answers: IntakeAnswers,
  intakePath: string,
  timestamp: string,
): Promise<void> {
  const control = await readControlFile(project);
  const relativeIntakePath = relative(project.rootDir, intakePath);

  const researcherContext = ((control.researcherContext ?? {}) as Record<string, unknown>);
  researcherContext.required = true;
  researcherContext.isComplete = true;
  researcherContext.intakeFile = relativeIntakePath;
  researcherContext.backgroundSummary = answers.background ?? "";
  researcherContext.requirementsSummary = answers.requirements ?? "";
  researcherContext.availableResources = answers.resources ?? "";
  researcherContext.collaborationPreferences = answers.collaboration ?? "";
  researcherContext.lastUpdated = timestamp;

  const automation = ((control.automation ?? {}) as Record<string, unknown>);
  automation.userIntakeRequired = true;

  control.researcherContext = researcherContext;
  control.automation = automation;

  await writeControlFile(project, control);
}

async function emitAnswerEvent(
  project: LocatedProject,
  session: SessionState,
  field: IntakeField,
  value: string,
): Promise<void> {
  await appendSessionEvent(project, {
    timestamp: new Date().toISOString(),
    sessionId: session.sessionId,
    type: "intake.answer.recorded",
    data: { field, value },
  });
}

export async function intakeSet(
  project: LocatedProject,
  answers: IntakeAnswers,
): Promise<{ session: SessionState; answers: IntakeAnswers }> {
  if (!answers.background || !answers.requirements) {
    throw new Error("Both background and requirements are required.");
  }

  const control = await readControlFile(project);
  const researchMode = requireResearchMode(control);
  const paths = getArtifactPaths(project, control);
  const session = await createSession(project, {
    provider: "codex",
    backend: "local-cli",
    model: "gpt5.4-xhigh",
    lifecycleState: "awaiting_input",
    currentStage: "researcher_intake",
    currentItemId: "INTAKE",
    currentQuestion: null,
    projectRoot: project.rootDir,
    controlFilePath: project.controlFilePath,
    artifacts: paths,
  });

  const timestamp = new Date().toISOString();
  await writeFile(paths.intakeFile, buildMarkdown(answers, timestamp, researchMode));

  for (const question of INTAKE_QUESTIONS[researchMode]) {
    const value = answers[question.field];
    if (value) {
      await emitAnswerEvent(project, session, question.field, value);
    }
  }

  await updateControlWithIntake(project, answers, paths.intakeFile, timestamp);

  session.lifecycleState = "completed";
  session.currentQuestion = null;
  await writeSessionState(project, session);

  return { session, answers };
}

export async function runInteractiveIntake(
  project: LocatedProject,
): Promise<{ session: SessionState; answers: IntakeAnswers; completed: boolean }> {
  if (!input.isTTY) {
    let raw = "";
    for await (const chunk of input) {
      raw += chunk.toString();
    }
    const lines = raw.split(/\r?\n/);
    const answers: IntakeAnswers = {
      background: lines[0]?.trim() || "",
      requirements: lines[1]?.trim() || "",
      resources: lines[2]?.trim() || "",
      collaboration: lines[3]?.trim() || "",
      extra: lines[4]?.trim() || "",
    };
    const result = await intakeSet(project, answers);
    return { ...result, completed: true };
  }

  const control = await readControlFile(project);
  const researchMode = requireResearchMode(control);
  const paths = getArtifactPaths(project, control);
  const existing = ((control.researcherContext ?? {}) as Record<string, string>);
  const questions = INTAKE_QUESTIONS[researchMode];
  const answers: IntakeAnswers = {
    background: existing.backgroundSummary ?? "",
    requirements: existing.requirementsSummary ?? "",
    resources: existing.availableResources ?? "",
    collaboration: existing.collaborationPreferences ?? "",
    extra: "",
  };

  const session = await createSession(project, {
    provider: "codex",
    backend: "local-cli",
    model: "gpt5.4-xhigh",
    lifecycleState: "awaiting_input",
    currentStage: "researcher_intake",
    currentItemId: "INTAKE",
    currentQuestion: questions[0].field,
    projectRoot: project.rootDir,
    controlFilePath: project.controlFilePath,
    artifacts: paths,
  });

  const rl = readline.createInterface({ input, output });
  let index = 0;
  let completed = false;

  try {
    while (index < questions.length) {
      const question = questions[index];
      session.currentQuestion = question.field;
      await writeSessionState(project, session);
      await appendSessionEvent(project, {
        timestamp: new Date().toISOString(),
        sessionId: session.sessionId,
        type: "intake.question.presented",
        data: { field: question.field, prompt: question.prompt },
      });

      const existingValue = answers[question.field];
      const prompt = existingValue
        ? `${index + 1}. ${question.prompt} [${existingValue}] `
        : `${index + 1}. ${question.prompt}: `;
      const answer = (await rl.question(prompt)).trim();

      if (answer === "/show") {
        output.write(`${JSON.stringify(answers, null, 2)}\n`);
        continue;
      }
      if (answer.startsWith("/edit ")) {
        const requestedField = answer.slice("/edit ".length).trim() as IntakeField;
        const targetIndex = questions.findIndex((item) => item.field === requestedField);
        if (targetIndex >= 0) {
          index = targetIndex;
        } else {
          output.write(`Unknown field '${requestedField}'.\n`);
        }
        continue;
      }
      if (answer === "/skip") {
        index += 1;
        continue;
      }
      if (answer === "/done") {
        if (!answers.background || !answers.requirements) {
          output.write("Background and requirements are required before /done.\n");
          continue;
        }
        completed = true;
        break;
      }
      if (answer === "/exit") {
        session.lifecycleState = "idle";
        session.currentQuestion = question.field;
        await writeSessionState(project, session);
        return { session, answers, completed: false };
      }

      const nextValue = answer.length > 0 ? answer : existingValue;
      answers[question.field] = nextValue;
      if (nextValue) {
        await emitAnswerEvent(project, session, question.field, nextValue);
      }
      index += 1;
    }

    if (!completed) {
      completed = Boolean(answers.background && answers.requirements);
    }

    if (completed) {
      const timestamp = new Date().toISOString();
      await writeFile(paths.intakeFile, buildMarkdown(answers, timestamp, researchMode));
      await updateControlWithIntake(project, answers, paths.intakeFile, timestamp);
      session.lifecycleState = "completed";
      session.currentQuestion = null;
      await writeSessionState(project, session);
    }

    return { session, answers, completed };
  } finally {
    rl.close();
  }
}

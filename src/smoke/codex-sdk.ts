import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CodexBackend } from "../backends.js";
import { intakeSet } from "../intake.js";
import { createSession } from "../sessions.js";
import { getArtifactPaths, initProject, readControlFile } from "../project.js";
import type { BackendRunContext } from "../types.js";

async function main(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "ralph-smoke-codex-"));

  try {
    const project = await initProject(join(root, "proj"), false, "experimental_research");
    await intakeSet(project, {
      background: "smoke test researcher",
      requirements: "verify codex sdk backend end-to-end",
      resources: "codex sdk authentication available",
      collaboration: "no destructive changes",
      extra: "respond tersely",
    });

    const control = await readControlFile(project);
    const session = await createSession(project, {
      provider: "codex",
      backend: "codex-sdk",
      model: "gpt5.5-xhigh",
      lifecycleState: "idle",
      currentStage: "smoke_test",
      currentItemId: "SMOKE-CODEX",
      currentQuestion: null,
      projectRoot: project.rootDir,
      controlFilePath: project.controlFilePath,
      artifacts: getArtifactPaths(project, control),
    });

    const backend = new CodexBackend();
    const context: BackendRunContext = {
      session,
      project,
      maxIterations: 1,
      prompt: "Reply with exactly TEST_OK and nothing else.",
    };

    const result = await backend.runTurn(context);
    if (!result.finalResponse?.includes("TEST_OK")) {
      throw new Error(`Unexpected Codex SDK response: ${result.finalResponse ?? "<empty>"}`);
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          sessionId: session.sessionId,
          lifecycleState: result.lifecycleState,
          finalResponse: result.finalResponse,
        },
        null,
        2,
      ),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

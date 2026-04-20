import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { getStatus, initProject, locateProject, readControlFile, writeControlFile } from "../src/project.js";
import { RESEARCH_MODES } from "../src/types.js";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ralph-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("project discovery", () => {
  it("initializes a canonical project in the target directory for every research mode", async () => {
    const root = await makeTempDir();
    const firstStages = {
      experimental_research: "problem_framing",
      theoretical_research: "problem_framing",
    } as const;

    for (const researchMode of RESEARCH_MODES) {
      const projectName = `proj-${researchMode}`;
      const project = await initProject(join(root, projectName), false, researchMode);

      expect(project.layout).toBe("canonical");
      expect(project.projectFilePath).toContain(".ralph/project.json");

      const control = await readControlFile(project);
      expect(control.project).toBe(projectName);
      expect(control.branchName).toBe(`ralph/${projectName.replace(/_/g, "-")}`);
      expect(control.researchMode).toBe(researchMode);

      const metadata = JSON.parse(
        await readFile(join(project.rootDir, ".ralph", "project.json"), "utf8"),
      ) as { layout: string; controlFile: string };
      expect(metadata.layout).toBe("canonical");
      expect(metadata.controlFile).toBe("research_program.json");

      const status = await getStatus(project);
      expect(status.researchMode).toBe(researchMode);
      expect(status.researchModeWarning).toBeNull();
      expect(status.currentStage).toBe(firstStages[researchMode]);
      if (researchMode === "theoretical_research") {
        const theoreticalTooling = (control.theoreticalTooling ?? {}) as Record<string, unknown>;
        expect(theoreticalTooling.profile).toBe("lean4_skills_plus_lsp");
        expect(theoreticalTooling.leanLspMcpRequired).toBe(true);
        expect(await readFile(join(project.rootDir, ".mcp.json"), "utf8")).toContain("lean-lsp-mcp");
        expect(await readFile(join(project.rootDir, ".ralph", "tooling", "lean4-env.sh"), "utf8")).toContain(
          "LEAN4_PLUGIN_ROOT",
        );
      }
    }
  });

  it("detects legacy projects via scripts/ralph/research_program.json", async () => {
    const root = await makeTempDir();
    const sourceRoot = join(root, "source");
    const legacyRoot = join(root, "legacy");
    const scriptsDir = join(legacyRoot, "scripts", "ralph");

    await initProject(sourceRoot, false, "experimental_research");
    await mkdir(scriptsDir, { recursive: true });
    await copyFile(join(sourceRoot, "research_program.json"), join(scriptsDir, "research_program.json"));

    const project = await locateProject(legacyRoot);
    expect(project?.layout).toBe("legacy");
    expect(project?.controlFilePath.endsWith("scripts/ralph/research_program.json")).toBe(true);
  });

  it("treats projects without researchMode as legacy experimental defaults", async () => {
    const root = await makeTempDir();
    const project = await initProject(join(root, "proj"), false, "experimental_research");
    const control = await readControlFile(project);
    delete control.researchMode;
    await writeControlFile(project, control);

    const status = await getStatus(project);
    expect(status.researchMode).toBe("experimental_research");
    expect(status.researchModeWarning).toContain("Legacy project");
  });
});

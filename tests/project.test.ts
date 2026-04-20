import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { getDoctor, getStatus, initProject, locateProject, readControlFile, writeControlFile } from "../src/project.js";
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

  it("requires both canonical metadata and control file to locate a project", async () => {
    const root = await makeTempDir();
    const sourceRoot = join(root, "source");
    const controlOnlyRoot = join(root, "control-only");
    const metadataOnlyRoot = join(root, "metadata-only");

    await initProject(sourceRoot, false, "experimental_research");
    await mkdir(controlOnlyRoot, { recursive: true });
    await copyFile(join(sourceRoot, "research_program.json"), join(controlOnlyRoot, "research_program.json"));
    await mkdir(join(metadataOnlyRoot, ".ralph"), { recursive: true });
    await copyFile(join(sourceRoot, ".ralph", "project.json"), join(metadataOnlyRoot, ".ralph", "project.json"));

    expect(await locateProject(controlOnlyRoot)).toBeNull();
    expect(await locateProject(metadataOnlyRoot)).toBeNull();
  });

  it("reports missing researchMode as a configuration problem", async () => {
    const root = await makeTempDir();
    const project = await initProject(join(root, "proj"), false, "experimental_research");
    const control = await readControlFile(project);
    delete control.researchMode;
    await writeControlFile(project, control);

    const status = await getStatus(project);
    expect(status.researchMode).toBeUndefined();
    expect(status.researchModeWarning).toContain("Missing required researchMode");

    const doctor = await getDoctor(project);
    const researchModeCheck = doctor.checks.find((check) => check.name === "research_mode");
    expect(researchModeCheck?.ok).toBe(false);
    expect(doctor.warnings).toContain(status.researchModeWarning);
  });
});

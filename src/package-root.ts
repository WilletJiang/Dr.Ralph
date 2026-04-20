import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function findPackageRoot(start = fileURLToPath(import.meta.url)): string {
  let current = dirname(start);

  while (true) {
    if (existsSync(join(current, "package.json"))) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) {
      throw new Error("Could not locate Dr.Ralph package root.");
    }
    current = parent;
  }
}

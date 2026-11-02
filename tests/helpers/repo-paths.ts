import path from "node:path";

/** The production source tree. Tests that read source files (layout and wiring checks) resolve them here. */
const SRC_DIR = path.resolve(__dirname, "../../src");

/** Absolute path of a file or folder under `src/`, given its path segments. */
export function srcPath(...segments: string[]): string {
  return path.join(SRC_DIR, ...segments);
}

import { cpSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import "./check-data.mjs";

const root = process.cwd();
const output = join(root, "public");

rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });

for (const entry of ["index.html", "data", "src"]) {
  cpSync(join(root, entry), join(output, entry), { recursive: true });
}

console.log("Static output written to public/");

import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import "./check-data.mjs";

const root = process.cwd();
const output = join(root, "public");

rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });

const entries = ["index.html", "data", "src", "img"];
for (const entry of entries) {
  const source = join(root, entry);
  if (!existsSync(source)) continue;
  cpSync(source, join(output, entry), { recursive: true });
}

console.log(`Static output written to public/ (${entries.filter((e) => existsSync(join(root, e))).join(", ")}).`);

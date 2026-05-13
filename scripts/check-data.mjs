import { readFileSync, existsSync } from "node:fs";

// Norway ministers
const ministers = JSON.parse(readFileSync("data/ministers.json", "utf8"));
for (const key of ["people", "parties", "stats", "sources"]) {
  if (!ministers[key]) throw new Error(`ministers.json missing key: ${key}`);
}
const roles = ministers.people.flatMap((p) => p.roles || []);
if (ministers.people.length < 650 || roles.length < 1800) {
  throw new Error(`ministers.json incomplete: ${ministers.people.length} people, ${roles.length} roles`);
}
const currentRoles = roles.filter((r) => !r.end);
const missingParty = currentRoles.filter((r) => !r.party);
if (currentRoles.length < 18 || missingParty.length) {
  throw new Error(
    `ministers.json current government incomplete: ${currentRoles.length} current, ${missingParty.length} without party`,
  );
}
if ((ministers.stats.images || 0) < 475) {
  throw new Error(`ministers.json portrait coverage regressed: ${ministers.stats.images} images`);
}

// World leaders (optional — only check if present)
if (existsSync("data/world-leaders.json")) {
  const world = JSON.parse(readFileSync("data/world-leaders.json", "utf8"));
  for (const key of ["countries", "stats", "generatedAt"]) {
    if (!world[key]) throw new Error(`world-leaders.json missing key: ${key}`);
  }
  if (world.countries.length < 150) {
    throw new Error(`world-leaders.json too few countries: ${world.countries.length}`);
  }
  const leaders = world.countries.flatMap((c) => c.leaders || []);
  if (leaders.length < 250) {
    throw new Error(`world-leaders.json too few leaders: ${leaders.length}`);
  }
  console.log(
    `Ministers: ${ministers.people.length} people · World: ${world.countries.length} countries, ${leaders.length} leaders, ${world.stats.images} images`,
  );
} else {
  console.log(
    `Ministers ok: ${ministers.people.length} people, ${roles.length} roles, ${ministers.stats.images} images, ${currentRoles.length} current roles (world-leaders.json not yet built)`,
  );
}

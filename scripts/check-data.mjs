import { readFileSync } from "node:fs";

const dataset = JSON.parse(readFileSync("data/ministers.json", "utf8"));
const required = ["people", "parties", "stats", "sources"];
for (const key of required) {
  if (!dataset[key]) {
    throw new Error(`Missing dataset key: ${key}`);
  }
}

const roles = dataset.people.flatMap((person) => person.roles || []);
if (dataset.people.length < 650 || roles.length < 1800) {
  throw new Error(`Dataset looks incomplete: ${dataset.people.length} people, ${roles.length} roles`);
}

const currentRoles = roles.filter((role) => !role.end);
const missingCurrentParty = currentRoles.filter((role) => !role.party);
if (currentRoles.length < 18 || missingCurrentParty.length) {
  throw new Error(
    `Current government data looks incomplete: ${currentRoles.length} current roles, ${missingCurrentParty.length} without party`
  );
}

if ((dataset.stats.images || 0) < 475) {
  throw new Error(`Portrait coverage regressed: ${dataset.stats.images} images`);
}

console.log(
  `Dataset ok: ${dataset.people.length} people, ${roles.length} roles, ${dataset.stats.images} images, ${currentRoles.length} current roles`
);

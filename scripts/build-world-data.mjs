#!/usr/bin/env node
/*
 * Build data/world-leaders.json from Wikidata SPARQL.
 *
 * For every UN member state, fetch:
 *   - Country name, ISO code, flag, capital
 *   - Current head of state (P35)
 *   - Current head of government (P6)
 *   - Current foreign affairs minister (officeholder of any P279* of Q83307)
 *
 * Cap at 3 leaders per country (matches the spec: top dog + VP + FM).
 * If head-of-state and head-of-government are the same person (e.g. USA),
 * we keep one slot and fall back to other roles.
 */
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DATA_DIR = join(ROOT, "data");
const OUT_FILE = join(DATA_DIR, "world-leaders.json");
const ENDPOINT = "https://query.wikidata.org/sparql";
const UA = "Ministerquiz-World/1.0 (https://ministerquiz.vercel.app; egilfure@gmail.com)";

mkdirSync(DATA_DIR, { recursive: true });

async function sparql(query, label) {
  const body = new URLSearchParams({ query, format: "json" });
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const ctl = new AbortController();
    const tm = setTimeout(() => ctl.abort(), 60_000);
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          "User-Agent": UA,
          Accept: "application/sparql-results+json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
        signal: ctl.signal,
      });
      clearTimeout(tm);
      if (res.status === 429 || res.status === 503) {
        const wait = (Number(res.headers.get("retry-after")) || 5) * 1000;
        process.stderr.write(`  · ${label}: ${res.status}, waiting ${wait}ms\n`);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text()}`);
      const json = await res.json();
      return json.results.bindings;
    } catch (err) {
      clearTimeout(tm);
      if (attempt === 4) throw err;
      process.stderr.write(`  · ${label}: attempt ${attempt} failed (${err.message}), retrying…\n`);
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  throw new Error(`SPARQL gave up: ${label}`);
}

const qidFromUri = (u) => (u ? u.split("/").pop() : null);
const val = (b, k) => b[k]?.value || null;

const COUNTRIES_QUERY = `
SELECT DISTINCT ?country ?countryLabel ?iso2 ?iso3 ?flag ?capital ?capitalLabel WHERE {
  ?country wdt:P463 wd:Q1065 .
  OPTIONAL { ?country wdt:P297 ?iso2 . }
  OPTIONAL { ?country wdt:P298 ?iso3 . }
  OPTIONAL { ?country wdt:P41  ?flag . }
  OPTIONAL { ?country wdt:P36  ?capital . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,fr,es,de,it,pt,ru,ar,zh" . }
}
ORDER BY ?countryLabel
`;

function leadersQuery(prop) {
  // current officeholder via simple truthy property (wdt:P35 / wdt:P6), then refine via p:/ps: chain so we can drop ended terms
  return `
SELECT DISTINCT ?country ?leader ?leaderLabel ?image ?wikiUrl WHERE {
  ?country wdt:P463 wd:Q1065 .
  ?country p:${prop} ?stmt .
  ?stmt ps:${prop} ?leader .
  FILTER NOT EXISTS { ?stmt pq:P582 ?endTime . }
  OPTIONAL { ?leader wdt:P18 ?image . }
  OPTIONAL {
    ?wikiUrl schema:about ?leader ;
             schema:isPartOf <https://en.wikipedia.org/> .
  }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en" . }
}
`;
}

const FOREIGN_MIN_QUERY = `
SELECT DISTINCT ?country ?office ?officeLabel ?leader ?leaderLabel ?image ?wikiUrl WHERE {
  ?country wdt:P463 wd:Q1065 .
  ?office wdt:P1001 ?country .
  ?office (wdt:P279|wdt:P31)* wd:Q83307 .
  ?leader p:P39 ?stmt .
  ?stmt ps:P39 ?office .
  FILTER NOT EXISTS { ?stmt pq:P582 ?endTime . }
  OPTIONAL { ?leader wdt:P18 ?image . }
  OPTIONAL {
    ?wikiUrl schema:about ?leader ;
             schema:isPartOf <https://en.wikipedia.org/> .
  }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en" . }
}
`;

const DEPUTY_QUERY = `
SELECT DISTINCT ?country ?leader ?leaderLabel ?image ?wikiUrl WHERE {
  ?country wdt:P463 wd:Q1065 .
  ?country p:P2828 ?stmt .
  ?stmt ps:P2828 ?leader .
  FILTER NOT EXISTS { ?stmt pq:P582 ?endTime . }
  OPTIONAL { ?leader wdt:P18 ?image . }
  OPTIONAL {
    ?wikiUrl schema:about ?leader ;
             schema:isPartOf <https://en.wikipedia.org/> .
  }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en" . }
}
`;

console.log("Fetching country list…");
const countriesRaw = await sparql(COUNTRIES_QUERY, "countries");
console.log(`  · ${countriesRaw.length} country rows`);

const countries = new Map();
for (const row of countriesRaw) {
  const qid = qidFromUri(val(row, "country"));
  if (!qid) continue;
  const existing = countries.get(qid);
  const name = val(row, "countryLabel");
  const iso2 = val(row, "iso2");
  const iso3 = val(row, "iso3");
  const flag = val(row, "flag");
  const capital = val(row, "capitalLabel");
  if (!existing) {
    countries.set(qid, { qid, name, iso2, iso3, flag, capital, leaders: [] });
  } else {
    existing.iso2 ||= iso2;
    existing.iso3 ||= iso3;
    existing.flag ||= flag;
    existing.capital ||= capital;
  }
}
console.log(`  · ${countries.size} unique countries`);

async function loadRole(prop, role) {
  console.log(`Fetching ${role}…`);
  const rows = await sparql(leadersQuery(prop), role);
  console.log(`  · ${rows.length} rows`);
  for (const row of rows) {
    const cQid = qidFromUri(val(row, "country"));
    const country = countries.get(cQid);
    if (!country) continue;
    country.leaders.push({
      role,
      name: val(row, "leaderLabel"),
      qid: qidFromUri(val(row, "leader")),
      image: val(row, "image"),
      wikipedia: val(row, "wikiUrl"),
    });
  }
}

await loadRole("P35", "head_of_state");
await loadRole("P6", "head_of_government");

console.log("Fetching deputy heads of government…");
const deputyRows = await sparql(DEPUTY_QUERY, "deputy");
console.log(`  · ${deputyRows.length} rows`);
for (const row of deputyRows) {
  const cQid = qidFromUri(val(row, "country"));
  const country = countries.get(cQid);
  if (!country) continue;
  country.leaders.push({
    role: "deputy_head_of_government",
    name: val(row, "leaderLabel"),
    qid: qidFromUri(val(row, "leader")),
    image: val(row, "image"),
    wikipedia: val(row, "wikiUrl"),
  });
}

console.log("Fetching foreign ministers…");
try {
  const fmRows = await sparql(FOREIGN_MIN_QUERY, "foreign-minister");
  console.log(`  · ${fmRows.length} rows`);
  for (const row of fmRows) {
    const cQid = qidFromUri(val(row, "country"));
    const country = countries.get(cQid);
    if (!country) continue;
    country.leaders.push({
      role: "foreign_minister",
      name: val(row, "leaderLabel"),
      qid: qidFromUri(val(row, "leader")),
      image: val(row, "image"),
      wikipedia: val(row, "wikiUrl"),
      officeLabel: val(row, "officeLabel"),
    });
  }
} catch (err) {
  console.warn(`  ! foreign minister query failed: ${err.message}`);
}

// Dedupe leaders by qid per country, prefer roles in this priority
const ROLE_PRIORITY = {
  head_of_state: 0,
  head_of_government: 1,
  deputy_head_of_government: 2,
  foreign_minister: 3,
};

for (const country of countries.values()) {
  // collapse duplicates (same person, multiple roles)
  const byQid = new Map();
  for (const leader of country.leaders) {
    if (!leader.qid || !leader.name) continue;
    // skip very obvious placeholders / Q-ids as label
    if (/^Q\d+$/.test(leader.name)) continue;
    const prev = byQid.get(leader.qid);
    if (!prev) {
      byQid.set(leader.qid, { ...leader, roles: [leader.role] });
    } else {
      if (!prev.roles.includes(leader.role)) prev.roles.push(leader.role);
      prev.image ||= leader.image;
      prev.wikipedia ||= leader.wikipedia;
    }
  }
  let leaders = [...byQid.values()].map((l) => {
    delete l.role;
    return l;
  });
  // pick primary role per leader (lowest priority value)
  leaders.forEach((l) => {
    l.roles.sort((a, b) => (ROLE_PRIORITY[a] ?? 99) - (ROLE_PRIORITY[b] ?? 99));
    l.primaryRole = l.roles[0];
  });
  // sort leaders by their primary role priority
  leaders.sort((a, b) => (ROLE_PRIORITY[a.primaryRole] ?? 99) - (ROLE_PRIORITY[b.primaryRole] ?? 99));
  // cap to 3
  leaders = leaders.slice(0, 3);
  country.leaders = leaders;
}

const all = [...countries.values()].filter((c) => c.leaders.length > 0);
all.sort((a, b) => (a.name || "").localeCompare(b.name || ""));

const totalLeaders = all.reduce((s, c) => s + c.leaders.length, 0);
const withImage = all.reduce(
  (s, c) => s + c.leaders.filter((l) => l.image).length,
  0,
);

const out = {
  generatedAt: new Date().toISOString(),
  source: "https://query.wikidata.org/",
  stats: {
    countries: all.length,
    leaders: totalLeaders,
    images: withImage,
  },
  roleLabels: {
    head_of_state: "Head of state",
    head_of_government: "Head of government",
    deputy_head_of_government: "Deputy head of government",
    foreign_minister: "Foreign minister",
  },
  countries: all,
};

writeFileSync(OUT_FILE, `${JSON.stringify(out, null, 2)}\n`);
console.log(
  `Wrote ${OUT_FILE}: ${all.length} countries, ${totalLeaders} leaders, ${withImage} with image`,
);

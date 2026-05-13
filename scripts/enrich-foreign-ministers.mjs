#!/usr/bin/env node
/*
 * Enrich data/world-leaders.json with foreign ministers.
 *
 * Queries Wikidata in small chunks per ISO country code so the SPARQL
 * service doesn't time out. Adds a foreign_minister leader to each country
 * that has space (cap stays at 3), or merges into an existing entry if the
 * same person already covers another role.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DATA_FILE = join(ROOT, "data", "world-leaders.json");
const ENDPOINT = "https://query.wikidata.org/sparql";
const UA = "Ministerquiz-World/1.0 (https://ministerquiz.vercel.app; egilfure@gmail.com)";
const CHUNK = 12;

async function sparql(query) {
  const body = new URLSearchParams({ query, format: "json" });
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const ctl = new AbortController();
    const tm = setTimeout(() => ctl.abort(), 45_000);
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
        const w = (Number(res.headers.get("retry-after")) || 5) * 1000;
        await new Promise((r) => setTimeout(r, w));
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text()}`);
      const json = await res.json();
      return json.results.bindings;
    } catch (err) {
      clearTimeout(tm);
      if (attempt === 4) throw err;
      await new Promise((r) => setTimeout(r, 1200 * attempt));
    }
  }
  throw new Error("SPARQL gave up");
}

const qidFrom = (u) => (u ? u.split("/").pop() : null);
const val = (b, k) => b[k]?.value || null;

const ROLE_PRIORITY = {
  head_of_state: 0,
  head_of_government: 1,
  deputy_head_of_government: 2,
  foreign_minister: 3,
};

const dataset = JSON.parse(readFileSync(DATA_FILE, "utf8"));
const countries = dataset.countries;
const qids = countries.map((c) => c.qid).filter(Boolean);

const chunks = [];
for (let i = 0; i < qids.length; i += CHUNK) chunks.push(qids.slice(i, i + CHUNK));

console.log(`Enriching ${qids.length} countries in ${chunks.length} chunks…`);

function queryFor(qidList) {
  const values = qidList.map((q) => `wd:${q}`).join(" ");
  return `
SELECT DISTINCT ?country ?office ?officeLabel ?leader ?leaderLabel ?image ?wikiUrl WHERE {
  VALUES ?country { ${values} }
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
}

let totalAdded = 0;
let totalMerged = 0;

for (let idx = 0; idx < chunks.length; idx += 1) {
  const chunk = chunks[idx];
  process.stdout.write(`  chunk ${idx + 1}/${chunks.length}…`);
  let rows;
  try {
    rows = await sparql(queryFor(chunk));
  } catch (err) {
    process.stdout.write(` FAILED (${err.message})\n`);
    continue;
  }
  process.stdout.write(` ${rows.length} rows\n`);

  const byCountry = new Map();
  for (const row of rows) {
    const cQid = qidFrom(val(row, "country"));
    if (!cQid) continue;
    const list = byCountry.get(cQid) || [];
    list.push({
      qid: qidFrom(val(row, "leader")),
      name: val(row, "leaderLabel"),
      image: val(row, "image"),
      wikipedia: val(row, "wikiUrl"),
      officeLabel: val(row, "officeLabel"),
    });
    byCountry.set(cQid, list);
  }

  for (const country of countries) {
    if (!byCountry.has(country.qid)) continue;
    // pick best foreign minister (prefer one with image)
    const candidates = byCountry.get(country.qid);
    const sorted = candidates.sort((a, b) => (b.image ? 1 : 0) - (a.image ? 1 : 0));
    const fm = sorted.find((c) => c.qid && c.name && !/^Q\d+$/.test(c.name));
    if (!fm) continue;

    // already represented?
    const existing = country.leaders.find((l) => l.qid === fm.qid);
    if (existing) {
      if (!existing.roles.includes("foreign_minister")) existing.roles.push("foreign_minister");
      existing.image    ||= fm.image;
      existing.wikipedia ||= fm.wikipedia;
      existing.roles.sort((a, b) => (ROLE_PRIORITY[a] ?? 99) - (ROLE_PRIORITY[b] ?? 99));
      existing.primaryRole = existing.roles[0];
      totalMerged += 1;
      continue;
    }

    if (country.leaders.length >= 3) continue;
    country.leaders.push({
      name: fm.name,
      qid: fm.qid,
      image: fm.image,
      wikipedia: fm.wikipedia,
      roles: ["foreign_minister"],
      primaryRole: "foreign_minister",
    });
    totalAdded += 1;
  }
}

dataset.stats.leaders = countries.reduce((s, c) => s + c.leaders.length, 0);
dataset.stats.images = countries.reduce(
  (s, c) => s + c.leaders.filter((l) => l.image).length,
  0,
);
dataset.generatedAt = new Date().toISOString();
writeFileSync(DATA_FILE, `${JSON.stringify(dataset, null, 2)}\n`);
console.log(`Added ${totalAdded} new foreign ministers, merged ${totalMerged}, total leaders now ${dataset.stats.leaders}.`);

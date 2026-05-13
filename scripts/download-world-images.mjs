#!/usr/bin/env node
/*
 * Download world-leaders portraits + flags locally to img/world/ and img/flags/,
 * then rewrite data/world-leaders.json so image URLs point at the local copies.
 *
 * Runs after scripts/build-world-data.mjs. Idempotent — already-cached files
 * are skipped.
 */
import { mkdirSync, existsSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as wait } from "node:timers/promises";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DATA_FILE = join(ROOT, "data", "world-leaders.json");
const PORTRAITS_DIR = join(ROOT, "img", "world");
const FLAGS_DIR = join(ROOT, "img", "flags");
const PORTRAIT_WIDTH = 480;
const FLAG_WIDTH = 256;
const CONCURRENCY = 4;
const RETRIES = 4;
const GAP_MS = 120;
const UA = "Ministerquiz-World/1.0 (https://ministerquiz.vercel.app; egilfure@gmail.com)";

mkdirSync(PORTRAITS_DIR, { recursive: true });
mkdirSync(FLAGS_DIR, { recursive: true });

const dataset = JSON.parse(readFileSync(DATA_FILE, "utf8"));

function specialFilePathThumb(url, width, { allowResize = true } = {}) {
  try {
    const u = new URL(url);
    if (u.protocol === "http:") u.protocol = "https:";
    if (allowResize) u.searchParams.set("width", String(width));
    else u.searchParams.delete("width");
    return u.toString();
  } catch {
    return url;
  }
}

function thumbUrl(originalUrl, width, options = {}) {
  try {
    const u = new URL(originalUrl);
    if (u.protocol === "http:") originalUrl = originalUrl.replace(/^http:/, "https:");
    if (u.hostname === "commons.wikimedia.org") {
      return specialFilePathThumb(originalUrl, width, options);
    }
    if (u.hostname === "upload.wikimedia.org") {
      // ensure thumb form
      return originalUrl;
    }
  } catch {}
  return originalUrl;
}

function extFromContentType(ct) {
  if (!ct) return ".jpg";
  if (ct.includes("jpeg")) return ".jpg";
  if (ct.includes("png"))  return ".png";
  if (ct.includes("webp")) return ".webp";
  if (ct.includes("svg"))  return ".svg";
  if (ct.includes("gif"))  return ".gif";
  return ".jpg";
}

async function fetchBuffer(url) {
  let lastError;
  for (let attempt = 1; attempt <= RETRIES; attempt += 1) {
    const ctl = new AbortController();
    const tm = setTimeout(() => ctl.abort(), 30_000);
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "image/*,*/*;q=0.8" },
        redirect: "follow",
        signal: ctl.signal,
      });
      clearTimeout(tm);
      if (res.status === 429 || res.status === 503) {
        const w = Math.max((Number(res.headers.get("retry-after")) || 0) * 1000, 2000 + attempt * 1500);
        process.stderr.write(`  · 429 — venter ${(w / 1000).toFixed(1)}s\n`);
        await wait(w);
        throw new Error(`HTTP ${res.status}`);
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} on ${url}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const ct = res.headers.get("content-type") || "";
      return { buffer: buf, contentType: ct };
    } catch (err) {
      clearTimeout(tm);
      lastError = err;
      if (attempt < RETRIES) await wait(800 * attempt + Math.random() * 600);
    }
  }
  throw lastError;
}

async function downloadOne({ id, url, outDir }) {
  const existing = ["jpg", "png", "webp", "svg", "gif"]
    .map((e) => join(outDir, `${id}.${e}`))
    .find((p) => existsSync(p) && statSync(p).size > 0);
  if (existing) return { id, path: existing, cached: true };
  await wait(GAP_MS + Math.random() * 80);
  const { buffer, contentType } = await fetchBuffer(url);
  const ext = extFromContentType(contentType);
  const out = join(outDir, `${id}${ext}`);
  writeFileSync(out, buffer);
  return { id, path: out, cached: false };
}

async function runPool(items, worker, label) {
  const queue = [...items];
  let inFlight = 0, done = 0;
  const total = queue.length;
  const errors = [];
  return await new Promise((resolveAll) => {
    const tick = () => {
      while (inFlight < CONCURRENCY && queue.length) {
        const it = queue.shift();
        inFlight += 1;
        worker(it)
          .then(() => {
            done += 1;
            if (done % 25 === 0 || done === total) process.stdout.write(`  ${label}: ${done}/${total}\n`);
          })
          .catch((err) => { errors.push({ it, err }); done += 1; console.warn(`  ! ${it.id}: ${err.message}`); })
          .finally(() => { inFlight -= 1; if (queue.length === 0 && inFlight === 0) resolveAll(errors); else tick(); });
      }
    };
    tick();
  });
}

console.log(`Portraits → ${PORTRAITS_DIR}`);
const portraitJobs = [];
for (const country of dataset.countries) {
  for (const leader of country.leaders) {
    if (!leader.image) continue;
    if (/^\/img\//.test(leader.image)) continue;
    portraitJobs.push({ id: leader.qid, url: thumbUrl(leader.image, PORTRAIT_WIDTH), outDir: PORTRAITS_DIR });
  }
}
const seen = new Set();
const uniquePortraits = portraitJobs.filter((j) => (seen.has(j.id) ? false : seen.add(j.id)));
console.log(`  ${uniquePortraits.length} portrait jobs (skipping cached)`);
await runPool(uniquePortraits, downloadOne, "portraits");

console.log(`Flags → ${FLAGS_DIR}`);
const flagJobs = [];
for (const country of dataset.countries) {
  if (!country.flag) continue;
  if (/^\/img\//.test(country.flag)) continue;
  flagJobs.push({ id: country.iso3 || country.iso2 || country.qid, url: thumbUrl(country.flag, FLAG_WIDTH, { allowResize: false }), outDir: FLAGS_DIR });
}
const seenFlag = new Set();
const uniqueFlags = flagJobs.filter((j) => (seenFlag.has(j.id) ? false : seenFlag.add(j.id)));
console.log(`  ${uniqueFlags.length} flag jobs (skipping cached)`);
await runPool(uniqueFlags, downloadOne, "flags");

function localFor(dir, id, urlRoot) {
  const exts = ["jpg", "png", "webp", "svg", "gif"];
  for (const ext of exts) {
    const p = join(dir, `${id}.${ext}`);
    if (existsSync(p) && statSync(p).size > 0) return `${urlRoot}/${id}.${ext}`;
  }
  return null;
}

let portraitsLinked = 0;
let flagsLinked = 0;
for (const country of dataset.countries) {
  if (country.flag) {
    const local = localFor(FLAGS_DIR, country.iso3 || country.iso2 || country.qid, "/img/flags");
    if (local) {
      country.flagSource ||= country.flag;
      country.flag = local;
      flagsLinked += 1;
    }
  }
  for (const leader of country.leaders) {
    if (!leader.image) continue;
    const local = localFor(PORTRAITS_DIR, leader.qid, "/img/world");
    if (local) {
      leader.imageSource ||= leader.image;
      leader.image = local;
      portraitsLinked += 1;
    }
  }
}

dataset.stats.images = dataset.countries.reduce(
  (s, c) => s + c.leaders.filter((l) => l.image).length,
  0,
);
dataset.stats.flags = flagsLinked;
writeFileSync(DATA_FILE, `${JSON.stringify(dataset, null, 2)}\n`);
console.log(`Linked ${portraitsLinked} portraits and ${flagsLinked} flags to local paths.`);

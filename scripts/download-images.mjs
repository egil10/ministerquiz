#!/usr/bin/env node
import { mkdirSync, existsSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as wait } from "node:timers/promises";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DATA_FILE = join(ROOT, "data", "ministers.json");
const PORTRAITS_DIR = join(ROOT, "img", "portraits");
const PARTIES_DIR = join(ROOT, "img", "parties");
const PORTRAIT_WIDTH = 480;
const LOGO_WIDTH = 192;
const CONCURRENCY = 2;
const RETRIES = 4;
const REQUEST_GAP_MS = 150;

mkdirSync(PORTRAITS_DIR, { recursive: true });
mkdirSync(PARTIES_DIR, { recursive: true });

const dataset = JSON.parse(readFileSync(DATA_FILE, "utf8"));

function thumbForUploadUrl(url, width) {
  // Direct file: https://upload.wikimedia.org/wikipedia/commons/9/96/Carsten_Anker_2.jpg
  // Thumb:      https://upload.wikimedia.org/wikipedia/commons/thumb/9/96/Carsten_Anker_2.jpg/480px-Carsten_Anker_2.jpg
  try {
    const u = new URL(url);
    if (u.hostname !== "upload.wikimedia.org") return null;
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length < 5) return null;
    let project = parts[0];
    let repo = parts[1];
    let body;
    let originalFile;
    if (parts[2] === "thumb") {
      // already a thumb: parts = [wikipedia, commons, thumb, 9, 96, File.jpg, 960px-File.jpg]
      if (parts.length < 7) return url;
      body = parts.slice(3, 5);
      originalFile = parts[5];
    } else {
      body = parts.slice(2, parts.length - 1);
      originalFile = parts[parts.length - 1];
    }
    const ext = extname(originalFile).toLowerCase();
    if (ext === ".svg") {
      return `https://upload.wikimedia.org/${project}/${repo}/thumb/${body.join("/")}/${originalFile}/${width}px-${originalFile}.png`;
    }
    return `https://upload.wikimedia.org/${project}/${repo}/thumb/${body.join("/")}/${originalFile}/${width}px-${originalFile}`;
  } catch {
    return null;
  }
}

function specialFilePathThumb(url, width, { allowResize = true } = {}) {
  // https://commons.wikimedia.org/wiki/Special:FilePath/Foo.svg
  // Width param works for raster but errors on SVGs sometimes — guard with allowResize
  try {
    const u = new URL(url);
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
    if (u.hostname === "upload.wikimedia.org") {
      return thumbForUploadUrl(originalUrl, width) || originalUrl;
    }
    if (u.hostname === "commons.wikimedia.org") {
      return specialFilePathThumb(originalUrl, width, options);
    }
  } catch {}
  return originalUrl;
}

function extFromContentType(contentType) {
  if (!contentType) return ".jpg";
  if (contentType.includes("jpeg")) return ".jpg";
  if (contentType.includes("png")) return ".png";
  if (contentType.includes("webp")) return ".webp";
  if (contentType.includes("svg")) return ".svg";
  if (contentType.includes("gif")) return ".gif";
  return ".jpg";
}

async function fetchBuffer(url) {
  let lastError;
  for (let attempt = 1; attempt <= RETRIES; attempt += 1) {
    try {
      const controller = new AbortController();
      const abort = setTimeout(() => controller.abort(), 25000);
      let response;
      try {
        response = await fetch(url, {
          headers: {
            "User-Agent": "Ministerquiz/1.0 (https://ministerquiz.vercel.app; build script; contact: egilfure@gmail.com)",
            Accept: "image/*,*/*;q=0.8",
          },
          redirect: "follow",
          signal: controller.signal,
        });
      } finally {
        clearTimeout(abort);
      }
      if (response.status === 429 || response.status === 503) {
        const retryAfter = Number(response.headers.get("retry-after")) || 0;
        const wait429 = Math.max(retryAfter * 1000, 2000 + attempt * 1500);
        process.stderr.write(`  · 429 — venter ${(wait429 / 1000).toFixed(1)}s\n`);
        await wait(wait429);
        throw new Error(`HTTP ${response.status}`);
      }
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} on ${url}`);
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      const contentType = response.headers.get("content-type") || "";
      return { buffer, contentType };
    } catch (error) {
      lastError = error;
      if (attempt < RETRIES) {
        await wait(800 * attempt + Math.random() * 600);
      }
    }
  }
  throw lastError;
}

async function downloadOne({ id, url, outDir, fallbackExt = ".jpg" }) {
  // Skip if we already have a file with this id prefix
  const existing = ["jpg", "png", "webp", "svg", "gif"]
    .map((ext) => join(outDir, `${id}.${ext}`))
    .find((p) => existsSync(p) && statSync(p).size > 0);
  if (existing) {
    return { id, path: existing, cached: true };
  }
  await wait(REQUEST_GAP_MS + Math.random() * 80);
  const { buffer, contentType } = await fetchBuffer(url);
  let ext = extFromContentType(contentType);
  if (!ext) ext = fallbackExt;
  const outPath = join(outDir, `${id}${ext}`);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, buffer);
  return { id, path: outPath, cached: false };
}

async function runPool(items, worker) {
  const queue = [...items];
  let inFlight = 0;
  let done = 0;
  const total = queue.length;
  const errors = [];
  return await new Promise((resolveAll) => {
    const tick = () => {
      while (inFlight < CONCURRENCY && queue.length) {
        const item = queue.shift();
        inFlight += 1;
        worker(item)
          .then((result) => {
            done += 1;
            if (done % 25 === 0 || done === total) {
              process.stdout.write(`  ${done}/${total}\n`);
            }
            return result;
          })
          .catch((error) => {
            errors.push({ item, error });
            console.warn(`  ! ${item.id}: ${error.message}`);
            done += 1;
          })
          .finally(() => {
            inFlight -= 1;
            if (queue.length === 0 && inFlight === 0) resolveAll(errors);
            else tick();
          });
      }
    };
    tick();
  });
}

function remoteUrlFor(currentValue, sourceValue) {
  // After a previous partial run, `image` may already be a local /img/... path.
  // In that case the original Wikimedia URL is preserved as `imageSource`.
  if (currentValue && /^https?:\/\//.test(currentValue)) return currentValue;
  if (sourceValue && /^https?:\/\//.test(sourceValue)) return sourceValue;
  return null;
}

console.log(`Portraits → ${PORTRAITS_DIR}`);
const portraitJobs = dataset.people
  .map((person) => {
    const remote = remoteUrlFor(person.image, person.imageSource);
    return remote ? { id: person.id, url: thumbUrl(remote, PORTRAIT_WIDTH), outDir: PORTRAITS_DIR } : null;
  })
  .filter(Boolean);
console.log(`  ${portraitJobs.length} portraits to fetch (will skip cached on disk)`);
await runPool(portraitJobs, downloadOne);

console.log(`Party logos → ${PARTIES_DIR}`);
const logoJobs = Object.entries(dataset.parties)
  .map(([code, party]) => {
    const remote = remoteUrlFor(party.logo, party.logoSource);
    return remote ? { id: code, url: thumbUrl(remote, LOGO_WIDTH, { allowResize: false }), outDir: PARTIES_DIR } : null;
  })
  .filter(Boolean);
console.log(`  ${logoJobs.length} logos to fetch`);
await runPool(logoJobs, downloadOne);

// Rewrite dataset paths to local URLs
function localPathFor(dir, id, urlRoot) {
  const candidates = ["jpg", "png", "webp", "svg", "gif"]
    .map((ext) => ({ ext, path: join(dir, `${id}.${ext}`) }))
    .filter(({ path }) => existsSync(path));
  if (!candidates.length) return null;
  return `${urlRoot}/${id}.${candidates[0].ext}`;
}

let portraitsLinked = 0;
for (const person of dataset.people) {
  if (!person.image) continue;
  const local = localPathFor(PORTRAITS_DIR, person.id, "/img/portraits");
  if (local) {
    if (!person.imageSource) person.imageSource = person.image;
    person.image = local;
    portraitsLinked += 1;
  }
}

let logosLinked = 0;
for (const [code, party] of Object.entries(dataset.parties)) {
  if (!party.logo) continue;
  const local = localPathFor(PARTIES_DIR, code, "/img/parties");
  if (local) {
    if (!party.logoSource) party.logoSource = party.logo;
    party.logo = local;
    logosLinked += 1;
  }
}

writeFileSync(DATA_FILE, `${JSON.stringify(dataset, null, 2)}\n`);
console.log(`Linked ${portraitsLinked} portraits and ${logosLinked} logos to local paths.`);

/* Lederquiz — minimal first-principles quiz.
 *
 * Three modes, all the same structure: show an image, pick the right
 * label from four options. That's it.
 *
 * Modes
 *   ministers  — show portrait of a Norwegian minister → guess name
 *   flags      — show flag → guess country
 *   leaders    — show world leader portrait → guess country
 */

const STORAGE_THEME = "lq.theme";
const STORAGE_STATS = "lq.stats.v2";
const STORAGE_AUTO = "lq.auto";

const AUTO_OPTIONS = [
  { id: "manual", label: "manuell", ms: 0 },
  { id: "1s", label: "1s", ms: 1000 },
  { id: "3s", label: "3s", ms: 3000 },
  { id: "5s", label: "5s", ms: 5000 },
];

const RECENT_HISTORY = 25;

// Normalize formal/long country names to Wikipedia short forms.
const COUNTRY_NAME_OVERRIDES = {
  "Kingdom of the Netherlands": "Netherlands",
  "Kingdom of Denmark": "Denmark",
  "People's Republic of China": "China",
  "Republic of the Congo": "Republic of Congo",
  "Republic of Afghanistan": "Afghanistan",
  "Democratic Republic of the Congo": "DR Congo",
  "Czech Republic": "Czechia",
  "Federation of Malaya": "Malaysia",
  "realm of the United Kingdom": "United Kingdom",
  "United States of America": "United States",
};

const normalizeCountryName = (name) => COUNTRY_NAME_OVERRIDES[name] ?? name;

// --- state ---------------------------------------------------------

const state = {
  ministers: null,
  world: null,
  mode: "ministers",
  pool: [],
  question: null,
  answered: false,
  autoTimer: null,
  auto: loadAuto(),
  stats: loadStats(),
  recent: { ministers: [], flags: [], leaders: [] },
};

// --- bootstrap -----------------------------------------------------

const $ = (id) => document.getElementById(id);

const MODES = [
  { id: "ministers", label: "Norske ministre" },
  { id: "flags", label: "Verdens flagg" },
  { id: "leaders", label: "Verdens ledere" },
];

document.addEventListener("DOMContentLoaded", init);

async function init() {
  renderModes();
  renderAutoToggle();
  setupTheme();
  setupKeyboard();
  renderStats();

  try {
    const [m, w] = await Promise.all([
      fetch("/data/ministers.json").then((r) => r.json()),
      fetch("/data/world-leaders.json").then((r) => r.json()),
    ]);
    state.ministers = m;
    state.world = w;
  } catch (err) {
    $("stage").innerHTML = `<div class="loading">kunne ikke laste data: ${err?.message ?? err}</div>`;
    return;
  }

  // restore last mode
  const saved = localStorage.getItem("lq.mode");
  if (saved && MODES.some((x) => x.id === saved)) state.mode = saved;

  setMode(state.mode);
}

// --- modes ---------------------------------------------------------

function renderModes() {
  const el = $("modes");
  el.innerHTML = "";
  MODES.forEach((m) => {
    const btn = document.createElement("button");
    btn.className = "mode";
    btn.type = "button";
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-pressed", String(m.id === state.mode));
    btn.dataset.mode = m.id;
    btn.innerHTML = `${m.label}<span class="mode-count" data-count="${m.id}"></span>`;
    btn.addEventListener("click", () => setMode(m.id));
    el.appendChild(btn);
  });
}

function setMode(id) {
  state.mode = id;
  localStorage.setItem("lq.mode", id);
  buildPool();
  document.querySelectorAll(".mode").forEach((b) => {
    b.setAttribute("aria-pressed", String(b.dataset.mode === id));
  });
  updateCounts();
  nextQuestion();
}

function updateCounts() {
  const counts = {
    ministers: state.ministers ? buildMinisterPool().length : 0,
    flags: state.world ? state.world.countries.length : 0,
    leaders: state.world ? buildLeaderPool().length : 0,
  };
  document.querySelectorAll(".mode-count").forEach((el) => {
    const key = el.dataset.count;
    el.textContent = counts[key] ? `${counts[key]}` : "";
  });
  // brand sub
  $("brandSub").textContent =
    state.mode === "ministers" ? "norske ministre" :
    state.mode === "flags"     ? "verdens flagg" :
                                  "verdens ledere";
}

// --- pool builders -------------------------------------------------

function buildMinisterPool() {
  if (!state.ministers) return [];
  return state.ministers.people.filter((p) => p.image && p.name);
}

function buildLeaderPool() {
  if (!state.world) return [];
  const out = [];
  for (const c of state.world.countries) {
    if (!c.iso3) continue; // skip historical / formal duplicates without ISO codes
    const country = normalizeCountryName(c.name);
    for (const l of c.leaders) {
      if (l.image) {
        out.push({
          name: l.name,
          image: l.image,
          country,
          countryFlag: c.flag,
          countryCapital: c.capital,
          wikipedia: l.wikipedia,
          role: l.primaryRole,
          roles: l.roles ?? [l.primaryRole].filter(Boolean),
          qid: l.qid,
          party: l.party,
          termStart: l.termStart,
          isMonarch: l.isMonarch,
          nextElection: c.nextElection,
        });
      }
    }
  }
  return out;
}

function buildFlagPool() {
  if (!state.world) return [];
  return state.world.countries
    .filter((c) => c.flag && c.iso3)
    .map((c) => ({ ...c, name: normalizeCountryName(c.name) }));
}

function buildPool() {
  if (state.mode === "ministers") state.pool = buildMinisterPool();
  else if (state.mode === "flags") state.pool = buildFlagPool();
  else state.pool = buildLeaderPool();
}

// --- question generation ------------------------------------------

function pick(arr, n = 1, exclude = new Set()) {
  const filtered = arr.filter((x) => !exclude.has(x));
  const out = [];
  const used = new Set();
  while (out.length < n && used.size < filtered.length) {
    const i = Math.floor(Math.random() * filtered.length);
    if (used.has(i)) continue;
    used.add(i);
    out.push(filtered[i]);
  }
  return out;
}

function keyFor(modeId, item) {
  if (modeId === "ministers") return item.id ?? item.name;
  if (modeId === "flags") return item.iso3 ?? item.name;
  return item.qid ?? `${item.name}|${item.country}`;
}

function pickFresh(pool) {
  const recent = state.recent[state.mode] ?? [];
  const recentSet = new Set(recent);
  const available = pool.filter((x) => !recentSet.has(keyFor(state.mode, x)));
  const arr = available.length ? available : pool;
  const choice = arr[Math.floor(Math.random() * arr.length)];
  const key = keyFor(state.mode, choice);
  const hist = state.recent[state.mode] ?? (state.recent[state.mode] = []);
  hist.push(key);
  const cap = Math.min(RECENT_HISTORY, Math.max(1, pool.length - 4));
  while (hist.length > cap) hist.shift();
  return choice;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function nextQuestion() {
  clearTimeout(state.autoTimer);
  state.answered = false;

  if (!state.pool.length) {
    $("stage").innerHTML = `<div class="loading">ingen data i denne pakken</div>`;
    return;
  }

  if (state.mode === "ministers") generateMinisterQ();
  else if (state.mode === "flags") generateFlagQ();
  else generateLeaderQ();

  renderQuestion();
}

function generateMinisterQ() {
  const correct = pickFresh(state.pool);
  const distractors = pick(state.pool, 3, new Set([correct]))
    .filter((x) => x.name !== correct.name);
  while (distractors.length < 3) {
    const more = pick(state.pool, 1)[0];
    if (more && more.name !== correct.name && !distractors.includes(more)) distractors.push(more);
  }
  const options = shuffle([correct, ...distractors]).map((p) => ({
    label: p.name,
    correct: p.name === correct.name,
  }));

  state.question = {
    image: correct.image,
    imageClass: "portrait",
    kicker: ministerKicker(correct),
    question: "Hvem er dette?",
    hintHtml: ministerRolesHtml(correct),
    options,
    explanation: ministerExplanation(correct),
  };
}

function ministerRolesHtml(p) {
  const roles = (p.roles ?? []).slice().sort((a, b) => (a.start ?? "").localeCompare(b.start ?? ""));
  if (!roles.length) return "";
  const items = roles.map((r) => {
    const ys = roleYears(r);
    const title = r.title || "Statsråd";
    const meta = [];
    if (r.department) meta.push(r.department);
    if (r.government) meta.push(r.government);
    const metaTxt = meta.join(" · ");
    return `<li>
      <span class="role-yrs">${escapeHtml(ys)}</span>
      <span class="role-text">
        <span class="role-title">${escapeHtml(title)}</span>${metaTxt ? `<span class="role-meta-text">${escapeHtml(metaTxt)}</span>` : ""}${partyChip(r.party)}
      </span>
    </li>`;
  }).join("");
  return `<ul class="role-list">${items}</ul>`;
}

function roleYears(r) {
  const s = (r.start || "").slice(0, 4);
  const e = (r.end || "").slice(0, 4);
  if (s && e) return s === e ? s : `${s}–${e}`;
  return s || e || "";
}

function partyChip(code) {
  if (!code) return "";
  const p = state.ministers?.parties?.[code];
  const name = p?.name ?? code;
  const color = (p && p.color) ? p.color : "currentColor";
  return ` <span class="role-party"><span class="role-party-dot" style="background:${escapeAttr(color)}"></span>${escapeHtml(name)}</span>`;
}

function escapeAttr(s) {
  return String(s).replace(/[<>"']/g, "");
}

function ministerKicker(p) {
  if (p.firstYear && p.lastYear) {
    return p.firstYear === p.lastYear ? `${p.firstYear}` : `${p.firstYear}–${p.lastYear}`;
  }
  return "Norge";
}

function ministerExplanation(p) {
  const role = p.roles && p.roles[0];
  const wiki = p.wikipedia ? ` · <a href="${p.wikipedia}" target="_blank" rel="noopener">wiki</a>` : "";
  if (role && role.title) {
    return `<strong>${escapeHtml(p.name)}</strong> — ${escapeHtml(role.title)}${wiki}`;
  }
  return `<strong>${escapeHtml(p.name)}</strong>${wiki}`;
}

function generateFlagQ() {
  const correct = pickFresh(state.pool);
  const distractors = pick(state.pool, 3, new Set([correct]));
  const options = shuffle([correct, ...distractors]).map((c) => ({
    label: c.name,
    correct: c.name === correct.name,
  }));

  state.question = {
    image: correct.flag,
    imageClass: "flag",
    kicker: correct.iso3 || "",
    question: "Hvilket land?",
    hint: correct.capital ? `Hovedstad: ${correct.capital}` : " ",
    options,
    explanation: `<strong>${escapeHtml(correct.name)}</strong>${correct.capital ? ` — hovedstad ${escapeHtml(correct.capital)}` : ""}`,
  };
}

function generateLeaderQ() {
  const correct = pickFresh(state.pool);
  // distractors from different countries
  const seen = new Set([correct.country]);
  const distractors = [];
  let guard = 0;
  while (distractors.length < 3 && guard < 200) {
    const cand = pick(state.pool, 1)[0];
    if (cand && !seen.has(cand.country)) {
      seen.add(cand.country);
      distractors.push(cand);
    }
    guard++;
  }
  const options = shuffle([correct, ...distractors]).map((l) => ({
    label: l.country,
    correct: l.country === correct.country,
  }));

  const roleLabel = state.world.roleLabels?.[correct.role] ?? "Leader";
  const roleNames = (correct.roles ?? [correct.role])
    .map((r) => state.world.roleLabels?.[r] ?? r)
    .filter(Boolean);
  const partsTxt = roleNames.length
    ? roleNames.map((r) => r.toLowerCase()).join(", ")
    : roleLabel.toLowerCase();
  const bits = [];
  if (correct.isMonarch) bits.push("monark");
  if (correct.party) bits.push(escapeHtml(correct.party));
  if (correct.termStart) bits.push(`tiltrådt ${escapeHtml(String(correct.termStart).slice(0, 4))}`);
  if (correct.nextElection) bits.push(`neste valg ${escapeHtml(String(correct.nextElection).slice(0, 4))}`);
  if (correct.countryCapital) bits.push(`hovedstad ${escapeHtml(correct.countryCapital)}`);
  const extras = bits.length ? ` · ${bits.join(" · ")}` : "";
  const wiki = correct.wikipedia ? ` · <a href="${correct.wikipedia}" target="_blank" rel="noopener">wiki</a>` : "";

  state.question = {
    image: correct.image,
    imageClass: "portrait",
    kicker: roleLabel,
    question: "Hvilket land leder denne personen?",
    hint: correct.name,
    options,
    explanation: `<strong>${escapeHtml(correct.name)}</strong> — ${escapeHtml(partsTxt)} i ${escapeHtml(correct.country)}${extras}${wiki}`,
  };
}

// --- rendering -----------------------------------------------------

function renderQuestion() {
  const q = state.question;
  const stage = $("stage");
  stage.innerHTML = `
    <article class="card">
      <div class="card-head">
        <div class="card-image ${q.imageClass}" id="cardImage">
          <span class="image-fallback" id="imageFallback">···</span>
          <img id="qImage" alt="" loading="eager" />
        </div>
        <div class="card-meta">
          <div class="kicker">${escapeHtml(q.kicker)}</div>
          <h2 class="question">${escapeHtml(q.question)}</h2>
          <div class="hint">${q.hintHtml ? q.hintHtml : (q.hint && q.hint.trim() ? escapeHtml(q.hint) : "&nbsp;")}</div>
        </div>
      </div>
      <div class="card-foot">
        <div class="choices" id="choices"></div>
      </div>
      <div class="feedback" id="feedback">
        <div class="feedback-text" id="feedbackText"></div>
        <button class="next" id="nextBtn" type="button" hidden>neste <kbd>↵</kbd></button>
      </div>
    </article>
  `;

  // image
  const img = $("qImage");
  const fb = $("imageFallback");
  if (q.image) {
    img.src = q.image;
    img.onload = () => { fb.style.display = "none"; };
    img.onerror = () => {
      img.style.display = "none";
      fb.textContent = "uten bilde";
    };
  } else {
    img.style.display = "none";
    fb.textContent = "uten bilde";
  }

  // choices
  const choicesEl = $("choices");
  q.options.forEach((opt, i) => {
    const b = document.createElement("button");
    b.className = "choice";
    b.type = "button";
    b.dataset.index = String(i);
    b.innerHTML = `<span class="choice-key">${i + 1}</span><span class="choice-text">${escapeHtml(opt.label)}</span>`;
    b.addEventListener("click", () => answer(i));
    choicesEl.appendChild(b);
  });

  $("nextBtn").addEventListener("click", nextQuestion);
}

function answer(i) {
  if (state.answered) return;
  state.answered = true;

  const q = state.question;
  const buttons = Array.from(document.querySelectorAll(".choice"));
  const chosen = q.options[i];
  const correctIdx = q.options.findIndex((o) => o.correct);

  buttons.forEach((b, idx) => {
    b.disabled = true;
    if (idx === correctIdx) b.classList.add("correct");
    if (idx === i && !chosen.correct) b.classList.add("wrong");
  });

  // stats
  const modeStats = state.stats[state.mode] ?? { played: 0, correct: 0, streak: 0, best: 0 };
  modeStats.played++;
  if (chosen.correct) {
    modeStats.correct++;
    modeStats.streak++;
    if (modeStats.streak > modeStats.best) modeStats.best = modeStats.streak;
  } else {
    modeStats.streak = 0;
  }
  state.stats[state.mode] = modeStats;
  saveStats();
  renderStats();

  // feedback (container is always visible; reveal text + button on answer)
  $("feedbackText").innerHTML = (chosen.correct ? "Riktig — " : "Feil — ") + q.explanation;
  $("nextBtn").hidden = false;

  // auto advance if a delay is configured
  const ms = autoMs();
  if (ms > 0) {
    state.autoTimer = setTimeout(nextQuestion, ms);
  }
}

// --- auto-next toggle ----------------------------------------------

function loadAuto() {
  try {
    const raw = localStorage.getItem(STORAGE_AUTO);
    if (raw && AUTO_OPTIONS.some((o) => o.id === raw)) return raw;
  } catch {}
  return "1s";
}

function autoMs() {
  const opt = AUTO_OPTIONS.find((o) => o.id === state.auto);
  return opt ? opt.ms : 0;
}

function renderAutoToggle() {
  const el = $("autoToggle");
  if (!el) return;
  el.innerHTML = "";
  AUTO_OPTIONS.forEach((o) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "auto-opt";
    b.dataset.auto = o.id;
    b.textContent = o.label;
    b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", String(o.id === state.auto));
    b.addEventListener("click", () => setAuto(o.id));
    el.appendChild(b);
  });
}

function setAuto(id) {
  if (!AUTO_OPTIONS.some((o) => o.id === id)) return;
  state.auto = id;
  try { localStorage.setItem(STORAGE_AUTO, id); } catch {}
  document.querySelectorAll(".auto-opt").forEach((b) => {
    b.setAttribute("aria-checked", String(b.dataset.auto === id));
  });
}

// --- stats ---------------------------------------------------------

function loadStats() {
  try {
    const raw = localStorage.getItem(STORAGE_STATS);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function saveStats() {
  try { localStorage.setItem(STORAGE_STATS, JSON.stringify(state.stats)); } catch {}
}

function renderStats() {
  const cur = state.stats[state.mode] ?? { played: 0, correct: 0, streak: 0, best: 0 };
  $("scoreCorrect").textContent = String(cur.correct);
  $("scoreTotal").textContent = String(cur.played);
  $("scoreStreak").textContent = `streak ${cur.streak}`;

  $("statPlayed").textContent = String(cur.played);
  $("statCorrect").textContent = String(cur.correct);
  $("statAccuracy").textContent = cur.played ? `${Math.round((cur.correct / cur.played) * 100)}%` : "—";
  $("statBest").textContent = String(cur.best);
}

// --- theme ---------------------------------------------------------

function setupTheme() {
  const btn = $("themeToggle");
  btn.addEventListener("click", () => {
    const isDark = document.documentElement.getAttribute("data-theme") === "dark";
    if (isDark) {
      document.documentElement.removeAttribute("data-theme");
      localStorage.setItem(STORAGE_THEME, "light");
    } else {
      document.documentElement.setAttribute("data-theme", "dark");
      localStorage.setItem(STORAGE_THEME, "dark");
    }
  });
}

// --- keyboard ------------------------------------------------------

function setupKeyboard() {
  document.addEventListener("keydown", (e) => {
    if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;

    if (e.key === "Enter" || e.key === " ") {
      if (state.answered) {
        e.preventDefault();
        nextQuestion();
      }
      return;
    }

    const n = Number(e.key);
    if (Number.isInteger(n) && n >= 1 && n <= 4 && !state.answered) {
      answer(n - 1);
    }
  });
}

// --- utils ---------------------------------------------------------

function escapeHtml(s) {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

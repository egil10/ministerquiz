/* Lederquiz — multi-pack quiz app.
 *
 * Routes (hash):
 *   #/                → hub
 *   #/no-ministers    → Norske statsråder (data/ministers.json)
 *   #/world-leaders   → Verdens ledere (data/world-leaders.json)
 *
 * Each pack loads its own JSON, exposes its own quiz modes, and persists
 * its own profile / stats under localStorage. The frame (top bar, theme,
 * view switcher, controls strip) is shared.
 */

/* ── Icon set ─────────────────────────────────────────────── */
const ICONS = {
  check: '<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>',
  x:     '<svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  sun:   '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>',
  moon:  '<svg viewBox="0 0 24 24"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>',
  search:'<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>',
  flame: '<svg viewBox="0 0 24 24"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>',
  globe: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
  crown: '<svg viewBox="0 0 24 24"><path d="M2 7l5 5 5-9 5 9 5-5-2 13H4z"/></svg>',
};
function icon(name) { return ICONS[name] || ""; }
function paintIcons(root = document) {
  root.querySelectorAll("[data-icon]").forEach((el) => {
    const name = el.dataset.icon;
    if (!ICONS[name] || el.firstElementChild) return;
    el.innerHTML = ICONS[name];
  });
}

/* ── Tiny utils ───────────────────────────────────────────── */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const shuffle = (arr) => {
  const c = [...arr];
  for (let i = c.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [c[i], c[j]] = [c[j], c[i]];
  }
  return c;
};
const escapeHtml = (v) =>
  String(v ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
const escapeAttr = (v) => escapeHtml(v).replaceAll("`", "&#096;");
const normalize = (v) =>
  String(v || "")
    .toLocaleLowerCase("nb")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
const initials = (name) =>
  String(name || "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();
const safeStorage = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

/* ── Pack registry ────────────────────────────────────────── */
const PACKS = {
  "no-ministers": {
    id: "no-ministers",
    title: "Norske statsråder",
    blurb: "Over 200 år av norsk regjering — 690 personer, 2 100 roller, 66 regjeringer.",
    icon: "🇳🇴",
    accent: "#dc2626",
    accentSoft: "#fee2e2",
    dataPath: "/data/ministers.json",
    locale: "nb-NO",
    modes: [
      { id: "portrait",   label: "Portrett",   badge: "Portrett",     help: "Bilde → person" },
      { id: "office",     label: "Posten",     badge: "Ministerpost", help: "Person → ministerpost" },
      { id: "party",      label: "Parti",      badge: "Parti",        help: "Person → parti" },
      { id: "government", label: "Regjering",  badge: "Regjering",    help: "Rolle → regjering" },
      { id: "timeline",   label: "Tiår",       badge: "Tiår",         help: "Når startet rollen?" },
    ],
    eras: [
      { id: "all",      label: "Alle år" },
      { id: "current",  label: "Siste 25 år" },
      { id: "postwar",  label: "1945 →" },
      { id: "interwar", label: "1905–1945" },
      { id: "union",    label: "1814–1905" },
    ],
    defaultMode: "portrait",
    defaultEra: "all",
  },
  "world-leaders": {
    id: "world-leaders",
    title: "Verdens ledere",
    blurb: "Statsoverhoder, regjeringssjefer og utenriksministre — over 195 land i alle verdens hjørner.",
    icon: "🌍",
    accent: "#2563eb",
    accentSoft: "#dbeafe",
    dataPath: "/data/world-leaders.json",
    locale: "en",
    modes: [
      { id: "portrait", label: "Ansikt",   badge: "Ansikt",   help: "Bilde → person" },
      { id: "country",  label: "Land",     badge: "Land",     help: "Bilde → land" },
      { id: "leader",   label: "Lederen",  badge: "Lederen",  help: "Land → person" },
      { id: "role",     label: "Rolle",    badge: "Rolle",    help: "Person → rolle" },
      { id: "flag",     label: "Flagg",    badge: "Flagg",    help: "Flagg → land" },
    ],
    eras: null,
    defaultMode: "portrait",
    defaultEra: null,
  },
};

/* ── Global state ─────────────────────────────────────────── */
const state = {
  packId: null,
  pack: null,
  data: null,
  items: [],   // unified question candidates (Norway: roles; World: leaders)
  view: "play",
  mode: null,
  era: null,
  current: null,
  answered: false,
  preloadCache: new Map(),
  profile: null,
  packCache: new Map(),   // packId → data (so switching is instant)
};

/* ── Element refs ─────────────────────────────────────────── */
const els = {
  hubView: $("#hubView"),
  hubGrid: $("#hubGrid"),
  loadingView: $("#loadingView"),
  loaderText: $("#loaderText"),
  playView: $("#playView"),
  learnView: $("#learnView"),
  statsView: $("#statsView"),
  controls: $("#controls"),
  viewSwitch: $("#viewSwitch"),
  viewTabs: $$(".view-tab"),
  brand: $(".brand"),
  brandPack: $("#brandPack"),
  packSwitch: $("#packSwitch"),
  packSwitchIcon: $("#packSwitchIcon"),
  themeToggle: $("#themeToggle"),
  modeList: $("#modeList"),
  eraSelect: $("#eraSelect"),
  choices: $("#choices"),
  portrait: $("#portrait"),
  portraitImg: $("#portraitImg"),
  portraitFallback: $("#portraitFallback"),
  portraitTag: $("#portraitTag"),
  questionText: $("#questionText"),
  questionHint: $("#questionHint"),
  badgeMode: $("#badgeMode"),
  badgeYear: $("#badgeYear"),
  railStreak: $("#railStreak"),
  railStreakValue: $("#railStreakValue"),
  answerPanel: $("#answerPanel"),
  answerTitle: $("#answerTitle"),
  answerDetail: $("#answerDetail"),
  answerLinks: $("#answerLinks"),
  nextBtn: $("#nextBtn"),
  roundFill: $("#roundFill"),
  roundLabel: $("#roundLabel"),
  learnSearch: $("#learnSearch"),
  learnFilterA: $("#learnFilterA"),
  learnFilterB: $("#learnFilterB"),
  learnCount: $("#learnCount"),
  learnGrid: $("#learnGrid"),
  card: $("#cardEl"),
  statPlayed: $("#statPlayed"),
  statCorrect: $("#statCorrect"),
  statAccuracyBig: $("#statAccuracyBig"),
  statBest: $("#statBest"),
  modeTable: $("#modeTable"),
  dataList: $("#dataList"),
  resetProgress: $("#resetProgress"),
  footStats: $("#footStats"),
  toast: $("#toast"),
  confetti: $("#confetti"),
};

const ROUND_SIZE = 10;
const THEME_KEY = "mq.theme";
const profileKey = (id) => `mq.profile.${id}.v3`;

paintIcons();
initTheme();
bindGlobalEvents();

window.addEventListener("hashchange", route);
route();

/* ── Routing ──────────────────────────────────────────────── */
function route() {
  const hash = location.hash.replace(/^#/, "");
  const parts = hash.split("/").filter(Boolean);
  const packId = parts[0] && PACKS[parts[0]] ? parts[0] : null;
  if (!packId) {
    showHub();
    return;
  }
  loadPack(packId).catch((err) => {
    console.error(err);
    showToast("Klarte ikke laste pakken", "fail");
    showHub();
  });
}

function go(path) {
  location.hash = path;
}

/* ── Hub view ─────────────────────────────────────────────── */
function showHub() {
  state.packId = null;
  state.pack = null;
  document.documentElement.style.removeProperty("--accent");
  document.documentElement.style.removeProperty("--accent-soft");
  document.body.dataset.pack = "";

  els.hubView.hidden = false;
  els.loadingView.hidden = true;
  els.playView.hidden = true;
  els.learnView.hidden = true;
  els.statsView.hidden = true;
  els.controls.hidden = true;
  els.viewSwitch.hidden = true;
  els.packSwitch.hidden = true;
  els.brandPack.textContent = "";

  els.hubGrid.innerHTML = Object.values(PACKS)
    .map((pack) => packCard(pack))
    .join("");
  els.hubGrid.querySelectorAll("[data-pack]").forEach((card) => {
    card.addEventListener("click", () => go(`/${card.dataset.pack}`));
  });
  // queued data fetch hints
  Object.values(PACKS).forEach((pack) => warmCache(pack));
}

function packCard(pack) {
  return `
    <button class="pack-card" data-pack="${pack.id}" type="button" style="--accent:${pack.accent};--accent-soft:${pack.accentSoft};">
      <span class="pack-card-glyph" aria-hidden="true">${pack.icon}</span>
      <span class="pack-card-body">
        <span class="pack-card-title">${escapeHtml(pack.title)}</span>
        <span class="pack-card-blurb">${escapeHtml(pack.blurb)}</span>
        <span class="pack-card-modes">${pack.modes.map((m) => `<span>${escapeHtml(m.label)}</span>`).join("")}</span>
      </span>
      <span class="pack-card-go" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
      </span>
    </button>
  `;
}

function warmCache(pack) {
  if (state.packCache.has(pack.id)) return;
  fetch(pack.dataPath, { cache: "force-cache" })
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => { if (data) state.packCache.set(pack.id, data); })
    .catch(() => {});
}

/* ── Pack loading ─────────────────────────────────────────── */
async function loadPack(packId) {
  const pack = PACKS[packId];
  state.packId = packId;
  state.pack = pack;
  state.profile = loadProfile(packId);
  state.view = "play";
  state.mode = pack.defaultMode;
  state.era = pack.defaultEra;

  document.documentElement.style.setProperty("--accent", pack.accent);
  document.documentElement.style.setProperty("--accent-soft", pack.accentSoft);
  document.body.dataset.pack = packId;
  els.brandPack.textContent = pack.title;
  els.packSwitchIcon.textContent = pack.icon;
  els.packSwitch.hidden = false;
  els.viewSwitch.hidden = false;
  els.hubView.hidden = true;
  els.playView.hidden = true;
  els.learnView.hidden = true;
  els.statsView.hidden = true;
  els.controls.hidden = true;
  els.loadingView.hidden = false;
  els.loaderText.textContent = `Laster ${pack.title.toLowerCase()}…`;

  let data = state.packCache.get(packId);
  if (!data) {
    const res = await fetch(pack.dataPath, { cache: "force-cache" });
    if (!res.ok) throw new Error(`Datafetch feilet: ${res.status}`);
    data = await res.json();
    state.packCache.set(packId, data);
  }
  state.data = data;
  state.items = packId === "no-ministers" ? buildItemsNorway(data) : buildItemsWorld(data);

  els.loadingView.hidden = true;
  switchView("play");
  buildModeChips();
  buildEraSelect();
  bindLearnFilters();
  renderRoundProgress();
  renderFootStats();
  nextQuestion();
}

/* ── Norway adapter ───────────────────────────────────────── */
function buildItemsNorway(data) {
  return data.people.flatMap((person) =>
    (person.roles || []).map((role) => ({
      ...role,
      person,
      _kind: "no",
      partyMeta: data.parties[role.party] || { name: role.party || "Ukjent", color: "#9a9a9a" },
    })),
  );
}

/* ── Flag helpers (prefer flagcdn for crisp small + big rendering) ─── */
const FLAGCDN_BADGE_SIZES = {
  sm: { base: "24x18", x15: "36x27", x2: "48x36", w: 18, h: 14 },
  md: { base: "32x24", x15: "48x36", x2: "64x48", w: 24, h: 18 },
  lg: { base: "48x36", x15: "72x54", x2: "96x72", w: 32, h: 24 },
};

function flagcdnFor(country) {
  const iso2 = (country?.iso2 || "").toLowerCase();
  if (!iso2 || !/^[a-z]{2}$/.test(iso2)) return null;
  return iso2;
}

function flagBadgeHtml(country, size = "sm") {
  const iso = flagcdnFor(country);
  const meta = FLAGCDN_BADGE_SIZES[size] || FLAGCDN_BADGE_SIZES.sm;
  const sizeClass = size === "lg" ? "size-lg" : size === "md" ? "size-md" : "size-sm";
  if (iso) {
    return `<span class="flag-badge ${sizeClass}" title="${escapeAttr(country.name)}">
      <img src="https://flagcdn.com/${meta.base}/${iso}.png"
           srcset="https://flagcdn.com/${meta.x15}/${iso}.png 1.5x, https://flagcdn.com/${meta.x2}/${iso}.png 2x"
           width="${meta.w}" height="${meta.h}" loading="lazy" decoding="async" alt="">
    </span>`;
  }
  // Fallback: local SVG, then text monogram
  if (country?.flag) {
    return `<span class="flag-badge has-svg ${sizeClass}" title="${escapeAttr(country?.name || "")}">
      <img src="${escapeAttr(country.flag)}" width="${meta.w}" height="${meta.h}" loading="lazy" decoding="async" alt="">
    </span>`;
  }
  const tag = (country?.iso2 || country?.iso3 || country?.name || "?").slice(0, 2).toUpperCase();
  return `<span class="flag-badge ${sizeClass} is-text" title="${escapeAttr(country?.name || "")}">${escapeHtml(tag)}</span>`;
}

function flagLargeUrl(country) {
  const iso = flagcdnFor(country);
  if (iso) return `https://flagcdn.com/${iso}.svg`;
  return country?.flag || null;
}

/* ── World adapter ────────────────────────────────────────── */
function buildItemsWorld(data) {
  const list = [];
  for (const country of data.countries) {
    for (const leader of country.leaders) {
      list.push({
        _kind: "world",
        id: `${country.qid}-${leader.qid}`,
        personId: leader.qid,
        country,
        leader,
        image: leader.image,
        name: leader.name,
        primaryRole: leader.primaryRole,
        roles: leader.roles,
      });
    }
  }
  return list;
}

/* ── Theme ────────────────────────────────────────────────── */
function initTheme() {
  const stored = safeStorage.get(THEME_KEY);
  const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  applyTheme(stored || (prefersDark ? "dark" : "light"));
  els.themeToggle?.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    applyTheme(next);
    safeStorage.set(THEME_KEY, next);
  });
}
function applyTheme(t) {
  if (t === "dark") document.documentElement.setAttribute("data-theme", "dark");
  else document.documentElement.removeAttribute("data-theme");
}

/* ── Global event bindings ────────────────────────────────── */
function bindGlobalEvents() {
  els.nextBtn.addEventListener("click", () => nextQuestion());
  els.resetProgress.addEventListener("click", () => {
    if (!state.pack) return;
    if (!confirm("Nullstille progresjonen for denne pakken?")) return;
    state.profile = defaultProfile();
    saveProfile();
    renderRoundProgress();
    renderStatsView();
    showToast("Progresjon nullstilt");
  });

  els.viewTabs.forEach((tab) => {
    tab.addEventListener("click", () => switchView(tab.dataset.view));
  });

  els.packSwitch.addEventListener("click", () => go("/"));

  els.portraitImg.addEventListener("load", () => {
    els.portraitImg.classList.add("is-ready");
    els.portrait.classList.add("is-loaded");
  });
  els.portraitImg.addEventListener("error", () => {
    els.portrait.classList.remove("is-loaded");
    els.portraitImg.classList.remove("is-ready");
    setFallback(state.current?.label || state.current?.item?.name);
  });

  window.addEventListener("keydown", (e) => {
    if (state.view !== "play" || !state.pack) return;
    const t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA")) return;
    if (e.key === "Enter" && state.answered) {
      e.preventDefault();
      nextQuestion();
      return;
    }
    const idx = Number(e.key) - 1;
    if (!state.answered && idx >= 0 && idx < 4) {
      els.choices.querySelectorAll(".choice")[idx]?.click();
    }
  });
}

function bindLearnFilters() {
  els.learnSearch.addEventListener("input", renderLearn);
  els.learnFilterA.addEventListener("change", renderLearn);
  els.learnFilterB.addEventListener("change", renderLearn);
}

function switchView(view) {
  if (!state.pack) return;
  state.view = view;
  els.viewTabs.forEach((t) => t.classList.toggle("is-active", t.dataset.view === view));
  els.playView.hidden = view !== "play";
  els.learnView.hidden = view !== "learn";
  els.statsView.hidden = view !== "stats";
  els.controls.hidden = view !== "play";
  if (view === "learn") renderLearn();
  if (view === "stats") renderStatsView();
}

/* ── Mode / era chips ─────────────────────────────────────── */
function buildModeChips() {
  els.modeList.innerHTML = state.pack.modes
    .map(
      (m) => `
        <button class="chip ${m.id === state.mode ? "is-active" : ""}" type="button" data-mode="${m.id}" title="${escapeAttr(m.help)}">
          ${escapeHtml(m.label)}
        </button>`,
    )
    .join("");
  els.modeList.querySelectorAll("button").forEach((b) => {
    b.addEventListener("click", () => {
      state.mode = b.dataset.mode;
      els.modeList.querySelectorAll("button").forEach((x) => x.classList.toggle("is-active", x === b));
      nextQuestion();
    });
  });
}

function buildEraSelect() {
  if (!state.pack.eras) {
    els.eraSelect.hidden = true;
    els.eraSelect.innerHTML = "";
    return;
  }
  els.eraSelect.hidden = false;
  els.eraSelect.innerHTML = state.pack.eras
    .map((e) => `<option value="${e.id}">${escapeHtml(e.label)}</option>`)
    .join("");
  els.eraSelect.value = state.era;
  els.eraSelect.onchange = () => {
    state.era = els.eraSelect.value;
    nextQuestion();
  };
}

/* ── Question pipeline ────────────────────────────────────── */
function nextQuestion() {
  state.answered = false;
  els.answerPanel.classList.remove("is-shown", "is-right", "is-wrong");
  els.answerTitle.innerHTML = "&nbsp;";
  els.answerDetail.innerHTML = "&nbsp;";
  els.answerLinks.innerHTML = "";

  const item = pickItem();
  if (!item) {
    els.questionText.textContent = "Ingen spørsmål for valgte innstillinger.";
    els.questionHint.textContent = "";
    els.choices.innerHTML = "";
    return;
  }
  const q = state.packId === "no-ministers" ? questionNorway(item) : questionWorld(item);
  state.current = q;
  renderQuestion(q);
  preloadUpcoming();
}

function pickItem() {
  const pool = state.items.filter(askable);
  if (!pool.length) return state.items.find(itemHasPortrait) || state.items[0];
  const imageMode = state.mode === "portrait" || state.mode === "country";
  const weighted = pool.map((item) => {
    const key = itemKey(item);
    const seen = state.profile.mastery[key]?.seen || 0;
    const correct = state.profile.mastery[key]?.correct || 0;
    const weakness = 1 + Math.max(0, seen - correct) * 0.6;
    const image = itemHasPortrait(item) ? (imageMode ? 1.8 : 1.1) : imageMode ? 0.1 : 1;
    const recent = state.profile.recent.includes(itemKey(item)) ? 0.18 : 1;
    return { item, w: weakness * image * recent };
  });
  const total = weighted.reduce((s, x) => s + x.w, 0);
  let cursor = Math.random() * total;
  for (const x of weighted) {
    cursor -= x.w;
    if (cursor <= 0) return x.item;
  }
  return weighted[0].item;
}

function askable(item) {
  if (item._kind === "no") {
    if (!item.title || !item.start) return false;
    if (state.era && state.era !== "all" && !passesNorwayEra(item, state.era)) return false;
    if (state.mode === "portrait") return Boolean(item.person.image);
    if (state.mode === "party")    return Boolean(item.party);
    return true;
  }
  // world
  if (!item.leader || !item.leader.name) return false;
  if (state.mode === "portrait") return Boolean(item.image);
  if (state.mode === "country")  return Boolean(item.image);
  if (state.mode === "flag")     return Boolean(item.country.flag);
  return true;
}

function itemHasPortrait(item) {
  return item._kind === "no" ? Boolean(item.person.image) : Boolean(item.image);
}

function itemKey(item) {
  return item._kind === "no" ? item.personId : item.personId;
}

/* ── Norway question builders ────────────────────────────── */
function questionNorway(role) {
  const dates = dateLabelNo(role);
  const ctx = {
    item: role,
    image: role.person.image,
    label: role.person.name,
    year: dates,
  };
  if (state.mode === "portrait") {
    return {
      ...ctx,
      mode: "portrait",
      correct: role.person.name,
      choices: choiceSet(role.person.name, state.data.people.map((p) => p.name)),
      prompt: "Hvem er dette?",
      hint: `${role.title}${role.government ? ` · ${role.government}` : ""} · ${dates}.`,
    };
  }
  if (state.mode === "office") {
    return {
      ...ctx,
      mode: "office",
      correct: role.title,
      choices: choiceSet(role.title, state.data.offices),
      prompt: `Hva var ${role.person.name} sin post?`,
      hint: `${dates}${role.government ? ` · ${role.government}` : ""}`,
    };
  }
  if (state.mode === "party") {
    return {
      ...ctx,
      mode: "party",
      correct: role.party || "Ukjent",
      choices: choiceSet(role.party || "Ukjent", partyChoicesNorway()),
      prompt: `Parti til ${role.person.name}?`,
      hint: `${role.title} · ${dates}${role.government ? ` · ${role.government}` : ""}`,
      formatChoice: (v) => (v === "Ukjent" ? v : partyNameNorway(v)),
    };
  }
  if (state.mode === "government") {
    return {
      ...ctx,
      mode: "government",
      correct: role.government || "Ukjent regjering",
      choices: choiceSet(role.government || "Ukjent regjering", state.data.governments),
      prompt: "Hvilken regjering?",
      hint: `${role.person.name} · ${role.title} · ${dates}`,
    };
  }
  const decade = `${Math.floor(startYearNo(role) / 10) * 10}-tallet`;
  return {
    ...ctx,
    mode: "timeline",
    correct: decade,
    choices: choiceSet(decade, decadeChoicesNorway()),
    prompt: "Når startet rollen?",
    hint: `${role.person.name} som ${role.title}${role.government ? ` i ${role.government}` : ""}.`,
  };
}

function passesNorwayEra(role, eraKey) {
  const y = startYearNo(role);
  if (!y) return true;
  if (eraKey === "current")  return y >= new Date().getFullYear() - 25;
  if (eraKey === "postwar")  return y >= 1945;
  if (eraKey === "interwar") return y >= 1905 && y < 1945;
  if (eraKey === "union")    return y < 1905;
  return true;
}
function startYearNo(role)  { return Number(String(role.start || "").slice(0, 4)); }
function dateLabelNo(role) {
  if (!role?.start && !role?.end) return "ukjent år";
  const fmt = (v) => {
    if (!v) return "";
    const [y, m, d] = v.split("-");
    return y && m && d ? `${d}.${m}.${y}` : v;
  };
  return `${fmt(role.start)}–${role.end ? fmt(role.end) : "nå"}`;
}
function partyNameNorway(code) { return state.data?.parties?.[code]?.name || code || "Ukjent"; }
function partyChoicesNorway() {
  const codes = Object.keys(state.data.parties).filter((c) =>
    state.items.some((it) => it._kind === "no" && it.party === c),
  );
  return [...codes, "Ukjent"];
}
function decadeChoicesNorway() {
  const s = new Set(state.items.filter((i) => i._kind === "no").map((it) => `${Math.floor(startYearNo(it) / 10) * 10}-tallet`));
  return [...s].filter((x) => !x.startsWith("NaN"));
}

/* ── World question builders ─────────────────────────────── */
const WORLD_ROLE_LABELS_NO = {
  head_of_state: "Statsoverhode",
  head_of_government: "Regjeringssjef",
  deputy_head_of_government: "Visestatsminister",
  foreign_minister: "Utenriksminister",
};

function questionWorld(item) {
  const { country, leader, primaryRole } = item;
  const ctx = {
    item,
    image: item.image,
    label: leader.name,
    year: country.name,
  };
  if (state.mode === "portrait") {
    return {
      ...ctx,
      mode: "portrait",
      correct: leader.name,
      choices: choiceSet(leader.name, allLeaderNames()),
      prompt: "Hvem er dette?",
      hint: `${WORLD_ROLE_LABELS_NO[primaryRole] || "Leder"} · ${country.name}`,
    };
  }
  if (state.mode === "country") {
    return {
      ...ctx,
      mode: "country",
      correct: country.name,
      choices: choiceSet(country.name, allCountryNames()),
      prompt: "Hvilket land leder denne personen?",
      hint: `${leader.name} · ${WORLD_ROLE_LABELS_NO[primaryRole] || "Leder"}`,
    };
  }
  if (state.mode === "leader") {
    // pick a country and ask who is the head
    return {
      ...ctx,
      image: null,
      mode: "leader",
      correct: leader.name,
      choices: choiceSet(leader.name, allLeaderNames()),
      prompt: `Hvem er ${WORLD_ROLE_LABELS_NO[primaryRole] || "leder"} i ${country.name}?`,
      hint: country.capital ? `Hovedstad: ${country.capital}` : "",
    };
  }
  if (state.mode === "role") {
    const correctLabel = WORLD_ROLE_LABELS_NO[primaryRole] || "Leder";
    return {
      ...ctx,
      mode: "role",
      correct: correctLabel,
      choices: choiceSet(correctLabel, Object.values(WORLD_ROLE_LABELS_NO)),
      prompt: `Hvilken rolle har ${leader.name}?`,
      hint: country.name,
    };
  }
  // flag
  return {
    ...ctx,
    image: flagLargeUrl(country) || country.flag,
    portraitKind: "flag",
    mode: "flag",
    correct: country.name,
    choices: choiceSet(country.name, allCountryNames()),
    prompt: "Hvilket land har dette flagget?",
    hint: country.capital ? `Hovedstad: ${country.capital}` : "",
  };
}

function allLeaderNames() {
  return state.items.filter((i) => i._kind === "world").map((i) => i.leader.name);
}
function allCountryNames() {
  return [...new Set(state.items.filter((i) => i._kind === "world").map((i) => i.country.name))];
}

/* ── Choice generation ───────────────────────────────────── */
function choiceSet(correct, universe) {
  const options = new Set([correct]);
  const clean = [...new Set(universe.filter(Boolean).filter((v) => v !== correct))];
  while (options.size < 4 && clean.length) {
    const i = Math.floor(Math.random() * clean.length);
    options.add(clean.splice(i, 1)[0]);
  }
  return shuffle([...options]);
}

/* ── Render ──────────────────────────────────────────────── */
function renderQuestion(q) {
  const modeMeta = state.pack.modes.find((m) => m.id === q.mode);
  els.badgeMode.textContent = modeMeta?.badge || "";
  els.badgeYear.textContent = q.year || "";
  els.questionText.textContent = q.prompt;
  els.questionHint.textContent = q.hint || "";
  els.card.classList.remove("is-entering");
  // restart enter animation
  // eslint-disable-next-line no-unused-expressions
  void els.card.offsetWidth;
  els.card.classList.add("is-entering");

  renderPortrait(q);
  renderChoices(q);
}

function renderPortrait(q) {
  els.portrait.classList.remove("is-loaded", "is-flag");
  els.portraitImg.classList.remove("is-ready");
  const isFlag = q.portraitKind === "flag";
  if (isFlag) els.portrait.classList.add("is-flag");

  els.portraitImg.alt = q.image ? `Bilde av ${q.label || "leder"}` : "";
  els.portraitFallback.textContent = initials(q.label);
  els.portraitTag.innerHTML = "";
  els.portraitTag.classList.remove("is-shown");

  if (q.image) {
    els.portraitImg.src = q.image;
  } else {
    els.portraitImg.removeAttribute("src");
    setFallback(q.label);
  }
}

function setFallback(name) {
  els.portrait.classList.remove("is-loaded");
  els.portraitImg.classList.remove("is-ready");
  if (name) els.portraitFallback.textContent = initials(name);
}

function renderChoices(q) {
  els.choices.innerHTML = "";
  q.choices.forEach((choice, i) => {
    const b = document.createElement("button");
    b.className = "choice";
    b.style.setProperty("--i", i);
    b.type = "button";
    b.dataset.value = choice;
    const text = q.formatChoice ? q.formatChoice(choice) : choice;
    b.innerHTML = `
      <span class="choice-key">${i + 1}</span>
      <span class="choice-text">${escapeHtml(text)}</span>
      <span class="icon choice-icon" aria-hidden="true"></span>
    `;
    b.addEventListener("click", () => onAnswer(b, choice));
    els.choices.appendChild(b);
  });
}

function onAnswer(btn, value) {
  if (state.answered) return;
  state.answered = true;
  const q = state.current;
  const correct = value === q.correct;

  els.choices.querySelectorAll(".choice").forEach((b) => {
    b.disabled = true;
    const ic = b.querySelector(".choice-icon");
    if (b.dataset.value === q.correct) {
      b.classList.add("is-correct");
      if (ic) ic.innerHTML = icon("check");
    } else if (b === btn && !correct) {
      b.classList.add("is-wrong", "is-shake");
      if (ic) ic.innerHTML = icon("x");
    } else {
      b.classList.add("is-dim");
    }
  });

  updateProfile(correct, q.item);
  renderAnswer(correct, q);
  renderStatsRail();
  renderRoundProgress();

  if (correct && state.profile.streak >= 5 && state.profile.streak % 5 === 0) {
    showConfetti();
    showToast(`${state.profile.streak} på rad`, "success");
  }
}

function renderAnswer(correct, q) {
  els.answerPanel.classList.toggle("is-right", correct);
  els.answerPanel.classList.toggle("is-wrong", !correct);
  if (q.item._kind === "no") {
    const role = q.item;
    const partyText = role.party ? partyNameNorway(role.party) : "uavhengig";
    els.answerTitle.textContent = `${role.person.name} · ${role.title}`;
    els.answerDetail.textContent = `${partyText} · ${dateLabelNo(role)}${role.government ? ` · ${role.government}` : ""}`;
    const links = [];
    if (role.person.wikipedia) links.push(`<a href="${escapeAttr(role.person.wikipedia)}" target="_blank" rel="noopener">Wikipedia</a>`);
    if (role.person.source)    links.push(`<a href="${escapeAttr(role.person.source)}" target="_blank" rel="noopener">Regjeringen.no</a>`);
    els.answerLinks.innerHTML = links.join("");
    els.portraitTag.innerHTML = renderPortraitTagNorway(role);
  } else {
    const { country, leader, primaryRole } = q.item;
    els.answerTitle.textContent = `${leader.name} · ${WORLD_ROLE_LABELS_NO[primaryRole] || "Leder"}`;
    els.answerDetail.textContent = `${country.name}${country.capital ? ` · ${country.capital}` : ""}`;
    const links = [];
    if (leader.wikipedia) links.push(`<a href="${escapeAttr(leader.wikipedia)}" target="_blank" rel="noopener">Wikipedia</a>`);
    if (leader.qid)       links.push(`<a href="https://www.wikidata.org/wiki/${escapeAttr(leader.qid)}" target="_blank" rel="noopener">Wikidata</a>`);
    els.answerLinks.innerHTML = links.join("");
    els.portraitTag.innerHTML = renderPortraitTagWorld(q.item);
  }
  els.answerPanel.classList.add("is-shown");
  els.portraitTag.classList.add("is-shown");
}

function renderPortraitTagNorway(role) {
  const badge = partyBadgeNorway(role.party, "md");
  const name = escapeHtml(role.person.name);
  const partyLabel = role.party ? escapeHtml(partyNameNorway(role.party)) : "Uavhengig";
  return `${badge}<span class="tag-text">${name} · ${partyLabel}</span>`;
}
function renderPortraitTagWorld(item) {
  return `${flagBadgeHtml(item.country, "md")}<span class="tag-text">${escapeHtml(item.leader.name)} · ${escapeHtml(item.country.name)}</span>`;
}
function partyBadgeNorway(code, size = "sm") {
  const meta = code ? state.data?.parties?.[code] : null;
  const color = meta?.color || "#9a9a9a";
  const logo = meta?.logo || meta?.logoSource || "";
  const sizeClass = size === "md" ? "size-md" : size === "lg" ? "size-lg" : "size-sm";
  const title = escapeAttr(partyNameNorway(code));
  if (logo) {
    const label = shortPartyCode(code);
    return `<span class="party-badge has-logo ${sizeClass}" title="${title}"><img src="${escapeAttr(logo)}" alt="" loading="lazy" decoding="async" onerror="this.parentNode.classList.remove('has-logo');this.parentNode.style.background='${escapeAttr(color)}';this.parentNode.textContent='${escapeAttr(label)}';"></span>`;
  }
  const label = shortPartyCode(code);
  return `<span class="party-badge ${sizeClass}" style="background:${escapeAttr(color)}" title="${title}">${escapeHtml(label)}</span>`;
}
function shortPartyCode(code) {
  if (!code) return "?";
  const trimmed = String(code).replace(/\./g, "");
  return trimmed.length <= 3 ? trimmed : trimmed.slice(0, 2);
}

/* ── Preload ─────────────────────────────────────────────── */
function preloadUpcoming() {
  const candidates = state.items.filter(itemHasPortrait);
  shuffle(candidates).slice(0, 8).forEach((it) => {
    const url = it._kind === "no" ? it.person.image : it.image;
    if (url) preloadImage(url);
  });
}
function preloadImage(url) {
  if (!url || state.preloadCache.has(url)) return;
  state.preloadCache.set(url, false);
  const img = new Image();
  img.decoding = "async";
  img.referrerPolicy = "no-referrer";
  img.onload = () => state.preloadCache.set(url, true);
  img.onerror = () => state.preloadCache.set(url, false);
  img.src = url;
}

/* ── Profile + stats ─────────────────────────────────────── */
function updateProfile(correct, item) {
  const p = state.profile;
  p.played += 1;
  p.correct += correct ? 1 : 0;
  p.streak = correct ? p.streak + 1 : 0;
  p.bestStreak = Math.max(p.bestStreak, p.streak);
  p.byMode[state.mode] ||= { played: 0, correct: 0 };
  p.byMode[state.mode].played += 1;
  p.byMode[state.mode].correct += correct ? 1 : 0;
  const key = itemKey(item);
  p.mastery[key] ||= { seen: 0, correct: 0 };
  p.mastery[key].seen += 1;
  p.mastery[key].correct += correct ? 1 : 0;
  p.recent = [key, ...p.recent.filter((k) => k !== key)].slice(0, 40);

  p.currentRound ||= { played: 0, correct: 0 };
  p.currentRound.played += 1;
  p.currentRound.correct += correct ? 1 : 0;
  if (p.currentRound.played >= ROUND_SIZE) {
    p.roundHistory.push({ played: p.currentRound.played, correct: p.currentRound.correct });
    if (p.roundHistory.length > 30) p.roundHistory.shift();
    p.currentRound = { played: 0, correct: 0 };
  }
  saveProfile();
}

function renderStatsRail() {
  const { streak } = state.profile;
  if (els.railStreak && els.railStreakValue) {
    if (streak >= 2) {
      els.railStreak.hidden = false;
      els.railStreakValue.textContent = streak;
      paintIcons(els.railStreak);
    } else {
      els.railStreak.hidden = true;
    }
  }
}

function renderRoundProgress() {
  const r = state.profile?.currentRound || { played: 0, correct: 0 };
  const pct = Math.min(100, (r.played / ROUND_SIZE) * 100);
  els.roundFill.style.width = `${pct}%`;
  els.roundLabel.textContent = `${r.played + 1} / ${ROUND_SIZE}`;
}

function renderStatsView() {
  const { played, correct, bestStreak, byMode } = state.profile;
  els.statPlayed.textContent = played;
  els.statCorrect.textContent = correct;
  els.statAccuracyBig.textContent = played ? `${Math.round((correct / played) * 100)}%` : "0%";
  els.statBest.textContent = bestStreak;

  const rows = state.pack.modes.map((m) => {
    const s = byMode[m.id] || { played: 0, correct: 0 };
    const acc = s.played ? `${Math.round((s.correct / s.played) * 100)}%` : "—";
    return `<tr><td>${escapeHtml(m.label)}</td><td>${s.played}</td><td>${s.correct}</td><td>${acc}</td></tr>`;
  });
  els.modeTable.innerHTML = `
    <thead><tr><th>Modus</th><th>Spilt</th><th>Riktig</th><th>%</th></tr></thead>
    <tbody>${rows.join("")}</tbody>
  `;
  renderDataList();
}

function renderDataList() {
  if (!state.data || !els.dataList) return;
  if (state.packId === "no-ministers") {
    const currentRoles = state.items.filter((r) => r._kind === "no" && !r.end).length;
    els.dataList.innerHTML = `
      <li><span>Personer</span><strong>${state.data.stats.people}</strong></li>
      <li><span>Roller</span><strong>${state.data.stats.roles}</strong></li>
      <li><span>Bilder</span><strong>${state.data.stats.images}</strong></li>
      <li><span>Regjeringer</span><strong>${state.data.stats.governments}</strong></li>
      <li><span>Poster</span><strong>${state.data.stats.offices}</strong></li>
      <li><span>Nåværende</span><strong>${currentRoles}</strong></li>
    `;
  } else {
    els.dataList.innerHTML = `
      <li><span>Land</span><strong>${state.data.stats.countries}</strong></li>
      <li><span>Ledere</span><strong>${state.data.stats.leaders}</strong></li>
      <li><span>Med bilde</span><strong>${state.data.stats.images}</strong></li>
    `;
  }
}

function renderFootStats() {
  if (!state.data || !els.footStats) return;
  if (state.packId === "no-ministers") {
    const { people, roles, images, governments } = state.data.stats;
    els.footStats.textContent = `${people} personer · ${roles} roller · ${images} bilder · ${governments} regjeringer · oppdatert ${formatGenDate(state.data.generatedAt)}`;
  } else {
    const { countries, leaders, images } = state.data.stats;
    els.footStats.textContent = `${countries} land · ${leaders} ledere · ${images} bilder · oppdatert ${formatGenDate(state.data.generatedAt)}`;
  }
}

function formatGenDate(v) {
  if (!v) return "ukjent";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v.slice(0, 10);
  return new Intl.DateTimeFormat("nb-NO", { dateStyle: "medium" }).format(d);
}

/* ── Learn view ──────────────────────────────────────────── */
function renderLearn() {
  if (!state.data) return;
  if (state.packId === "no-ministers") renderLearnNorway();
  else renderLearnWorld();
}

function renderLearnNorway() {
  if (els.learnFilterA.dataset.pack !== "no-ministers") {
    els.learnFilterA.dataset.pack = "no-ministers";
    const codes = [...new Set(state.items.map((it) => it.party).filter(Boolean))].sort((a, b) =>
      partyNameNorway(a).localeCompare(partyNameNorway(b), "nb"),
    );
    els.learnFilterA.innerHTML = `<option value="all">Alle parti</option>${codes
      .map((c) => `<option value="${escapeAttr(c)}">${escapeHtml(partyNameNorway(c))}</option>`)
      .join("")}`;
    els.learnFilterB.innerHTML = state.pack.eras
      .map((e) => `<option value="${e.id}">${escapeHtml(e.label)}</option>`)
      .join("");
  }

  const query = normalize(els.learnSearch.value);
  const party = els.learnFilterA.value;
  const eraKey = els.learnFilterB.value;
  const people = state.data.people
    .filter((p) =>
      p.roles?.some((r) => passesNorwayEra({ ...r, person: p }, eraKey)),
    )
    .filter((p) => {
      if (party !== "all" && !p.roles.some((r) => r.party === party)) return false;
      if (!query) return true;
      const hay = normalize(
        [
          p.name,
          p.birthYear,
          p.birthDate,
          p.deathDate,
          ...p.roles.flatMap((r) => [r.title, r.party, r.government]),
        ]
          .filter(Boolean)
          .join(" "),
      );
      return hay.includes(query);
    })
    .sort((a, b) => (b.image ? 1 : 0) - (a.image ? 1 : 0) || a.name.localeCompare(b.name, "nb"));

  els.learnCount.textContent = `${people.length} treff`;
  els.learnGrid.innerHTML = people.slice(0, 240).map(personCardNorway).join("");
}

function personCardNorway(person) {
  const latest = [...(person.roles || [])].sort((a, b) => (b.start || "").localeCompare(a.start || ""))[0];
  const party = latest?.party;
  const media = person.image
    ? `<img src="${escapeAttr(person.image)}" alt="Portrett av ${escapeAttr(person.name)}" loading="lazy" decoding="async">`
    : `<div class="person-mini">${escapeHtml(initials(person.name))}</div>`;
  return `
    <article class="person">
      <div class="person-media">${media}</div>
      <div class="person-body">
        <h3>${escapeHtml(person.name)}</h3>
        <p>${escapeHtml(latest?.title || "Statsråd")}</p>
        <p>${escapeHtml(dateLabelNo(latest || {}))}</p>
        ${party ? `<span class="person-party">${partyBadgeNorway(party, "sm")}${escapeHtml(partyNameNorway(party))}</span>` : ""}
      </div>
    </article>
  `;
}

function renderLearnWorld() {
  if (els.learnFilterA.dataset.pack !== "world-leaders") {
    els.learnFilterA.dataset.pack = "world-leaders";
    const roles = [...new Set(state.items.map((i) => i.primaryRole))];
    els.learnFilterA.innerHTML = `<option value="all">Alle roller</option>${roles
      .map((r) => `<option value="${escapeAttr(r)}">${escapeHtml(WORLD_ROLE_LABELS_NO[r] || r)}</option>`)
      .join("")}`;
    els.learnFilterB.innerHTML = `
      <option value="all">Alle land</option>
      <option value="with-image">Med bilde</option>
      <option value="without-image">Uten bilde</option>
    `;
  }

  const query = normalize(els.learnSearch.value);
  const roleFilter = els.learnFilterA.value;
  const imgFilter = els.learnFilterB.value;

  const items = state.items
    .filter((i) => i._kind === "world")
    .filter((i) => (roleFilter === "all" ? true : i.primaryRole === roleFilter))
    .filter((i) => (imgFilter === "with-image" ? Boolean(i.image) : imgFilter === "without-image" ? !i.image : true))
    .filter((i) => {
      if (!query) return true;
      return normalize(`${i.leader.name} ${i.country.name} ${i.country.capital || ""}`).includes(query);
    })
    .sort((a, b) => (b.image ? 1 : 0) - (a.image ? 1 : 0) || a.country.name.localeCompare(b.country.name));

  els.learnCount.textContent = `${items.length} treff`;
  els.learnGrid.innerHTML = items.slice(0, 240).map(personCardWorld).join("");
}

function personCardWorld(item) {
  const media = item.image
    ? `<img src="${escapeAttr(item.image)}" alt="Bilde av ${escapeAttr(item.leader.name)}" loading="lazy" decoding="async">`
    : `<div class="person-mini">${escapeHtml(initials(item.leader.name))}</div>`;
  return `
    <article class="person">
      <div class="person-media">${media}</div>
      <div class="person-body">
        <h3>${escapeHtml(item.leader.name)}</h3>
        <p>${escapeHtml(WORLD_ROLE_LABELS_NO[item.primaryRole] || "Leder")}</p>
        <span class="person-party">${flagBadgeHtml(item.country, "sm")}${escapeHtml(item.country.name)}</span>
      </div>
    </article>
  `;
}

/* ── Profile persistence ─────────────────────────────────── */
function defaultProfile() {
  return {
    played: 0, correct: 0, streak: 0, bestStreak: 0,
    byMode: {}, mastery: {}, recent: [],
    currentRound: { played: 0, correct: 0 },
    roundHistory: [],
  };
}
function loadProfile(packId) {
  try {
    const merged = { ...defaultProfile(), ...JSON.parse(localStorage.getItem(profileKey(packId)) || "{}") };
    merged.currentRound ||= { played: 0, correct: 0 };
    merged.roundHistory ||= [];
    merged.byMode  ||= {};
    merged.mastery ||= {};
    merged.recent  ||= [];
    return merged;
  } catch {
    return defaultProfile();
  }
}
function saveProfile() {
  if (!state.packId) return;
  try {
    localStorage.setItem(profileKey(state.packId), JSON.stringify(state.profile));
  } catch {}
}

/* ── Toast + confetti ────────────────────────────────────── */
function showToast(msg, tone = "") {
  els.toast.textContent = msg;
  els.toast.hidden = false;
  els.toast.classList.remove("is-success", "is-fail", "is-shown");
  if (tone === "success") els.toast.classList.add("is-success");
  if (tone === "fail")    els.toast.classList.add("is-fail");
  void els.toast.offsetWidth;
  els.toast.classList.add("is-shown");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => {
    els.toast.classList.remove("is-shown");
    setTimeout(() => (els.toast.hidden = true), 280);
  }, 1900);
}

function showConfetti() {
  const colors = ["#ff5d8f", "#ffd55a", "#5ce5b8", "#6aa5ff", "#a988ff"];
  const N = 36;
  const frag = document.createDocumentFragment();
  for (let i = 0; i < N; i += 1) {
    const piece = document.createElement("span");
    piece.className = "confetti-piece";
    piece.style.setProperty("--c", colors[i % colors.length]);
    piece.style.setProperty("--x", `${(Math.random() - 0.5) * 100}vw`);
    piece.style.setProperty("--rot", `${Math.random() * 720 - 360}deg`);
    piece.style.setProperty("--delay", `${Math.random() * 200}ms`);
    piece.style.setProperty("--dur", `${900 + Math.random() * 700}ms`);
    frag.appendChild(piece);
  }
  els.confetti.innerHTML = "";
  els.confetti.appendChild(frag);
  setTimeout(() => { els.confetti.innerHTML = ""; }, 1800);
}

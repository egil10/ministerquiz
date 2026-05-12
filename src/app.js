const MODES = {
  portrait: {
    label: "Portrett",
    badge: "Portrett",
    help: "Bilde → person",
  },
  office: {
    label: "Posten",
    badge: "Ministerpost",
    help: "Person → ministerpost",
  },
  party: {
    label: "Parti",
    badge: "Parti",
    help: "Person → parti",
  },
  government: {
    label: "Regjering",
    badge: "Regjering",
    help: "Rolle → regjering",
  },
  timeline: {
    label: "Tiår",
    badge: "Tiår",
    help: "Når startet rollen?",
  },
};

const ERAS = {
  all: { label: "Alle år" },
  current: { label: "Siste 25 år" },
  postwar: { label: "1945 →" },
  interwar: { label: "1905–1945" },
  union: { label: "1814–1905" },
};

const STORE_KEY = "ministerquiz.profile.v2";
const ROUND_SIZE = 10;

const state = {
  data: null,
  people: [],
  roles: [],
  mode: "portrait",
  era: "all",
  view: "play",
  current: null,
  answered: false,
  preloadCache: new Map(),
  profile: loadProfile(),
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const els = {
  modeList: $("#modeList"),
  eraSelect: $("#eraSelect"),
  choices: $("#choices"),
  portrait: $(".portrait"),
  portraitImg: $("#portraitImg"),
  portraitFallback: $("#portraitFallback"),
  portraitTag: $("#portraitTag"),
  questionText: $("#questionText"),
  questionHint: $("#questionHint"),
  badgeMode: $("#badgeMode"),
  badgeYear: $("#badgeYear"),
  badgeGov: $("#badgeGov"),
  badgeGovSep: $("#badgeGovSep"),
  answerPanel: $("#answerPanel"),
  answerKicker: $("#answerKicker"),
  answerTitle: $("#answerTitle"),
  answerDetail: $("#answerDetail"),
  answerLinks: $("#answerLinks"),
  nextBtn: $("#nextBtn"),
  statStreak: $("#statStreak"),
  statScore: $("#statScore"),
  statAccuracy: $("#statAccuracy"),
  roundFill: $("#roundFill"),
  roundLabel: $("#roundLabel"),
  playView: $("#playView"),
  learnView: $("#learnView"),
  statsView: $("#statsView"),
  learnSearch: $("#learnSearch"),
  partyFilter: $("#partyFilter"),
  learnEra: $("#learnEra"),
  learnCount: $("#learnCount"),
  learnGrid: $("#learnGrid"),
  statPlayed: $("#statPlayed"),
  statCorrect: $("#statCorrect"),
  statAccuracyBig: $("#statAccuracyBig"),
  statBest: $("#statBest"),
  modeTable: $("#modeTable"),
  dataList: $("#dataList"),
  resetProgress: $("#resetProgress"),
  toast: $("#toast"),
  viewTabs: $$(".view-tab"),
};

init().catch((error) => {
  console.error(error);
  els.questionText.textContent = "Kunne ikke laste data.";
  els.questionHint.textContent =
    "Sjekk at appen kjøres via en server (Vercel eller `npm run dev`).";
});

async function init() {
  const res = await fetch("/data/ministers.json", { cache: "force-cache" });
  if (!res.ok) throw new Error(`Datafetch feilet: ${res.status}`);
  const data = await res.json();
  state.data = data;
  state.people = data.people;
  state.roles = data.people.flatMap((person) =>
    (person.roles || []).map((role) => ({
      ...role,
      person,
      partyMeta: data.parties[role.party] || { name: role.party || "Ukjent", color: "#8a94c2" },
    })),
  );

  buildModeChips();
  buildEraSelect();
  buildPartyFilter();
  bindEvents();
  renderStats();
  renderRoundProgress();
  renderDataPanel();
  nextQuestion();
}

function bindEvents() {
  els.nextBtn.addEventListener("click", nextQuestion);
  els.resetProgress.addEventListener("click", () => {
    if (!confirm("Nullstille all progresjon?")) return;
    state.profile = defaultProfile();
    saveProfile();
    renderStats();
    renderRoundProgress();
    showToast("Progresjon nullstilt");
  });

  els.viewTabs.forEach((tab) => {
    tab.addEventListener("click", () => switchView(tab.dataset.view));
  });

  els.learnSearch.addEventListener("input", renderLearn);
  els.partyFilter.addEventListener("change", renderLearn);
  els.learnEra.addEventListener("change", renderLearn);

  els.portraitImg.addEventListener("load", () => {
    els.portraitImg.classList.add("is-ready");
    els.portrait.classList.add("is-loaded");
  });
  els.portraitImg.addEventListener("error", () => {
    els.portrait.classList.remove("is-loaded");
    els.portraitImg.classList.remove("is-ready");
    setFallback(state.current?.role?.person?.name);
  });

  window.addEventListener("keydown", (event) => {
    if (state.view !== "play") return;
    const target = event.target;
    if (target && (target.tagName === "INPUT" || target.tagName === "SELECT" || target.tagName === "TEXTAREA")) return;
    if (event.key === "Enter" && state.answered) {
      event.preventDefault();
      nextQuestion();
      return;
    }
    const index = Number(event.key) - 1;
    if (!state.answered && index >= 0 && index < 4) {
      els.choices.querySelectorAll(".choice")[index]?.click();
    }
  });
}

function switchView(view) {
  state.view = view;
  els.viewTabs.forEach((tab) => tab.classList.toggle("is-active", tab.dataset.view === view));
  els.playView.hidden = view !== "play";
  els.learnView.hidden = view !== "learn";
  els.statsView.hidden = view !== "stats";
  if (view === "learn") renderLearn();
  if (view === "stats") renderStatsView();
}

function buildModeChips() {
  els.modeList.innerHTML = Object.entries(MODES)
    .map(
      ([key, mode]) => `
        <button class="chip ${key === state.mode ? "is-active" : ""}" type="button" data-mode="${key}" title="${escapeAttr(mode.help)}">
          ${escapeHtml(mode.label)}
        </button>
      `,
    )
    .join("");
  els.modeList.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      state.mode = button.dataset.mode;
      els.modeList.querySelectorAll("button").forEach((b) => b.classList.toggle("is-active", b === button));
      nextQuestion();
    });
  });
}

function buildEraSelect() {
  if (!els.eraSelect) return;
  els.eraSelect.value = state.era;
  els.eraSelect.addEventListener("change", () => {
    state.era = els.eraSelect.value;
    nextQuestion();
  });
}

function buildPartyFilter() {
  const codes = [...new Set(state.roles.map((role) => role.party).filter(Boolean))].sort((a, b) =>
    partyName(a).localeCompare(partyName(b), "nb"),
  );
  els.partyFilter.innerHTML += codes
    .map(
      (code) =>
        `<option value="${escapeAttr(code)}">${escapeHtml(partyName(code))} (${escapeHtml(code)})</option>`,
    )
    .join("");
}

/* ── Quiz logic ──────────────────────────────────────────── */

function nextQuestion() {
  state.answered = false;
  els.answerPanel.hidden = true;
  els.answerPanel.classList.remove("is-right", "is-wrong");

  const role = pickRole();
  const question = buildQuestion(role);
  state.current = question;
  renderQuestion(question);
  preloadUpcoming();
}

function pickRole() {
  const pool = filteredRoles().filter(roleAskable);
  const fallback = state.roles.filter(roleAskable);
  const universe = pool.length ? pool : fallback;
  if (!universe.length) return state.roles[0];

  const imageMode = state.mode === "portrait";
  const weighted = universe.map((role) => {
    const seen = state.profile.mastery[role.personId]?.seen || 0;
    const correct = state.profile.mastery[role.personId]?.correct || 0;
    const weakness = 1 + Math.max(0, seen - correct) * 0.6;
    const image = role.person.image ? (imageMode ? 1.8 : 1.1) : imageMode ? 0.1 : 1;
    const recent = state.profile.recent.includes(role.id) ? 0.18 : 1;
    return { role, weight: weakness * image * recent };
  });
  const total = weighted.reduce((sum, item) => sum + item.weight, 0);
  let cursor = Math.random() * total;
  for (const item of weighted) {
    cursor -= item.weight;
    if (cursor <= 0) return item.role;
  }
  return weighted[0].role;
}

function buildQuestion(role) {
  const mode = state.mode;
  const dates = dateLabel(role);

  if (mode === "portrait") {
    return {
      role,
      mode,
      correct: role.person.name,
      choices: choiceSet(role.person.name, state.people.map((person) => person.name)),
      prompt: "Hvem er dette?",
      hint: `${role.title}${role.government ? ` · ${role.government}` : ""} · ${dates}.`,
    };
  }
  if (mode === "office") {
    return {
      role,
      mode,
      correct: role.title,
      choices: choiceSet(role.title, state.data.offices),
      prompt: `Hva var ${role.person.name} sin post?`,
      hint: `${dates}${role.government ? ` · ${role.government}` : ""}`,
    };
  }
  if (mode === "party") {
    return {
      role,
      mode,
      correct: role.party || "Ukjent",
      choices: choiceSet(role.party || "Ukjent", partyChoices()),
      prompt: `Parti til ${role.person.name}?`,
      hint: `${role.title} · ${dates}${role.government ? ` · ${role.government}` : ""}`,
      formatChoice: (value) =>
        value === "Ukjent" ? value : `${partyName(value)} (${value})`,
    };
  }
  if (mode === "government") {
    return {
      role,
      mode,
      correct: role.government || "Ukjent regjering",
      choices: choiceSet(role.government || "Ukjent regjering", state.data.governments),
      prompt: "Hvilken regjering?",
      hint: `${role.person.name} · ${role.title} · ${dates}`,
    };
  }
  const decade = `${Math.floor(startYear(role) / 10) * 10}-tallet`;
  return {
    role,
    mode,
    correct: decade,
    choices: choiceSet(decade, decadeChoices()),
    prompt: "Når startet denne rollen?",
    hint: `${role.person.name} som ${role.title}${role.government ? ` i ${role.government}` : ""}.`,
  };
}

function renderQuestion(question) {
  const { role } = question;
  const mode = MODES[question.mode];
  els.badgeMode.textContent = mode.badge;
  els.badgeYear.textContent = dateLabel(role);
  if (role.government) {
    els.badgeGov.textContent = role.government;
    els.badgeGov.hidden = false;
    if (els.badgeGovSep) els.badgeGovSep.hidden = false;
  } else {
    els.badgeGov.hidden = true;
    if (els.badgeGovSep) els.badgeGovSep.hidden = true;
  }
  els.questionText.textContent = question.prompt;
  els.questionHint.textContent = question.hint;

  renderPortrait(role.person);
  renderChoices(question);
}

function renderPortrait(person) {
  els.portrait.classList.remove("is-loaded");
  els.portraitImg.classList.remove("is-ready");
  els.portraitImg.alt = person.image ? `Portrett av ${person.name}` : "";
  els.portraitFallback.textContent = initials(person.name);
  els.portraitTag.innerHTML = "";
  els.portraitTag.classList.remove("is-shown");

  if (person.image) {
    if (state.preloadCache.get(person.image) === true) {
      els.portraitImg.src = person.image;
      // load event will still fire even if cached
    } else {
      els.portraitImg.src = person.image;
    }
  } else {
    els.portraitImg.removeAttribute("src");
    setFallback(person.name);
  }
}

function setFallback(name) {
  els.portrait.classList.remove("is-loaded");
  els.portraitImg.classList.remove("is-ready");
  if (name) els.portraitFallback.textContent = initials(name);
}

function renderChoices(question) {
  els.choices.innerHTML = "";
  question.choices.forEach((choice, index) => {
    const button = document.createElement("button");
    button.className = "choice";
    button.type = "button";
    button.dataset.value = choice;
    const text = question.formatChoice ? question.formatChoice(choice) : choice;
    button.innerHTML = `
      <span class="choice-key">${index + 1}</span>
      <span class="choice-text">${escapeHtml(text)}</span>
      <svg class="choice-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"></svg>
    `;
    button.addEventListener("click", () => onAnswer(button, choice));
    els.choices.appendChild(button);
  });
}

function onAnswer(button, value) {
  if (state.answered) return;
  state.answered = true;
  const current = state.current;
  const correct = value === current.correct;

  const buttons = els.choices.querySelectorAll(".choice");
  buttons.forEach((b) => {
    b.disabled = true;
    if (b.dataset.value === current.correct) {
      b.classList.add("is-correct");
      setIcon(b.querySelector(".choice-icon"), "check");
    } else if (b === button && !correct) {
      b.classList.add("is-wrong", "is-shake");
      setIcon(b.querySelector(".choice-icon"), "cross");
    } else {
      b.classList.add("is-dim");
    }
  });

  updateProfile(correct, current.role);
  renderAnswer(correct, current.role);
  renderStats({ pop: correct ? "score" : "" });
  renderRoundProgress({ pop: true });

  if (state.profile.played > 0 && state.profile.played % ROUND_SIZE === 0) {
    const lastRound = state.profile.roundHistory[state.profile.roundHistory.length - 1];
    if (lastRound && lastRound.correct >= ROUND_SIZE) {
      showToast(`Perfekt runde · ${lastRound.correct}/${ROUND_SIZE}`, "success");
    } else if (lastRound) {
      const tone = lastRound.correct >= 7 ? "success" : "";
      showToast(`Runde ferdig · ${lastRound.correct}/${ROUND_SIZE}`, tone);
    }
  } else if (correct && state.profile.streak > 0 && state.profile.streak % 5 === 0) {
    showToast(`${state.profile.streak} på rad! 🔥`, "success");
  }
}

function setIcon(svg, kind) {
  if (!svg) return;
  if (kind === "check") {
    svg.innerHTML = '<polyline points="4 12 10 18 20 6"></polyline>';
  } else {
    svg.innerHTML = '<line x1="6" y1="6" x2="18" y2="18"></line><line x1="18" y1="6" x2="6" y2="18"></line>';
  }
}

function renderAnswer(correct, role) {
  const person = role.person;
  const partyText = role.party ? `${partyName(role.party)} (${role.party})` : "parti ikke oppgitt";
  els.answerPanel.classList.toggle("is-right", correct);
  els.answerPanel.classList.toggle("is-wrong", !correct);
  els.answerKicker.textContent = correct ? "Riktig" : "Ikke helt";
  els.answerTitle.textContent = `${person.name} · ${role.title}`;
  els.answerDetail.textContent = `${partyText}. ${dateLabel(role)}${role.government ? ` · ${role.government}` : ""}.`;

  const links = [];
  if (person.wikipedia) links.push(`<a href="${escapeAttr(person.wikipedia)}" target="_blank" rel="noopener">Wikipedia ↗</a>`);
  if (person.source) links.push(`<a href="${escapeAttr(person.source)}" target="_blank" rel="noopener">Regjeringen.no ↗</a>`);
  els.answerLinks.innerHTML = links.join("");

  els.answerPanel.hidden = false;

  // Portrait tag fades in with answer
  els.portraitTag.innerHTML = renderPortraitTag(role);
  els.portraitTag.classList.add("is-shown");
}

function renderPortraitTag(role) {
  const badge = partyBadge(role.party, "md");
  const name = escapeHtml(role.person.name);
  const partyLabel = role.party ? escapeHtml(partyName(role.party)) : "Uavhengig";
  return `${badge}<span class="tag-text">${name} · ${partyLabel}</span>`;
}

function partyBadge(code, size = "sm") {
  const meta = code ? state.data?.parties?.[code] : null;
  const color = meta?.color || "#9a9a9a";
  const logo = meta?.logo || meta?.logoSource || "";
  const sizeClass = size === "md" ? "size-md" : size === "lg" ? "size-lg" : "size-sm";
  const title = escapeAttr(partyName(code));
  if (logo) {
    return `<span class="party-badge has-logo ${sizeClass}" title="${title}"><img src="${escapeAttr(logo)}" alt="" loading="lazy" decoding="async" onerror="this.parentNode.classList.remove('has-logo');this.parentNode.style.background='${escapeAttr(color)}';this.parentNode.textContent='${escapeAttr(shortPartyCode(code))}';"></span>`;
  }
  const label = shortPartyCode(code);
  return `<span class="party-badge ${sizeClass}" style="background:${escapeAttr(color)}" title="${title}">${escapeHtml(label)}</span>`;
}

function shortPartyCode(code) {
  if (!code) return "?";
  const trimmed = String(code).replace(/\./g, "");
  if (trimmed.length <= 3) return trimmed;
  return trimmed.slice(0, 2);
}

function preloadUpcoming() {
  // Best-effort: preload the next 3 candidate portraits so swaps are instant.
  const candidates = filteredRoles().filter((role) => role.person.image).slice(0, 50);
  shuffle(candidates)
    .slice(0, 3)
    .forEach((role) => preloadImage(role.person.image));
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

function updateProfile(correct, role) {
  const profile = state.profile;
  profile.played += 1;
  profile.correct += correct ? 1 : 0;
  profile.streak = correct ? profile.streak + 1 : 0;
  profile.bestStreak = Math.max(profile.bestStreak, profile.streak);
  profile.byMode[state.mode] ||= { played: 0, correct: 0 };
  profile.byMode[state.mode].played += 1;
  profile.byMode[state.mode].correct += correct ? 1 : 0;
  profile.mastery[role.personId] ||= { seen: 0, correct: 0 };
  profile.mastery[role.personId].seen += 1;
  profile.mastery[role.personId].correct += correct ? 1 : 0;
  profile.recent = [role.id, ...profile.recent.filter((id) => id !== role.id)].slice(0, 40);

  profile.currentRound ||= { played: 0, correct: 0 };
  profile.currentRound.played += 1;
  profile.currentRound.correct += correct ? 1 : 0;
  if (profile.currentRound.played >= ROUND_SIZE) {
    profile.roundHistory.push({ played: profile.currentRound.played, correct: profile.currentRound.correct });
    if (profile.roundHistory.length > 30) profile.roundHistory.shift();
    profile.currentRound = { played: 0, correct: 0 };
  }
  saveProfile();
}

function renderStats(options = {}) {
  const { played, correct, streak } = state.profile;
  setStat(els.statStreak, streak);
  setStat(els.statScore, correct, options.pop === "score");
  els.statAccuracy.textContent = played ? `${Math.round((correct / played) * 100)}%` : "0%";
}

function setStat(el, value, pop = false) {
  const previous = el.textContent;
  el.textContent = value;
  if (pop && String(value) !== previous) {
    const parent = el.closest(".hero-stat");
    if (!parent) return;
    parent.classList.add("is-pop");
    setTimeout(() => parent.classList.remove("is-pop"), 320);
  }
}

function renderRoundProgress(options = {}) {
  const round = state.profile.currentRound || { played: 0, correct: 0 };
  const pct = Math.min(100, (round.played / ROUND_SIZE) * 100);
  els.roundFill.style.width = `${pct}%`;
  els.roundLabel.textContent = `${round.played} / ${ROUND_SIZE}`;
  if (options.pop) {
    els.roundFill.parentElement.animate(
      [{ transform: "scale(1)" }, { transform: "scale(1.03)" }, { transform: "scale(1)" }],
      { duration: 240, easing: "ease-out" },
    );
  }
}

function renderStatsView() {
  const { played, correct, bestStreak, byMode } = state.profile;
  els.statPlayed.textContent = played;
  els.statCorrect.textContent = correct;
  els.statAccuracyBig.textContent = played ? `${Math.round((correct / played) * 100)}%` : "0%";
  els.statBest.textContent = bestStreak;

  const rows = Object.entries(MODES).map(([key, mode]) => {
    const stats = byMode[key] || { played: 0, correct: 0 };
    const acc = stats.played ? `${Math.round((stats.correct / stats.played) * 100)}%` : "—";
    return `<tr><td>${escapeHtml(mode.label)}</td><td>${stats.played}</td><td>${stats.correct}</td><td>${acc}</td></tr>`;
  });
  els.modeTable.innerHTML = `
    <thead><tr><th>Modus</th><th>Spilt</th><th>Riktig</th><th>%</th></tr></thead>
    <tbody>${rows.join("")}</tbody>
  `;

  renderDataPanel();
}

function renderDataPanel() {
  if (!state.data) return;
  const currentRoles = state.roles.filter((role) => !role.end).length;
  els.dataList.innerHTML = `
    <li><span>Personer</span><strong>${state.data.stats.people}</strong></li>
    <li><span>Roller</span><strong>${state.data.stats.roles}</strong></li>
    <li><span>Bilder</span><strong>${state.data.stats.images}</strong></li>
    <li><span>Regjeringer</span><strong>${state.data.stats.governments}</strong></li>
    <li><span>Poster</span><strong>${state.data.stats.offices}</strong></li>
    <li><span>Nåværende roller</span><strong>${currentRoles}</strong></li>
    <li><span>Generert</span><strong>${escapeHtml(formatGeneratedDate(state.data.generatedAt))}</strong></li>
  `;
}

/* ── Learn view ──────────────────────────────────────────── */

function renderLearn() {
  if (!state.data) return;
  const query = normalize(els.learnSearch.value);
  const party = els.partyFilter.value;
  const eraKey = els.learnEra.value;
  const filtered = state.people
    .filter((person) => person.roles?.some((role) => rolePassesEra({ ...role, person }, eraKey)))
    .filter((person) => {
      if (party !== "all" && !person.roles.some((role) => role.party === party)) return false;
      if (!query) return true;
      const haystack = normalize(
        [
          person.name,
          person.birthYear,
          person.birthDate,
          person.deathDate,
          ...person.roles.flatMap((role) => [role.title, role.party, role.government]),
        ]
          .filter(Boolean)
          .join(" "),
      );
      return haystack.includes(query);
    })
    .sort((a, b) => (b.image ? 1 : 0) - (a.image ? 1 : 0) || a.name.localeCompare(b.name, "nb"));

  els.learnCount.textContent = `${filtered.length} treff`;
  els.learnGrid.innerHTML = filtered.slice(0, 240).map(renderPersonCard).join("");
}

function renderPersonCard(person) {
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
        <p>${escapeHtml(dateLabel(latest || {}))}</p>
        ${party ? `<span class="person-party">${partyBadge(party, "sm")}${escapeHtml(partyName(party))}</span>` : ""}
      </div>
    </article>
  `;
}

/* ── Helpers ─────────────────────────────────────────────── */

function filteredRoles() {
  return state.roles.filter((role) => rolePassesEra(role, state.era));
}

function roleAskable(role) {
  if (!role.title || !role.start) return false;
  if (state.mode === "portrait") return Boolean(role.person.image);
  if (state.mode === "party") return Boolean(role.party);
  return true;
}

function rolePassesEra(role, eraKey) {
  const year = startYear(role);
  if (!year) return true;
  if (eraKey === "current") return year >= new Date().getFullYear() - 25;
  if (eraKey === "postwar") return year >= 1945;
  if (eraKey === "interwar") return year >= 1905 && year < 1945;
  if (eraKey === "union") return year < 1905;
  return true;
}

function choiceSet(correct, universe) {
  const options = new Set([correct]);
  const clean = [...new Set(universe.filter(Boolean).filter((item) => item !== correct))];
  while (options.size < 4 && clean.length) {
    const index = Math.floor(Math.random() * clean.length);
    options.add(clean.splice(index, 1)[0]);
  }
  return shuffle([...options]);
}

function partyChoices() {
  const codes = Object.keys(state.data.parties).filter((code) =>
    state.roles.some((role) => role.party === code),
  );
  return [...codes, "Ukjent"];
}

function decadeChoices() {
  const decades = new Set(state.roles.map((role) => `${Math.floor(startYear(role) / 10) * 10}-tallet`));
  return [...decades].filter((item) => !item.startsWith("NaN"));
}

function startYear(role) {
  return Number(String(role.start || "").slice(0, 4));
}

function dateLabel(role) {
  if (!role?.start && !role?.end) return "ukjent år";
  const start = formatDate(role.start);
  const end = role.end ? formatDate(role.end) : "nå";
  return `${start}–${end}`;
}

function formatDate(value) {
  if (!value) return "";
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}.${month}.${year}` : value;
}

function formatGeneratedDate(value) {
  if (!value) return "ukjent";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return new Intl.DateTimeFormat("nb-NO", { dateStyle: "medium" }).format(date);
}

function partyName(code) {
  return state.data?.parties?.[code]?.name || code || "Ukjent";
}

function initials(name) {
  return String(name || "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function normalize(value) {
  return String(value || "")
    .toLocaleLowerCase("nb")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}

function showToast(message, tone = "") {
  els.toast.textContent = message;
  els.toast.hidden = false;
  els.toast.classList.remove("is-success", "is-fail", "is-shown");
  if (tone === "success") els.toast.classList.add("is-success");
  if (tone === "fail") els.toast.classList.add("is-fail");
  // force reflow to retrigger transition
  void els.toast.offsetWidth;
  els.toast.classList.add("is-shown");
  clearTimeout(showToast._timeout);
  showToast._timeout = setTimeout(() => {
    els.toast.classList.remove("is-shown");
    setTimeout(() => (els.toast.hidden = true), 280);
  }, 2200);
}

function defaultProfile() {
  return {
    played: 0,
    correct: 0,
    streak: 0,
    bestStreak: 0,
    byMode: {},
    mastery: {},
    recent: [],
    currentRound: { played: 0, correct: 0 },
    roundHistory: [],
  };
}

function loadProfile() {
  try {
    const merged = { ...defaultProfile(), ...JSON.parse(localStorage.getItem(STORE_KEY) || "{}") };
    merged.currentRound ||= { played: 0, correct: 0 };
    merged.roundHistory ||= [];
    merged.byMode ||= {};
    merged.mastery ||= {};
    merged.recent ||= [];
    return merged;
  } catch {
    return defaultProfile();
  }
}

function saveProfile() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state.profile));
  } catch {
    /* storage may be unavailable in some sandboxes */
  }
}

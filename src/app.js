const MODES = {
  portrait: {
    label: "Portrett",
    help: "Gjett personen fra bilde og spor.",
    badge: "Portrett",
  },
  office: {
    label: "Posten",
    help: "Koble statsråd til ministerpost.",
    badge: "Ministerpost",
  },
  party: {
    label: "Parti",
    help: "Hvilket parti satt statsråden for?",
    badge: "Parti",
  },
  government: {
    label: "Regjering",
    help: "Plasser rollen i riktig regjering.",
    badge: "Regjering",
  },
  timeline: {
    label: "Tiår",
    help: "Finn når rollen startet.",
    badge: "Tidslinje",
  },
};

const STORE_KEY = "ministerquiz.progress.v1";
const state = {
  data: null,
  people: [],
  roles: [],
  mode: "portrait",
  era: "all",
  view: "play",
  current: null,
  answered: false,
  profile: loadProfile(),
};

const els = {
  modeList: document.querySelector("#modeList"),
  eraFilter: document.querySelector("#eraFilter"),
  choices: document.querySelector("#choices"),
  portrait: document.querySelector("#portrait"),
  portraitFrame: document.querySelector(".portrait-frame"),
  portraitFallback: document.querySelector("#portraitFallback"),
  questionText: document.querySelector("#questionText"),
  questionHint: document.querySelector("#questionHint"),
  modeBadge: document.querySelector("#modeBadge"),
  yearBadge: document.querySelector("#yearBadge"),
  answerPanel: document.querySelector("#answerPanel"),
  answerKicker: document.querySelector("#answerKicker"),
  answerTitle: document.querySelector("#answerTitle"),
  answerDetail: document.querySelector("#answerDetail"),
  nextQuestion: document.querySelector("#nextQuestion"),
  playedStat: document.querySelector("#playedStat"),
  accuracyStat: document.querySelector("#accuracyStat"),
  streakStat: document.querySelector("#streakStat"),
  peopleStat: document.querySelector("#peopleStat"),
  rolesStat: document.querySelector("#rolesStat"),
  imagesStat: document.querySelector("#imagesStat"),
  currentStat: document.querySelector("#currentStat"),
  sourceStat: document.querySelector("#sourceStat"),
  factOffice: document.querySelector("#factOffice"),
  factParty: document.querySelector("#factParty"),
  factGovernment: document.querySelector("#factGovernment"),
  factLife: document.querySelector("#factLife"),
  resetProgress: document.querySelector("#resetProgress"),
  learnView: document.querySelector("#learnView"),
  playView: document.querySelector("#playView"),
  learnSearch: document.querySelector("#learnSearch"),
  partyFilter: document.querySelector("#partyFilter"),
  learnCount: document.querySelector("#learnCount"),
  learnGrid: document.querySelector("#learnGrid"),
};

init().catch((error) => {
  console.error(error);
  els.questionText.textContent = "Kunne ikke laste data.";
  els.questionHint.textContent = "Sjekk at appen kjøres via en lokal server eller Vercel.";
});

async function init() {
  const response = await fetch("/data/ministers.json");
  const data = await response.json();
  state.data = data;
  state.people = data.people;
  state.roles = data.people.flatMap((person) =>
    person.roles.map((role) => ({
      ...role,
      person,
      partyMeta: data.parties[role.party] || { name: role.party || "Ukjent", color: "#64748b" },
    }))
  );
  buildModeButtons();
  buildPartyFilter();
  bindEvents();
  renderStats();
  nextQuestion();
  renderLearn();
}

function bindEvents() {
  els.eraFilter.addEventListener("change", () => {
    state.era = els.eraFilter.value;
    nextQuestion();
    renderLearn();
  });
  els.nextQuestion.addEventListener("click", nextQuestion);
  els.resetProgress.addEventListener("click", () => {
    state.profile = defaultProfile();
    saveProfile();
    renderStats();
  });
  document.querySelectorAll(".view-tab").forEach((button) => {
    button.addEventListener("click", () => {
      state.view = button.dataset.view;
      document.querySelectorAll(".view-tab").forEach((tab) => tab.classList.toggle("active", tab === button));
      els.playView.hidden = state.view !== "play";
      els.learnView.hidden = state.view !== "learn";
      if (state.view === "learn") renderLearn();
    });
  });
  els.learnSearch.addEventListener("input", renderLearn);
  els.partyFilter.addEventListener("change", renderLearn);
  els.portrait.addEventListener("error", () => showFallback(state.current?.role?.person?.name || ""));
  window.addEventListener("keydown", (event) => {
    if (state.view !== "play") return;
    if (event.key === "Enter" && state.answered) nextQuestion();
    const index = Number(event.key) - 1;
    if (!state.answered && index >= 0 && index < 4) {
      els.choices.querySelectorAll(".choice")[index]?.click();
    }
  });
}

function buildModeButtons() {
  els.modeList.innerHTML = Object.entries(MODES)
    .map(
      ([key, mode]) => `
        <button class="mode-button ${key === state.mode ? "active" : ""}" type="button" data-mode="${key}">
          <strong>${mode.label}</strong>
          <span>${mode.help}</span>
        </button>
      `
    )
    .join("");
  els.modeList.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      state.mode = button.dataset.mode;
      els.modeList.querySelectorAll("button").forEach((item) =>
        item.classList.toggle("active", item === button)
      );
      nextQuestion();
    });
  });
}

function buildPartyFilter() {
  const codes = [...new Set(state.roles.map((role) => role.party).filter(Boolean))].sort();
  els.partyFilter.innerHTML += codes
    .map((code) => `<option value="${escapeHtml(code)}">${escapeHtml(partyName(code))} (${escapeHtml(code)})</option>`)
    .join("");
}

function nextQuestion() {
  state.answered = false;
  els.answerPanel.hidden = true;
  const role = pickRole();
  const current = buildQuestion(role);
  state.current = current;
  renderQuestion(current);
}

function pickRole() {
  const roles = filteredRoles().filter(roleCanBeAsked);
  const pool = roles.length ? roles : state.roles;
  const imageBoost = state.mode === "portrait";
  const weighted = pool.map((role) => {
    const seen = state.profile.mastery[role.personId]?.seen || 0;
    const correct = state.profile.mastery[role.personId]?.correct || 0;
    const weakness = 1 + Math.max(0, seen - correct);
    const image = role.person.image ? 1.8 : imageBoost ? 0.45 : 1;
    const recent = state.profile.recent.includes(role.id) ? 0.25 : 1;
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
  if (mode === "portrait") {
    return {
      role,
      correct: role.person.name,
      choices: choiceSet(role.person.name, state.people.map((person) => person.name)),
      prompt: "Hvem er dette?",
      hint: `${role.title}${role.government ? ` i ${role.government}` : ""}, ${dateRange(role)}.`,
    };
  }
  if (mode === "office") {
    return {
      role,
      correct: role.title,
      choices: choiceSet(role.title, state.data.offices),
      prompt: `Hvilken post hadde ${role.person.name}?`,
      hint: `${dateRange(role)}${role.government ? ` · ${role.government}` : ""}`,
    };
  }
  if (mode === "party") {
    return {
      role,
      correct: role.party || "Ukjent",
      choices: choiceSet(role.party || "Ukjent", partyChoices()),
      prompt: `Hvilket parti representerte ${role.person.name}?`,
      hint: `${role.title}, ${dateRange(role)}${role.government ? ` · ${role.government}` : ""}`,
      formatChoice: (value) => (value === "Ukjent" ? value : `${partyName(value)} (${value})`),
    };
  }
  if (mode === "government") {
    return {
      role,
      correct: role.government || "Ukjent regjering",
      choices: choiceSet(role.government || "Ukjent regjering", state.data.governments),
      prompt: `Hvilken regjering passer?`,
      hint: `${role.person.name} · ${role.title} · ${dateRange(role)}`,
    };
  }
  const decade = `${Math.floor(startYear(role) / 10) * 10}-tallet`;
  return {
    role,
    correct: decade,
    choices: choiceSet(decade, decadeChoices()),
    prompt: `Når startet denne rollen?`,
    hint: `${role.person.name} som ${role.title}${role.government ? ` i ${role.government}` : ""}.`,
  };
}

function renderQuestion(question) {
  const { role } = question;
  const mode = MODES[state.mode];
  els.modeBadge.textContent = mode.badge;
  els.yearBadge.textContent = dateRange(role);
  els.questionText.textContent = question.prompt;
  els.questionHint.textContent = question.hint;
  renderPortrait(role.person);
  renderChoices(question);
  renderFacts(role);
}

function renderPortrait(person) {
  els.portrait.alt = person.image ? `Portrett av ${person.name}` : "";
  if (person.image) {
    els.portraitFrame.classList.remove("is-empty");
    els.portrait.src = person.image;
  } else {
    els.portrait.removeAttribute("src");
    showFallback(person.name);
  }
}

function showFallback(name) {
  els.portraitFrame.classList.add("is-empty");
  els.portraitFallback.textContent = initials(name);
}

function renderChoices(question) {
  els.choices.innerHTML = "";
  question.choices.forEach((choice, index) => {
    const button = document.createElement("button");
    button.className = "choice";
    button.type = "button";
    button.dataset.value = choice;
    button.innerHTML = `<span>${escapeHtml(question.formatChoice ? question.formatChoice(choice) : choice)}</span><small>${index + 1}</small>`;
    button.addEventListener("click", () => answer(choice));
    els.choices.append(button);
  });
}

function answer(choice) {
  if (state.answered) return;
  state.answered = true;
  const current = state.current;
  const correct = choice === current.correct;
  els.choices.querySelectorAll(".choice").forEach((button) => {
    const value = button.dataset.value;
    button.classList.toggle("correct", value === current.correct);
    button.classList.toggle("wrong", value === choice && !correct);
  });
  updateProfile(correct, current.role);
  renderAnswer(correct, current.role);
  renderStats();
}

function renderAnswer(correct, role) {
  const party = role.party ? `${partyName(role.party)} (${role.party})` : "parti ikke oppgitt";
  els.answerKicker.textContent = correct ? "Riktig" : "Ikke helt";
  els.answerTitle.textContent = `${role.person.name} · ${role.title}`;
  els.answerDetail.textContent = `${party}. ${dateRange(role)}${role.government ? ` · ${role.government}` : ""}${
    role.governmentInferred ? " · regjering utledet fra regjeringsperiode" : ""
  }.`;
  els.answerPanel.hidden = false;
}

function renderFacts(role) {
  els.factOffice.textContent = role.title || "Ukjent";
  els.factParty.innerHTML = partyMarkup(role.party);
  els.factGovernment.textContent = role.government || "Ukjent";
  els.factLife.textContent = lifeLabel(role.person);
}

function renderStats() {
  const { played, correct, streak } = state.profile;
  els.playedStat.textContent = played;
  els.accuracyStat.textContent = played ? `${Math.round((correct / played) * 100)}%` : "0%";
  els.streakStat.textContent = streak;
  if (state.data) {
    const currentRoles = state.roles.filter((role) => !role.end).length;
    els.peopleStat.textContent = `${state.data.stats.people} personer`;
    els.rolesStat.textContent = `${state.data.stats.roles} roller`;
    els.imagesStat.textContent = `${state.data.stats.images} bilder`;
    els.currentStat.textContent = `${currentRoles} nåværende`;
    els.sourceStat.textContent = `Oppdatert ${formatGeneratedDate(state.data.generatedAt)}`;
  }
}

function renderLearn() {
  if (!state.data) return;
  const query = normalize(els.learnSearch.value);
  const party = els.partyFilter.value;
  const filtered = state.people
    .filter((person) => person.roles.some((role) => rolePassesEra({ ...role, person })))
    .filter((person) => {
      if (party !== "all" && !person.roles.some((role) => role.party === party)) return false;
      if (!query) return true;
      const haystack = normalize(
        [person.name, person.birthYear, person.deathDate, ...person.roles.flatMap((role) => [role.title, role.party, role.government])]
          .filter(Boolean)
          .join(" ")
      );
      return haystack.includes(query);
    })
    .sort((a, b) => (b.image ? 1 : 0) - (a.image ? 1 : 0) || a.name.localeCompare(b.name, "nb"));
  els.learnCount.textContent = `${filtered.length} treff`;
  els.learnGrid.innerHTML = filtered.map(renderPersonCard).join("");
}

function renderPersonCard(person) {
  const role = [...person.roles].sort((a, b) => (b.start || "").localeCompare(a.start || ""))[0];
  const party = role?.party || "";
  const media = person.image
    ? `<img src="${escapeAttr(person.image)}" alt="Portrett av ${escapeAttr(person.name)}" referrerpolicy="no-referrer" loading="lazy">`
    : `<div class="mini-fallback">${escapeHtml(initials(person.name))}</div>`;
  return `
    <article class="person-card">
      ${media}
      <div class="person-card-body">
        ${partyMarkup(party)}
        <h3>${escapeHtml(person.name)}</h3>
        <p>${escapeHtml(role?.title || "Statsråd")} · ${escapeHtml(dateRange(role || {}))}</p>
        <p>${escapeHtml(role?.government || "Regjering ikke oppgitt")}</p>
      </div>
    </article>
  `;
}

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
  profile.recent = [role.id, ...profile.recent.filter((id) => id !== role.id)].slice(0, 24);
  saveProfile();
}

function filteredRoles() {
  return state.roles.filter(rolePassesEra);
}

function roleCanBeAsked(role) {
  if (!role.title || !role.start) return false;
  if (state.mode === "portrait") return Boolean(role.person.image);
  if (state.mode === "party") return Boolean(role.party);
  return true;
}

function rolePassesEra(role) {
  const year = startYear(role);
  if (!year) return true;
  if (state.era === "current") return year >= new Date().getFullYear() - 25;
  if (state.era === "postwar") return year >= 1945;
  if (state.era === "interwar") return year >= 1905 && year < 1945;
  if (state.era === "union") return year < 1905;
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
  const codes = Object.keys(state.data.parties).filter((code) => state.roles.some((role) => role.party === code));
  return [...codes, "Ukjent"];
}

function decadeChoices() {
  const decades = new Set(state.roles.map((role) => `${Math.floor(startYear(role) / 10) * 10}-tallet`));
  return [...decades].filter((item) => !item.startsWith("NaN"));
}

function startYear(role) {
  return Number(String(role.start || "").slice(0, 4));
}

function dateRange(role) {
  if (!role?.start && !role?.end) return "ukjent år";
  const start = formatDate(role.start);
  const end = role.end ? formatDate(role.end) : "nå";
  return `${start}-${end}`;
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

function lifeLabel(person) {
  const birth = person.birthDate || person.birthYear || "?";
  const death = person.deathDate || "";
  return death ? `${birth}-${death}` : `født ${birth}`;
}

function partyName(code) {
  return state.data?.parties?.[code]?.name || code || "Ukjent";
}

function partyColor(code) {
  return state.data?.parties?.[code]?.color || "#64748b";
}

function partyMarkup(code) {
  if (!code) return "Ukjent";
  const logo = partyLogo(code);
  const mark = logo
    ? `<img class="party-logo" src="${escapeAttr(logo)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
    : `<i class="party-dot" style="background:${escapeAttr(partyColor(code))}"></i>`;
  return `<span class="party-chip">${mark}${escapeHtml(partyName(code))} (${escapeHtml(code)})</span>`;
}

function partyLogo(code) {
  return state.data?.parties?.[code]?.logo || "";
}

function initials(name) {
  return name
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

function defaultProfile() {
  return {
    played: 0,
    correct: 0,
    streak: 0,
    bestStreak: 0,
    byMode: {},
    mastery: {},
    recent: [],
  };
}

function loadProfile() {
  try {
    return { ...defaultProfile(), ...JSON.parse(localStorage.getItem(STORE_KEY) || "{}") };
  } catch {
    return defaultProfile();
  }
}

function saveProfile() {
  localStorage.setItem(STORE_KEY, JSON.stringify(state.profile));
}

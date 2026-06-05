# BLUEPRINT — Lederquiz

A complete reference for how this site is built: architecture, styling, fonts,
colours, data model, and quiz logic. Use it to rebuild or extend the project
from first principles.

---

## 1. What it is

**Lederquiz** is a fast, no-build, static quiz site. Show an image, pick the
correct label from four options. Three modes:

| Mode        | Shows                       | You guess     |
| ----------- | --------------------------- | ------------- |
| `ministers` | Portrait of a Norwegian minister | the person's name |
| `flags`     | A national flag             | the country   |
| `leaders`   | Portrait of a world leader  | their country |

No backend, no framework, no bundler. Plain HTML + one CSS file + one ES module.
Deployed as static files to Vercel.

---

## 2. Architecture at a glance

```
index.html          Shell: topbar, intro, mode tabs, #stage, stats row, footer
src/app.js          All behaviour (ES module, no dependencies)
src/styles.css      All styling (CSS custom properties, light/dark)
data/
  ministers.json    690 people, roles, parties, governments  (~1.6 MB)
  world-leaders.json 197 countries, leaders, roleLabels        (~220 KB)
img/
  portraits/{id}.webp     Norwegian minister portraits
  world/{qid}.{jpg|png}   World leader portraits
  flags/{ISO3}.svg        National flags
  parties/{code}.{svg|png} Party logos
logos/                    Source party logos (not shipped to public/)
scripts/            Data-ingestion + image-download + build tooling
public/             Build output (generated; what Vercel serves)
```

**Runtime flow**

1. `index.html` loads, inline script applies the saved/`prefers-color-scheme`
   theme **before paint** (no flash).
2. `app.js` runs on `DOMContentLoaded`: render mode tabs, auto-next toggle,
   theme button, keyboard handler, stats — then `fetch()` both JSON files in
   parallel.
3. `setMode()` builds the question **pool** for the active mode and starts the
   first question.
4. `nextQuestion()` pulls from a small **lookahead queue** (`LOOKAHEAD = 2`)
   whose images are preloaded, so each transition is instant. Rendering rebuilds
   `#stage`'s `innerHTML` for the card.
5. Answering updates per-mode **stats** in `localStorage` and reveals feedback.

---

## 3. Data model

### `data/ministers.json`

```jsonc
{
  "generatedAt": "...",
  "sources": [...],
  "stats": { "images": 512, ... },
  "parties":   { "A": { "name": "Arbeiderpartiet", "color": "#...", "logo": "/img/parties/A.svg" }, ... },
  "governments": [...],
  "offices": [...],
  "people": [
    {
      "id": "1201",
      "name": "Carsten Tank Anker",
      "image": "/img/portraits/1201.webp",   // local path; may be absent
      "wikipedia": "https://...",
      "firstYear": "1814",
      "lastYear": "1814",
      "roles": [
        { "title": "Statsråd ...", "party": "A", "department": "...",
          "government": "...", "start": "1814-03-02", "end": "1814-11-27" }
      ]
    }
  ]
}
```

The ministers pool = `people.filter(p => p.image && p.name)` → **512** people.

### `data/world-leaders.json`

```jsonc
{
  "roleLabels": { "head_of_state": "Statsoverhode", ... },
  "countries": [
    {
      "qid": "Q889", "name": "Afghanistan", "iso2": "AF", "iso3": "AFG",
      "flag": "/img/flags/AFG.svg", "capital": "Kabul",
      "leaders": [
        { "name": "...", "qid": "Q...", "image": "/img/world/Q....png" | null,
          "wikipedia": "...", "roles": ["head_of_government"],
          "primaryRole": "head_of_government", "party": "...", "termStart": "..." }
      ]
    }
  ]
}
```

- **Flags pool** = countries with `flag && iso3` (the `iso3` filter drops
  historical/formal duplicates) → **197**.
- **Leaders pool** = every leader that has an `image` → **341**, flattened across
  countries and tagged with their country.

### Country-name normalisation

`COUNTRY_NAME_OVERRIDES` in `app.js` maps formal Wikidata names to short forms
(e.g. *"People's Republic of China" → "China"*) so answer buttons read cleanly.

---

## 4. Quiz logic (`src/app.js`)

Single module, no dependencies. Key pieces:

- **`state`** — the live object: loaded data, current `mode`, `pool`, current
  `question`, the lookahead `queue`, `answered` flag, `auto` setting, `stats`,
  and per-mode `recent` history.
- **Pool builders** — `buildMinisterPool` / `buildFlagPool` / `buildLeaderPool`
  shape raw data into uniform question candidates for the active mode.
- **Anti-repeat** — `pickFresh()` avoids recently-seen items using a per-mode
  `recent` ring buffer (`RECENT_HISTORY = 25`, capped to `pool.length - 4`).
- **Distractors** — three wrong options chosen randomly; the leaders mode forces
  distractors from *different* countries so options are never duplicated.
- **Lookahead + preloading** — `buildQuestion()` returns a question object;
  `fillQueue()` keeps `LOOKAHEAD` questions ready and calls `preloadImage()`
  (an off-DOM `new Image()` with `decoding="async"`) so the next portrait/flag
  is already in cache. `preloadCache` is a `Map` bounded to 12 entries.
- **Rendering** — `renderQuestion()` writes the card markup; if the image is
  already cached (`img.complete && naturalWidth > 0`) it reveals instantly,
  otherwise fades in on `load` via the `.is-loaded` class.
- **Answering** — `answer(i)` marks correct/wrong, updates stats, shows the
  explanation, and (if a delay is set) schedules auto-advance.

### Persistence (`localStorage`)

| Key            | Purpose                                  |
| -------------- | ---------------------------------------- |
| `lq.theme`     | `"light"` / `"dark"`                      |
| `lq.stats.v2`  | per-mode `{ played, correct, streak, best }` |
| `lq.auto`      | auto-next delay id (`manual`/`1s`/`3s`/`5s`) |
| `lq.mode`      | last active mode                          |

### Keyboard

`1`–`4` selects an option; `Enter` / `Space` advances after answering. Ignored
while focus is in an input/textarea.

### Accessibility

Mode tabs use `role="tab"` + `aria-pressed`; the auto-next control is a
`role="radiogroup"`. Images carry descriptive `alt` text. `:focus-visible`
outlines everywhere. Animations respect `prefers-reduced-motion`.

---

## 5. Styling system (`src/styles.css`)

A single stylesheet driven by **CSS custom properties**. Light is the default in
`:root`; dark overrides them under `:root[data-theme="dark"]`. Everything
references the variables, so theming is a token swap.

### Colour tokens

| Token              | Light                 | Dark                  | Use                         |
| ------------------ | --------------------- | --------------------- | --------------------------- |
| `--bg`             | `rgb(252 252 250)`    | `rgb(12 13 14)`       | page background             |
| `--surface`        | `rgb(255 255 255)`    | `rgb(22 23 25)`       | cards, buttons              |
| `--surface-2`      | `rgb(247 247 244)`    | `rgb(30 31 34)`       | image wells, key chips      |
| `--border`         | `rgb(229 228 222)`    | `rgb(42 43 46)`       | hairlines                   |
| `--border-strong`  | `rgb(208 207 199)`    | `rgb(64 65 68)`       | hover borders, scrollbars   |
| `--text`           | `rgb(23 23 22)`       | `rgb(240 240 238)`    | primary text                |
| `--text-muted`     | `rgb(115 115 110)`    | `rgb(160 160 156)`    | secondary text              |
| `--text-faint`     | `rgb(168 167 158)`    | `rgb(110 110 106)`    | labels, kickers             |
| `--accent`         | `rgb(13 148 136)`     | `rgb(45 212 191)`     | teal — active/links/focus   |
| `--accent-soft`    | accent @ 0.10         | accent @ 0.14         | hover/active fills          |
| `--accent-strong`  | `rgb(15 118 110)`     | `rgb(94 234 212)`     | accent variant              |
| `--correct`/`-bg`  | green                 | light green           | right answer                |
| `--wrong`/`-bg`    | rose                  | light rose            | wrong answer                |

The signature colour is **teal** (`#0d9488` light, `#2dd4bf` dark) — also the
favicon background and `theme-color`.

### Shape & elevation tokens

```css
--radius: 10px;        /* cards */
--radius-sm: 6px;      /* buttons, chips, stats */
--shadow: 0 1px 2px rgb(0 0 0 / 0.04);   /* very subtle; 0.4 alpha in dark */
```

### Typography

```css
--font-sans: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
--font-mono: "JetBrains Mono", "SF Mono", "Menlo", ui-monospace, monospace;
```

- **Inter** (weights 400/500/600/700) — all UI text. Base `15px`, line-height
  `1.55`, `letter-spacing: -0.01em` on headings for a tight, modern feel.
- **JetBrains Mono** (400/500) — every "data" accent: score, streak, kickers,
  role years, stat labels, key chips, footer. The mono/sans contrast is the core
  of the dashboard aesthetic.
- Loaded from Google Fonts with `display=swap` and `preconnect`. Antialiasing is
  forced on (`-webkit-font-smoothing: antialiased`).

### Layout

- Centred column, `max-width: 760px`, `20px` side padding. `body` is a flex
  column so the footer sits at the bottom (`min-height: 100dvh`).
- **Topbar** — sticky, translucent (`backdrop-filter: blur(8px)`), holds brand,
  live score/streak, auto-next toggle, theme button.
- **Mode tabs** — underline tabs (`border-bottom` accent on the active one).
- **Card** — the centrepiece, `grid-template-columns: 240px 1fr` with a fixed
  `280px`-tall head: image well on the left, question + scrollable role list on
  the right. Fixed heights (`card-foot` 124px, `feedback` 52px) keep the card a
  stable size so answering never shifts layout. Images: `object-fit: cover` for
  portraits, contained with a soft shadow for flags.
- **Stats row** — 4-up grid of bordered tiles (mono label + bold value).

### Responsive breakpoints

- `≤ 560px` — card head collapses to one column; image becomes a `4/3` banner.
- `≤ 520px` — choices go single-column; stats 4→2 columns; tighter gaps.

### Motion

- `card-in` (fade + 4px rise, 0.22s) on each new card.
- Image fade via `.is-loaded` opacity transition.
- `pop` micro-scale on the correct choice.
- All of the above are neutralised under `prefers-reduced-motion: reduce`.

---

## 6. Build & deploy

No bundler. `scripts/build.mjs`:

1. runs `check-data.mjs` (dataset invariants — people/role counts, current
   government party coverage, portrait coverage, country count);
2. wipes `public/`;
3. copies `index.html`, `data/`, `src/`, `img/` into `public/`.

`vercel.json` sets `outputDirectory: public`, `cleanUrls: true`, and a
`Cache-Control` header for `/data/*` (`max-age=3600, stale-while-revalidate=86400`).

```bash
npm run dev      # python -m http.server 5173
npm run build    # node scripts/build.mjs  → public/
```

### Images

Portraits/flags/logos are committed under `img/` and referenced by **local
paths** in the JSON (originals retained as `imageSource`/`logoSource`). Refresh
with the `download-*.mjs` scripts (idempotent — they skip files already on disk).

> **Perf note / future work:** world-leader images (`img/world/`, ~27 MB, some
> 400–540 KB PNGs) are full-resolution but rendered in a 240 px well. The single
> biggest remaining performance win is re-encoding them to ~480 px WebP. It was
> intentionally *not* done here because no image-processing tool (sharp / cwebp /
> ImageMagick) is installed in this environment. Add `sharp` and a resize pass to
> `download-world-images.mjs` to capture it.

---

## 7. If you rebuild from this

Keep these invariants — they're what make it feel good:

1. **No flash of wrong theme** — apply the theme in an inline `<head>` script
   before first paint.
2. **Stable card size** — fixed image/foot/feedback heights so answering never
   reflows. This is deliberate, not accidental.
3. **Instant transitions** — keep the lookahead queue + image preload.
4. **One stylesheet, all tokens** — never hard-code a colour; add a CSS variable.
5. **Mono for data, sans for prose** — the type contrast carries the whole look.
6. **Local images, JSON paths** — never hot-link Wikimedia at runtime.

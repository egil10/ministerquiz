# Ministerquiz

A fast, no-build quiz on Norwegian government ministers from 1814 to today.

- **690 people**, **2104 ministerial roles**, **66 governments**, **391 posts**
- **5 quiz modes** — portrait, post, party, government, decade
- **Era filter** — last 25 years, postwar, interwar, 1814–1905, all
- **Round structure** — 10 questions per round with progress bar
- **Local image cache** — all portraits and party logos are served from `/img/`
- **Smooth UX** — image preloading, animated correct/wrong feedback, keyboard 1-4 + Enter
- **Browse + Stats views** — search, filter by party, see per-mode accuracy
- **No backend** — static site deployed to Vercel

## Develop

```bash
npm run dev      # python -m http.server 5173
npm run build    # writes static output to public/
```

## Refresh image cache

The dataset already ships with portraits in `img/portraits/{id}.jpg` and party logos in `img/parties/{code}.svg`. To re-download from Wikimedia Commons (idempotent — skips files already on disk):

```bash
node scripts/download-images.mjs
```

The script also rewrites `data/ministers.json` so each `image` / `logo` entry points at the local copy and `imageSource` / `logoSource` retains the original Wikimedia URL.

## Data

- `data/ministers.json` — generated dataset combining `regjeringen.no` (roles, dates, governments) with Wikipedia/Wikidata (portraits, life dates).
- `scripts/build-data.py` — original ingestion pipeline (Python).
- `scripts/check-data.mjs` — basic dataset invariants.
- `scripts/build.mjs` — copies `index.html`, `data/`, `src/`, `img/` into `public/` for Vercel.

from __future__ import annotations

import concurrent.futures
import datetime as dt
import html
import json
import re
import hashlib
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
CACHE_DIR = ROOT / ".cache" / "fetch"
BASE = "https://www.regjeringen.no"
API = BASE + "/api/RegjeringDataApi/GetRegjeringspolitikere"
DETAIL_BASE = (
    BASE
    + "/no/om-regjeringa/tidligere-regjeringer-og-historie/sok-i-regjeringer-siden-1814/"
    + "regjeringspolitiker/id2578016/?personId="
)
CURRENT_GOVERNMENT_URL = BASE + "/no/om-regjeringa/noverande/regjeringen-store/id2877247/"
UA = "MinisterQuizDataBuilder/1.0 (public archive enrichment; contact: local app)"


PARTIES = {
    "A": {
        "name": "Arbeiderpartiet",
        "color": "#d71920",
        "logo": "https://commons.wikimedia.org/wiki/Special:FilePath/Arbeiderpartiet%20logo.svg",
    },
    "H": {
        "name": "Høyre",
        "color": "#005eb8",
        "logo": "https://commons.wikimedia.org/wiki/Special:FilePath/H%C3%B8yre%20logo.svg",
    },
    "Sp": {
        "name": "Senterpartiet",
        "color": "#008542",
        "logo": "https://commons.wikimedia.org/wiki/Special:FilePath/Senterpartiet%20logo.svg",
    },
    "FrP": {
        "name": "Fremskrittspartiet",
        "color": "#00529b",
        "logo": "https://commons.wikimedia.org/wiki/Special:FilePath/Fremskrittspartiet%20logo.svg",
    },
    "SV": {
        "name": "Sosialistisk Venstreparti",
        "color": "#bf1e2e",
        "logo": "https://commons.wikimedia.org/wiki/Special:FilePath/Sosialistisk%20Venstreparti%20logo.svg",
    },
    "V": {
        "name": "Venstre",
        "color": "#00843d",
        "logo": "https://commons.wikimedia.org/wiki/Special:FilePath/Venstre%20logo.svg",
    },
    "KrF": {
        "name": "Kristelig Folkeparti",
        "color": "#f4a900",
        "logo": "https://commons.wikimedia.org/wiki/Special:FilePath/Kristelig%20Folkeparti%20logo.svg",
    },
    "KRF": {
        "name": "Kristelig Folkeparti",
        "color": "#f4a900",
        "logo": "https://commons.wikimedia.org/wiki/Special:FilePath/Kristelig%20Folkeparti%20logo.svg",
    },
    "NKP": {
        "name": "Norges Kommunistiske Parti",
        "color": "#c40000",
        "logo": "https://commons.wikimedia.org/wiki/Special:FilePath/Norges%20Kommunistiske%20Parti%20logo.svg",
    },
    "NS": {
        "name": "Nasjonal Samling",
        "color": "#6e1f21",
        "logo": "",
    },
    "B": {"name": "Bondepartiet", "color": "#2f7d32", "logo": ""},
    "FRIVNSTR": {"name": "Frisinnede Venstre", "color": "#3b82f6", "logo": ""},
    "Hf": {"name": "Hjemmefronten", "color": "#475569", "logo": ""},
    "MODVNSTR": {"name": "Moderate Venstre", "color": "#4f8f46", "logo": ""},
    "SMLNGSP": {"name": "Samlingspartiet", "color": "#64748b", "logo": ""},
    "Uavh.": {"name": "Uavhengig", "color": "#6b7280", "logo": ""},
    "Uavh": {"name": "Uavhengig", "color": "#6b7280", "logo": ""},
}

PARTY_ALIASES = {
    "Ap": "A",
    "Frp": "FrP",
    "KRF": "KrF",
    "Uavh.": "Uavh",
}

WIKIDATA_PARTIES = {
    "Q188067": "A",
    "Q188146": "V",
    "Q193486": "SV",
    "Q203184": "FrP",
    "Q211901": "KrF",
    "Q320195": "H",
    "Q506868": "Sp",
}


def fetch(url: str, *, data: bytes | None = None, content_type: str | None = None, tries: int = 4) -> str:
    cache_path = None
    if data is None:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        key = hashlib.sha256(url.encode("utf-8")).hexdigest()
        cache_path = CACHE_DIR / f"{key}.txt"
        if cache_path.exists():
            return cache_path.read_text(encoding="utf-8")

    headers = {"User-Agent": UA}
    if content_type:
        headers["Content-Type"] = content_type
    req = urllib.request.Request(url, data=data, headers=headers)
    last: Exception | None = None
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(req, timeout=40) as response:
                body = response.read().decode("utf-8")
                if cache_path:
                    cache_path.write_text(body, encoding="utf-8")
                return body
        except urllib.error.HTTPError as exc:
            last = exc
            if exc.code in (429, 500, 502, 503, 504):
                retry_after = exc.headers.get("Retry-After")
                delay = int(retry_after) if retry_after and retry_after.isdigit() else 5 + attempt * 8
                time.sleep(delay)
                continue
            raise
        except (urllib.error.URLError, TimeoutError) as exc:
            last = exc
            time.sleep(0.8 + attempt * 1.3)
    raise RuntimeError(f"Could not fetch {url}: {last}")


def text(raw: str) -> str:
    raw = re.sub(r"<script\b.*?</script>", " ", raw, flags=re.S | re.I)
    raw = re.sub(r"<style\b.*?</style>", " ", raw, flags=re.S | re.I)
    raw = re.sub(r"<[^>]+>", " ", raw)
    raw = html.unescape(raw)
    raw = raw.replace("\xa0", " ")
    return re.sub(r"\s+", " ", raw).strip()


def normalize_party_code(code: str) -> str:
    code = text(code).strip()
    return PARTY_ALIASES.get(code, code)


def name_signature(name: str) -> tuple[str, str]:
    parts = [part for part in re.split(r"\s+", text(name).lower()) if part]
    return (parts[0], parts[-1]) if parts else ("", "")


def iso_date(value: str) -> str:
    value = text(value).strip()
    if not value:
        return ""
    match = re.match(r"(\d{2})\.(\d{2})\.(\d{4})$", value)
    if match:
        day, month, year = match.groups()
        return f"{year}-{month}-{day}"
    return value


def full_name(list_name: str) -> str:
    name = html.unescape(list_name).strip()
    if "," not in name:
        return name
    family, given = [part.strip() for part in name.split(",", 1)]
    return f"{given} {family}".strip()


def person_id_from_link(link: str) -> str:
    parsed = urllib.parse.urlparse(link)
    qs = urllib.parse.parse_qs(parsed.query)
    return qs.get("personId", [""])[0]


def fetch_role_list(role: str) -> dict[str, dict]:
    people: dict[str, dict] = {}
    page = 1
    total_pages = 1
    while page <= total_pages:
        params = urllib.parse.urlencode(
            {
                "language": "no",
                "term": "",
                "role": role,
                "regjeringId": "",
                "date": "",
                "page": str(page),
            }
        )
        payload = json.loads(fetch(f"{API}?{params}"))
        result = payload["Result"]
        total_pages = int(result["TotalPages"])
        for item in result["List"]:
            pid = person_id_from_link(item["Link"])
            people.setdefault(
                pid,
                {
                    "id": pid,
                    "listName": html.unescape(item["Name"]),
                    "name": full_name(item["Name"]),
                    "birthYear": item.get("BirthYear", ""),
                    "source": item["Link"],
                    "apiRoles": set(),
                },
            )["apiRoles"].add(role)
        print(f"Fetched {role} page {page}/{total_pages}")
        page += 1
    return people


def fetch_government_periods() -> list[dict]:
    governments: list[dict] = []
    for period in ("1945-", "1940-1945", "1905-1940", "1814-1905"):
        page = 1
        total_pages = 1
        while page <= total_pages:
            params = urllib.parse.urlencode(
                {"language": "no", "term": "", "period": period, "page": str(page)}
            )
            payload = json.loads(fetch(f"{BASE}/api/RegjeringDataApi/GetRegjeringer?{params}"))
            result = payload["Result"]
            total_pages = int(result["TotalPages"])
            for item in result["List"]:
                governments.append(
                    {
                        "name": html.unescape(item["Name"]).replace("\xa0", " "),
                        "fromYear": int(item["FromYear"]),
                        "toYear": int(item["ToYear"]) if item.get("ToYear") else 9999,
                        "source": urllib.parse.urljoin(BASE, item["Link"]),
                    }
                )
            page += 1
    unique = {gov["name"]: gov for gov in governments}
    return sorted(unique.values(), key=lambda gov: (gov["fromYear"], gov["toYear"], gov["name"]))


def fetch_current_party_map() -> dict[str, str]:
    body = fetch(CURRENT_GOVERNMENT_URL)
    parties: dict[str, str] = {}
    for label in re.findall(r"<a\b[^>]*>(.*?)</a>", body, flags=re.S | re.I):
        label_text = text(label)
        match = re.match(r"(.+?)\s+\(([^()]+)\)$", label_text)
        if match:
            name, party = match.groups()
            parties[name] = normalize_party_code(party)
    return parties


def current_party_for(name: str, current_parties: dict[str, str]) -> str:
    signature = name_signature(name)
    for current_name, party in current_parties.items():
        if name_signature(current_name) == signature:
            return party
    return ""


def infer_government(role: dict, government_periods: list[dict]) -> str:
    year = year_from_date(role.get("start", ""))
    if not year:
        return ""
    matches = [gov for gov in government_periods if gov["fromYear"] <= year <= gov["toYear"]]
    if not matches:
        return ""
    matches.sort(key=lambda gov: (gov["toYear"] - gov["fromYear"], -gov["fromYear"], gov["name"]))
    return matches[0]["name"]


def parse_featurebox(block: str, person_id: str, idx: int) -> dict | None:
    h3 = re.search(r"<h3[^>]*>(.*?)</h3>", block, flags=re.S | re.I)
    if not h3:
        return None
    heading = text(h3.group(1))
    if heading.lower().startswith(("politisk rådgiver", "statsekretær")):
        return None

    party = ""
    party_match = re.search(r"\(([^()]+)\)\s*$", heading)
    if party_match:
        party = normalize_party_code(party_match.group(1))
        heading = heading[: party_match.start()].strip()

    # The quiz is for ministers and prime ministers. Detail pages can also contain
    # advisory history; the early return above keeps those out of the game data.
    if "minister" not in heading.lower() and "statsråd" not in heading.lower():
        return None

    links = re.findall(r'<a\b[^>]*href="([^"]+)"[^>]*>(.*?)</a>', block, flags=re.S | re.I)
    department = ""
    government = ""
    for href, label in links:
        label_text = text(label)
        if "historisk-departement" in href:
            department = label_text
        elif "/regjeringer/" in href:
            government = label_text

    date_match = re.search(r'<p class="date"[^>]*>(.*?)</p>', block, flags=re.S | re.I)
    date_text = text(date_match.group(1)) if date_match else ""
    date_text = date_text.replace("–", "-").replace("—", "-")
    start = ""
    end = ""
    if "-" in date_text:
        start_raw, end_raw = date_text.split("-", 1)
        start = iso_date(start_raw)
        end = iso_date(end_raw)
    else:
        start = iso_date(date_text)

    paragraphs = [text(match) for match in re.findall(r"<p[^>]*>(.*?)</p>", block, flags=re.S | re.I)]
    description = ""
    if paragraphs:
        description = paragraphs[-1] if paragraphs[-1] != date_text else ""

    return {
        "id": f"{person_id}-{idx}",
        "personId": person_id,
        "title": heading,
        "party": party,
        "department": department,
        "government": government,
        "start": start,
        "end": end,
        "dateLabel": date_text,
        "description": description,
    }


def parse_detail(person: dict) -> dict:
    source = DETAIL_BASE + urllib.parse.quote(person["id"])
    body = fetch(source)
    h1 = re.search(r"<h1[^>]*>(.*?)</h1>", body, flags=re.S | re.I)
    if h1:
        person["name"] = text(h1.group(1))
    birth = re.search(r"Født:\s*</span>\s*|Født:\s*(\d{4})", body)
    if birth and birth.groups() and birth.group(1):
        person["birthYear"] = birth.group(1)
    else:
        birth2 = re.search(r"Født:\s*(\d{4})", text(body))
        if birth2:
            person["birthYear"] = birth2.group(1)
    blocks = re.findall(r'<div class="featurebox"[^>]*>(.*?)</div>', body, flags=re.S | re.I)
    roles = []
    for idx, block in enumerate(blocks, start=1):
        role = parse_featurebox(block, person["id"], idx)
        if role:
            roles.append(role)
    person["roles"] = roles
    person["source"] = source
    return person


def claim_time(entity: dict, prop: str) -> str:
    claims = entity.get("claims", {}).get(prop, [])
    if not claims:
        return ""
    value = claims[0].get("mainsnak", {}).get("datavalue", {}).get("value", {}).get("time", "")
    match = re.match(r"[+-](\d{4})-(\d{2})-(\d{2})", value)
    return "-".join(match.groups()) if match else ""


def claim_commons_file(entity: dict, prop: str) -> str:
    claims = entity.get("claims", {}).get(prop, [])
    if not claims:
        return ""
    filename = claims[0].get("mainsnak", {}).get("datavalue", {}).get("value", "")
    return filename if isinstance(filename, str) else ""


def claim_entity_id(entity: dict, prop: str) -> str:
    claims = entity.get("claims", {}).get(prop, [])
    if not claims:
        return ""
    value = claims[0].get("mainsnak", {}).get("datavalue", {}).get("value", {})
    entity_id = value.get("id", "")
    return entity_id if isinstance(entity_id, str) else ""


def wikipedia_title_candidates(name: str) -> list[str]:
    parts = [part for part in re.split(r"\s+", name.strip()) if part]
    candidates = [name]
    if len(parts) > 2:
        without_initials = [part for part in parts if not re.fullmatch(r"[A-ZÆØÅ]\.", part)]
        if without_initials != parts and len(without_initials) >= 2:
            candidates.append(" ".join(without_initials))
        candidates.append(f"{parts[0]} {parts[-1]}")
        if len(parts) > 3:
            candidates.append(" ".join([parts[0], *parts[-2:]]))
    unique = []
    for candidate in candidates:
        if candidate not in unique:
            unique.append(candidate)
    return unique


def wikipedia_enrichment(names: list[str]) -> dict[str, dict]:
    endpoint = "https://no.wikipedia.org/w/api.php"
    enriched: dict[str, dict] = {}
    qids_by_name: dict[str, str] = {}
    query_to_name: dict[str, str] = {}
    for name in names:
        for candidate in wikipedia_title_candidates(name):
            query_to_name.setdefault(candidate, name)
    queries = list(query_to_name)

    for i in range(0, len(queries), 45):
        chunk = queries[i : i + 45]
        params = urllib.parse.urlencode(
            {
                "action": "query",
                "format": "json",
                "redirects": "1",
                "prop": "pageprops|pageimages|info",
                "inprop": "url",
                "piprop": "thumbnail|original",
                "pithumbsize": "700",
                "titles": "|".join(chunk),
            },
            safe="|",
        )
        payload = json.loads(fetch(f"{endpoint}?{params}"))
        redirects = {item["from"]: item["to"] for item in payload.get("query", {}).get("redirects", [])}
        normalized = {item["from"]: item["to"] for item in payload.get("query", {}).get("normalized", [])}
        pages = payload.get("query", {}).get("pages", {})
        pages_by_title = {page.get("title", ""): page for page in pages.values() if "missing" not in page}
        for query in chunk:
            name = query_to_name[query]
            if enriched.get(name, {}).get("wikipedia"):
                continue
            target = redirects.get(normalized.get(query, query), normalized.get(query, query))
            page = pages_by_title.get(target)
            if not page:
                continue
            slot = enriched.setdefault(name, {})
            slot["wikipedia"] = page.get("fullurl", "")
            qid = page.get("pageprops", {}).get("wikibase_item", "")
            if qid:
                slot["wikidata"] = f"https://www.wikidata.org/wiki/{qid}"
                qids_by_name[name] = qid
            image = page.get("thumbnail", {}).get("source") or page.get("original", {}).get("source")
            if image:
                slot["image"] = image
        print(f"Enriched Wikipedia titles {i + 1}-{min(i + len(chunk), len(queries))}")
        time.sleep(0.2)

    qids = sorted(set(qids_by_name.values()))
    entity_endpoint = "https://www.wikidata.org/w/api.php"
    entities_by_qid: dict[str, dict] = {}
    for i in range(0, len(qids), 25):
        chunk = qids[i : i + 25]
        params = urllib.parse.urlencode(
            {
                "action": "wbgetentities",
                "format": "json",
                "ids": "|".join(chunk),
                "props": "claims|labels",
                "languages": "nb|nn|en",
            },
            safe="|",
        )
        payload = json.loads(fetch(f"{entity_endpoint}?{params}"))
        entities_by_qid.update(payload.get("entities", {}))
        print(f"Fetched Wikidata entities {i + 1}-{min(i + len(chunk), len(qids))}")
        time.sleep(0.2)

    for name, qid in qids_by_name.items():
        entity = entities_by_qid.get(qid, {})
        slot = enriched.setdefault(name, {})
        labels = entity.get("labels", {})
        for lang in ("nb", "nn", "en"):
            if lang in labels:
                slot["wikidataLabel"] = labels[lang]["value"]
                break
        birth = claim_time(entity, "P569")
        death = claim_time(entity, "P570")
        commons_file = claim_commons_file(entity, "P18")
        party_qid = claim_entity_id(entity, "P102")
        if birth:
            slot["birthDate"] = birth
        if death:
            slot["deathDate"] = death
        if commons_file and not slot.get("image"):
            slot["image"] = "https://commons.wikimedia.org/wiki/Special:FilePath/" + urllib.parse.quote(
                commons_file
            )
        if party_qid in WIKIDATA_PARTIES:
            slot["wikidataParty"] = WIKIDATA_PARTIES[party_qid]
    return enriched


def year_from_date(value: str) -> int | None:
    match = re.match(r"(\d{4})", value or "")
    return int(match.group(1)) if match else None


def main() -> None:
    DATA_DIR.mkdir(exist_ok=True)
    combined: dict[str, dict] = {}
    for role in ("statsrad", "statsminister"):
        for pid, person in fetch_role_list(role).items():
            if pid not in combined:
                combined[pid] = person
            else:
                combined[pid]["apiRoles"].update(person["apiRoles"])

    government_periods = fetch_government_periods()
    current_parties = fetch_current_party_map()
    people = list(combined.values())
    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
        parsed = list(pool.map(parse_detail, people))

    parsed = [p for p in parsed if p.get("roles")]
    parsed.sort(key=lambda p: (int(p.get("birthYear") or 9999), p["name"]))
    enriched = wikipedia_enrichment([p["name"] for p in parsed])

    all_roles = []
    governments = set()
    offices = set()
    party_codes = set()
    for person in parsed:
        person["apiRoles"] = sorted(person["apiRoles"])
        person.update(enriched.get(person["name"], {}))
        roles = person.get("roles", [])
        roles.sort(key=lambda r: (r.get("start") or "0000-00-00", r["title"]))
        for role in roles:
            role["party"] = normalize_party_code(role.get("party", ""))
            if not role["party"] and not role.get("end"):
                current_party = current_party_for(person["name"], current_parties)
                if current_party:
                    role["party"] = current_party
                    role["partyInferred"] = "currentGovernmentPage"
            if not role["party"] and person.get("wikidataParty") and (year_from_date(role.get("start", "")) or 0) >= 1884:
                role["party"] = person["wikidataParty"]
                role["partyInferred"] = "wikidata"
            if role["government"]:
                governments.add(role["government"])
            else:
                inferred_government = infer_government(role, government_periods)
                if inferred_government:
                    role["government"] = inferred_government
                    role["governmentInferred"] = True
                    governments.add(inferred_government)
            if role["title"]:
                offices.add(role["title"])
            if role["party"]:
                party_codes.add(role["party"])
            all_roles.append(role)
        years = [year for role in roles for year in (year_from_date(role["start"]), year_from_date(role["end"])) if year]
        person["firstYear"] = min(years) if years else None
        person["lastYear"] = max(years) if years else None

    parties = dict(PARTIES)
    for code in sorted(party_codes):
        parties.setdefault(code, {"name": code, "color": "#64748b", "logo": ""})

    dataset = {
        "generatedAt": dt.datetime.utcnow().replace(microsecond=0).isoformat() + "Z",
        "sources": [
            {
                "name": "Regjeringen.no historisk regjeringsdatabase",
                "url": "https://www.regjeringen.no/no/om-regjeringa/tidligere-regjeringer-og-historie/sok-i-regjeringer-siden-1814/id2578015/",
            },
            {"name": "Wikidata / Wikimedia Commons enrichment", "url": "https://www.wikidata.org/"},
        ],
        "stats": {
            "people": len(parsed),
            "roles": len(all_roles),
            "governments": len(governments),
            "offices": len(offices),
            "images": sum(1 for p in parsed if p.get("image")),
        },
        "parties": parties,
        "governmentPeriods": government_periods,
        "governments": sorted(governments),
        "offices": sorted(offices),
        "people": parsed,
    }

    out = DATA_DIR / "ministers.json"
    out.write_text(json.dumps(dataset, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(
        f"Wrote {out}: {dataset['stats']['people']} people, "
        f"{dataset['stats']['roles']} roles, {dataset['stats']['images']} images"
    )


if __name__ == "__main__":
    main()

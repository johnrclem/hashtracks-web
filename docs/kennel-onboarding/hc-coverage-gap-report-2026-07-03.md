# Harrier Central — Coverage Gap Report (2026-07-03)

> **Answer to "can we identify ALL the HC kennels we haven't added, instead of piecemeal?"** — Yes.
> This report is the full diff of the Harrier Central universe against our live site, produced in one
> pass. It replaces daily one-at-a-time discovery with a **master backlog** you can work through (or
> batch, like the 2026-07-01 HC batch of 10).

## How this was generated (repeatable in ~10 min)

1. **Enumerate the HC universe.** `hashruns.org/api/global-runs` is the public front-end for all
   Harrier Central data. Sweep it for every kennel that has posted a run:
   - `?isFuture=1` (upcoming, ~200-row cap) → kennels with upcoming runs.
   - `?isFuture=0&minEventDate=…&maxEventDate=…` in ≤6-month windows over the last ~24 months → all
     kennels with recent past runs. Collect distinct `PublicKennelId` + name/slug/continent/tz/last-run.
   - Run same-origin inside the page (Chrome MCP) — the Azure adapter host is sandbox-blocked, but
     `hashruns.org` is not.
2. **Pull our live coverage.** `hashtracks.xyz/sitemap.xml` via Chrome MCP → the authoritative list of
   live kennel slugs (476 on 2026-07-03). The seed files are NOT authoritative (live has more).
3. **Diff by NAME, not slug.** The catch the docs flag: **HC slugs ≠ our slugs** (HC `BHHH2` vs our
   `bandung-h3`, HC `TwH3` vs `taiwan-h3`). A naive slug match misses. So match each HC kennel's
   distinctive **name tokens** (stripped of "hash/house/harriers/h3/…") as substrings against the joined
   slug set, plus an HC-slug==our-slug check. Classify LIVE / GAP / weak.

**Result:** **155 distinct HC kennels** active in the last 24 months → **95 confidently live**,
**57 raw gaps**. After removing name-match false-positives (live under an abbreviated slug),
test/junk rows, and the 9 already queued/handed-off today, **40 real gap candidates** remain.

> ⚠️ **The name-match is a heuristic, not ground truth.** It surfaces candidates; every one still needs
> the standard per-kennel live-verify + sitemap re-dedup at handoff (some "gaps" are nomadic *events*,
> not standing kennels; a few may be seeded-but-hidden). Buckets below encode that judgement.

---

## Bucket A — Onboard-ready NOW (genuine local kennel + recently active)

Config-only HARRIER_CENTRAL, last run recent enough to pass the recently-active rule. Ranked by value.
🔴 = tz field is an HC placeholder quirk — set the METRO tz from the real city.

| Kennel | HC slug | PublicKennelId | Region / new-geo | Last run | Runs/2y | Notes |
|---|---|---|---|---|---|---|
| **Prague H3** | PH3-CZ | `e7a4700c-beb3-4a5f-a05e-9ce019e5a610` | **Czechia — NEW COUNTRY** (Prague METRO) | 2026-06-14 | 5 | 🔴 tz `Europe/Warsaw`→`Europe/Prague`. 5 `region.ts` edits. |
| **Poznań H3** | PH3-PL | `b193f2ad-a2b2-4f48-b8be-b7145423faaf` | Poland (Warsaw live) — **new Poznań METRO** | 2026-06-13 | 3 | 🔴 tz `Europe/Warsaw` OK. ~2 edits. |
| **Rio H3** | RIOH3 | `8d230b92-a6e6-4d8b-8c13-fe004a260d25` | Brazil (Brasília/São Paulo live) — **new Rio METRO** | 2026-06-06 | 3 | tz `America/Sao_Paulo`. ~2 edits. |
| **Rio Full Moon H3** | RFMH3 | `98a6791b-0514-4d0b-969c-f43d24e83413` | Brazil — Rio sibling (same metro as above) | 2026-05-30 | 1 | Onboard with/after Rio H3; 0 extra region edits. |
| **Cairneyhill H3** | CH3-GB | `6108b51b-123e-4568-8d68-ea295bac0789` | Scotland/Fife (Edinburgh live) | 2026-04-12 | 6 | Likely reuse a Fife/Edinburgh metro. 🔴 code `ch3` taken → suffix. |
| **Nuremberg H3** | NH3-DE | `5d397fbf-0b8a-46a1-83a5-b3e34435170b` | Germany — new Nuremberg METRO | 2026-03-14 | 10 | 🔴 code `nh3` taken (Newcastle) → suffix. Confirm cadence. |

## Bucket B — Genuine, but STALE (re-check recency before onboarding)

Real local kennels absent from our site, but last run is well beyond ~2× a normal interval as of
2026-07-03. Re-pull `global-runs` at handoff; onboard only if they've resumed, else mark `blocked: stale`.
Many are **new countries** and worth re-checking on every refill.

| Kennel | HC slug | PublicKennelId | Region / new-geo | Last run | Runs/2y |
|---|---|---|---|---|---|
| Bonaire Flamingo H3 | BFH3 | `cea44284-7d3a-4c10-be79-8b1ccac68056` | **Bonaire — NEW (Caribbean NL)** | 2025-06-10 | 13 |
| Bossier/Shreveport H3 | BSH3-US1 | `f04f1991-e31b-488d-a159-1bc8eaf17dcd` | US — Louisiana (new metro) | 2025-09-06 | 3 |
| Santo Domingo H3 | SDH3-DO | `e5330426-10e0-46d4-be4c-30ee844f3038` | **Dominican Republic — NEW COUNTRY** | 2025-09-14 | 2 |
| Hartford H3 (H69) | H69 | `0aa6bd7a-cba2-4cd2-b4fc-0c09a860c563` | US — Connecticut (Hartford; deep #, 50 runs) | 2025-05-09 | 50 |
| Freetown H3 | FH3-SL | `078e247c-6d1e-4c47-b6c6-916275085243` | **Sierra Leone — NEW COUNTRY** (= the "Sierra H4" verify-first lead's likely country) | 2025-05-25 | 2 |
| Paramaribo H3 | PH3-SR | `84d28394-1a47-42fb-828d-af322e22a497` | **Suriname — NEW COUNTRY** | 2025-04-28 | 1 |
| Antigua H3 | AHHH | `753517a9-bdcf-4895-8156-e58f4a4cc7b0` | **Antigua & Barbuda — NEW COUNTRY** (Caribbean) | 2025-03-15 | 5 |
| Addis Ababa H3 | A2H3 | `a6cf6d01-74b4-4029-ac3e-e0153b8f32b1` | **Ethiopia — NEW COUNTRY** | 2025-03-15 | 2 |
| Abuja H3 | AbujaH3 | `fa948a7e-c51f-4024-8e81-fb09c30977c1` | **Nigeria — NEW COUNTRY** | 2024-11-15 | 10 |
| Bahrain H3 | BH3-BH | `ad92519a-7b71-4459-b36f-e7c2bb13e23b` | **Bahrain — NEW COUNTRY** | 2024-10-21 | 9 |
| Bucharest Full Moon H3 | BFMH3-RO | `e849b53f-1d85-488c-91d3-fedfe773766f` | **Romania — NEW COUNTRY** (Bucharest) | 2025-11-07 | 5 |
| Braunschweig H3 | BSH3-DE | `2173fe67-661b-4a2e-978b-b7facc1a403a` | Germany — new metro (deep, 37 runs) | 2025-11-25 | 37 |
| Okinawa H3 | OH3-JP | `f5f9bb8d-c731-4793-a682-7315e654fccf` | Japan — Okinawa metro already in `region.ts` map, no kennel (74 runs) | 2025-10-26 | 74 |
| Århus H3 | AH3-DK | `45f9ad00-025b-43c1-9521-a01361f4c69b` | Denmark (Copenhagen live) — new Århus metro | 2024-10-20 | 3 |
| Tavira H3 | TH3-PT | `d51ae590-79a6-4e8e-bd8d-52ebc2c68d8d` | Portugal — Algarve sibling (already noted as future) | 2025-01-31 | 2 |
| Barcelona H3 | BaHHH | `65024df8-20c1-419d-a1cd-6c96af8360d4` | Spain (Mijas live) — new Barcelona metro | 2024-07-11 | 1 |
| Vancouver H3 | Vanhash | `b9ff0887-1987-4829-a17f-2d2a4b941aa4` | Canada — new Vancouver metro | 2025-07-28 | 3 |
| Rideau H3 | RH3-CA | `9f7ad540-1525-4e17-b20c-ccdc55708554` | Canada — Ottawa area (Ottawa `oh3-ca` live) | 2025-02-20 | 4 |
| Bow Valley H3 | BVH3 | `641fb4ec-887a-4ae9-bca9-c7e3f33d0963` | Canada — Alberta (Calgary live) | 2024-09-14 | 1 |
| Mengo H3 | MH3-UG | `a74266de-b164-40c3-a365-65f7c09e0022` | **Uganda** (= the Kampala verify-first lead's country; Mengo = Kampala) | 2024-11-22 | 2 |
| CoMoTION H3 | CoMoH3 | `1d7ebbe8-641c-4c91-8d32-32a536ecc81e` | US — Columbia MO (new metro) | 2025-06-27 | 1 |
| Yorkshire H3 | YH3 | `5ee2d8ec-57a4-4461-ae5c-bcf0de3f4ce0` | England — new Yorkshire/Leeds METRO | 2026-02-22 | 5 |

## Bucket C — UK/Ireland regional (well-covered region; lower priority)

| Kennel | HC slug | PublicKennelId | Last run | Runs/2y |
|---|---|---|---|---|
| Devon A2B | DA2B | `a3844c71-7a31-4ef7-a6e0-2444023182ac` | 2025-12-06 | 15 |
| Golden Vale H3 (Ireland — Tipperary) | GVH3 | `2afd08e1-e6c1-4d58-888e-f2c3217eeca6` | 2025-05-17 | 5 |
| Portsmouth & District H3 | PADH3 | `a934c55f-aaca-4cd6-bf8a-9894143df07a` | 2024-11-18 | 3 |
| Gloucestershire Gourmets H3 | GGH3 | `8b472dfa-2961-4b2f-bc6d-c17c84dfdc46` | 2024-08-08 | 6 |

## Bucket D — Novelty / nomadic / event-based or ambiguous (deprioritize / verify identity)

These are likely **travelling events or one-offs, not standing local kennels** — HashTracks onboards
kennels with a fixed home region, so most of these don't fit. Verify before spending effort.

| Name | HC slug | Why deprioritized |
|---|---|---|
| EuroHash | EuroHash | The annual pan-European gathering (event, not a kennel) |
| Interscandi | Iscandi | Nomadic Scandinavian gathering |
| Dalmatian Hash Cruise | DHC | A cruise event |
| Ski H3 | SkiH3 | Ski-trip hash (nomadic) |
| EH80s | EH80s | Themed one-off / sub-event of Edinburgh |
| The Pub H3 | PUB | Ambiguous (US LA tz); verify it's a standing kennel |
| Dongcheng Urban H3 | DUH3 | Beijing/Shanghai urban one-off (1 run) — verify |
| Ski H3 / CoMoTION / Bow Valley | — | 1–2 runs only; may be defunct |

## Excluded — name-match false-positives (already LIVE, just under an abbreviated slug)

The diff flagged these because our slug is an abbreviation that doesn't contain the city name. They are
**already live** — do not onboard. (Documents the heuristic's known blind spot.)

- **Amsterdam H3** → live as `ah3-nl` · **Aloha H3** → `ah3-hi` · **Frankfurt Full Moon** → `ffmh3`
  · **Minneapolis H3** → `mh3-mn` · **Foothill H3** → `fth3` · **A Harrier Central Testx** (`HCTEST-Y`,
  a test kennel — ignore).
- **Oslo H3** (`OH3-NO`) — seeded as an iCal source (`oh3-no`) but **absent from the live sitemap** →
  either hidden/no-events or a **source-add** opportunity (repoint to HC). Verify separately.

## Already queued / handed off today (not re-listed)

Pranburi (`PSH3-TH`, handed off) · Belgrade EER (`BEERH3`) · Lune Valley (`LVH3`) · Try it Thursdays
(`TITs`) · Lyon (`LH3-FR`) · Heraultics (`Heraultics`) · KRASH (`KRASHH3`) · CERN (`CERNH3`) · Cropredy
(`Coh4`) · Divahhh (verify `divah3` slug identity) · Betawi / Sierra H4 / Drunken Dragon (verify-first).

---

## Recommended next move

Instead of one kennel/day, run a **single batch PR** for Bucket A (6 config-only HC kennels, all
recently active, mirroring the 2026-07-01 batch-of-10 pattern) — Prague is a new country, the rest are
new metros in covered countries. Then sweep Bucket B on each refill (re-checking recency), prioritising
the **new countries** (Czechia already in A; then DR, Sierra Leone, Suriname, Antigua, Ethiopia, Nigeria,
Bahrain, Romania, Bonaire). Regenerate this report monthly with the method above — the HC feed is the
single source of truth for "what's left."

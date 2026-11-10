# Retro — Hanoi Hash (hanoi-hash, the original Hanoi H3, Hanoi, Vietnam) — handoff 2026-09-25

**Not onboarded: the run data is empty.** The handoff's step-0 live-verify gate fails. Every run
widget on `hanoihash.com` renders empty, even in a real browser, so there's no verifiable current
run to build an adapter against. Re-verified live 2026-11-10.

## Evidence (2026-11-10)
- **Home page** `hanoihash.com`: HTTP 200, WordPress + Elementor, `article:modified_time`
  2026-11-10T05:19:40+07:00.
- **Run widgets.** They are `div.cdbi` placeholders hydrated by a third-party "cdbi" app
  (`https://1mme.com/cdbi/cdbi_main.js.php`, JSONP through `frames.php?d=hash&page=…` and
  `jcdbi.php?d=hash&query=…`). Rendered in Chrome after a 10 s wait:

  | Widget | Rendered |
  |---|---|
  | `hash\|this weeks run` | empty |
  | `hash\|wp_agenda` ("Coming up") | empty |
  | `hash\|runs` (the `/runs/` archive) | empty |
  | `hash\|wp random pic recent new` | "Run 1763 2025-05-31" |
  | `hash\|wp announcements` | "The Hanoi Hash House Harriers website address has changed. It is no longer hanoih3 dot com. The new address is HanoiHash.com." |

  Calling `frames.php` directly returns only a frame shell whose content loads through further
  JSONP calls.
- **No newer run data anywhere.** The most recent run data on the site is the May 2025 photo
  (#1763). The WordPress Run-Report posts stop at #1728 (Sep 2024), per the handoff.
- **Same finding as before.** The onboard-intl-html-nov session skipped this kennel on 2026-11-06 for
  the same reason: the 1mme.com cdbi widgets return empty.

## Dedup note for whoever picks this up
- The seeded `hanoi-h3` (`hanoih3.com`) brands itself "Traditional Hanoi Hash House Harriers (since 1991)".
  It is the breakaway, distinct from this kennel.
- The announcement above says the original used to live at `hanoih3.com`, which explains why the
  breakaway now holds that domain.
- ⚠️ The original's run numbering (#1728 Sep 2024 → #1763 May 2025, weekly) projects to about #1840 by
  Nov 2026. That's the same range `hanoi-h3` shows (#1840–#1843). Before onboarding, confirm the two
  kennels really keep separate run counts, and that `hanoi-h3`'s rows are its own. Otherwise the
  handoff's alias move ("Hanoi Hash House Harriers" off `hanoi-h3`) could misroute.

## What would unblock it
1. **The cdbi widgets show runs again.** Then capture the JSONP request that fills
   `hash|this weeks run` / `hash|wp_agenda` (the network tab while rendering) and build the adapter on
   that endpoint, as the handoff's step 4 says.
2. **Or the kennel publishes runs somewhere scrapeable.** Run-Report posts resuming on WP REST would
   work, as would the FB group `facebook.com/groups/hanoih3`. The group is private, so it isn't a
   source today.
3. **Or, on the owner's call,** a `STATIC_SCHEDULE` for the documented weekly Saturday bus (13:30 summer /
   13:00 winter, 36 Ngo Quyen St). That has no run data, so it would only be worth it if the owner
   wants the kennel listed anyway.

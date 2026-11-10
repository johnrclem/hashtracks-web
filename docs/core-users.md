# HashTracks Core Users

**Last updated:** 2026-11-10 (draft for the Nov 2026 design review)

**Product goal:** people come back regularly to find hashes and treat HashTracks as a
reliable source of hash event information. This matters most when they don't know where to
look: nearby, or while traveling.

---

## What we know

| Evidence | What it says | Strength |
|---|---|---|
| Hash House Harriers Facebook group (16.6K members), reviewed March 2026 ([facebook-user-research.md](facebook-user-research.md)) | The most common post is "Is there a hash in [place]?" from travelers and people who moved. The answers are half-mind.com links, gotothehash.net links and Facebook group links pasted by hand. Dead kennels are a common trap. | Strong evidence of demand |
| PostHog, Mar–Nov 2026 | Has never recorded a signed-out visitor: the `/ingest` analytics route was blocked by Clerk for anyone not signed in (fixed in PR #2873). The "6 visitors in 90 days" were signed-in users, mostly the owner's admin pages. | None yet: real traffic is unknown |
| Accounts (local DB copy, June 2026) | 14 users. 9 have never logged a run. One account holds most of the check-ins. | Medium: the copy is months old |
| In-app feedback | 16 issues, the last one in March 2026. Mostly photos, Strava sync and map links. | Weak: very few people use it |

**We can't measure the goal yet.** Signed-out visitors were never recorded, and PostHog runs
with `persistence: "memory"`, so a signed-out visitor gets a new ID on every full page load.
PR #2873 fixes both: analytics skip the login check, and a date-only marker in the browser
reports new vs. returning visits. A baseline needs a week or two of data after it ships.

---

## The users

### 1. The traveler (primary: how people find us)

**Who:** an experienced hasher going somewhere else for a work trip, a holiday or a race
weekend. Often hashes in many places and keeps count of kennels, states or countries.

**Their question:** "Is there a hash where I'll be, while I'm there?"

**When they ask:** while planning, days or weeks out, or after arriving ("tonight", "this
weekend").

**What they need:**
- One search by place and dates that gives an answer. When nothing is on, it says so and
  shows the nearest alternatives.
- Confidence that the run is real: where the information came from, when it was last
  confirmed, and a link to the kennel's own page or group.
- How to show up: start time, start location on a map, cost, trail length or shiggy level,
  and how to contact the kennel. Visitor etiquette helps too.
- Add to calendar and share with a travel buddy.

**When they come back:** on the next trip. Their visits come in bursts, not every week, so the
hooks are remembered trips, saved searches and alerts.

**What they use today:** Facebook group posts, half-mind.com, gotothehash.net, the Harrier
Central app where a kennel uses it, and Hash Rego for big events.

### 2. The local regular (primary: the reason to return weekly)

**Who:** hashes with one or two home kennels, sometimes more in a big metro. Knows the local
scene.

**Their question:** "What's on around me this week?" Second: "How many runs have I done?"

**What they need:**
- A fast weekly view of every nearby kennel, with their own kennels first.
- To notice changes and cancellations without hunting for them.
- Add to calendar.
- A reason to sign in: the logbook, run counts and milestones.

**When they come back:** weekly, but only if the view is faster and more complete than
checking several Facebook groups.

**What they use today:** their home kennel's Facebook group, WhatsApp chat, email list or
website.

**Risk:** they already know their home kennel's schedule. HashTracks wins only on having every
kennel in one place, and on the logbook.

### 3. The newcomer (secondary: finding a hash at all)

**Who:** someone who just moved, a lapsed hasher, or someone who has never hashed and searched
"hash run near me" or "what is hash house harriers".

**Their question:** "Is there an active hash near me, and what's it like?"

**What they need:**
- Kennels near them, ranked by activity (last run, next run), not a directory full of dead
  kennels.
- What each kennel is like: how often it runs, run style, whether it suits families or has a
  bike hash, and cost.
- A plain explanation of hashing for first-timers, and how to make contact.

**When they come back:** once they pick a kennel, they may become a local regular.

### Out of scope for now: the kennel officer

Misman, GMs and hare raisers. They will matter later for accurate data and attendance, but
the data pipeline is built so we don't need them. Design for them only where it builds trust
for the three users above, for example an "Is this your kennel? Fix the info" link.

---

## What this means for design

1. **Trust is the product.** Every event shows where it came from and how fresh it is.
   Predicted runs look clearly different from confirmed ones.
2. **Place and date are the main question.** "Where and when" should be the front door, not a
   filter.
3. **An empty result is still an answer.** "No runs in Biloxi that week. Nearest: Mobile (1 hr),
   New Orleans (1.5 hr)" beats a blank list.
4. **Give people a reason to return:** saved places and kennels, trip alerts, logbook
   milestones.
5. **Phone first.** Travelers and regulars both check on the go.
6. **Measure returning visitors** before optimizing for them.

---

## Open questions

- What share of real visitors are travelers versus locals? We can't tell yet.
- Will regulars sign in for the logbook, or stay anonymous?
- Will this community accept "notify me" emails or push alerts?

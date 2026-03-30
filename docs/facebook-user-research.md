# Hash House Harriers Facebook Group — User Research Report for HashTracks.xyz

After thoroughly reviewing recent posts and comments in the Hash House Harriers Facebook group (16.6K members), here are the key findings organized by pain points and specific locations.

---

## COMMON PAIN POINTS

### 1. "Where Is There a Hash?" — The #1 Problem
The most frequent post type is tagged **"InSearchOf"** and follows a simple pattern: someone traveling or relocating asks the group if there's a hash in [location]. These posts generate massive engagement (up to 72 comments on the Texas post, 59 on the Florida post), which tells you two things: there's huge demand, and there's no single reliable tool that answers this question.

**Key examples from the last few weeks alone:**
- "Is there a hash in texas" (64 likes, 72 comments)
- "Is there a South Florida H3 chapter group? (West Palm Beach/Miami)" (12 likes, 59 comments)
- "Is there a hash near Charleston, SC this week?" (Yesterday)
- "Any hashes near Biloxi, Mississippi?" (20 comments)
- "I'm in Portland Maine. Is there a hash here?" (22 comments)

### 2. Too Vague, Too Big — The Location Precision Problem
When someone asks about a state or large region, the immediate response is always **"narrow it down."** Texas is the perfect case study: commenters pointed out that Texas is bigger than most of Europe and some cities have 5+ kennels, while other areas have none. One person estimated about 40 kennels in Texas alone. Responses repeatedly asked "What part?" and "How far are you willing to drive measured in hours?"

**Your app opportunity:** Location-aware search with radius/drive-time filters. People don't just need "Texas kennels" — they need "kennels within 2 hours of San Antonio."

### 3. Fragmented, Outdated Resources
Three resources get shared repeatedly by the group admin and experienced hashers, but none is comprehensive:
- **half-mind.com** (e.g., half-mind.com/regionalwebsite/p_list1.php?state=TX for Texas contacts, ?state=KY for Kentucky, ?state=FL for Florida)
- **gotothehash.net** (genealogy.gotothehash.net for chapters by state)
- **Individual Facebook group pages** (people share direct FB links to local kennel groups)

The group admin Matthew Kleinosky manually pastes half-mind.com links in nearly every search thread. One community member (Pryvette SInohbawl) had to manually create a visual map of all Florida kennels because no existing tool showed them. This map was labeled "as of March 2026" and included both active and inactive kennels.

### 4. Dead/Inactive Kennels
Multiple comments reference kennels that "used to run" but are now inactive. Examples include Biloxi H3 ("used to run fairly frequently"), a hash in Davis called "DUHHH" that "died quickly," and "all kennels are dead" jokes about Texas. One commenter even said she kept inactive kennels on her Florida map "just in case they are restarted." There's no way to know if a kennel is active without asking around.

### 5. Travel Hashing — The "Hash Tourist" Use Case
A huge segment of this community are **travel hashers** (self-described as "travel whores") who visit kennels in new cities. Sarah Modlin's post about visiting Kentucky for a marathon and wanting to hash along the way (86 likes, 19 comments) and Monica Danger Wiggins looking for a hash in any new state reachable by cheap nonstop flight from Denver (23 comments) exemplify this. These users want to discover and plan hash visits while traveling.

### 6. Timing and Scheduling Conflicts
The Charleston post revealed a key issue: the local hash was cancelled because of a city bridge run event. Someone had to explain in real-time that hashers would be at the bridge run instead. Real-time event awareness and calendar integration would be extremely valuable.

### 7. Asking About Individual Hashers, Not Just Kennels
Some posts search for specific hashers by hash name (e.g., "Plastic Chaps My Ass" in Indiana) or look for any hashers in an area — not formal kennels. Julia Stewart in Tangier asked for "a hash (or hashers)" explicitly distinguishing between organized events and informal connections.

### 8. International Discovery Is Even Harder
Posts searching for hashes in Iceland/Reykjavik, Brazil (Belo Horizonte, Sao Paulo), Morocco (Tangier), and the inaugural KeflavikH3 in Iceland show that international discovery is even more challenging. One person asked about Belo Horizonte two years in a row because she couldn't find an answer.

---

## SPECIFIC LOCATIONS PEOPLE ARE SEARCHING FOR

### United States
| Location | Post Details |
|---|---|
| **Texas** (general, then Houston, San Antonio, Dallas, El Paso) | 72 comments, resources shared: AH3, NoDUH (North of Dallas Urban Hash), ~40 kennels statewide |
| **South Florida** (West Palm Beach / Miami) | 59 comments; kennels identified: Miami (Pryvette SInohbawl), Wildcard (Fort Lauderdale), Palm Beach H3, Treasure Coast H3, Lakeland/Polk County H3, Lehigh Acres H3, ~16 kennels on the peninsula |
| **Charleston, SC** | "This week?" — local hash cancelled for bridge run |
| **Biloxi, Mississippi** | "Can't find any active kennels"; nearest: Gulf Coast H3 (Mobile), NOH3 & Vudu (New Orleans), Survivor H3 (Pensacola), Low Key H3 |
| **Portland, Maine** | 22 comments |
| **Kentucky** (Louisville, Lexington) | Kennels: Louisville H3, Cerberus Legion Full Moon H3 (Lexington), Horses Ass (Lexington) |
| **Twin Falls, Idaho** | "Friend just moved there and needs community" |
| **Banff / Spokane, WA** | 3 comments |
| **Tulsa, Oklahoma** | "Weekend of the 18th?" |
| **Denver area** (looking for any new state by nonstop flight) | Excluding Washington, Oregon — 23 comments |

### International
| Location | Post Details |
|---|---|
| **Reykjavik, Iceland** | 13 comments; also KeflavikH3 just formed as a new "renegade" kennel |
| **Belo Horizonte, Brazil** | Asked twice (Oct 2023, Nov 2024) by the same person — still no answer |
| **Sao Paulo, Brazil** | 9 comments |
| **Tangier, Morocco** | Looking for hash or individual hashers |
| **Karachi, Pakistan** | Active — Run 1165 posted March 28 |
| **Yaoundé, Cameroon** | Active since 1986 |
| **Sandakan (Malaysia) → Guangzhou, China** | Cross-border hashing |

---

## RECOMMENDATIONS FOR HASHTRACKS.XYZ

Based on this research, the highest-value features to build would be:

**1. Location-aware kennel finder** with radius/drive-time search — the single most requested thing in this group. Every "Is there a hash in [X]?" post is a user your app should capture.

**2. Active vs. inactive kennel status** — People need to know if a kennel is still running, not just that it once existed. A last-verified or last-run-date indicator would solve a huge trust gap.

**3. Traveler mode** — Let users input a trip itinerary or destination and surface kennels along the route or near the destination, with next-run dates. The "hash tourism" segment is passionate and well-connected.

**4. Kennel aggregation** — Consolidate the fragmented info from half-mind.com, gotothehash.net, and individual Facebook pages into one searchable database. Right now the admin is manually copy-pasting these links.

**5. Event calendar with real-time updates** — Show upcoming runs, cancellations, and special events (Red Dress, Green Dress, Interhash, campouts). The Charleston scheduling conflict demonstrates this need.

**6. "No kennel here yet" flag with interest registration** — For locations like Belo Horizonte where someone asks repeatedly with no result, let users register interest so that when a kennel forms, they're notified. Also supports the "set your own trail" ethos that commenters suggest for areas without formal kennels.

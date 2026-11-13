-- Literal HTML in user-visible event text (2026-11-13).
--
-- Every statement is keyed by Event id and guarded by the md5 (or NULL-ness)
-- of the value it replaces, so a row that changed since the 2026-11-13 read
-- is skipped (UPDATE 0) instead of overwritten. Re-running is a no-op.
--
-- 1. NOH3 (93 rows, 2010-03 → 2011-04, imported, no RawEvent). The calendar
--    packed whole notes into SUMMARY with "<br>" between lines. New title =
--    first line (+ the next line when it is a short name or theme, not a
--    Hares/LOC/$/time/address line), "Run# 1127" spelled "Run #1127", bare
--    "Run #…" titles prefixed "NOH3". Hares from a "Hares:" line fill a NULL
--    haresText (47); "#NNNN" fills a NULL runNumber when no other NOH3 event
--    holds it (44). The 2010-09-18 "Run #1154 & 1/2" pickup gives up run
--    number 1154 to the real #1154 (2010-09-13). Title lines missing from
--    the description are kept at its top (73).
-- 2. HTML-formatted descriptions → text, as the adapters now produce it:
--    Whoreman H3 calendar (lds 48, wasatch 14, slosh 9, slut 9; GCal Pandoc
--    "\(5" cost spans restored to "$5"), SHITH3 23, Jacksonville Timely iCal
--    20, BCH3 1, SVH3 1.
-- 3. haresText that swallowed "<br>…" description lines → first line only
--    (wasatch 6, slosh 1; a bare "TBD" becomes NULL). locationName "<br>"
--    → ", " (Copenhagen ch3-dk 1, ch4-dk 1).
--
-- Generated read-only from prod; forward fixes in the same PR stop new rows
-- (merge sanitizer turns "<br>" into a space / line break; iCal strips HTML
-- DESCRIPTIONs; `<br class=…>` now matched).

UPDATE "Event" SET "description" = '🐰 HARE: TSquatty Slavie
👯‍♂️ Theme: Ice Age Trail
📏 Distance: 3-4 miles
🔛 On-Out: Maple Wayside (in Hartland)
🌵 Shiggy level: some
🐕‍🦺 Dog friendly: Yes, just pick up after your puppers
🚾 Bathroom on trail: the woods
🍺 Booze plan: Cooler
💵 Hash cash: $7

https://www.facebook.com/events/1963449241186750/', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmnfkue5t001504l1mqnzj6gs' AND md5("description") = 'd0acd5c4b960ac4e7a2235b1715da92e';

UPDATE "Event" SET "locationName" = 'Oxbjergvej Parkinglot near Oxbjerget, Glostrup', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmof68etc003dfdhn0h8882z1' AND md5("locationName") = '566ff4c5951d3036baa0ae0994e3bccf';

UPDATE "Event" SET "locationName" = 'GROTESK Cafe, Teglholmsgade 36, 2450 København SV', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmof6ahve00j3fdhnkiwlgkep' AND md5("locationName") = '74403a5e434b2e2f628ae31e7121e74f';

UPDATE "Event" SET "description" = 'Event Description

Cum one, cum All for our annual fundraiser. We shall converge upon Ruby Beach Brewing and walk around tail gate city collecting funds for the Two Titmice foundation to support those undergoing treatments for Breast Cancer. That''s right! It''s all about the Boobs...and they are local boobs. See you there!', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmss2bs7m01dn04js7cp5v93x' AND md5("description") = '7ac0033ad13a51ffde779b5f26176229';

UPDATE "Event" SET "description" = 'Greetings, Welcum to the wine and cheese trail. For those of you Wankers who cannot camp this weekend, we bring you this trail opportunity.

HARE: A Mystery Hare

LOCATION: 793 Dutton Island Road W. Atlantic Beach, FL 32233

START TIME: We have to be careful about when the park closes. Start at 1:30 PM. So the Hares will be away at 2:00 PM

HASH CASH: $6 for shitty beer; $2 if you bring your own beverage.

SHIGGY METER: Is a 1.69. There will be some dirt. Mostly pavement.', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmss2bsdk01dp04jsl9mcj4su' AND md5("description") = 'ae95ca8d5d570ce1fd3644ef546f6333';

UPDATE "Event" SET "description" = 'Event Description

We are going to meet up behind Dave and Buster''s to piss in the woods and start our shenanigans somewhere. All you need to know is below:', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmss2bsjo01dr04jseo36pp4t' AND md5("description") = '016b7388794302dfec9715590eafa5c5';

UPDATE "Event" SET "description" = 'Event Description

Kayaking trail! What to bring Kayak, paddles and floatation device. and Hash cash. Towels and extra clothing. This will be a Yak Hash!', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmss2bsqb01dt04jscjwsnd8w' AND md5("description") = '7f77f88a2c121b6b1383242ae34a00c5';

UPDATE "Event" SET "description" = 'Event Description

Join Funsize as she returns to hare a trail.

Hey wankers, been a minute but I’m back!!! Been wanting to do this trail for a good minute and now it has commenced!

Hare- FUN SIZE

Shiggy meter- 3.69

Hash cash- $6 and virgins are free

Start time & length- 6:20, hare off at 6:35, 3 miles

Location- is behind the Verizon/firehouse subs on Roosevelt

What to expect- shiggy, bring a dry bag in case it rains,', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmss2bttj01e504jstsuipi56' AND md5("description") = '8662873578cf86672692f4ed9d851994';

UPDATE "Event" SET "description" = 'Event Description

Join us for a shortish trail or maybe not. The hare has been known to lie. It will be hot, so hydrate. There will be an on after with food of the hotdog and sausage persuasion along with a pool to swim in. Suits are optional. We might also elect new misman. Time to Nominate...

HARE: Butt Hare & a Mystery Hare
LOCATION: In front of LA Fitness 11901 Atlantic Blvd.
START TIME: 1PM Show 1:30 Go
HASH CASH: $6 for shitty beer; $2 if you bring your own beverage. Consider bringing your own cooler if you don''t want to share.
SHIGGY METER: Level 1.69 Don''t expect any major off road stuff. It may happen but I haven''t decided.
EXPECTATIONS: approximate trial length is 2 to 3 miles depending on how my back holds up. It''s A to A (back to start)
WHAT TO BRING: Dry bag (if you''ll get wet or sweaty), ID, cash, whistles, vessel, virgins. (Chairs & Towels recommended & swimsuits are optional)
There will be mystery shots on Trail.

The address for the On-After is 12368 Nesting Eagles Way.', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmss2bswp01dv04jsz0q651di' AND md5("description") = '41afdc075c4dee13079b883f6a4161cf';

UPDATE "Event" SET "description" = 'Event Description

This is a kayaking trail at Middleburg Boat Ramp #2, 3788 Main St, Middleburg 32068.
Hares: Flying Saucers/Fire N the Hole
Hash Cash: $5 (We will have beer/seltzer/Jell-O shots/snacks on trail)
Trail Deets: Expect to be on the water for approx 3-4 hours. (We can shorten trail if that’s the consensus of the hounds.) There are plenty of stops to get out and rest/swim.

Early start is to get everyone launched in the water before the landing gets crowded and parking diminishes. There will be significant boat traffic on the creek and some Middleburglars don’t care about slowing or creating big wakes, so we’ll stay to the sides of the creek.

Note: We will post updates if the weather doesn’t cooperate.

We have an extra kayak and a fat ass canoe if you need a water vessel. Just let us know in advance! We have plenty of crash/tent space if you want to stay over Friday and/or Saturday night (BYOE). (contact through the FB page)', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmss2bt3101dx04jshsv04usb' AND md5("description") = '3284033167d2fce63684d97d15f70987';

UPDATE "Event" SET "description" = 'EVENT DETAILS

This is a Place Holder for the Annual 4th of July Bike Pub Crawl. Details Forth coming.', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmss2btc301dz04jsjf7jle88' AND md5("description") = '8454ceb9e2b69e0a28af96a777cd7e65';

UPDATE "Event" SET "description" = 'Event Description

Please join us in celebrating Shauna (El Sav A Whore) with a party before she departs for Deutschland.

We plan to gather in the Tully room @ Lynch''s from 5 to 8 to have drinks to toast Shauna and wish her well on her adventures in Germany. Light hors''devours will be served as well as cake. Cash Bar.', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmss2bti901e104js7u78jvnc' AND md5("description") = '8679140495a462bff2fa0a8d94b3277c';

UPDATE "Event" SET "description" = 'Event Description

Greetings Hashers, It''s going to be a scavenger hunt or a bingo trail. There will be both trail and beer.

Following the hunt, there will be a pool party.

HARE: Black Hawk Hoe
LOCATION: 1803 Wofford Ave
START DATE: 7/25/26
START TIME: 2 PM
HASH CASH: $6 for shitty beer; $2 if you bring your own beverage. Consider bringing your own cooler if you don''t want to share.
SHIGGY METER: TBD
EXPECTATIONS: A to A
WHAT TO BRING: Dry bag (if you''ll get wet or sweaty), ID, cash, whistles, vessel, virgins, a bathing suit, a towel, etc...', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmss2btwd01e704js9f5og2yi' AND md5("description") = 'c67531455888bea0ed9311d98e84cd18';

UPDATE "Event" SET "description" = 'Event Description

This back to nature trail at 10931 Hood Rd Jax 32257 Your hares are Pipe down in the library co-hare just Crystal. This will be a fat girl trail, with lots of fun. what to bring for this trail:
your bones, a vessel, thirst for the nectar, and virgins if you got them.
If you want to be adventurous, dressed like a Dinosauurrr Rawr or Kitty Cat.
On after we be at Crystal’s, the address 10755 Gelding Dr.', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmss2bu1u01e904jsz0bx308n' AND md5("description") = 'b39743d35a704d30166a733da278d298';

UPDATE "Event" SET "description" = 'EVENT DETAILS

Details are available on HashRego.com. You must register:
https://hashrego.com/events/jaxbeachh3-jax-jax-beach-h3-tubing-and-chill-2026

Rego opens 6/1 @ 6PM Only $25.00 per person', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmss2bto101e304jszsrthttq' AND md5("description") = '4456b5d714b1780f74f6d611bac2070d';

UPDATE "Event" SET "description" = 'Event Description

Cum one, cum all! It’s national bacon day and who doesn’t love bacon, beer and boobs!

Hares- Fun Size and Just Sauce

Location- parking lot of legacy ministries and the fitness place.

Start time- arrive between 5-5:15 and hares away at 5:30

Hash cash- $6 and virgins are FREE

Shiggy- 2.69

Expectations- trail is a little over 2.69 miles, plenty of stops to refill your vessel, lots of photo opps! Wear shoes please! Plenty of pussy, trail treasure, and poss', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmtj7saj1001904jtemnl33si' AND md5("description") = '7343d951f11110770ac2f9a66d20e868';

UPDATE "Event" SET "description" = 'Event Description

It’s national cleanup day and national talk like a pirate day! So come in your best attire.

Hare- just Josh

Date and time- 09/19 at 11 and the hare away at 11:30 (it’s gonna rain later)

Shiggy- 2.69

Length- maybe 3 miles

Hash cash- $6 but virgins are free

What to bring- hash cash, ids, cards, thirst for beer, vessel, virgins and a desire to explore.', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmtj7sam4001b04jtsnuscf6f' AND md5("description") = '23ea9bc0f57f63ef4eba328be690aeac';

UPDATE "Event" SET "description" = 'EVENT DETAILS

If you got the invite, you have the details.', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmtj7sas3001h04jtwkmd30qs' AND md5("description") = 'c9db6ee9398d1f2351333c4d2d7bf192';

UPDATE "Event" SET "description" = 'Event Description

Hey All, Our Hare for today was feverishly trying to get everything set up for today''s trail but alas had automotive issues which we preclude her from being able to lay trail. We are going to switch things up a bit and do a drinking practice at Veterans United.

Pay As you Go

8999 Western Way, Ste. 104
Jacksonville, Florida 32256', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmtj7sao3001d04jttevy36n1' AND md5("description") = 'd40908bad967f597a5e7b257e2c53dff';

UPDATE "Event" SET "description" = 'Event Description

Halloween themed trail at Sheffield Regional Park
Hares are Kink Stink and Ink, and Just Jessica
On after is at my (Just Jessica''s) house! Bonfire, costume contest, spooky snacks and smores, and shenanigans', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmtkn84nv000g04le0u1gqjvy' AND md5("description") = '78110361b796c08aae6823d3ceca589d';

UPDATE "Event" SET "description" = 'Event Description

HARE: Flying Saucers
LOCATION: 11851 Stillwood Pines Blvd Jacksonville, FL 32224
START DATE: 10/24/2026
START TIME: 2:30 PM
HARES AWAY: 3:00 PM', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmtj7saqn001f04jtvnlrhcto' AND md5("description") = '10d34d9f9ca0c3847e534a2ce32fb71d';

UPDATE "Event" SET "description" = 'HARE: Kink, Stink, and Ink
LOCATION: 157 East 8th st 32206
START DATE: 11/07/2026
START TIME: 2:30 PM
HARES AWAY: 3:00 PM
HASH CASH: $6 for shitty beer; $2 if you bring your own beverage. Consider bringing your own cooler if you don''t want to share.
SHIGGY METER: 1.69
EXPECTATIONS: This is a pavement pounder. There will be lots of people and vendors. There will be 2 beer checks and 1 shot stop.
WHAT TO BRING: a thirst for beer, hash cash, IDs, vessels, virgins to sacrifice, whistle, shiggy socks (optional).', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmvk38r78005w04lev2qv3n60' AND md5("description") = 'edaf68f8ded5a5db7ced300cbc74346a';

UPDATE "Event" SET "description" = 'Event Description

HARE:
LOCATION:
START DATE: 11/21/2026
START TIME: 2:30 PM
HARES AWAY: 3:00 PM
HASH CA', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmvk38rbt005y04let8vlulca' AND md5("description") = 'cc7bc2ac3e4884715413a96f70c73ffe';

UPDATE "Event" SET "description" = 'I''ll be out of town, so I''m leaving you in Oral V''s handsy capabilities. She''s your babysitter for the drinking practice, and I expect you all to be on your best behavior for her. Daddy loves you.

https://www.facebook.com/events/697349183242599/', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpnghjes000ki4hnh3f3hbt1' AND md5("description") = '2a23f838d00ad0491a1d2e71c2ff32d7';

UPDATE "Event" SET "description" = 'Hare: Sensitive New Age Nipples
Hash cash: $5 (or $1 and BYOB)
Bring: whistle, cranium lamp, shiggy appropriate attire, and virgins w/ bananas.

https://www.facebook.com/events/736105392415273/', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpnghjsl000ni4hnpseamtex' AND md5("description") = '71aff3c394d1bf067c512d5d877a8f9b';

UPDATE "Event" SET "description" = 'Hares: Dragonballz Zzz Nutz & Just Itorri
Hash cash: $5 (or $1 and BYOB)
Bring: whistle, cranium lamp, shiggy appropriate attire, and virgins w/ bananas.

https://www.facebook.com/events/731257596268192/', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpnghk8k000qi4hn3dejil49' AND md5("description") = '71d99aceb913b7d031b9f2cf65b511ae';

UPDATE "Event" SET "description" = 'Hare: Hon Hon Hon Titty Croissants
Hash cash: $5 (or $1 and BYOB)
Bring: whistle, cranium lamp, shiggy appropriate attire, and virgins w/ bananas.

https://www.facebook.com/events/1226403928967998/', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpnghkmi000ti4hns4kwsu0p' AND md5("description") = '8034b225661f4d8c9161598989207783';

UPDATE "Event" SET "description" = 'Hare: Improper Cleanse
Free trail to "celebrate" the start of Campout weekend
Bring: whistle, cranium lamp, long pants, long sleeves, shiggy gloves, and virgins w/ bananas.

Where: Moss Ledge Waterfall, Big Cottonwood Canyon, mile marker 7. Just beyond the S curve. 40.6342139, -111.7115023

On-After will be at Canyons Edge Pub, 6522 S Big Cottonwood Canyon Rd.

https://www.facebook.com/events/729718196112645/', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpnghlu10010i4hni9kh2zte' AND md5("description") = 'fa1d9c2650cb1c68e797c252b5d8e4cc';

UPDATE "Event" SET "description" = 'Pie and Beer Trail
Grandeur Peak (Face) Trailhead
https://maps.app.goo.gl/Rpg4wv8XM9bZUhbE8

Hare: Legs Wide Open & Cuckold and Cuddles
Hash cash: $5 (or $1 and BYOB)
Bring: whistle, cranium lamp, shiggy appropriate attire, and virgins w/ bananas.

https://www.facebook.com/events/718247984147299/', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpnghmgq0016i4hny95jwnkw' AND md5("description") = 'e47d0f92f228def9e761611924902363';

UPDATE "Event" SET "description" = 'First Unitarian Church of Salt Lake

Group · Members of Whoreman Hash House Harriers (Salt Lake City, Ogden, Hill AFB, Utah)

Hare: Busload & Just Ki
Hash cash: $5 (or $1 and BYOB)
Bring: whistle, cranium lamp, shiggy appropriate attire, and virgins w/ bananas.', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpnghmzv0019i4hnb4nx9n6f' AND md5("description") = '90f20cb82922da41e50c5f1ab568d2fa';

UPDATE "Event" SET "description" = 'Hare: Dragonballz Zzz Nutz
Hash cash: $5 (or $1 and BYOB)
Bring: whistle, cranium lamp, shiggy appropriate attire, and virgins w/ bananas.

https://www.facebook.com/events/2544656429223591/', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpnghnpa001ei4hntn2rf6zc' AND md5("description") = '5448d17727b5306ba6e89dbb085be779';

UPDATE "Event" SET "description" = 'Hare: Busload
Hash cash: $5 (or $1 and BYOB)
Bring: whistle, cranium lamp, shiggy appropriate attire, and virgins w/ bananas.

https://www.facebook.com/events/767288329155524/', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpngho3b001hi4hnmew8j3a5' AND md5("description") = 'f283aaa3f40cf8eedba03bedbb5be6a7';

UPDATE "Event" SET "description" = '1868 W Springfield Rd SLC, UT 84116

Hare: Bad Draggin''
Hash cash: $5 (or $1 and BYOB)
Bring: whistle, cranium lamp, shiggy appropriate attire, and virgins w/ bananas.

https://www.facebook.com/events/714992657965780/', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpnghocy001ki4hnzagczmyz' AND md5("description") = 'f5304e0d32e705ded3e46cdfc5b4c903';

UPDATE "Event" SET "description" = 'Hares: Fuckin Spiders Man & Just Joe
Hash cash: $5 (or $1 and BYOB)
Bring: whistle, cranium lamp, shiggy appropriate attire, and virgins w/ bananas.

We will meet at Knudsen Park behind the Cotton bottom grill.

6pm gather, hares off @630. If your late, follow marks. My co-hare will be Just Joe, so come see this shit show tonight.

Bring ID''s, cash, lots of cash, as we may or may not visit "drinking establishments." It''s probably gonna be between 1 to 15 miles, some up hills some down hills, maybe a few flat spots. Be prepared to get wet, dry..mild crouch irritation and possibly sexual arousal. Remember, we are meeting in a city park, so bring protection, it''s your responsibility to prevent the itch.

On-on
Spidey!

https://www.facebook.com/events/1308417384196086/', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpnghopn001ni4hnfy5zijd2' AND md5("description") = '99f096d44fc880e6328f30e2815e5110';

UPDATE "Event" SET "description" = 'Let''s DP. Tell me where you want it.

https://www.facebook.com/events/1119767160099066/', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpnghp3t001qi4hnzfk21nmk' AND md5("description") = '2a6fb856f833c126b097751388ecb4bc';

UPDATE "Event" SET "description" = 'Hare: Osama Bin Hashing, Fuckin Spiders Man, & Improper Cleanse
Hash cash: $5 (or $1 and BYOB)
Bring: whistle, cranium lamp, shiggy appropriate attire, and virgins w/ bananas.

https://www.facebook.com/events/1449495956297540/', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpnghpj1001ti4hnw85907sz' AND md5("description") = 'e750c4e9d54cc3b01a4fb8104c9a8f46';

UPDATE "Event" SET "description" = 'Hare: Hon Hon Hon Titty Croissants
Hash cash: $5 (or $1 and BYOB)
Bring: whistle, cranium lamp, shiggy appropriate attire, and virgins w/ bananas.

https://www.facebook.com/events/2939582952895016/', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpnghpq1001wi4hnvl51j0fy' AND md5("description") = 'e5d763acc5d780b57558cc9d371d497b';

UPDATE "Event" SET "description" = 'Hare: Highbeams & Just Joe (for now)
Hash cash: $5 (or $1 and BYOB)
Bring: whistle, cranium lamp, shiggy appropriate attire, and virgins w/ bananas.

https://www.facebook.com/events/783571737498616/', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpnghqtg0023i4hniqxpo1y1' AND md5("description") = '19d3ed52e0672007407427997c5d4e1e';

UPDATE "Event" SET "description" = 'Hare: Soft Serve & Some Like It Spicy, I Like It White
Hash cash: $5 (or $1 and BYOB)
Bring: whistle, cranium lamp, shiggy appropriate attire, and virgins w/ bananas.

https://www.facebook.com/events/1454770299108725/', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpnghr550025i4hn3fzq8dd4' AND md5("description") = '2c588acf25d91483075b6e59339fc811';

UPDATE "Event" SET "description" = 'Who: Scent of a Man
What: A-A trail
Where: Harmony Park, 3760 S Main St, South Salt Lake, UT 84115
Hash cash: $5 (or $1 and BYOB)
Bring: map of Ao Island, whistle, a hunger for snacks, cranium lamp, extra cash for on trail, shiggy appropriate attire, claw machine skills, and virgins w/ bananas.

https://www.facebook.com/events/807396561785400/', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpnghrmo002ai4hnl89amjns' AND md5("description") = 'acc6c7f8d6230d064f346edc1d3c6169';

UPDATE "Event" SET "description" = 'Hare: Blue Cock in Garbage
Where: West Valley Skate Park
Hash cash: $5 (or $1 and BYOB)
Bring: whistle, cranium lamp, shiggy appropriate attire, and virgins w/ bananas.

https://www.facebook.com/events/1836864563846330/', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpnghrt8002di4hn9vx6yznj' AND md5("description") = '8408342eeecbff830c05ab1479b7c692';

UPDATE "Event" SET "description" = 'Hare: Kiss From A Rose On My Ass
Where: Orson Smith Park, 12625 S, 12625 Highland Dr, Draper, UT 84020
Hash cash: $5 (or $1 and BYOB)
Bring: whistle, cranium lamp, shiggy appropriate attire, and virgins w/ bananas.

https://www.facebook.com/events/5116538148570309/', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpnghs1i002hi4hnx5qia9kq' AND md5("description") = 'd5fe5108d3910c1ead0f95a66800edef';

UPDATE "Event" SET "description" = 'Hare: Hon Hon Hon Titty Croissants and Cuckold and Cuddle
Hash cash: $5 (or $1 and BYOB)
Bring: whistle, cranium lamp, shiggy appropriate attire, and virgins w/ bananas.

https://www.facebook.com/events/1387117872836319/', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpnghsfx002ji4hneouoaxv5' AND md5("description") = '6dc90639f9ab5cb08930e8c93144549f';

UPDATE "Event" SET "description" = 'Hare: TBD
Where: TBD
Hash cash: $5 (or $1 and BYOB)
Bring: whistle, cranium lamp, shiggy appropriate attire, and virgins w/ bananas.

Now that it''s colder and the weather is more inclement, we can opt for a DP or a trail. If the week is marked as a DP but you would like to hare, just say the word!

https://www.facebook.com/events/1981893692574536/', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpnght0z002oi4hnx8bztmf1' AND md5("description") = 'a5c53cf192132955c17077dd4a3bbe57';

UPDATE "Event" SET "description" = 'Hares: Just Rylee and Riley (Blue Cock in garbage- r word Kelly- rain man)

Where: Rotary glen (by hogle zoo)
Hash cash: $5 (or $1 and BYOB)
Bring: whistle, cranium lamp, change of shoes, shiggy appropriate attire, and virgins w/ bananas.

https://www.facebook.com/events/866098202437440/', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpnghteg002ri4hnivdu2jrd' AND md5("description") = '85418496f3f0e1ee6d9b3f131f29118d';

UPDATE "Event" SET "description" = 'Hare: Double Brown Diamond
Where: Neff''s Canyon Trail Head
Hash cash: $5 (or $1 and BYOB)
Bring: whistle, cranium lamp, shiggy appropriate attire, and virgins w/ bananas.

https://www.facebook.com/events/1334149268501974/', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpnghty1002ui4hno2sku9pz' AND md5("description") = '0a2cfe2eb096a0f6653329f6848956ad';

UPDATE "Event" SET "description" = 'Go drink and complain about all the shit you have to put up with tomorrow from your families.

https://www.facebook.com/events/4290978984504898/', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpnghuf3002yi4hnlzh26ltv' AND md5("description") = 'e340033c880177c9ed7450459e969574';

UPDATE "Event" SET "description" = 'Hare: Scent of a Man
Where: Liberty Park (tennis court parking lot)
Hash cash: $5 (or $1 and BYOB)
Bring: whistle, Hawaiian shirt, cranium lamp, thirst for beer, shiggy appropriate attire, map of Nepal, and virgins w/ bananas.

Now that it''s colder and the weather is more inclement, we can opt for a DP or a trail. If the week is marked as a DP but you would like to hare, just say the word! See less

https://www.facebook.com/events/1297701088827470/', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpnghur30031i4hn0d8kj9mc' AND md5("description") = '61560e2edb7b46682ab06d8b208d4f6c';

UPDATE "Event" SET "description" = 'Hare: Drinking practice!
Where: Second Summit Cider
Bring: trivia knowledge! they have trivia at 7 pm tonight.

Now that it''s colder and the weather is more inclement, we can opt for a DP or a trail. If the week is marked as a DP but you would like to hare, just say the word!

https://www.facebook.com/events/1350851039508969/', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpnghvej0035i4hn15c9anhi' AND md5("description") = 'f90f35c913a481a26a39ab2455d71b03';

UPDATE "Event" SET "description" = 'Hare: TBD
Where: TBD
Hash cash: $5 (or $1 and BYOB)
Bring: whistle, cranium lamp, shiggy appropriate attire, and virgins w/ bananas.
Now that it''s colder and the weather is more inclement, we can opt for a DP or a trail. If the week is marked as a DP but you would like to hare, just say the word!

https://www.facebook.com/events/2219351455240944/', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpnghvwe003ai4hng9mcivrq' AND md5("description") = 'def7d40dcc3ea5932291bc31e1523615';

UPDATE "Event" SET "description" = 'Hare: High Beams
Where: 5777 S Waterbury Circle Unity L, Murray UT 84121
Hash cash: BYOB
Bring: Spare liver, 1 gallon of water, comfy clothes, your favorite blanket, and a snacky snack. Kiddos are welcome.

With the NYE party at Smorgs, SL,UT doing the hangover trail in the morning, let''s do a Recovery DP/Family Movie night!

We''ll be watching SLC Punk. I''ll have some light snacks, BYOB and if you''d like to bring snacks to share, please do!

https://www.facebook.com/events/1352783836572609/', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpnghwpx003hi4hnl03lvden' AND md5("description") = 'bbb8aba2ec9c634332b997ef6e5d29b0';

UPDATE "Event" SET "description" = 'Hare: If you don''t like it, blame Blue. This was his idea!
Where: Lonestar Saloon
Hash cash: pay as you go, buy your own damn beer! 🤪
Bring: monies, ID, sense of adventure, curiosity.

https://www.facebook.com/events/1386856588947748/', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpnghx3p003ji4hnrbg8kedw' AND md5("description") = '82925b9c64362918e92ab402f4555689';

UPDATE "Event" SET "description" = 'Hare: Exhibushonist
Where: TBD
Hash cash: $5 (or $1 and BYOB)
Bring: whistle, cranium lamp, shiggy appropriate attire, and virgins w/ bananas.

https://www.facebook.com/events/1566120191271440/', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpnghxdl003oi4hn2xu2u3ew' AND md5("description") = '813fc94e55ad3e1754010262014bd199';

UPDATE "Event" SET "description" = 'Time to embrace your inner Dude, Lebowski! Freshen up your white Russian recipe, wax your balls, and let''s go bowling.

A prize to the best dressed.

https://www.facebook.com/events/849822744338455/', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpnghxlh003qi4hn4o8djgl0' AND md5("description") = '90125a4db20ce10035fbd400f3a6cd3c';

UPDATE "Event" SET "description" = 'Hare: Sensitive New Age Nipples
Where: Porter''s Fork Trail
Hash cash: $5 (or $1 and BYOB)
Bring: whistle, cranium lamp, shiggy appropriate attire, and virgins w/ bananas.

https://www.facebook.com/events/2746471652363158/', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpnghxzh003ui4hn8tb1zqjf' AND md5("description") = '75ea96650d8226362f9bfaee69508d57';

UPDATE "Event" SET "description" = 'Location: the Highlander
Bring out your virgins, ID, monies, and what''s left of your dignity.

Holler if you''d like to hare a trail

https://www.facebook.com/events/2743671369305259/', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpnghycl003xi4hnumvpmr71' AND md5("description") = 'dfebc0433dfeed499c4237869921584b';

UPDATE "Event" SET "description" = 'Hare: Bad Dragon
Where: Smoot Park

Smoot Park 75 W 1500 N, Centerville, UT 84014
Eastern lot, next to tennis courts

Hash cash: $5 (or $1 and BYOB)
Bring: whistle, cranium lamp, shiggy appropriate attire, and virgins w/ bananas.

https://www.facebook.com/events/1190459269777454/', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpnghyty0040i4hnacfz3roa' AND md5("description") = '10284df97400ceea52e3b62a760a2000';

UPDATE "Event" SET "description" = 'DP
Where: Second Summit Hard Cidery

https://www.facebook.com/events/25788633257436651/', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpnghz4s0044i4hnbxsxhgd1' AND md5("description") = '9bb4137e9d4a59b6c501a177a02c6105';

UPDATE "Event" SET "description" = 'Hare: DRINKING PRACTICE!
Where: Paxton Pub!

Hash cash: BYOB and BYOM(I heard a rumor they have Malört meow)
Bring: whistle, cranium lamp, shiggy appropriate attire, and virgins w/ bananas.

https://www.facebook.com/events/1234126654958203/', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpnghzib0048i4hndlbe3gzm' AND md5("description") = 'a909af7a66c622c13685d12efcbfadc0';

UPDATE "Event" SET "description" = 'Hare: Scent of a Man
Where: back of the Parley''s way Walmart parking lot

Hash cash: $5 (or $1 and BYOB)
Bring: whistle, cranium lamp, shiggy appropriate attire, and virgins w/ bananas.

https://www.facebook.com/events/1373423314535279/', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpnghzze004ci4hn6pubglvn' AND md5("description") = 'd945b7737c3f6169fb1895c6a57c04b1';

UPDATE "Event" SET "description" = 'Hare: our very favorite, STEVE!!
Where: Rotary Glen Park by Hogle Zoo, Pavilion Parking

Hash cash: $5 (or $1 and BYOB)
Bring: whistle, cranium lamp, shiggy appropriate attire, and virgins w/ bananas.

https://www.facebook.com/events/1470030968062358/', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpngi09o004fi4hn405iq8h6' AND md5("description") = '1dfedbbf9407d73f412a290a31a94d12';

UPDATE "Event" SET "description" = 'Hare: Blue & High Beams
Where: Jack''s Peak Trailhead

Hash cash: $5 (or $1 and BYOB)
Bring: whistle, cranium lamp, shiggy appropriate attire, and virgins w/ bananas.

https://www.facebook.com/events/858606567152692/', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpngi0m2004hi4hnmltp3xzl' AND md5("description") = 'e6e14b163ee65fc97e5d42d602056ad8';

UPDATE "Event" SET "description" = 'Hare: Hon Hon Hon Titty Croissants
Where: Popperton Park

Hash cash: $5 (or $1 and BYOB)
Bring: whistle, cranium lamp, shiggy appropriate attire, and virgins w/ bananas.

https://www.facebook.com/events/933440135787638/', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpngi0yk004ki4hnquj41xow' AND md5("description") = 'd337626fecb8ce7188f4f18533929831';

UPDATE "Event" SET "description" = 'Hare: Mirrors
Where: Happy Taps @ Hall Pass

Happy taps at the hall pass food court around 5 or earlier
No trail just beer than a show
Open seating 4/2 6:20

Project Hail Mary tickets:
https://tickets.clarkplanetarium.org/WebStore/Shop/ViewItems.aspx?CG=11&C=422&fbclid=IwY2xjawQ4_1ZleHRuA2FlbQIxMABicmlkETFFeUF6ZXFXVjI5YUVKbHhTc3J0YwZhcHBfaWQQMjIyMDM5MTc4ODIwMDg5MgABHibAWkSgDMl0ymgTdQQ8D9TS16wpVuIRbjr_r0bVOxG8ZM4RZqWCFQ3OocfC_aem_ZCY6kt3SMpoHIwBSPqeMgg

https://www.facebook.com/events/932051545933213/', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmnwb4vkx005004jxcyuqmib9' AND md5("description") = 'a5ff6f3bcef6fa317493d399ea46761e';

UPDATE "Event" SET "description" = 'Hare: Lesbian Art House Tentacle Porn & PeeShy for the Queer Eye
Where: 13922 S Hawberry Rd, Draper

Hash cash: $5 (or $1 and BYOB)
Bring: whistle, cranium lamp, shiggy appropriate attire, and virgins w/ bananas.

https://www.facebook.com/events/886831760814435/', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpngi219004si4hnk6rsjk67' AND md5("description") = '2d428db199498c9fb5994ddff6e018cf';

UPDATE "Event" SET "description" = 'Hare: Scent of a Man
Where: Jefferson''s Rectangle Park

Hash cash: $5 (or $1 and BYOB)
Bring: whistle, cranium lamp, shiggy appropriate attire, and virgins w/ bananas.

https://www.facebook.com/events/917709994293224/', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpngi272004ui4hncye5bhcx' AND md5("description") = '27bf6d2fa007a325dee8789dca418005';

UPDATE "Event" SET "description" = 'Hare: Bad Draggin
Where: Westpointe Park

Hash cash: $5 (or $1 and BYOB)
Bring: whistle, cranium lamp, shiggy appropriate attire, and virgins w/ bananas.

https://www.facebook.com/events/1299431565350601/', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpngi2n3004yi4hnewwqv7wf' AND md5("description") = '068e4d7b42243b65e356aac017ed2b41';

UPDATE "Event" SET "description" = 'Hare: Double Brown Diamond & High Beams
Where: Rotary Glen Dog Park

Hash cash: $5 (or $1 and BYOB)
Bring: whistle, cranium lamp, shiggy appropriate attire, and virgins w/ bananas.

https://www.facebook.com/events/2035707830328849/', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpngi2v00050i4hn8gk16bdf' AND md5("description") = '31f92245f7168c05cdd62128ce66b3eb';

UPDATE "Event" SET "description" = 'Hare: High Beams
Where: Living Room Trailhead (WHO SAID HEAD)

Hash cash: $5 (or $1 and BYOB)
Bring: whistle, cranium lamp, shiggy appropriate attire, and virgins w/ bananas.

https://www.facebook.com/events/1564357141312997/', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpngi3qy0056i4hniu4dxcdq' AND md5("description") = 'a599ff979d7cf94e86b1b9503074a34f';

UPDATE "Event" SET "description" = 'Hare: Scent of a Man
Where: Poplar Grove Park, 775 S 1200 W, Salt Lake City, UT 84104

Hash cash: $5 (or $1 and BYOB)
Bring: whistle, map of Mt Rushmore, cranium lamp, deodorant, shiggy appropriate attire, house keys, dollars for Hab, A golf club, basketball, bug spray, A laundry heap, a pocket knife, a battery, These are the things in my Jeep...... oh wait, nevermind.....and virgins w/ bananas!

https://www.facebook.com/events/1637645107259312/', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpngi3vs0058i4hnlbklbsvm' AND md5("description") = 'b677de6ef31a7816ab68fa857c232cfa';

UPDATE "Event" SET "description" = 'Hare: Dragon Ball Zzz''s Nuts ⬅️ JK he''s dead to us! Surprise Hare is Blue Cock in Garbage and maybe Bad Dragon!! Get ready for the shittiest trail no one scouted and if it''s bad we''ll still blame Dragon Ballzzz!

Where: LOCATION CHANGE... MURRAY PARK

Hash cash: $5 (or $1 and BYOB)
Bring: whistle, cranium lamp, shiggy appropriate attire, and virgins w/ bananas.

https://www.facebook.com/events/1707236056924063/', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpngi46h005bi4hnxxs37se5' AND md5("description") = '72adde47e787bb24489b03dc3d636e6d';

UPDATE "Event" SET "title" = 'Hash Social – Gordon Biersch', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpr8gbiv005fpyhnp75cc769' AND md5("title") = '6da819cf1f2324c28b50e5692cc6ba73';

UPDATE "Event" SET "title" = 'NOH3 Run #1127', "haresText" = 'Spread ''Em', "runNumber" = 1127, "description" = 'LOC: N. Rendon & Ursuline

Run# 1127 Hares: Spread ''Em LOC: TBA $6 hash 3pm show 3:30 Go!!!! Bring chalk, a drinking vessle and a sense of humor.', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpr8gbzj005jpyhna4o2ckzr' AND md5("title") = '1a37c234991a870d57ffdda19795f1bb' AND "haresText" IS NULL AND "runNumber" IS NULL AND md5("description") = 'a8fe6b5a2dc9d0125b2fc08ee9dbe060';

UPDATE "Event" SET "title" = 'Hash Social – Turtle Bay', "description" = '1119 Decatur St.

Happy hour prices for all hashers. The parade starts just a couple of doors down at Molly''s.', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpr8gcow005npyhnrekx5ftv' AND md5("title") = '3e7ca446b05a583f0869c1468b723634' AND md5("description") = 'cd49576298d99db364c01f3f95b2af6f';

UPDATE "Event" SET "title" = 'NOH3 Run #1128 – Green Dress Run !!!!', "haresText" = 'Tidy Bowl Man and Came Upon Me', "runNumber" = 1128, "description" = 'Yea! That''s right a great way to see Metairie Road... in a Green Dress!
Hares: Tidy Bowl Man and Came Upon Me
Loc: Metairie Road Public Library
$6 hash
10am show 10:30am go!

We''re cooking authentic Irish something or other and there will be a keg of O''Lite and O''Amber on tap. Be sure to dress for success as we''ll be having a costume strut-off just like last year. Cartwheels welcome.', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpr8gd0l005ppyhnknfbeozm' AND md5("title") = '95a3a256da635844be43759f2d030cf7' AND "haresText" IS NULL AND "runNumber" IS NULL AND md5("description") = '8268eb828de2437d158530c117a1cb3d';

UPDATE "Event" SET "title" = 'Hash Social – JB''s Bar', "description" = '115 Focis St.', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpr8gdp8005vpyhnketbjr5t' AND md5("title") = '6ded02b54fd19866ae0e1fdbc2e4c28c' AND "description" IS NULL;

UPDATE "Event" SET "title" = 'NOH3 Run #1129 – Irish/Italian Parade & Pig Roast', "haresText" = 'Coulda Tubed Ya, Hump Me Davidson, Piston Penis & Came Upon Me', "runNumber" = 1129, "description" = 'Hares: Coulda Tubed Ya, Hump Me Davidson, Piston Penis & Came Upon Me
LOC: Chase Bank - Corner of Vets & Homestead
$6 Hash
Time: 11:30 Show 12:00 Go

It''s the Irish/Italian Parade. We''ll be roasting a pig out on the parade route. So come out and celebrate your Irish/Italian-ness. We''ll be set up behind the Chase Bank on the corner of Homestead & Veterans.', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpr8ge1p005xpyhnd4a0upcg' AND md5("title") = 'b505183e9b5ac05f394303c24764adab' AND "haresText" IS NULL AND "runNumber" IS NULL AND md5("description") = '6e1963d9e7d6539b30c4c71c3b4e818b';

UPDATE "Event" SET "title" = 'Hash Social – Pyrate Parade', "description" = 'R Bar
1431 Royal St.

Avast ye scurvy dogs! It''s the start of NOLA Pyrate Week which means it''s a Pyrate Parade.

http://nolapyrateweek.com/', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpr8geoi0063pyhnfxrmigdq' AND md5("title") = 'faec1df153802e0127d727cb1ffd4e9b' AND md5("description") = '5d29cb6b25c81de02752b97a43fca1a2';

UPDATE "Event" SET "title" = 'NOH3 Run #1130', "haresText" = 'Piston Penis', "runNumber" = 1130, "description" = 'Hares:Piston Penis
Loc: Audubon Park at St. Charles, Look for the beer
$6 hash
6pm show 630pm go!!!!!

Our first Monday night hash of the year.', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpr8gex20065pyhncre12zqs' AND md5("title") = '252a65a0f269f630de2b97c91d2761c1' AND "haresText" IS NULL AND "runNumber" IS NULL AND md5("description") = '926d4192fcbf63ef613a0949f93e20a3';

UPDATE "Event" SET "title" = 'Hash Social – Ernst Cafe', "description" = '600 S. Peters St.

Party with the Capt Fun Runners from Pensacola', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpr8gfhs006bpyhnjoxpmuqc' AND md5("title") = 'b39f32801e395dc85c826d76c27e12da' AND md5("description") = 'f933ba1ff9f2737de98f39ee68f9a396';

UPDATE "Event" SET "title" = 'Crescent City Classic Party – VIP Tent at the Practice Field', "description" = '$10 adults/$5 kids
Beer and BBQ

Food, fun and beer. $10 for adults and $5 for kids.', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpr8gfto006dpyhnbk2t2j2g' AND md5("title") = 'e4f12a8580a89c8fc3dafa5477d145f5' AND md5("description") = '9a33f951744053e9918eac414bdcead9';

UPDATE "Event" SET "title" = 'NOH3 Run #1131', "haresText" = 'Piston Penis', "runNumber" = 1131, "description" = 'Hares:Piston Penis
Loc: Morial''s Balls (Convention Center Blvd at Diamon St.)
$6 hash
6pm show 630pm go!!!!!

Come recupperate after all the fun at the Crescent City Classic. Meet up at Morial''s Balls for 6.', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpr8gg4v006fpyhnom6ma4s7' AND md5("title") = '97a29e0b76cc918e5e5f503b2bb0e78e' AND "haresText" IS NULL AND "runNumber" IS NULL AND md5("description") = '3e639d9b2c33d2167e7f6be330b76447';

UPDATE "Event" SET "title" = 'MissManagement Meeting – New York Pizza', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpr8ggl9006jpyhn67diaozg' AND md5("title") = '3bd978fd9e113e35bf690becb67e3b38';

UPDATE "Event" SET "title" = 'NOH3 Run #1132', "haresText" = 'Inject Her Gadget, Genital Cuntractor, Hump Me Davidson & Came Upon Me', "runNumber" = 1132, "description" = 'It''s a Hooters Hash. Cum dressed as your favorite Hooters wench
Hares: Inject Her Gadget, Genital Cuntractor, Hump Me Davidson & Came Upon Me
$6 Hash
LOC: Parking lot next to Hooters. Look for the beer truck.

It''s a Hooters Hash. Put on your tight orange shorts and strap on your white high top sneakers. We''re paying homage to the folks who turned a man cave into an American iconic restaurant.', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpr8gh3h006npyhnjkrbbbpw' AND md5("title") = '57740e6774c5d92759c00c85a2369557' AND "haresText" IS NULL AND "runNumber" IS NULL AND md5("description") = '3c7ee997fb973b910d0db421ab550247';

UPDATE "Event" SET "title" = 'Hash Social – Abita Wheat Pub Crawl', "description" = 'Howlin Wolf
907 S. Peters St.', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpr8ghu2006tpyhnvgdjwsk7' AND md5("title") = 'a3564f864eb7b139d8557624c3c6c35c' AND "description" IS NULL;

UPDATE "Event" SET "title" = 'NOH3 Run #1133', "haresText" = 'Bleeding Paloma & High Beams', "runNumber" = 1133, "description" = 'Loc: 171 Harrison Ave
Hares: Bleeding Paloma & High Beams
$6 Hash', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpr8gihp006xpyhnwy679x5e' AND md5("title") = 'd5b2bbb882b9732261a363d2cea36322' AND "haresText" IS NULL AND "runNumber" IS NULL AND "description" IS NULL;

UPDATE "Event" SET "title" = 'Hash Social – Jazz Fest', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpr8giyo0071pyhniy4rqaic' AND md5("title") = '10f016ecfc86866cd060d9ae03708aeb';

UPDATE "Event" SET "title" = 'NOH3 Run #1134', "haresText" = 'Piston Penis & Indicksision', "runNumber" = 1134, "description" = 'Hares: Piston Penis & Indicksision
LOC: New Orleans Museum of Art
$6 Hash', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpr8gjcv0073pyhni7d0wqoo' AND md5("title") = '07a4a88fad33a9f5be1d9f914a4c29d4' AND "haresText" IS NULL AND "runNumber" IS NULL AND "description" IS NULL;

UPDATE "Event" SET "title" = 'NOH3 Hash Social – Liuzza''s by the Track', "description" = 'After the Jazz Fest

NOH3 Hash Social', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpr8gk5m0079pyhn2xcrexk0' AND md5("title") = '4fdcd1133341a274ffb9e96ba6a102f6' AND md5("description") = 'd0a3d001b7a67c9107f706fbc539967d';

UPDATE "Event" SET "title" = 'NOH3 Run #1135 – Cinco de Hasho', "haresText" = 'Hump Me Davidson, Purrrfurrred Pussy & Vagazzled', "runNumber" = 1135, "description" = 'Hares: Hump Me Davidson, Purrrfurrred Pussy & Vagazzled
$6 hash

Grab your ponchos, sombreros and fake mustaches. It''s Cinco de Hasho time again. Cross the border to Vagazzled''s casa.', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpr8gkj5007bpyhnmnyqtr0j' AND md5("title") = 'ee49c6e987e5ca4c95a2ac4dd72a9fd1' AND "haresText" IS NULL AND "runNumber" IS NULL AND md5("description") = '21403c07dc198e8036abf4d6344d92ae';

UPDATE "Event" SET "title" = 'NOH3 Free Hash Social – Winston''s', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpr8gl5r007hpyhn7ot0fgqp' AND md5("title") = '3cde7ef13aedcecb9779020ad67b38f7';

UPDATE "Event" SET "title" = 'NOH3 Run #1136', "haresText" = 'Pocket Rocket & ED Bone Home', "runNumber" = 1136, "description" = 'Hares: Pocket Rocket & ED Bone Home
Loc: Where Jaegers used to be at West End
$6 Hash

Meet up where the old Jaeger''s used to be out at West End. 6:00 Show 6:30 Go.', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpr8glhh007jpyhnbpodn7yl' AND md5("title") = '8f6601002b177cc1dac6cecc1b9efea2' AND "haresText" IS NULL AND "runNumber" IS NULL AND md5("description") = '7627054d072bc25cf20160a6d78637af';

UPDATE "Event" SET "title" = 'NOH3 Hash Social – 28th Annual Tchoupitoulas Barathon', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpr8gm3h007ppyhni7umbxaf' AND md5("title") = '9b502905db4a091c67d8b3a94c9cab8e';

UPDATE "Event" SET "title" = 'NOH3 Run #1137 – Peter Teaser''s Birthday Hash', "haresText" = 'Peter Teaser & Swamp Bitch', "runNumber" = 1137, "description" = 'Hares: Peter Teaser & Swamp Bitch
Loc: City Park near the Hash Fountain
$6 Hash

Anyone for CAKE? It''s Peter Teaser''s birthday.', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpr8gmg3007rpyhnyu9ocw6w' AND md5("title") = '7a401e1509d5d603ce3e33de19d5fa17' AND "haresText" IS NULL AND "runNumber" IS NULL AND md5("description") = '841c16268a506bdb97f8f38e09dda278';

UPDATE "Event" SET "title" = 'NOH3 Hash Social – Tarpon Joe''s on the patio', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpr8gn2p007xpyhn8njti2w7' AND md5("title") = '7cc64c41ab9e88ec8ce7c42982f26d95';

UPDATE "Event" SET "title" = 'NOH3 Hash #1138', "haresText" = 'Just David, Just Leslie (Virgin Lays), Came Upon Me and Tasty Meat', "runNumber" = 1138, "description" = 'Hares: Just David, Just Leslie (Virgin Lays), Came Upon Me and Tasty Meat
LOC: Shooter''sClub - 2338 Hickory Ave., River Ridge
$6 Hash

Virgin hares Just David and Just Leslie ready to get their hare on.', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpr8gnf8007zpyhn96ozscr5' AND md5("title") = '6feefef2616e7e1ff4184195f20a2591' AND "haresText" IS NULL AND "runNumber" IS NULL AND md5("description") = 'fe8745b3bd022f0f44a1d93e77895d0d';

UPDATE "Event" SET "title" = 'Greek Festival – Opa!', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpr8go140085pyhnyamxkd7i' AND md5("title") = '0cfd3862bf696171574e87f6f4e8ec14';

UPDATE "Event" SET "title" = 'NOH3 Crawfish Boil – Shelter #6 Wally Pontiff Playground', "description" = 'Noon - til

Time to pinch some tail and suck some head. Guests (non-hashers) $10', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpr8goel0087pyhngndbiv2l' AND md5("title") = '115c079ddd9dd4ec854ef71155bf0b61' AND md5("description") = '405bbdd28073ade67964fa6c23927a9c';

UPDATE "Event" SET "title" = 'NOH3 Hash #1139 – Memorial Day Hash', "haresText" = 'Piston Penis & Penis Collada', "runNumber" = 1139, "description" = 'Hares: Piston Penis & Penis Collada
2:00PM BBQ and 6:00PM Show/6:30 Go
LOC: Near the Hash fountain in City Park
$6 Hash

Piston says bring your lawn chairs and get ready for some BBQ and Beer.', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpr8gopg0089pyhn4p27pisc' AND md5("title") = 'bb63f2b9510388fa7572c440d239bc62' AND "haresText" IS NULL AND "runNumber" IS NULL AND md5("description") = 'b350aa36fe4261d43dde477734187b5a';

UPDATE "Event" SET "title" = 'NOH3 Hash #1140', "haresText" = 'Coulda Tubed Ya, Little Red Head & Puppy Pumper', "runNumber" = 1140, "description" = 'Hares: Coulda Tubed Ya, Little Red Head & Puppy Pumper
LOC: Parking Lot of Lasalle Park (Enter from Airline)
6 Show 6:30 Go
$5 Hash

Better wear some freakin'' shiggy socks.', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpr8gp9m008fpyhn93shs0xd' AND md5("title") = '4e32eed8979bd13ad1bc3c7477ca5906' AND "haresText" IS NULL AND "runNumber" IS NULL AND md5("description") = 'b11a02abc0fc493bcfe0f619dc010016';

UPDATE "Event" SET "title" = 'NOH3 Hash Social – Rivershack', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpr8gphi008hpyhnw58chu6z' AND md5("title") = '4afa425e4f686bc58bcc9a0e9bf404f0';

UPDATE "Event" SET "title" = 'NOH3 Hash #1141 – Spread ''Em''s Going Away Hash', "haresText" = 'Spread ''Em', "runNumber" = 1141, "description" = 'Hares: Spread ''Em
LOC: Washington Square
$6 hash

Spread ''Em''s going away hash.', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpr8gqbb008npyhncswvhslt' AND md5("title") = '791f33bd554908618ddcb1b11964c727' AND "haresText" IS NULL AND "runNumber" IS NULL AND md5("description") = '89e90c5debfa20fa102623d2944b8a46';

UPDATE "Event" SET "title" = 'NOH3 Hash Social – Krewe of Palmyra', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpr8gqre008rpyhnh2gl5pkj' AND md5("title") = '1e32644e5c148f76e9fa41b927e1132c';

UPDATE "Event" SET "title" = 'NOH3 Hash #1142', "haresText" = 'Toe Hoe, Goey Blow & Piston Penis', "runNumber" = 1142, "description" = 'Hares: Toe Hoe, Goey Blow & Piston Penis
LOC: Robert E. Lee & Paris Ave.
6 Show 6:30 Go
$6 Hash', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpr8gr3z008tpyhntnf531hx' AND md5("title") = 'f6f965c68aea6942fae3e9698d257525' AND "haresText" IS NULL AND "runNumber" IS NULL AND "description" IS NULL;

UPDATE "Event" SET "title" = 'Voodoo Hahs – Game Ovaries (Virgin Lay) and TidyBowlMan', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpr8grct008xpyhn6yauuud7' AND md5("title") = '317ebf011c5d5913bfff7aa7fc6e0a7f';

UPDATE "Event" SET "title" = 'NOH3 Hash Social – Santa Fe', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpr8grp4008zpyhn7upow0q3' AND md5("title") = 'f559d3125bc43f3aef6a2ed79ef680fd';

UPDATE "Event" SET "title" = 'NOH3 Hash #1143 – Hash Splash', "haresText" = 'Mud Flaps & Pap Smear', "runNumber" = 1143, "description" = 'Hares: Mud Flaps & Pap Smear
LOC: 2500 Harvard Ave behind E Jeff Library
$6 Hash
2 Show 2:30 Go

Hash Splash - Be sure to bring your bathing suit.', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpr8gs660093pyhnmef4sdfe' AND md5("title") = 'c7e55ee4bc17acfd329853e3ce53e843' AND "haresText" IS NULL AND "runNumber" IS NULL AND md5("description") = '79e323856bffbaca74a4b179066cf847';

UPDATE "Event" SET "title" = 'Voodoo Hash – UnderCummer and Hobo Rodeo', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpr8gsa90095pyhnpobs3npx' AND md5("title") = '21a27a900d6b5b758595debd73fbd7ba';

UPDATE "Event" SET "title" = 'NOH3 Hash Social – No Mo Social Life for Coulda Tubed Ya', "description" = 'LOC: Bay Cafe in Metairie

Hosted by Coulda Tubed Ya. Couple of kegs and some eats from 5:30 till you can''t go no mo. Come say goodbye as Coulda starts his self imposed life as a hermit.', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpr8gslv0097pyhnaknjqdkl' AND md5("title") = '0177705f9e599d7fbc5355353f576e43' AND md5("description") = '11bf94f7ebe065b017242bac04e86d07';

UPDATE "Event" SET "title" = 'NOH3 Hash Run #1144 – Pre-running of the Bulls', "haresText" = 'Hump Me Davidson, Cuntpetitor & G String', "runNumber" = 1144, "description" = 'Hares: Hump Me Davidson, Cuntpetitor & G String
Loc: Deja Vu at Dauphine & Conti
6:00 Show 6:30 Go
$ 6

In the celebration of San Fermin in Neuva Orleans http://www.nolabulls.com/index.asp?id=0, we will be having a Pre-Running of the Bulls Hash Run in the Quarter. It is also my 3 year anniversary hash! My first hash ever was the Running of the Bullshit in July 2007 with Doc and Dental Damsel:) in which we celebrated Running of the Bulls too.

A lil'' preliminary info:

Hares: HumpMe Davidson, G-String, Cuntpetitor
When: Monday, July 5th
Where: see above
Time: 6pm SHOW, 6:30pm GEAUX
Cost: $6
Why: "¿Por qué no?" :)
Attire: any kind of white shirt, white shorts or skirt or pants, and a peice of red cloth/accessories around the waist or neck or wherever

Beer, food, Sangria...', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpr8gt19009bpyhnwtqrimn2' AND md5("title") = 'df1176e9af8625f7e58fab3b926696a3' AND "haresText" IS NULL AND "runNumber" IS NULL AND md5("description") = '8fdd3c7b66198863c16ee5f91511f5ea';

UPDATE "Event" SET "title" = 'Voodoo Hash – 8 Lays a week (Virgin Lay) AND ???', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpr8gt5o009dpyhnn3lwl4p4' AND md5("title") = 'a6bdd56c240718bdf372875bf2acb969';

UPDATE "Event" SET "title" = 'NOH3 Hash Social – Prytania Cafe', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpr8gtt1009fpyhnvr8bcyvs' AND md5("title") = '3a124d5faf481dccb495f048363ab8b8';

UPDATE "Event" SET "title" = 'Running of the Bulls – Starting at Three Legged Dog', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpr8gu5h009hpyhnkb4nrc1e' AND md5("title") = 'a240814a1c1a9fd5dd194a1a37ed5d18';

UPDATE "Event" SET "title" = 'NOH3 Hash Run #1145', "haresText" = 'In Cock Nito', "runNumber" = 1145, "description" = 'Hares: In Cock Nito
LOC: Corner of Burgundy & St Roch
$6', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpr8guqc009lpyhnc6ctwp1s' AND md5("title") = 'ac8f79db421323c55137f0afd00ad361' AND "haresText" IS NULL AND "runNumber" IS NULL AND "description" IS NULL;

UPDATE "Event" SET "title" = 'NOH3 Hash Social – Winston''s Pub', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpr8guz9009npyhnusi0nfii' AND md5("title") = '429b0d02b1ecb97577ca8529ae1a8519';

UPDATE "Event" SET "title" = 'NOH3 Hash Run #1146 – Gooey & Puppy''s Going Away Hash', "haresText" = 'Puppy Pumper & Gooey Blow and a mystery hare', "runNumber" = 1146, "description" = 'Hares: Puppy Pumper & Gooey Blow and a mystery hare
LOC: Shelter 10 Audubon Park
$ 6

Gooey Blow and Puppy Pumper are moving to Houston. Let''s send them away in style at Shelter 10 in Audubon Park.', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpr8gvoi009vpyhn527x7vkz' AND md5("title") = '7cad0b0e645777348349c3efe2ab4165' AND "haresText" IS NULL AND "runNumber" IS NULL AND md5("description") = 'a08fb9d79d3830dc815408de9038496f';

UPDATE "Event" SET "title" = 'Voodoo Hash', "description" = 'It''s my birthday! Fuck you! Everything Butt Sex and BabyFacial', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpr8gvtd009xpyhnvegpfoqe' AND md5("title") = 'a089fcdee3e1d166b363ff51aa95ce30' AND "description" IS NULL;

UPDATE "Event" SET "title" = 'NOH3 Hash Social – The Club House featuring .88 cent longnecks', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpr8gw4y009zpyhn281fcb76' AND md5("title") = '1f1fe64daa129b42783269f84d80d458';

UPDATE "Event" SET "title" = 'NOH3 Hash Run #1147', "haresText" = 'Little Red Head & Beer Fart', "runNumber" = 1147, "description" = 'Hares: Little Red Head & Beer Fart
LOC: Lafayette Square
$5 hash unless someone wants to volunteer to be food hare
6pm Show/6:30 Go

Little Red Head has stepped up to take an empty date. But he''s without his better half and has no cooking skilz. Anybody willing to be the food hare??? Get in touch with LRH. If nobody wants to handle the food then it''ll be $5 hash.', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpr8gwko00a3pyhnfv3azbmn' AND md5("title") = '65d7ea8898754967fee7fdc1123ae7b0' AND "haresText" IS NULL AND "runNumber" IS NULL AND md5("description") = '7e6aab5103dab6d06ff76d812934225f';

UPDATE "Event" SET "title" = 'NOH3 Hash Social – Going Away Party for Pope Snatch the First', "description" = 'LOC: InCockNitto''s house, St Roch & Burgundy

Snatch Shot will be cooking Hawaiian food and it will be a pot luck, so feel free to bring a dish. There will be a keg and there''s always a bar right across the street.', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpr8gxlh00a8pyhnhyl2j88m' AND md5("title") = 'd49e3baf590643ec2129de953cef82c1' AND md5("description") = '74f3cfad6fc0d948c960856b1d802714';

UPDATE "Event" SET "title" = 'NOH3 Hash Run #1148', "haresText" = 'Pope Snatch 1 (virgin hare), Just John (virgin Hare), Incocknito', "runNumber" = 1148, "description" = 'Hares: Pope Snatch 1 (virgin hare), Just John (virgin Hare), Incocknito
LOC: Parlay''s Dream Lounge, 870 Harrison Ave, New Orleans, LA
$6 Hash
6:00 Show/6:30 Go', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpr8gxxi00aapyhnjvlyic6k' AND md5("title") = 'cca898f9cff2e616967f1c82f5f35289' AND "haresText" IS NULL AND "runNumber" IS NULL AND "description" IS NULL;

UPDATE "Event" SET "title" = 'NOH3 Hash Run #1149 – Red Skirt Run!!', "haresText" = 'Ready Whip, 4 Sale on Trail, G-String,Boner Lisa, Mud Flaps, ComeLickHer', "runNumber" = 1149, "description" = 'Hares: Ready Whip, 4 Sale on Trail, G-String,Boner Lisa, Mud Flaps, ComeLickHer
LOC: Hash Fountain at City Park
$6 hash
6pm Show / 6:30 Go

It''s the Red Skirt Run!! Break out that red Catholic girl''s school skirt and hit the road.', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpr8gyc800aepyhnz4685a13' AND md5("title") = 'ff20f42f652b20a583fc3480c5cfa746' AND "haresText" IS NULL AND "runNumber" IS NULL AND md5("description") = 'a5b1b8c7e61b8a76ba3f21538f62e0e5';

UPDATE "Event" SET "title" = 'NOH3 Run #1150 – 2010 NOH3 Red Dress Run', "runNumber" = 1150, "description" = 'LOC Washington Square, Elysian Fields & Royal St, New Orleans, LA
Gates Open: 9am / Hares Away: Noon

Join 5,000 of your closest friends for a little fun in the French Quarter for a good cause (several good causes)', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpr8gyvi00akpyhnrsbda1iv' AND md5("title") = '2e05eb81148d95398fad06534fc7f52b' AND "runNumber" IS NULL AND md5("description") = 'e920fea8e97d5b30d535e7cb9d944f82';

UPDATE "Event" SET "title" = 'NOH3 Hash Run #1151', "haresText" = 'Penis Colada & Indickcision', "runNumber" = 1151, "description" = 'LOC: St Pius School, 6600 Spanish Fort Blvd
POOL PARTY - Theme: Support our troops! Yellow ribbons, USA flags, camo, etc.
6pm Show / 6:30 Go

Mon 8/23/2010
6pm NOH3 Hash Run #1151
Hares: Penis Colada & Indickcision
LOC: St Pius School
6600 Spanish Fort Blvd, NOLA 70124
POOL PARTY – Theme:Support our troops! Yellow ribbons, USA flags, camo, etc.
$6 Hash
6:00 Show/6:30 Go', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpr8gzw300aspyhn0aocj2s7' AND md5("title") = '736f749b8b5177a8ad8acf19cd8866a6' AND "haresText" IS NULL AND "runNumber" IS NULL AND md5("description") = '611d13c1797653058228df8d6b38278f';

UPDATE "Event" SET "title" = 'NOH3 Hash Run #1152', "haresText" = 'Old Hag & Mr. Mum', "runNumber" = 1152, "description" = 'Hares: Old Hag & Mr. Mum
Food/Beer Hare: Beer Fart
LOC: 1424 Cadiz St. NOLA 70115
$6 Hash
6:00 Show/6:30 Go

Uptown - between St. Charles and Prytania and 2 blocks uptown from Napoleon)', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpr8h0rl00b0pyhn2tlhq6qd' AND md5("title") = '218ef7d1a2664694443b30402bf4a037' AND "haresText" IS NULL AND "runNumber" IS NULL AND md5("description") = 'd8ce594ea0e4f96bba59ec221de26bd2';

UPDATE "Event" SET "title" = 'NOH3 Social - Metairie Beer-a-thon – JB''s Bar & Grill', "description" = '115 Focis St.

If it''s the Friday before Labor Day then that can only mean one thing; the Metairie Beerathon. Starting at JB''s just off Metairie Road, runners must hit three separate beer stops and make it back to the start. The course you run is up to you. Great party with beer, food, music by Mason and prizes. $12.00 early registration, $11:95 day of registration at JB''s.', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpr8h1kp00b6pyhn1k3zmclf' AND md5("title") = 'e5927e68062b313c21e416389d28dc08' AND md5("description") = 'e20cd1502af17e603e809de276190928';

UPDATE "Event" SET "title" = 'NOH3 Hash Run #1153 – Labor Day Hash', "haresText" = 'Mahatvajyhna, Little Red Head & Came Upon Me', "runNumber" = 1153, "description" = 'Hares: Mahatvajyhna, Little Red Head & Came Upon Me
LOC: The Village at Algiers Point
$6 Hash
6:00 Show / 6:30 Go

Come say goodbye to another summer.', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpr8h1xi00b8pyhn6yxg2zsc' AND md5("title") = 'b0a2e279dfd021a8a744161d9d47dbc4' AND "haresText" IS NULL AND "runNumber" IS NULL AND md5("description") = '0a4c83e4b5bbbc020580bfe94c4cbf63';

UPDATE "Event" SET "title" = 'NOH3 Hash Social – New Orleans Seafood Festival at Lafayette Square', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpr8h2eu00bcpyhnk7xqhtoc' AND md5("title") = 'a7248ddd42ae85d9480b83af62e4bf45';

UPDATE "Event" SET "title" = 'NOH3 Hash Run #1154', "haresText" = 'Came Upon Me & Tasty Meat', "runNumber" = 1154, "description" = 'Hares: Came Upon Me & Tasty Meat
LOC: Parking lot behind Robert''s, 5000 Block of Fairfield between Kent & Transcontinental
$6 Hash
6:00 Show / 6:30 Go', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpr8h2rf00bepyhnskfmqqxv' AND md5("title") = 'c4a31a658158915aea8d0d0b8f21549d' AND "haresText" IS NULL AND "runNumber" IS NULL AND "description" IS NULL;

UPDATE "Event" SET "title" = 'NOH3 Hash Social – Piston''s Halfway to St. Patricks Day Party', "description" = 'LOC: Wintson''s on Metairie Rd.

It''s half way to St. Patrick''s day and it''s Piston''s Birthday Bash all rolled into one big ball of fun at Winston''s on Metairie Road.', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpr8h35k00bipyhng692otte' AND md5("title") = '7790c58f3b3aedcedf871ba9e88348f2' AND md5("description") = 'af4791c2e3f4a28473ad8baa5482d228';

UPDATE "Event" SET "title" = 'NOH3 Pickup Hash Run #1154 & 1/2 – LSU Tailgate Hash', "haresText" = 'Came Upon Me, Purrrfurrred Pussy, Just Christie', "runNumber" = NULL, "description" = 'Hares: Came Upon Me, Purrrfurrred Pussy, Just Christie
LOC: LSU Campus
4:00 Show / 4:30 Go

Let''s introduce 80,000 LSU fans to the joys of hashing as we run trail through all of the tailgaters before the MS State game.

We''ll be tailgating before the hash, so come join us in front of the Veterinary School on Skip Bertman Dr by the river.', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpr8h3i100bkpyhnqprjmpzw' AND md5("title") = 'ad722b86c5906042bff75fc9a2bf0e81' AND "haresText" IS NULL AND "runNumber" = 1154 AND md5("description") = '77594dcddd4a2d6a2088ce698223d589';

UPDATE "Event" SET "title" = 'NOH3 Hash Run #1155', "haresText" = 'Piston Penis', "runNumber" = 1155, "description" = 'Hares: Piston Penis
LOC: Corner of Lapalco & Bellemeade
$6
6:00 Show / 6:30 Go

Watch a little MNF after the Hash', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpr8h3t700bmpyhnn3pdj4n6' AND md5("title") = '7937bf9f71263d459ce22721aad56b9c' AND "haresText" IS NULL AND "runNumber" IS NULL AND md5("description") = 'f437c12f1b6acac32d9bf9c2363bd6f0';

UPDATE "Event" SET "title" = 'NOH3 Hash Social – Penis Colada''s Birthday at Gordon Biersch', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpr8h44j00bqpyhnm58d2a24' AND md5("title") = 'bd6297f6aedcdce12fa34318dfaa114f';

UPDATE "Event" SET "title" = 'NOH3 Hash Run #1156 – It''s a Double D Hash', "haresText" = 'Penis Colada & Tidy Bowl Man', "runNumber" = 1156, "description" = 'Hares: Penis Colada & Tidy Bowl Man
LOC: 5200 Block of Veterans between I-10 and Transcontinental
$6
6:00 Show / 6:30 Go

Since we''ve go the two Danny''s haring the theme will be Double D. Do with it what you will.

You can park at 5246 Vets or 5240 Vets. To get there exit I-10 and head towards Transcontinental. Location is across Veterans from Rouses.', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpr8h4fy00bspyhnf7yjo4vh' AND md5("title") = 'ff97210ab6aa2393f9e9957eaecf9dca' AND "haresText" IS NULL AND "runNumber" IS NULL AND md5("description") = '62c344f38129f84e65012c9d13a17b45';

UPDATE "Event" SET "title" = 'NOH3 Hash Social – Gretna Fest', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpr8h4pf00bwpyhnzz2jmmwp' AND md5("title") = '6019689bb8914aa59acf3fadff01e4c1';

UPDATE "Event" SET "title" = 'NOH3 Hash Run #1157 – Who Ate My Burger? Hash', "haresText" = 'Ready Whip, Takes it in the Face', "runNumber" = 1157, "description" = 'Hares: Ready Whip, Takes it in the Face
LOC: Harbor Bar & Grill
$5 Hash
6 Show / 6:30 Go

Who Ate My Burger? Hash. Be sure to bring $$$ for food at the bar afterwards.

ALSO. NO TANK TOPS OR SLEEVLES SHIRTS ARE ALLOWED IN THE RESTAURANT.', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpr8h4z200bypyhn8vnjsofj' AND md5("title") = 'b5d9f80fffb53ee0b4ad661758e66f35' AND "haresText" IS NULL AND "runNumber" IS NULL AND md5("description") = 'b130461ebb3cbbe172eea990bab8172f';

UPDATE "Event" SET "title" = 'NOH3 Hash Social – Fill Me Up''s Birthday', "description" = 'Deutches Haus', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpr8h5fu00c2pyhnnbs3vi9p' AND md5("title") = '5adcafa0b65ae7fdf99c38bb3acea425' AND "description" IS NULL;

UPDATE "Event" SET "title" = 'NOH3 Hash Run #1158 – Analversary Hash', "haresText" = 'Piston Penis, Incocknito, Snatch Shot, Pap Smear', "runNumber" = 1158, "description" = 'Hares: Piston Penis, Incocknito, Snatch Shot, Pap Smear
LOC: Incocknito''s House
$6 Hash
12:00pm Show / 12:30pm Go', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpr8h5ot00c4pyhn46v9vszd' AND md5("title") = '5a7b30c5a132cdfc7414709f64a4aba4' AND "haresText" IS NULL AND "runNumber" IS NULL AND "description" IS NULL;

UPDATE "Event" SET "title" = 'NOH3 Hash Social – New York Pizza/Bronx Bar', "description" = 'Hash sponsored keg', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpr8h6aj00c8pyhn31ngr687' AND md5("title") = '03c6969cc3dcc560babb5fc130bc197e' AND "description" IS NULL;

UPDATE "Event" SET "title" = 'NOH3 Hash Run #1159', "haresText" = 'Piston Penis', "runNumber" = 1159, "description" = 'Hares: Piston Penis
LOC: Piston''s House
$6 Hash
3:00 Show / 3:30 Go

Saints away game at noon. Everyone is welcome to watch the game at PP''s house.', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpr8h6jg00capyhntfz3apwu' AND md5("title") = '2ac9423a0a218307c68924b559114f70' AND "haresText" IS NULL AND "runNumber" IS NULL AND md5("description") = 'ee728bfb59624223afed625f5c7da762';

UPDATE "Event" SET "title" = 'NOH3 Hash Social – Gretna Riverfront Amphitheater', "description" = 'Free Concert Series: Bag of Donuts

Free Concert Series: Featuring Bag of Donuts.', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpr8h6va00ccpyhndtoubajf' AND md5("title") = '4c49eea27154e10536f4428316271459' AND md5("description") = 'bac73a3cc86d6d93c1569d317493af81';

UPDATE "Event" SET "title" = 'NOH3 Hash Run #1160', "haresText" = 'Mud Flaps, Come Lick Her, Boner Lisa', "runNumber" = 1160, "description" = 'Hares: Mud Flaps, Come Lick Her, Boner Lisa
LOC: McGuire''s
$5 Hash
3:00 Show / 3:30 Go

Saints home game at noon.', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpr8h7c100cgpyhn4bdzzob2' AND md5("title") = 'ab357ee2c0fc64e889f89206b522ff0e' AND "haresText" IS NULL AND "runNumber" IS NULL AND md5("description") = '7c49dc2925566d9d3ef69437b3a493d3';

UPDATE "Event" SET "title" = 'NOH3 Hash Social – Red Door Bar', "description" = '206 N Carrollton Ave.

Halloween Warmup', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpr8h7ox00cipyhnlakg1p6l' AND md5("title") = '34284a0ce879263efcb5eaffd469a3d7' AND md5("description") = 'a937b57c5472db8886bb1def3e01ed7f';

UPDATE "Event" SET "title" = 'NOH3 Hash Run #1161 – Halloween Costume Hash', "haresText" = 'Tidy Bowl, Ready Whip, CUM, & Bush Hogg', "runNumber" = 1161, "description" = 'Hares: Tidy Bowl, Ready Whip, CUM, & Bush Hogg
LOC: Lafayette Square
$6 Hash
11:00 Show / 11:30 Go
THAT EVENING: Molly''s Parade 5pm
LOC: Molly''s at the Market on Decatur
5:00pm Show

It''s a Halloween Costume Hash. Theme: Want some candy little boy/girl? Costumes highly encouraged. Saints home game at 7:20PM.
Halloween Night: Molly''s Parade. at 5pm meet at Molly''s on the Market on Decatur St. Cost $5.', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpr8h83800cmpyhnegf67lla' AND md5("title") = 'fd05725d8fd3ff08c0be1b031bd1c354' AND "haresText" IS NULL AND "runNumber" IS NULL AND md5("description") = '9605f75cf8b3de038d31e01ef15ff3ca';

UPDATE "Event" SET "title" = 'Molly''s Parade', "description" = 'LOC: Molly''s at the Market on Decatur
$5
5:00pm Show

Pirate theme. Walking with our Pirate ship float in the Molly''s Parade which begins at 6pm', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpr8h8ic00copyhnp1fu56we' AND md5("title") = 'cbb92441126c0596d15662b5a5ccd063' AND md5("description") = '1665e89e3d0d34a5c498b5d9a14d56ce';

UPDATE "Event" SET "title" = 'NOH3 Hash Run #1162', "haresText" = 'Quarter Slut & Tidy Bowl', "runNumber" = 1162, "description" = 'Hares: Quarter Slut & Tidy Bowl
LOC: 425 Robert E Lee Blvd
$6 Hash
3:00 Show / 3:30 Go

Saint''s Away Game at Noon
You may watch game at Quarter Slut''s house, but please bring a food dish with you. Theme: NO Mo Ho-hercainne Season.... So, cum in Hurricane attire.', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpr8h9go00cwpyhnrrum6mdq' AND md5("title") = 'd10b7e86b416870197b6c0e18afd9875' AND "haresText" IS NULL AND "runNumber" IS NULL AND md5("description") = '024f69dcfb510fcdd81e8e4b4fa95149';

UPDATE "Event" SET "title" = 'NOH3 Hash Social – Bayou Beer Garden', "description" = '326 N Jeff Davis Pkwy

Bayou Beer Garden hash social 6pm', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpr8h9s200cypyhnupnsca6p' AND md5("title") = 'dcae676560d9cef3fbfd75c2de8a63c1' AND md5("description") = 'ea685cc22441bb48d10109f0e9639f51';

UPDATE "Event" SET "title" = 'NOH3 Hash Run #1163', "haresText" = 'Incocknito & Just John', "runNumber" = 1163, "description" = 'Hares: Incocknito & Just John
LOC: 928 Dante St
$5 Hash
12:30 Show / 1:00 Go

Live Music & Delicious Po-Boys! On- After at the Po-Boy Festival just a couple of blocks away!
Saints Bye Week', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpr8ha7t00d2pyhngtl6kp8s' AND md5("title") = '6ad5b6ff26011f50ad71f59683ef211d' AND "haresText" IS NULL AND "runNumber" IS NULL AND md5("description") = '8eed04b10434e3caaa5dbee27ef1c8d9';

UPDATE "Event" SET "title" = 'NOH3 Hash Social – Carrollton Station', "description" = '8140 Willow St NOLA 70118
5:30pm

Free keg for NOH3 hashers.', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpr8haku00d4pyhn5574ap8h' AND md5("title") = '74153a2a6a604480aeab4aa7402bb775' AND md5("description") = 'e2a77177d9884583ee9e9486f6e17f32';

UPDATE "Event" SET "title" = 'NOH3 Hash Run #1164 – Hashgiving', "haresText" = 'Only Oral', "runNumber" = 1164, "description" = 'Hares: Only Oral
LOC: General DeGaulle and Kabel Drive
$?? Hash
11:69 Show

Bring a dish with Food. On-After address: 2228 Easter Lane, Algiers, La 70114. You may drop your food dish off prior to hash. Gooey Blow will be there to warm it.
Saints home game at 3:05pm', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpr8hb3a00d8pyhnqu38dzer' AND md5("title") = '617d8f24fb49f7535cded85ef6c43168' AND "haresText" IS NULL AND "runNumber" IS NULL AND md5("description") = 'ddf637edb8705946b52ad44e46bd72bd';

UPDATE "Event" SET "title" = 'NOH3 Hash Social – River Shack', "description" = '3449 River Rd Jefferson La 70121
6pm', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpr8hbe100dapyhnxqykpvcf' AND md5("title") = '73779c8a304576182fd520aa98121439' AND "description" IS NULL;

UPDATE "Event" SET "title" = 'NOH3 Hash Run #1165', "haresText" = 'Swamp Bitch & Peter Teaser', "runNumber" = 1165, "description" = 'Hares: Swamp Bitch & Peter Teaser
LOC: Wally Pontiff Playground
$6 Hash
12:00 Show / 12:30 Go

Meet at noon. Hounds off at 12:30', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpr8hbu000depyhnf6ggvrue' AND md5("title") = '18676294efd4486831acc6ce67bc8ea2' AND "haresText" IS NULL AND "runNumber" IS NULL AND md5("description") = '512a176ed0dae5441a3d05bb887d8e0f';

UPDATE "Event" SET "title" = 'NOH3 Hash Christmas Party', "description" = 'Date: Friday December 03, 2010
Time: 8:00pm
Location: GNOTRI Sports / Kona Cafe

Cost: Free to NOH3 Hashers that have hashed in 2010.
Non-hashers/guests $20
Attire: Dressy! Men should wear pants & Sport coat. NO JEANS please.
Gift Exchange Details: Please bring a wrapped gift that costs between $15-$20. You must bring a gift to participate in the gift exchange.', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpr8hc4o00dgpyhn3vkxa0zx' AND md5("title") = '716b238d2748cb80c22c7b078def9061' AND md5("description") = '9194c2134e1d07e4a7548a0322891a1d';

UPDATE "Event" SET "title" = 'NOH3 Hash Run #1166', "haresText" = 'Bend Over Rover & IHOV', "runNumber" = 1166, "description" = 'Hares: Bend Over Rover & IHOV
LOC: Bonnabel Boat Launch
$6 Hash
3:00pm Show / 3:30 Go

Saints Away Game at NOON.
For those interested, they can watch game at my house 1516 Homestead Ave, Metairie, La 70005. On dead end by lake just 5 blocks from Bonnabel. We will have some food and beer, etc and others are welcome to bring a dish or not. Also have hot tub but not sure if heater is working. Have 46 inch TV inside and may set up a smaller TV on patio', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpr8hccz00dkpyhnqx05b5bp' AND md5("title") = 'b2827d800b3ae6a692db52f270552e01' AND "haresText" IS NULL AND "runNumber" IS NULL AND md5("description") = 'e8049f615df161f9ce02de1e5a72edab';

UPDATE "Event" SET "title" = 'NOH3 Hash Social', "description" = '6pm
Bayou Beer Garden
326 N Jefferson Davis Pkwy New Orleans, Louisiana 70119
Hash Erections night

Hash erections', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpr8hcjy00dmpyhng4q1vdvr' AND md5("title") = 'bdcf85bd64ac1c9bb866e6164fb81698' AND md5("description") = '2ba70b39551753a3254c11c4f4873a0e';

UPDATE "Event" SET "title" = 'NOH3 Hash Run #1167', "haresText" = 'Only Oral & Little Red Head', "runNumber" = 1167, "description" = 'Hares: Only Oral & Little Red Head
LOC: corner of Camp St & Race St
$5 Hash
12:00 Show / 12:30 Go

Saints Home Game at 3:05pm
On-After: McGuire''s 869 Magazine Street, New Orleans, LA', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpr8hcri00dopyhnub32xyf9' AND md5("title") = 'bee3c9dcbfaf0e62fbba6a4040400e0e' AND "haresText" IS NULL AND "runNumber" IS NULL AND md5("description") = 'cf7389693ebf7a2ff38a5dd7dd5d21e9';

UPDATE "Event" SET "title" = 'NOH3 Hash Run #1168', "haresText" = 'OCR & Little Red Head', "runNumber" = 1168, "description" = 'Hares: OCR & Little Red Head
LOC: Belle Chasse at the corner of Barrierre Road and Good News
$7 Hash
10:00am Show / 10:30 Go
click below for important details.

Saints away game Noon.
OCR was unfortunate enough to have picked this lump of coal at our Christmas party.
Fee is $7, or a $2 discount if you wear Tampa football attire; shirt, hat, etc. ya know, a "buck-an-ear". Rendering it to $5.
Yes, it''s early & on the WB. IBF, now so have ya''ll! On-out!

But seriously, I realize that we normally hash at 3:00 when the Saints play at 1:00, but with all the other holidays things going on (parties, caroling at Jackson square, just to name a few) I wanted to free people up for later in the afternoon. The meeting spot is across the street from Sudz, normally they have hot dogs, burgers, nachos during the game, and only $2.25 ice cold long necks.', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpr8hdcd00dupyhnowpecitu' AND md5("title") = 'ec98128c894330689e922bde35430c03' AND "haresText" IS NULL AND "runNumber" IS NULL AND md5("description") = '27fd31b27ac42e13264cfe8ec57b197f';

UPDATE "Event" SET "title" = 'NOH3 Hash Run #1169', "haresText" = 'Kiss My Trassh, Piston Penis, & TuHiTuCum', "runNumber" = 1169, "description" = 'Hares: Kiss My Trassh, Piston Penis, & TuHiTuCum
LOC: across from Cooter Brown''s
$6 Hash - 2:30 Show / 3:00 Go

No Saints game today. 2:30 meet and 3:00 on out. Start at Cooter Browns on the corner of S. Carrollton and Leake Ave. This will be an A- B (short walk back to vehicles).', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpr8hdw300e0pyhnr3z5bj2h' AND md5("title") = 'f0cb4394ed3261686f71a5c4ee6548ac' AND "haresText" IS NULL AND "runNumber" IS NULL AND md5("description") = 'ddfe015f7f0eeabc0d317730cf7c3b0d';

UPDATE "Event" SET "title" = 'Winter Tour de Liquor bike ride', "description" = '9am
Parlays Dream Lounge
870 Harrison Ave NOLA

Meet us at Parlay''s for Bloody Mary''s and Mimosas at 9/9:30am before we take off at 10:30ish am. BYOB and $$ for the remainder of the day. Jello Shots available. Watching the Saints game somewhere at the end.', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpr8he5h00e2pyhnnb539jly' AND md5("title") = '760ab4c321e93296fd062750b7218337' AND md5("description") = '6c32675f7f53cc079a9ea9a7a72c0e0c';

UPDATE "Event" SET "title" = 'NOH3 Hash Run #1170', "haresText" = 'Mystery Hares were Piston Penis, Tidybowl Man, Wishbone', "runNumber" = 1170, "description" = 'Hares: Mystery Hares were Piston Penis, Tidybowl Man, Wishbone
LOC: McGuires
$5 Hash
3pmShow / 3:30 Go

Saints Home Game at NOON. We will meet at McGuire''s to watch the game and the hash will begin after the game ends.', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpr8herb00e8pyhncfpwmqti' AND md5("title") = 'b7b6a74edd97a45b253e3117dabc6a15' AND "haresText" IS NULL AND "runNumber" IS NULL AND md5("description") = '9fbbe2f64902f3d5caecc87e46837cee';

UPDATE "Event" SET "title" = 'NOH3 Hash Run #1171 King''s Day Hash', "haresText" = 'Snatch Shot', "description" = 'Hares: Snatch Shot
LOC: Washington Square
$6 Hash
12:00Show / 12:30 Go

Saints Game is at 3:30pm today.
Our Kings Day Hash is the start of the Mardi Gras Season, so dress like it and let''s show the neighborhood that the real New Orleans holidays have begun.', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpr8hfh500eepyhnyhtb4be6' AND md5("title") = '70cf76ea7e1613d073fafdd871028b94' AND "haresText" IS NULL AND md5("description") = '21824a54cc2ded2dcfd28eb1eb728680';

UPDATE "Event" SET "title" = 'NOH3 Hash Run #1172', "haresText" = 'IME & Fire in the Hole', "description" = 'Hares: IME & Fire in the Hole
LOC: Parlay''s on Harrison
$5 Hash
3:00Show / 3:30Go', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpr8hgas00empyhnx1d56sq9' AND md5("title") = 'c98d9337071d8547e0d2c83984ca5bdd' AND "haresText" IS NULL AND "description" IS NULL;

UPDATE "Event" SET "title" = 'NOH3 Hash Run #1181', "haresText" = 'EBS & Chum Dumpster', "description" = 'Irish Italian parade. Hares: EBS & Chum Dumpster. LOC: Chase Bank - Corner of Vets & Homestead
$6 Hash
Time: 11:30 Show 12:00 Go

It''s the Irish/Italian Parade. Tank & PS Knave will be roasting a pig out on the parade route. So come out and celebrate your Irish/Italian-ness. We''ll be set up behind the Chase Bank on the corner of Homestead & Veterans.', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpr8hnh600gcpyhn665w26nf' AND md5("title") = '2d63ee5376fa22d30ed2eaa54082fff8' AND "haresText" IS NULL AND md5("description") = 'c5b759c8caa47fad094d99c7d0c41dcb';

UPDATE "Event" SET "title" = 'CCC Crescent City Classic', "description" = 'VIP Tent at the Practice Field behind Tad Gormley Stadium

Please volunteer to pour beer inside the event. $3 Entry fee to the CCC Event itself.
Hash VIP Tent at the Practice Field. $10 adults/$5 kids. Beer and BBQ.
http://www.ccc10k.com/site.php?pageID=3', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpr8hque00h4pyhnidmfdhjb' AND md5("title") = 'd3e347ca96be888b755080109c168d77' AND md5("description") = 'c2a035e9c33cbe3c7c6508ae6e418f1b';

UPDATE "Event" SET "description" = 'Who/Hare(s):
Buck-a-Fuffalo & Lichtenschtabbed

We Tried this once & Mother Nature had other plans. So we are trying to do this again. Hopefully the snow will stay away this time. You all have a duo of guest hares coming into town & they are huge patch whores & would like to show you all a good old fashioned hash trail!!
(Insert Evil Laugh)

What to bring:
****HEADLAMP / FLASHLIGHT !!!!****
Hash cash for Trail
Money for Hab!!!
Clean/Dry/Warm clothes & shoes
Virgins!!!!
TRAIL TYPE: A to A
Vessel - who wants to drink from a can?
Whistle
Appetite for a trail!?!?!', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmlrhx6b7000a04jprtbb5a8a' AND md5("description") = '50935cd762d0664f3ac60e52f5152ab9';

UPDATE "Event" SET "description" = 'Dog friendly, some water, some shiggy.
4 miles.

On-After: Mark''s Pub', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmlrhx6bv000c04jpg8ihiuqz' AND md5("description") = '0cfd3cfd26f358fa969c2bbcf27316de';

UPDATE "Event" SET "description" = 'The Masters Tournament is this weekend! Drive for show and putt for dough!

But also - https://youtube.com/shorts/s18-zrjNYyA?si=MXdIwDQyNcg9UHlo

And Mouth Full gets her SH!T Hare-Ginia Challenge patch!

On-After: Buffalo Wild Wings
11204 James Swart Cir, Fairfax, VA 22030
$4 tall Goose Island Kolsch!
$5 tall Bud Lights!
$5-$6 late night app menu!

Free exclamation points!!!!!', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmlrhx6d3000g04jpnlb7tmi5' AND md5("description") = 'b8842816c1ab94a185d8ff419e24bdc2';

UPDATE "Event" SET "description" = 'This is a double metro trail! One, it is metro accessible! Two, we''ll be riding the metro as part of trail

If folks have their own metro cards, they should bring them. The hare will have some spare cards to pass out.', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmlrhx6dv000i04jp7kovd65u' AND md5("description") = '0d8b2729ceb04cce15801cbd3e2ebd90';

UPDATE "Event" SET "description" = 'Runners 3.x and Walkers 2.x. dog friendly, wet feet.

On-After: Marks Pub
2190 Pimmit Dr Falls Church', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmlrhx6em000k04jp6t6cplu3' AND md5("description") = '5256ff592ae880d64d90a2421ad8ca64';

UPDATE "Event" SET "description" = 'On-After: On-On-On: Chuy''s: (or whatever it''s called now...)": at: "21365 Epicerie Plaza, Sterling, VA. 20164" (or wherever you''ve gotten lost!).
D''ERECTIONS:
FROM "START": (depending where you parked)...
From START... it''s across the street at: "21365 Epicerie Plaza, Sterling, VA. 20164"', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmlrhx6fv000m04jpxwh37xnf' AND md5("description") = '3d5edcc2822bc948179d87073a96fc41';

UPDATE "Event" SET "description" = 'Runners 5 Shiggy 4ish miles
Walkers 2 Shiggy 2ish miles', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmlrhx6gt000o04jp2p97qv62' AND md5("description") = 'a39f658cc210a18c999097568e17ca99';

UPDATE "Event" SET "description" = 'Trail #1177 - The Bunnymankini Trail!

https://en.wikipedia.org/wiki/Bunny_Man

https://en.wikipedia.org/wiki/Sling_swimsuit#mankini

Having/wearing a mankini is optional, but more fun if more people do it! You can get one for $3 on Amazon in a whole array of colors.

Most just wear the mankini over their running clothes during trail. What you do at end circle is up to you!

On-After: Main St Pub
7140 Main St,

Clifton, VA 20124

Kitchen closes at 9PM (half price apps)
Bar closes at 10PM', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmlrhx6ia000s04jppf77x1vh' AND md5("description") = '0e83fe0c32ab99e56f8db0c9a0e1db23';

UPDATE "Event" SET "description" = 'Sometimes... you wonder who you know or who you don''t'' know. There I was... scouting trail (and just don''t assume that I''m running with the Great Falls Hash House Harriers in order to steal their Saturday trail for Tuesday, because that would be just wrong!!) and I''m running (if you can call it that) West on the bike trail when some strange voice (however lovely it was) yells behind me... "And How''s Her"!!
Who is going to figure who I am from the backside? Is my ass to big? Is it the awesome gait of mine?
So... I scouted out this awesome (less than four miles) true trail and finished back at the Caboose Brewing Company & Tavern only to find a bunch of bikers there. It was not hard to tell who the sexy, spandex wearing biker gear voice was... none other than the lovely, "Cruisin for Vajucin"!!
Okay... in reality, she saw a ''non'' GFHer wearing hashing gear and then recognized Whack''n Spurt prior to ''guessing'' who I was!! I invited her up to the OnOnOn and gave her a little history of the GFH3... a much older group that''s been around for some 42 years!!

On-After: Caboose Brewing Company & Tavern: (or whatever it''s called now...)": at: "520 Mill Street, Vienna, VA 22180" or "Vienna Inn" (or wherever you''ve gotten lost!).', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmlrhx6is000u04jpjv47dqz0' AND md5("description") = 'f10b62fdff3d3e9d78d2a447ea0a13ed';

UPDATE "Event" SET "description" = 'Hares:
Hugs High-five Ghost and Just Sean

Date:
June 17, 2025

Location: Behind the Giant
8941 Ox Road, Lorton, VA 22079

When: Hares away at 7:00pm. Pack off at 7:15pm

What to expect
Join Hugs for her first haring adventure without Sorest. Be on the lookout for blue herons on trail and bring your boots for line dancing at the On After.
Runners: 4
Walkers: 2

Pre-Lube: Fusebox
8961 Ox Road, Lorton, VA 22079
Happy Hour 4-7pm (All draft beer $2.00 off)

On-After: Madigans
201 Mill Street, Occoquan, VA 22125
Sorest is going to teach some line dances

On-After: 201 Mill Street, Occoquan, VA 22125', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmlrhx6ky001004jpe5dvzjfs' AND md5("description") = '0329b180d79970274f8166f75f5566c6';

UPDATE "Event" SET "description" = 'Trail #3369 - The Country Swing Dance Trail!

What''s country swing? How does it differ from west coast swing east coast swing? How does it differ from swinging and upside down pineapples?

Find out none of the answers at Tuesday''s trail!

Let''s do a trail, name Just Meg, and then embarrass ourselves country swing dancing.

https://www.instagram.com/reel/DKcAblhgSW3/?utm_source=ig_web_copy_link&igsh=MzRlODBiNWFlZA==

Lessons from 8-9PM for the NLCers!

On-After: Crooked Run Fermentation/Nectar Cocktail Bar (closes at 11PM on Tuesdays)
22455 Davis Dr #120,
Sterling, VA 20164
There may be a $10 cover if you''re dancing (but we''re showing up late, so maybe not?). No cover if you''re just going to hang at the bar and creepily watch girls dance.
Both Crooked Run and Nectar Cocktail Bar will be open til 11PM (connected via hallway). Kitchen closes at 9PM but will have slices for sale past 9PM.', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmlrhx6lv001204jpnv735wxk' AND md5("description") = 'ea1bcf29b72352973892c466826c0744';

UPDATE "Event" SET "description" = 'In commemoration of National Postal Workers day, your trail will be cumming to you courtesy of some mail escorts.
It is said that mail escorts suffer some of the harshest working conditions, yet continue to persevere six days a week. On the seventh day they go hashing. There may also be a special delivery of shiggy.

On-After: Don Luis Restaurant - Cantina', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmlrhx6my001404jpe3h8vdj7' AND md5("description") = '5bfd50685cb474b8c244e88e5bb05c8f';

UPDATE "Event" SET "description" = 'Trail starts in the parking lot across from the Art Center (across from the painted butterfly) and behind Sully''s.
750 Center St. Herndon Va.
Um... maybe these "veteran" or "rookie" hares want to prove they won''t get you lost on a trail? Maybe we are trail-loving not so secretly Foodie-loving hares, who want to celebrate National Cow Day, National Freezer Pop AND National Sundae
Day (shouldn''t that be on a Sundae?) Or Chocolate with Almonds Day. What exactly is a Black Kow and how does it taste!? Cum if you''re hungry, or if you like to spend time in the mud with your friends, or if like to sing Karaoke (we can''t sing! - except Upper Cunt, she''s got nice pipes!) or just... cum if you like to.... we often do....
Sully''s Pourhouse Path:
Leave the everyday behind and surrender to the temptations of the Sully''s Pourhouse Path. This trail isn''t just a walk; it''s a flirtation with the untamed. Imagine dappled sunlight teasing your skin, the scent of damp earth and a bit of primal energy. This is where nature sheds its inhibitions, revealing a vibrant, sensuous side. And when your journey culminates, Sully''s Pourhouse awaits, a perfect culmination to your sensory adventure.
Start Address: Behind Sully''s Pourhouse and the artsy place. Look....ing for the wall with the painted butterfly:
750 Center St, Herndon, VA 20170
Cranium lamp recommended for undisclosed reasons.
You could bring golf clubs, a skateboard, or even a tennis racket.
Um... we will ask for sunshine, but you might want to get wet? We often do...
Hares: Whorganic, Pimmb, Shea Coco Butt Hurts, Polish Face Polish, Phoof There It Is.
Maybe mysterious nymphs in the forest.
Prelube:
530pm Sully''s Pourhouse
630pm arrival for prompt 7pm hares away. 715 pack away.
Walkers ~ 3 miles. More trails than sidewalk, light to no shiggy.
Runners ~5+ miles Turkey/Eagle, you might survive. Hares from Pa like to run. Just sayin.
On On On: Sully''s Pourhouse for libations, food for the foodies and yes, Karaoke okay, we will likely drop the mic now... ttyl!

On-After: Sully''s for karaoke', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmlrhx6nt001604jpwxwvvex9' AND md5("description") = 'b5ae621eb7e8f8af0db9db13948a9b39';

UPDATE "Event" SET "description" = 'If you think it''s going to be hot
Take a dip in the lake and it''s not
Have fun on the trail
Have some wine or an ale
Let''s see what this damn dam has got!

It''s Hugs and Just Sean once again
Bring a virgin or some other friend
We''re sure you''ll have fun
On this cool four mile run
Or a two mile walk around the bend

On-After: Glory Days
9526 Old Keene Mill Rd, Burke, VA', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmlrhx6pf001c04jp14u3yijn' AND md5("description") = 'c93b6cb77a91487117a61cd1067c6527';

UPDATE "Event" SET "description" = 'PIIMMB found out how to make cheap shirts!

BYO blank shirt to trail in a bag and write on a piece of paper your hash name and naming story. Shirt has to be at least 70% polyester and lighter colors are prefered over dark.

Then in a future trail (date TBD) you''ll get your shirt back with a (hopefully) cool design on it!

On-After: Prelube:

Sushi Kabuki (sake bombs, anyone?)

2533 John Milton Dr,
Herndon, VA 20171

OnOnOn:

Glory Days
2567 John Milton Dr,

Herndon, VA 20171', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmlrhx6rk001k04jpi3rvqyoh' AND md5("description") = 'c1fb84cd4c435dcdeb560b275e376568';

UPDATE "Event" SET "description" = 'Burke center VRE area. Look for marks and sketchy sh*t.
Summer is OVER. Do you even remember how to hash?', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmlrhx6so001o04jpvn31msye' AND md5("description") = '57513872e7eb4ef99a8fae45da91232b';

UPDATE "Event" SET "description" = 'Did you know there is a Lake Mercer in Antarctica? Well, we''re not going to that
one. There''s one in Fairfax too! Just Sean is back in college but join Hugs on the
Not-Antarctica Lake Mercer Trail. 4 miles runners, 2 miles walkers, some shiggy
and bring head lamps.

On-After: Glory Days
9526 Old Keene Mill Rd, Burke, VA', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmlrhx6tp001s04jpxn65cfl5' AND md5("description") = 'dee364519233ab1a7ac0681adc008ed0';

UPDATE "Event" SET "description" = 'After 6 months, Sorest traveled all around the state to hare for all the Virginia kennels, except for Great Falls (f*ck them!) and Elbow Deep in Damascus, VA! Let''s celebrate!

On-After: OnOnOn: Blue Iguana
12727 Shoppes Ln, Fairfax, VA 22033', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmlrhx6u7001u04jpla1qhr42' AND md5("description") = '1b00b9023856142cd3e83994baced13b';

UPDATE "Event" SET "description" = 'PreLube @ Bike Lane
11150 Sunset Hills Rd STE 110, Reston, VA 20190

On-After: Red''s Table
11150 South Lakes Dr, Reston, VA 20191', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmlrhx6vd001y04jpx7k7wfyr' AND md5("description") = 'd4967adcd47ee03a331cd0c08ea2608e';

UPDATE "Event" SET "description" = 'Wear a costume and let''s get weird looks from the muggles at Tysons Mall! Finish up with playing some games at the new Level 99!
No trail, other than finding your way to the next bar!
Recommended parking garage: Tysons One Pl and Westpark Dr Tysons, VA 22102
https://maps.app.goo.gl/LuLkDimVvFRQ9Txw8
Earl''s Kitchen & Bar
5:00-6:00
https://earls.ca/locations/tysons-corner/
Highball Crushes (1oz) - 1/2 PRICE
Corona ( 330 ml) - 3 OFF
Stella Artois (50 cl) - 3 OFF
Earls Old Fashioned - 1/2 PRICE
Moscow Mule (1 oz) - 1/2 PRICE
Nitro Espresso Martini - 1/2 PRICE
Green Tea Shot - $5
Mini Strawberry Margarita Shot - $5
Tiny Tini Peach Bellini - $5

Barrel & Bushel
6:00-7:00
https://www.barrelandbushel.com/
$2 Off Selected Draft Beers
$6 House Wines - Pinot Grigio, Chardonnay, Merlot, Cabernet Sauvignon
$7 Rail Mixed Drinks - Vodka, Bourbon, Whiskey, Tequila, Gin, Rum, Scotch
$2 Off Select Share Plates - Loaded Tots, Hearth Pretzel with Cheese Sauce & Mustard, Pimento Deviled Eggs, 72 Hour Pork Belly, Hot Fried Crispy Chicken Sliders, Pub Sliders

Level 99 / Victory Brewing
7:30-9:30
https://www.level99.com/?loc=tysons-va
There are 50+ rooms with games (physical, mental, skill) that take 1-3 minutes
$30 for 2 hours
Victory Brewing is attached for those who don''t want to play.
Can bring booze into the rooms!
Have to leave early but want to see the games? You can go in to watch for free!
Kids? Sure, if it''s not past their bedtime.

Earl''s Kitchen & Bar
10:00-Midnight
https://earls.ca/locations/tysons-corner/
Highball Crushes (1oz) - 1/2 PRICE
Corona ( 330 ml) - 3 OFF
Stella Artois (50 cl) - 3 OFF
Earls Old Fashioned - 1/2 PRICE
Moscow Mule (1 oz) - 1/2 PRICE
Nitro Espresso Martini - 1/2 PRICE
Green Tea Shot - $5
Mini Strawberry Margarita Shot - $5
Tiny Tini Peach Bellini - $5
Hares:
Sorest Rump (in spirit), Wookin Pa Nub, Mystery Hare(s)
Date:
October 28, 2025
Notes:
No hash cash! Pay as you go bar crawl! Maybe a shot check!
Costume optional, but more fun if everyone participates!
Recommended parking garage:
Tysons One Pl and Westpark Dr
Tysons, VA 22102

https://maps.app.goo.gl/LuLkDimVvFRQ9Txw8', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmlrhx6wl002204jpq8ohgoua' AND md5("description") = 'f081e7e418bea6f381e1bd7b7f0318cb';

UPDATE "Event" SET "description" = 'Park Behind Kilroys.

You wanted: Easy, fun, themed trail with hot sauce, games, hot chicks and costumes?
You''re getting: trails, fun, mud, confusion, a theme song, hot chicks, and beer. Oh well.
Theme Song: https://tinyurl.com/52vjjwjk
Hares: Mysterious, sexy, intelligent, fun-loving.
Bring the usual. It''s a hash, and the hares always lie.
Runners = 4.5
Walkers = 2 See less

On-After: 5250a Port Royal Rd, Springfield, VA 22151', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmlrhx6xa002404jpwh65lf0s' AND md5("description") = 'd6e10956f4659f8912bc4043cd0b0ac8';

UPDATE "Event" SET "description" = 'Let''s hoist our favorite beverage to our military and veterans! 4 miles runners, 2 miles walkers, some shiggy and bring head lamps.
Hares Away: 7:00 PM
Start:
Bunnyman Brewing in Burke
5583 Guinea Rd
Fairfax, VA
***Closed on Tuesdays so no prelube or on after there but still a good start location
On-After:
Glory Days
9526 Old Keene Mill Rd, Burke, VA', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmlrhx6xu002604jpesb24cev' AND md5("description") = '86b9fd40c3b59bbecc5b19c9744b6088';

UPDATE "Event" SET "description" = 'Delicate Flower AKA nub turns old again!
Start at Glory Days (temporarily closed).
Hare: Fingerrrgrgrgrgrrrr & mystery hare.
Run: ~4mi
Walk:~2mi', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmlrhx6zo002c04jprh3bwhp2' AND md5("description") = '6ed683dc2b058053c96aa5c42d9ab38e';

UPDATE "Event" SET "description" = 'SLOTH 105:
Hare: OnlyTeeth
Hash cash: $10
Start: Fairmont Aquatic Center 1044 Sugarmont Dr, Salt Lake City, UT 84106 40.72227229540586,-111.86138846195072
Finish: There Will Be An On-After.

Some may refer to this as a race(ist) trail, hangover trail, throwback trail, whatever.
It''s more simply a stripped down (giggity), back to basics trail where people can get a run in.
In regards to this being a r*nning trail:
We do NOT ask that you run fast.
We do NOT ask that you run the entire trail.
We DOask that you do NOT come to trail expecting to walk the whole thing.
This trail will cover all 4 objectives of hashing:
To promote physical fitness among our members.
To get rid of weekend hangovers.
To acquire a good thirst and to satisfy it in beer.
To persuade the older members that they are not as old as they feel.a', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmnwb4hi7000804jxalwmczln' AND md5("description") = '806e3649d5785e0c9ea15045449eaa32';

UPDATE "Event" SET "description" = 'A has been posted on the Events calendar on the Whoreman website. https://www.whoremanh3.com/events-trails/

Smorg is Hiding somewhere in the Mountains near PC. Let’s go find (snare) him. Last one in buys the 1st round!

Take the Summit Park exit off I-80, then up to the Short Stack Trailhead. Carpools are being formed ask around!!

SLOSH 107:
Hare: SmorgAssWhore
Hash cash: $10
Start: Short Stack Trailhead
Finish: There Might! Be An On-After.

Some may refer to this as a race(ist) trail, hangover trail, throwback trail, whatever.
It''s more simply a stripped down (giggity), back to basics trail where people can get a run in.
In regards to this being a r*nning trail:
We do NOT ask that you run fast.
We do NOT ask that you run the entire trail.
We DOask that you do NOT come to trail expecting to walk the whole thing.
This trail will cover all 4 objectives of hashing:
To promote physical fitness among our members.
To get rid of weekend hangovers.
To acquire a good thirst and to satisfy...', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmnwb4krg001104jxs8qt49hn' AND md5("description") = '9380da12311a2e293f39b4335f03dacb';

UPDATE "Event" SET "description" = 'Exact start location: https://maps.app.goo.gl/rduRRwA6mDN5Vsqr9

What''s that shining down from on High? Must be Hi-Beams'' Peak Experiences. Hi-Beams is always gettin'' dat'' vert'' & you should too.
Returning to the OG purpose of the hash, the whole reason Gispert himself discovered hare-of-the-dog and running, let''s burn off that RDR hangover with a jaunt through SLC and end with a delicious brunch at Goat Head. Trail will be A-B. Bring ID and money on trail if you would like to go straight to brunch after.

You can park over at Goat Head and walk over to the start.

A point will be posted here ASAP: https://www.whoremanh3.com/events-trails/

https://www.facebook.com/events/1422164028866932/', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmnwb4mgm001o04jxubfaxc45' AND md5("description") = '23911cbed71c213813dc01e38447d8dc';

UPDATE "Event" SET "description" = 'Sometimes when Nipples Runs too Hard they get a bit tender. Let''s find a way to comfort them!

A point on the website as always for SLOSH!

https://www.facebook.com/events/1410120486762558/', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmnwb4nm4002104jx7qe89pw0' AND md5("description") = '57072101cec00d4eb71dff3f9e3624b0';

UPDATE "Event" SET "description" = 'For more details:
https://www.whoremanh3.com/events-trails/

Location and details will be updated as they become available. ;)

https://www.facebook.com/events/904943225208867/', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmnwb4pq8002q04jxndd9vedf' AND md5("description") = '17ea021b945ffef830a03f8e37fb2646';

UPDATE "Event" SET "description" = 'Hares: Real, Scabs, & friends.
Hash cash: $5-10

More details to cum.', "haresText" = 'Real, Scabs, & friends.', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmnwb4q5g002y04jxjmnshsid' AND md5("description") = 'bb0e0bc487fca53fc12ad302dac739e3' AND md5("haresText") = 'e2c2b945229e6ec6fa9420a17b926335';

UPDATE "Event" SET "description" = 'Hares: Just Rylee (let''s get her named finally!!)
For more details:
https://www.whoremanh3.com/events-trails/
park at the eastern most parking area
https://maps.app.goo.gl/8z36BNkG5aKCit7i6

https://www.facebook.com/events/1428066685344306/', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmnwb4s0o003n04jx6vmwbl2a' AND md5("description") = '7366bf0790f014b122e9c038f4baefcf';

UPDATE "Event" SET "description" = 'https://www.facebook.com/events/1380355819776907/', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmnwb4te2004804jx8cm6jwno' AND md5("description") = 'a85bd53446cde1b099ad7fc3f0b0fc78';

UPDATE "Event" SET "description" = 'SMORG volunteered but is desperately seeking Co-Hare! plz let Teeth know asap if you are the willing victim.

https://www.facebook.com/events/891647717047319/', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmnwb4vd2004y04jxe8egiek2' AND md5("description") = '9f522b79489d3f9da3ab06c06c98589a';

UPDATE "Event" SET "description" = 'Full Moon Spin the Bottle Trail #179 (Blue Moon)
Hash Cash: $5.00
Bring:
-Virgins
-New Shoes
-Whistles
-Cranium Gear
-A Thirst for Beer

Location: Fairmont Park - 1040 E. Sugarmont Dr, SLC, UT 84106

https://www.facebook.com/events/756300417105623/', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmnwb4lmx001c04jxby4fe7ls' AND md5("description") = '770e704878592376a8f9fae5c7d6514a';

UPDATE "Event" SET "description" = 'Full Moon Spin the Bottle Trail #179 (Blue Moon)
Hash Cash: $5.00
Bring:
-Virgins
-New Shoes
-Whistles
-Cranium Gear
-A Thirst for Beer

Location: Murray park

https://www.facebook.com/events/1272807054530798/', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpnghrhr0028i4hnly7zot6w' AND md5("description") = '5d53d7349020c0468a4b33be05b97a44';

UPDATE "Event" SET "description" = 'Full Moon Spin the Bottle Trail #182 (Beaver Moon)

Hash Cash: $5.00

Bring:
-Virgins
-New Shoes
-Whistles
-Cranium Gear
-A Thirst for Beer

Location: Southwood Park
6150 S 725 E, Murray, UT 84107

https://www.facebook.com/events/2109743646519227/', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpnghssx002mi4hnuhyyyfyj' AND md5("description") = '8372b7d26410b0503cdba0d6db8babc8';

UPDATE "Event" SET "description" = 'Get your livers warmed up and ready for the 12 Down Downs with a spin the bottle bar crawl!

We will pre-lube the pre-lube bar crawl at the Trax Ballpark station. From there, we will go downtown on a magical journey of inebriation.

https://www.facebook.com/events/1833411373974792/', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpnghvr30037i4hna32zo86c' AND md5("description") = 'd6c7e97229f27ce5d09c9e2cdb7f91d2';

UPDATE "Event" SET "description" = 'please join all of us for a hangover trail on New Year''s Day. for the normal shenanigan''s per usual just hating our lives with a headache. come get that hare of a dog and get your trail on. it''s going to be a blast as always. but incase it''s not, it''s all nipples fault.

Hash Cash: $5.00

Bring:
-Virgins
-New Shoes
-Whistles
-Cranium Gear
-A Thirst for Beer
-what migraine you''re fine. here, have a beer.

https://www.facebook.com/events/1181041096722256/', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmnwb4r80003f04jxd3httsss' AND md5("description") = '5bb615109eb68cd6c08692b0071b06c4';

UPDATE "Event" SET "description" = 'please join all of us for the normal shenanigan''s per usual just with drinking........ and sledding....... AND DAMN IT NO HOSPITAL VISITS! it''s going to be a blast. bring sleds tubes, the skateboards without wheels or trucks. last night''s blow-up doll. or a damn cookie sheet. (these are only ideas of things that might slide your ass down a hill) I take absolutely no responsibility for any actions made by you, as always, its Improper''s fault for leaving us unattended.

Hash Cash: $5.00

Bring:
-Virgins
-shoes suitable for snow.
- sliding gear unless you plan to slide like a penguin.
-Cranium Gear never a bad idea.
-A Thirst for Beer
it''s just white shit, you will be fine! But seriously. Dress for the cold. Coat pants, boots hat gloves you know the drill.

https://www.facebook.com/events/1178373703720448/', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmnwb4soj004004jx6dkkj59g' AND md5("description") = '481312c6aeff1e43ddae9d0fa7cd7046';

UPDATE "Event" SET "description" = 'please join all of us for the normal shenanigan''s per usual just with drinking........ and spin the bottle fates. we will be starting this trail with some takilla sorry tequila. at EL Chihuahua restaurant then its ON-ON to the first bottle fate.

Hash Cash: $5.00

Bring:
-Virgins
-New Shoes
-Whistles
-Cranium Gear
-A Thirst for Beer
some money''s for your takilla. tequila sorry I''ll work on it.

https://www.facebook.com/events/1772699353445443/', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpnghzun004ai4hnxkjctqy2' AND md5("description") = '94cd39acdbe41f2a060e625775460b1e';

UPDATE "Event" SET "description" = 'please join all of us for the normal shenanigan''s per usual just with drinking........ and spin the bottle fates. bring a bag of rose wine for a shitty wine trail run

Hash Cash: $5.00

Bring:
- Bag of rose wine
-Virgins
-New Shoes
-Whistles
-Cranium Gear
-A Thirst for Beer

https://www.facebook.com/events/1168931178142386/', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpngi1ie004qi4hn9oep6nph' AND md5("description") = '70697851b8a88c2d355f8ca305978663';

UPDATE "Event" SET "description" = 'please join all of us for the normal shenanigan''s per usual just with drinking........ and spin the bottle fates. location TBD

Hash Cash: $5.00

Bring:
-Virgins
-New Shoes
-Whistles
-Cranium Gear
-A Thirst for Beer

https://www.facebook.com/events/848167944805593/', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpngi3760052i4hn3eihrmi2' AND md5("description") = 'eee961a5e75b720a2410f87a9fdac106';

UPDATE "Event" SET "description" = 'Comment: Silicone Valley Hash House Harriers Present: 50 SHADES OF RED Red Dress R*n Weekend Three days of drunken debauchery in the name of charity to justify your indiscretions. April 5-7 in REDwood City, CA $45 day of, or $10 a la carte price day of for trail on Saturday only. svh3.com/rdr and svh3rdr.blogspot.com Facebook event info: https://www.facebook.com/events/490241974373959/ This will be our worst RDR ever! You will wish you missed it! Fortunately you may not remember any of it! Friday: Prelube leaves at 6:15 pm from hash hotel in Redwood City or meets at 6:45 at San Mateo Caltrain station. Saturday: Check-in at 11:00 pm at hash hotel, hares away at 1:00 pm Sunday: Hangover trail at 11:00 am at hash hotel Check out the RDR page for more information!', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmqzlr6eq006r6thn36fw1myy' AND md5("description") = 'e8e7b7f16a3c7a01ead339235138830c';

UPDATE "Event" SET "description" = 'DP! Food! DP!

https://www.facebook.com/events/9534424193315096/', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmnwb4hym000c04jxnj45elyx' AND md5("description") = '1801957193673588048f04a491bbff5d';

UPDATE "Event" SET "description" = 'Rego now!
The Red Dress Run is our ANnuAL charity event. This is a proud tradition for many communities of hashers around the world.
This years charity will go to the Christmas Box. (https://thechristmasbox.org/)

Here in SL,UT; this year we Whoremans will be starting our trail at Liberty Park and will strut our stuff all the way through the 9th and 9th Street Festival. This is a great opportunity to show off our sexy dresses, and share in celebration of SL,UT pride as well as raise funds for this years charity!!!

Yes, you are required to wear a red dress!

Location: Liberty Park
Enter in at the north entrance on 900 e, park in the alcove by the tennis courts

Rego Amount:
$40.69 until 9/13$45.69 9/14 (week of, until 9/20)

Hares: Sensitive New Aged Nipples

To rego and pay electronically:
Venmo: @Olaf-Questereit
(please use the friends and family option or funds will be returned)
Cash regos at the event are okay, but please let us know in advance that you''ll be paying there.

htt...', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpnghqb1001zi4hn2s3qqee1' AND md5("description") = 'eb22fe7c6ff54fd6704291d56f6bcaa2';

UPDATE "Event" SET "description" = 'Hares: Joe vs Vagina & Just Sydney
Hash cash $7

Jordan Bluffs Park

https://maps.app.goo.gl/aSDGAiK5rPJPUYsC8?g_st=ipc

Dust off your Costumes and join us for a Halloween themed trail.
Bring whistles and a thirst for beer

https://www.facebook.com/events/4078904012374182/', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmnwb4nxl002504jxtbinecnl' AND md5("description") = 'c39020f9bf2d78ea906d7d726c07ecda';

UPDATE "Event" SET "description" = 'Hares: Brokeback Blackout & ATM
Hash cash $7

join us for the shit show. ATM and I put our heads together and come up with something different. hungover or Not we are looking forward to making all your drunken dreams come true (kidding)

bring your migraines, virgins, your thirst for that hair of a dog, oh and that can-do attitude.

https://www.facebook.com/events/2011644609572742/', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmnwb4ola002c04jxegggbwei' AND md5("description") = 'c895692cbdc8ba2129d36a7813e31910';

UPDATE "Event" SET "description" = 'Hares: tums the enemy maker and tater twat
Hash cash $7

https://www.facebook.com/events/3641860979442529/', "haresText" = 'tums the enemy maker and tater twat', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmnwb4pb6002l04jxrq8wccnq' AND md5("description") = 'b3d0a27a29a3dceea8fffe88a6d79c23' AND md5("haresText") = '900c67f4377b162a17a0cad20451270b';

UPDATE "Event" SET "description" = 'Hares: TBD
Hash cash $7

https://www.facebook.com/events/619239351157218/', "haresText" = NULL, "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmnwb4pye002u04jxepe8wn8m' AND md5("description") = 'd2342136730cb4879cc370b6a0a28093' AND md5("haresText") = 'bd303c282513efe8098caac7b08f26ca';

UPDATE "Event" SET "description" = 'Hares: realcurious and real’s daddy

https://www.facebook.com/events/793961310164434/', "haresText" = 'realcurious and real’s daddy', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmnwb4rte003l04jx3jdetylr' AND md5("description") = '8d801a7c57a012b913ea8a9abd364121' AND md5("haresText") = 'cb38644c7eb9bd1a9a843617d7003523';

UPDATE "Event" SET "description" = 'Hares: smog and blackout
hares out by 11:15am
pack out by 11:30am

https://www.facebook.com/events/1508638540273392/', "haresText" = 'smog and blackout', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmnwb4sdb003v04jxbg7bus7m' AND md5("description") = '21075aa22e03d0f2d76054ca4eed68d0' AND md5("haresText") = '4d0d6a249013f526ab0f80fd131b05b5';

UPDATE "Event" SET "description" = 'Hares: tums the enemy maker and scent of a man
hares out by 11:15am
pack out by 11:30am

https://www.facebook.com/events/632507319794010/', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmnwb4sy4004404jxau4fm2na' AND md5("description") = '370c088876730407216ba887df834453';

UPDATE "Event" SET "description" = 'Hares: Cuckold and Cuddle
Hares out: 11:15am
Pack out: 11:30am

Meet at the south parking lot of Riverview Park

On After at Ice Haus

https://www.facebook.com/events/509891795552655/', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmnwb4tqc004e04jxu3i0763t' AND md5("description") = '889cf3358f9e27348a1ed13bb6cc3886';

UPDATE "Event" SET "description" = 'Hares: Hon Hon Hon Titty Croissants and spawn
hares out by 11:15am
pack out by 11:30am

Bring your kids! Or don''t! Bring someone else''s kids! But, like, with consent....

https://www.facebook.com/events/1259715145926273/', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmnwb4ugp004n04jx88phri05' AND md5("description") = 'af7df17f8e3e2c1f06017e87f6336835';

UPDATE "Event" SET "description" = 'hares: blackout and tums
hares out by 11:15am
pack out by 11:30am

https://www.facebook.com/events/1359129245881100/', "haresText" = 'blackout and tums', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmnwb4vwz005904jxprwke46p' AND md5("description") = 'acf1d9ca82a2ad0e7830a6fa63615917' AND md5("haresText") = '4f3cefcd9f7aec081752d9f540edb53a';

UPDATE "Event" SET "description" = 'We will be doing drinking practice at ice haus in Murray at 6:30 I called ahead and was told they will have a live band playing there will be a cover charge at the door of $5 please be prepared to come early and start pre gaming until the rest of the pack get there. Or pay the $5.00 idk you’re an adult.

https://www.facebook.com/events/1333102384928368/', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmpngi3fd0054i4hnelgbdnkg' AND md5("description") = '0e92d8a3b191c3829424563c09dd5bbb';

UPDATE "Event" SET "description" = 'hares: yer a wizzer Harry
hares out by 12:15 pm
pack out by 12:30 pm

https://www.facebook.com/events/1296935374977660/', "haresText" = 'yer a wizzer Harry', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "id" = 'cmnwb4w8m005p04jx49lbyau3' AND md5("description") = '5c24ee94ea3f4b693e6e138ffbe7c0d6' AND md5("haresText") = '0b00a7ca43a84f4183c5c1d31d67998a';

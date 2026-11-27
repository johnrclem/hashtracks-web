-- GCal defect sweep, part 2: titles and run numbers (2026-11-28).
-- Refs #2993 #2994 #3155, and the rows #3167 could not reach: #2941 #3059 #2964.
--
-- Every statement is guarded by the value it replaces, so a re-run is a no-op.
-- 1. Source configs: Hill Country H3 reads "Trail 650" run numbers; the Boston calendar
--    strips B3H4's kennel name from titles (seed changes reach prod only through a migration).
-- 2. 118 Hill Country H3 runs (2010 on, outside the scrape window) get the run number
--    their title carries, read with the adapter's own parser; a number another HCH3 run
--    already holds is skipped (32).
-- 3. Minneapolis H3's weekly placeholder series repeated run #1972 on 46 dates in 2027
--    ("Hare TBD"); the adapter now clears a run number a placeholder series repeats, and
--    these stored rows lose it too. The real #1972 (8 Mar 2026) is untouched.
-- 4. #2941 Charm City #350: its Facebook source (trust 8) owns the event, so the corrected
--    iCal hares can't replace the stale theme; set them here.
-- 5. #3059 PPH4: three runs keep a description sentence as their title; merge won't let the
--    adapter's default replace a stored title, so set "PPH4 Trail" here.
-- 6. #2964 EELS #53: the street #3164 held back (its postcode-area guard is too strict for London).
BEGIN;
SET LOCAL lock_timeout = '5s';

-- Hill Country H3 Google Calendar: #2993: read "Trail 650" titles without a "#".
UPDATE "Source"
SET config = config || '{"summaryRunNumberPatterns":["^Hill Country H3 Trail\\s+(\\d{3,4})\\b(?!\\.\\d)"]}'::jsonb,
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE name = 'Hill Country H3 Google Calendar' AND type = 'GOOGLE_CALENDAR'::"SourceType"
  AND config->'summaryRunNumberPatterns' IS NULL;

-- Boston Hash Calendar: #3155: strip B3H4's "Ballbuster H4" title prefix and "(Ballbuster H4)" suffix.
UPDATE "Source"
SET config = config || '{"titleStripPatterns":["^BH3:\\s*","^Ball\\s*Buster\\s+H4(?!\\s*Trail\\b)\\s*[-:]?\\s*","\\s*\\(Ball\\s*Buster\\s+H4\\)$"]}'::jsonb,
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE name = 'Boston Hash Calendar' AND type = 'GOOGLE_CALENDAR'::"SourceType"
  AND config->'titleStripPatterns' = '["^BH3:\\s*"]'::jsonb;

UPDATE "Event" e SET "runNumber" = v.run, "updatedAt" = NOW() AT TIME ZONE 'UTC'
FROM jsonb_to_recordset(
$runs$[
{"id":"cmw6lm1uc0001pphnbiu5j1si","title":"Hill Country H3 Trail 285","run":285},
{"id":"cmw6lm2f40005pphnw87vvfb7","title":"Hill Country H3 Trail 287","run":287},
{"id":"cmw6lm2q40007pphnmqfo1apt","title":"Hill Country H3 Trail 288 \"talk like a pirate day\"","run":288},
{"id":"cmw6lm3bv000bpphn03h4pi0c","title":"Hill Country H3 Trail 289","run":289},
{"id":"cmw6lm3t6000fpphnyffiyuhm","title":"Hill Country H3 Trail 291 Hashy Halloween","run":291},
{"id":"cmw6lm4a0000jpphntvkwcvlv","title":"Hill Country H3 Trail 293 Operation \"Get Stuffed 2010\"","run":293},
{"id":"cmw6lm5vr000vpphndhz2plom","title":"Hill Country H3 Trail 296 OP \"Get your hang over off me\"","run":296},
{"id":"cmw6lm96j001jpphnw448pcbx","title":"Hill Country H3 Trail 301","run":301},
{"id":"cmw6lmb5a001xpphn11pdgzpv","title":"Hill Country H3 Trail 303","run":303},
{"id":"cmw6lmd00002bpphn4oub6o48","title":"Hill Country H3 Trail 305","run":305},
{"id":"cmw6lmdks002fpphnzokqh3nh","title":"Hill Country H3 Trail 306","run":306},
{"id":"cmw6lmekq002npphnrmallyao","title":"Hill Country H3 Trail 307","run":307},
{"id":"cmw6lmggl0033pphnk2oq0yic","title":"Hill Country H3 Trail 310","run":310},
{"id":"cmw6lmrbn006jpphnbf02r2wj","title":"Hill Country H3 Trail 333 Red Dress Run","run":333},
{"id":"cmw6lmsun006zpphn7brmp31a","title":"Hill Country H3 Trail 335","run":335},
{"id":"cmw6lmtzf007dpphnh2tij73a","title":"Hill Country H3 Trail 337","run":337},
{"id":"cmw6lnn5p00fbpphnxikdbwnr","title":"Hill Country H3 Trail 399","run":399},
{"id":"cmw6lnsj100gfpphnl3k0j2k8","title":"Hill Country H3 Trail 400 13th Analversary Red Dress Run","run":400},
{"id":"cmw6lntdm00glpphnagqvm4aw","title":"Hill Country H3 Trail 407","run":407},
{"id":"cmw6lnu6900grpphn5wa83ufd","title":"Hill Country H3 Trail 408","run":408},
{"id":"cmw6lnv9m00gzpphnpv2t4snf","title":"Hill Country H3 Trail 409","run":409},
{"id":"cmw6lnx8b00hdpphnpvevpfdx","title":"Hill Country H3 Trail 411 Wizard Staff","run":411},
{"id":"cmw6lny0s00hjpphnhcjoctqs","title":"Hill Country H3 Trail 412","run":412},
{"id":"cmw6lnz5d00hrpphngx8y3oe0","title":"Hill Country H3 Trail 413","run":413},
{"id":"cmw6lnzuq00hxpphnog1ca8l0","title":"Hill Country H3 Trail 414","run":414},
{"id":"cmw6lo0xb00i5pphn9arg6vh1","title":"Hill Country H3 Trail 415","run":415},
{"id":"cmw6lo20h00idpphnganyvcky","title":"Hill Country H3 Trail 418","run":418},
{"id":"cmw6lo32o00ilpphnpzebgceh","title":"Hill Country H3 Trail 419","run":419},
{"id":"cmw6lo3rs00irpphn08sk1v5t","title":"Hill Country H3 Trail 420","run":420},
{"id":"cmw6lo4tt00izpphnvtf9n04q","title":"Hill Country H3 Trail 421","run":421},
{"id":"cmw6lo5nd00j5pphn9p2urwtu","title":"Hill Country H3 Trail 422","run":422},
{"id":"cmw6lo6g400jbpphnk5y3hkna","title":"Hill Country H3 Trail 423 (Beer Mile)","run":423},
{"id":"cmw6lo7pu00jlpphnbl5lw2vg","title":"Hill Country H3 Trail 424","run":424},
{"id":"cmw6lo8h300jrpphna7qv5i5f","title":"Hill Country H3 Trail 425","run":425},
{"id":"cmw6lo9ku00jzpphn6woir692","title":"Hill Country H3 Trail 426; World Peace Through Beer","run":426},
{"id":"cmw6loagb00k5pphnli9mgvw7","title":"Hill Country H3 Trail 427 Blue Dress Trail","run":427},
{"id":"cmw6lobmi00kdpphnyrbiizwi","title":"Hill Country H3 Trail 428; The Ugly Suit","run":428},
{"id":"cmw6loca500kjpphn6wn5jukt","title":"Hill Country H3 Trail 429","run":429},
{"id":"cmw6lodbl00krpphn814jr32i","title":"Hill Country H3 Trail 430","run":430},
{"id":"cmw6loe4m00kxpphnp320dvdo","title":"Hill Country H3 Trail 433 or a Tale of Two Shitties","run":433},
{"id":"cmw6lof7000l5pphnhmzg2i5v","title":"Hill Country H3 Trail 434","run":434},
{"id":"cmw6lofr500lbpphn2uzklm85","title":"Hill Country H3 Trail 435","run":435},
{"id":"cmw6lohja00lppphnh4rm81y8","title":"Hill Country H3 Trail 437","run":437},
{"id":"cmw6lqu3k014vpphn6bcxb6ky","title":"Hill Country H3 Trail #554 WARNO","run":554},
{"id":"cmw6lqzh70167pphnyu55uoyi","title":"Hill Country H3 Trail 561 WARNO","run":561},
{"id":"cmw6lr0f2016fpphnyxs4r9sd","title":"Hill Country H3 Trail 562 WARNO","run":562},
{"id":"cmw6lr12t016lpphn02bw73ik","title":"Hill Country H3 Trail 563 WARNO","run":563},
{"id":"cmw6lr1p5016rpphndpnh2i5g","title":"Hill Country H3 Trail 564 WARNO","run":564},
{"id":"cmw6lr2up016zpphnibbt2tq6","title":"Hill Country H3 Trail 565 WARNO","run":565},
{"id":"cmw6lr3ew0175pphnmdorsqan","title":"Hill Country H3 Trail 566 WARNO","run":566},
{"id":"cmw6lr45c017dpphn2xfp6d0l","title":"Hill Country H3 Trail 567 WARNO","run":567},
{"id":"cmw6lr4rr017jpphncdj7dcqk","title":"Hill Country H3 Trail 568 WARNO","run":568},
{"id":"cmw6lr5ln017rpphnpqc6ejai","title":"Hill Country H3 Trail 569 WARNO","run":569},
{"id":"cmw6lr7xg018bpphn5h7xy7p0","title":"Hill Country H3 Trail #572 WARNO","run":572},
{"id":"cmw6lr90b018jpphnouy8jq7k","title":"Hill Country H3 Trail #573 WARNO","run":573},
{"id":"cmw6lreyt01a1pphnzwz2tndr","title":"Hill Country H3 Trail # 579 WARNO","run":579},
{"id":"cmw6lrlli01bnpphn5v8qykcn","title":"Hill Country H3 Trail 587 WARNO: OP Taxi picks up the trail","run":587},
{"id":"cmw6lrmkj01bvpphnw1y44vx8","title":"Hill Country H3 Trail 588 WARNO: Zombieland","run":588},
{"id":"cmw6lrnep01c1pphnky2tgkgi","title":"Hill Country H3 Trail 589 WARNO: OP 'Stupid Pandemic'","run":589},
{"id":"cmw6lroep01c9pphn61vip329","title":"Hill Country H3 Trail 590 WARNO: Revenge of the Sioux","run":590},
{"id":"cmw6lrp2t01cfpphnryz3anxl","title":"Hill Country H3 Trail 591 WARNO: BEER Mile A","run":591},
{"id":"cmw6lrq0i01cnpphn80bdrapl","title":"Hill Country H3 Trail 592 WARNO: not another miller springs trail, it's not virtual","run":592},
{"id":"cmw6lrqqa01ctpphncp9qplpe","title":"Hill Country H3 Trail 593 WARNO: Gay Schlobby Midget","run":593},
{"id":"cmw6lrrls01d1pphn8k4sjrst","title":"Hill Country H3 Trail 594 WARNO: OP 2 of 3 for the 4th","run":594},
{"id":"cmw6lrsfw01d7pphnspwi3at5","title":"Hill Country H3 Trail 595 WARNO: Return of SMS","run":595},
{"id":"cmw6lrt3s01ddpphntnvxd9q1","title":"Hill Country H3 Trail 596 WARNO: missing Doggie Daze","run":596},
{"id":"cmw6lrtyt01dlpphnxyo1u5d4","title":"Hill Country H3 Trail 597 WARNO","run":597},
{"id":"cmw6lrukf01drpphneyoy7bnr","title":"Hill Country H3 Trail 598 WARNO: Wizard Staff","run":598},
{"id":"cmw6lrvbq01dzpphn1u8rgqw4","title":"Hill Country H3 Trail 599 WARNO: Beer Mile B","run":599},
{"id":"cmw6ls4jf01g1pphnsels7ywt","title":"Hill Country H3 Trail 600 WARNO: OP 20th Analversary","run":600},
{"id":"cmw6ls5dy01g9pphnw0fbadeu","title":"Hill Country H3 Trail 601 WARNO: Deja Whoa!","run":601},
{"id":"cmw6ls7ua01gtpphnc43y3wep","title":"Hill Country H3 Trail 604 OP: Dress Like a Karen","run":604},
{"id":"cmw6ls8tw01h1pphnq0tgiojf","title":"Hill Country H3 Trail 605 WARNO, \"3,2,1...Not it\"","run":605},
{"id":"cmw6ls9l901h7pphnx9j170hm","title":"Hill Country H3 Trail 606 WARNO","run":606},
{"id":"cmw6lsa8i01hdpphnjrvyj9q5","title":"Hill Country H3 Trail 607 WARNO \"Boo\"","run":607},
{"id":"cmw6lsb4501hlpphn72nxltvo","title":"Hill Country H3 Trail 608 WARNO","run":608},
{"id":"cmw6lsbsu01hrpphns1ca2ci2","title":"Hill Country H3 Trail 609 WARNO","run":609},
{"id":"cmw6lscmh01hzpphna4zvd7rz","title":"Hill Country H3 Trail 610 WARNO \"what, we're independent?\"","run":610},
{"id":"cmw6lsd8g01i5pphnb2wxajv7","title":"Hill Country H3 Trail 611 WARNO","run":611},
{"id":"cmw6lse9t01idpphn2hdiq8d0","title":"Hill Country H3 Trail 612 WARNO","run":612},
{"id":"cmw6lsez601ijpphndguhp9vz","title":"Hill Country H3 Trail 613 WARNO","run":613},
{"id":"cmw6lsku401k1pphnksret1s2","title":"Hill Country H3 Trail 623 WARNO","run":623},
{"id":"cmw6lsl8m01k5pphnk4ju3w6g","title":"Hill Country H3 Trail 624 WARNO","run":624},
{"id":"cmw6lslf801k7pphnrms3b6aw","title":"Hill Country H3 Trail 625 WARNO","run":625},
{"id":"cmw6lslpn01k9pphnvxmeoq9l","title":"Hill Country H3 Trail 626 WARNO RED DRESS RUN / 21st Analversary","run":626},
{"id":"cmw6lsm8401kdpphnw8o76x6x","title":"Hill Country H3 Trail 627 WARNO, The new GB lays her trail","run":627},
{"id":"cmw6lsn2q01kjpphna54my06b","title":"Hill Country H3 Trail 629 Green Dress","run":629},
{"id":"cmw6lsnc701klpphnxbuz7287","title":"Hill Country H3 Trail 630 WARNO 3 day adult drinky plan","run":630},
{"id":"cmw6lso5901krpphnfydaw26b","title":"Hill Country H3 Trail 631 WARNO: Return to Chalk Ridge Falls","run":631},
{"id":"cmw6lsocj01ktpphn4miplptb","title":"Hill Country H3 Trail 632 WARNO","run":632},
{"id":"cmw6lsooe01kxpphnuuriz6ko","title":"Hill Country H3 Trail 633 WARNO","run":633},
{"id":"cmw6lsory01kzpphnkjr278ri","title":"Hill Country H3 Trail 634 WARNO","run":634},
{"id":"cmw6lsp7601l3pphnpnw1hvv3","title":"Hill Country H3 Trail 635 WARNO","run":635},
{"id":"cmw6lspgo01l5pphna8ztil5a","title":"Hill Country H3 Trail 636 WARNO","run":636},
{"id":"cmw6lspu901l9pphniowx5abf","title":"Hill Country H3 Trail 637 WARNO","run":637},
{"id":"cmw6lsq1i01lbpphnfskhhl23","title":"Hill Country H3 Trail 638 WARNO, Wizard's Staff","run":638},
{"id":"cmw6lsqgo01lfpphnbbwu9hy8","title":"Hill Country H3 Trail 639 WARNO Wait, a nuke was dropped last week?","run":639},
{"id":"cmw6lsqqj01lhpphnoi9lj0j2","title":"Hill Country H3 Trail 640 WARNO, TADA Rides Again","run":640},
{"id":"cmw6lsr8801llpphnqn74d8hj","title":"Hill Country H3 Trail 641 WARNO","run":641},
{"id":"cmw6lsrfl01lnpphngz69pmal","title":"Hill Country H3 Trail 642 WARNO for those not camping out","run":642},
{"id":"cmw6lsrn801lppphnmcifc0gp","title":"Hill Country H3 Trail 643 WARNO Beer Mile","run":643},
{"id":"cmw6lss4v01ltpphns5ixsoy0","title":"Hill Country H3 Trail 644 WARNO World Peace through Beer","run":644},
{"id":"cmw6lssoa01lxpphnim5go2k8","title":"Hill Country H3 Trail 645 WARNO, The Blew Dress","run":645},
{"id":"cmw6lst1101m1pphn94tlc9r7","title":"Hill Country H3 Trail 646 WARNO","run":646},
{"id":"cmw6lst7y01m3pphnjl95wt5l","title":"Hill Country H3 Trail 647 WARNO Picture/Scavenger Trail","run":647},
{"id":"cmw6lstp301m7pphna23qpeyh","title":"Hill Country H3 Trail 648 WARNO Hashmas","run":648},
{"id":"cmw6lstx101m9pphn439bvwge","title":"Hill Country H3 Trail 649 WARNO 'The Formal' or Black Dress","run":649},
{"id":"cmw6lsu8s01mdpphn9k0qraom","title":"Hill Country H3 Trail 650 WARNO","run":650},
{"id":"cmw6lsuqm01mhpphn6upggisw","title":"Hill Country H3 Trail 651 WARNO \"... look, up in the sky, it's shaft...\"","run":651},
{"id":"cmw6lsv7c01mlpphn9d8siuxn","title":"Hill Country H3 Trail 652 WARNO \"Red Dress Run\"","run":652},
{"id":"cmw6lt9xf01plpphnosjdn3ml","title":"Hill Country H3 Trail #689 WARNO","run":689},
{"id":"cmweecl440001tbhn7zhficxh","title":"Hill Country H3 Trail 290","run":290},
{"id":"cmweeclbi0003tbhn3io2fkmx","title":"Hill Country H3 Trail 292 Veterans' Day Fun Run/Walk","run":292},
{"id":"cmweeclp10005tbhnbvwq2lmz","title":"Hill Country H3 Trail 294 \"3rd Anal Ugly Suit Decathelon\"","run":294},
{"id":"cmweecltf0007tbhnvwjr24ga","title":"Hill Country H3 Trail 295 \"Merry Hashmas\"","run":295},
{"id":"cmweecm2x0009tbhnt5c661p5","title":"Hill Country H3 Trail 297 OP \"Sacrifice the Virgin Hare\"","run":297},
{"id":"cmweecmgj000btbhnls85ihz0","title":"Hill Country H3 Trail 298","run":298},
{"id":"cmweecmuy000dtbhnas7mvb2k","title":"Hill Country H3 Trail 300 OP: F*#k off Queer in the Headlights","run":300}
]$runs$
) AS v(id text, title text, run integer)
WHERE e.id = v.id AND e."runNumber" IS NULL AND e.title = v.title
  AND NOT EXISTS (
    SELECT 1 FROM "Event" o
    WHERE o."kennelId" = e."kennelId" AND o."runNumber" = v.run AND o.id <> e.id
  );

UPDATE "Event" e SET "runNumber" = NULL, title = 'Minneapolis H3 Trail', "updatedAt" = NOW() AT TIME ZONE 'UTC'
FROM "Kennel" k
WHERE k.id = e."kennelId" AND k."kennelCode" = 'mh3-mn'
  AND e."runNumber" = 1972 AND e.title = 'Minneapolis H3 Trail #1972'
  AND e."haresText" = 'Hare TBD' AND e.date >= TIMESTAMP '2027-01-01 00:00:00';

UPDATE "Event" SET "haresText" = 'I Kock A Lot, Adidas, and Screaming Pussy', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE id = 'cmsqea31o003m04lcxqbw5ndt' AND "haresText" = 'Friday the 13th — Bad Luck, Worse Decisions 🔪🍻';

UPDATE "Event" SET title = 'PPH4 Trail', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE (id, title) IN (
  ('cmpu7hdwa000m04k0wxr6d06j', 'Hash # you get a prize if you guess correctly!'),
  ('cmqy7sy41001g04ify8b0v8cl', 'The P2H4 is going to start the Hash at Navajo Hogan, which has just been refurbished. We’re doing a feet up Colorado kennel trail. We will be checking out the venue, food and drinks!'),
  ('cmt6lck1q002404lbhq570ilo', 'Our great hare Vibrator will take you down a great trail!')
);

UPDATE "Event" SET "locationStreet" = '29 Spring Street, W2 1JA', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE id = 'cmss5vu1b001njphnohhqtkbs' AND "locationStreet" IS NULL AND "locationName" = 'The Bear';

COMMIT;

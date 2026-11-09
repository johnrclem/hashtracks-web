/**
 * One-shot canonical-Event fixes for the Nov 7-8 audit findings. These runs are past, or
 * their stored title/hares won't change on a re-scrape (merge keeps an existing real title),
 * so the row is corrected directly. RawEvents stay untouched. Every UPDATE is guarded on the
 * audited value, so a re-run is a no-op.
 *
 * Apply only AFTER the adapter fixes deploy: until then Hanoi's next scrape re-files run
 * #1841 on the Nov 7 row.
 *
 *   Dry run:  BACKFILL_ALLOW_SELF_SIGNED_CERT=1 npx tsx scripts/fix-audit-canonicals-nov-2026b.ts
 *   Apply:    BACKFILL_APPLY=1 BACKFILL_ALLOW_SELF_SIGNED_CERT=1 npx tsx scripts/fix-audit-canonicals-nov-2026b.ts
 */
import "dotenv/config";
import { prisma } from "@/lib/db";

type Value = string | number | null | Date;
interface Fix {
  id: string;
  label: string;
  /** Field values the row must currently have for the fix to apply. */
  expect: Record<string, Value>;
  set: Record<string, Value>;
}

const retitle = (id: string, label: string, from: string, to: string): Fix => ({ id, label, expect: { title: from }, set: { title: to } });

const FIXES: Fix[] = [
  // #2793 Abuja: run-number prefix or bare run-number titles.
  retitle("cmw50p2be00012shn04ld2yqg", "abujah3 #680", "Run#680: April-born Birthday Run", "April-born Birthday Run"),
  retitle("cmw50p2fv00032shnyrgw0e8k", "abujah3 #681", "Run#681: The Flag Beerer's Run", "The Flag Beerer's Run"),
  retitle("cmw50p2jg00052shng1bbwcdh", "abujah3 #682", "Run#682: May-borns Rocky Beerday Run", "May-borns Rocky Beerday Run"),
  retitle("cmw50p2nf00072shnmc3bqk6c", "abujah3 #683", "Run#683: Beer-O-Cracy Day Run", "Beer-O-Cracy Day Run"),
  retitle("cmw50p2wg00092shn7puk33sr", "abujah3 #684", "Run#684", "Abuja H3 Trail #684"),
  retitle("cmw50p30d000b2shn2movaehi", "abujah3 #685", "Run#685", "Abuja H3 Trail #685"),
  retitle("cmw50p361000d2shncqbrvarz", "abujah3 #686", "Run#686", "Abuja H3 Trail #686"),
  retitle("cmw50p3b5000f2shnbknoqwm6", "abujah3 #688", "Run#688", "Abuja H3 Trail #688"),
  retitle("cmw50p3ez000h2shn1q6pzoj1", "abujah3 #690", "Run#690", "Abuja H3 Trail #690"),
  retitle("cmw50p3pp000l2shntmx3s1i2", "abujah3 #694", "Run#694", "Abuja H3 Trail #694"),
  retitle("cmw50p3w0000n2shnyjx2pess", "abujah3 #695", "Run#695", "Abuja H3 Trail #695"),
  retitle("cmw50p47y000r2shnoizq12on", "abujah3 #703", "Run#703: Christmas Eve Run", "Christmas Eve Run"),
  retitle("cmw50pab3003h2shn0til3b7r", "abujah3 #815", "RUN 815 - Treasure Hunt Run", "Treasure Hunt Run"),
  retitle("cmw50paf6003j2shnqox5ix1v", "abujah3 #816", "Run 816: Halloween/Cocktober Buns Beerday Run.", "Halloween/Cocktober Buns Beerday Run."),
  // #2792 Abuja: placeholder hares.
  { id: "cmw50p3j4000j2shnr1hipqqk", label: "abujah3 #691 hares", expect: { haresText: "Many" }, set: { haresText: null } },
  { id: "cmw50p7id00292shnwegbv056", label: "abujah3 #733 hares", expect: { haresText: "The Hares" }, set: { haresText: null } },
  // #2817 Big Lik: "UN#728" prefix with no space.
  retitle("cmw50pkns000bkahngl2ytr0s", "blhhh #728", "UN#728 Slam Dranks", "Slam Dranks"),
  // #2796 Barbados Bike: HC EventNumber 82 on the run it names "Bash 100".
  { id: "cmw50qgh2000beohngtr0fk5n", label: "bbh3 Bash 100", expect: { runNumber: 82 }, set: { runNumber: 100, title: "Barbados Bike H3 #100" } },
  // #2820 Black Death: HC EventNumber 1 on a run titled #154; the real number is ambiguous.
  { id: "cmw50noup00012jhnr87h5n2l", label: "bdh3-uk 2024-09-08", expect: { runNumber: 1 }, set: { runNumber: null } },
  // #2799 Basel #392: "Hares;" label.
  { id: "cmw4a0qnj002m08jqge60mhft", label: "bsh3-ch #392 hares", expect: { haresText: null }, set: { haresText: "George Moonie, Chunder Woman" } },
  // Hanoi: the "1t4h" heading filed run #1841 over run #1840's row.
  {
    id: "cmw55zngo002a08lbz2e5s00k", label: "hanoi-h3 #1840", expect: { runNumber: 1841 },
    set: { runNumber: 1840, haresText: "Finger In Van Dyke and Dr Creampie.", locationName: "8 Hai Bà Trưng Street, Hoàn Kiếm District" },
  },
  // #2789 Warsaw: start time stored as the title.
  retitle("cmu60nssr007g04i9keajo9jb", "warsaw-h3 #1653", "13h00", "Warsaw H3 Trail #1653"),
  // #2812 Herts 2241: notes and a second venue in the location fields (run has left the page).
  {
    id: "cmw3x445x000208l48p5j48p2", label: "herts-h3 #2241", expect: { runNumber: 2241 },
    set: { locationName: "The Royston Club", locationStreet: "12 College Road, St Albans, AL1 5ND" },
  },
  // #2791 Saigon #1854: full details from the This Week's Run panel.
  {
    id: "cmqoiipur001604jn9lsxf1gs", label: "saigon-h3 #1854", expect: { title: "Saigon H3 Trail #1854" },
    set: {
      title: "The Ultimate Cat Lai Temple Run",
      haresText: "Three Shitty Tits, Forgettable Fuck & Team Jack Off",
      locationName: "Nhà hàng Sông Quê Phước Khánh",
      locationAddress: "https://maps.app.goo.gl/xz39WsFmrid27NCu6",
    },
  },
  // #2816 Vientiane Bush #1569: venue on its own "Location:" line.
  {
    id: "cmw54mihh005i08lbewoq3i7e", label: "vbh3-la #1569", expect: { locationName: null },
    set: { locationName: "Done Pamai village, Happy Endings Shop", locationAddress: "https://maps.app.goo.gl/Ump4znCNufPW8RHa7" },
  },
  // #2813 Puerto Galera #1905: special-run name and 14:45 departure (Asia/Manila, UTC+8).
  {
    id: "cmw5675n1000208jp8twmzr8t", label: "pgh3 #1905", expect: { title: "Puerto Galera H3 Trail #1905" },
    set: { title: "7-11 Run #4", startTime: "14:45", dateUtc: new Date("2026-11-07T06:45:00Z") },
  },
  // #2802/#2803 Bicester: raw SUMMARY stored as the title.
  retitle("cmw3x4bwx003o08l432z9h2j3", "bicester-h3 #2709", "Trail # 2709 - Clippety Cloggs - The Rose & Crown, Charlton", "Bicester H3 Trail #2709"),
  retitle("cmw3x4byo003q08l4bee4m28d", "bicester-h3 #2710", "Trail # 2710 - Runner Bean - TBC", "Bicester H3 Trail #2710"),
  retitle("cmw3x4bzz003s08l4z5epxcs3", "bicester-h3 #2711", "Trail # 2711 - Walkathon - TBC", "Bicester H3 Trail #2711"),
  retitle("cmw3x4c1f003u08l40o8zklld", "bicester-h3 #2712", "Trail # 2712 - Home Alone (Kip & Nipples) - TBC", "Bicester H3 Trail #2712"),
  {
    id: "cmw3x4caa003w08l4fftqfskq", label: "bicester-h3 #2713",
    expect: { title: "Trail # 2713 - 🎅 BH3 CHRISTMAS PARTY 🎅The Nightingale, Bicester - PP & Praying Mantis" },
    set: { title: "BH3 CHRISTMAS PARTY", haresText: "PP & Praying Mantis" },
  },
  retitle("cmw3x4cby003y08l4q22h4vpp", "bicester-h3 #2714", "Trail # 2714 - Richard D'Turd - TBC", "Bicester H3 Trail #2714"),
  retitle("cmw3x4cdf004008l4m7rc7pu2", "bicester-h3 #2715", "Trail # 2715 - Smiling Oyster (Dormobile) - TBC", "Bicester H3 Trail #2715"),
];

async function main(): Promise<void> {
  const apply = process.env.BACKFILL_APPLY === "1";
  console.log(`Mode: ${apply ? "APPLY" : "DRY RUN"}`);
  let ready = 0;
  let skipped = 0;
  for (const fix of FIXES) {
    const row = await prisma.event.findUnique({ where: { id: fix.id } }); // NOSONAR S7735 — sequential by design
    const current = row as unknown as Record<string, unknown> | null;
    const mismatch = current ? Object.entries(fix.expect).find(([k, v]) => current[k] !== v) : undefined;
    if (!current || mismatch) {
      skipped++;
      console.log(`  SKIP ${fix.label}: ${current && mismatch ? `${mismatch[0]} is ${JSON.stringify(current[mismatch[0]])}` : "event gone"}`);
      continue;
    }
    ready++;
    console.log(`  ${apply ? "FIX " : "WOULD FIX"} ${fix.label}: ${Object.keys(fix.set).join(", ")}`);
    if (apply) await prisma.event.update({ where: { id: fix.id }, data: fix.set }); // NOSONAR S7735
  }
  console.log(`\n${apply ? "Applied" : "Would apply"}: ${ready} | skipped: ${skipped} | total: ${FIXES.length}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

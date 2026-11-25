/**
 * Live `runQuery` response rows captured from big-hump.com's Firestore
 * (`bighump` project, `hashes` collection) on 2026-11-25, trimmed to the
 * selected fields. Covers: a filled upcoming run (#2040), an upcoming
 * hare-needed run (#2042, title = hares), a blank pre-generated slot (#2051),
 * done runs (#2039; #2 from 1999), a legacy local-midnight "Open" run (#30),
 * another kennel's unnumbered event (Bell-Scott), and the cancelled undated #0.
 *
 * Rows are stored flat (one per line) and expanded into Firestore's typed
 * `{ document: { name, fields: { x: { stringValue } } }, readTime }` shape below,
 * exactly as the REST API returns them.
 */
type Row = Record<string, string | number | null>;

const READ_TIME = "2026-11-25T15:00:00.000000Z";
const DOC_PREFIX = "projects/bighump/databases/(default)/documents/hashes/";
const INTEGER_FIELDS = new Set(["number", "hashCashCents"]);
const META_KEYS = new Set(["id", "createTime", "updateTime"]);

function firestoreValue(key: string, value: string | number | null): Record<string, unknown> {
  if (value === null) return { nullValue: null };
  if (INTEGER_FIELDS.has(key)) return { integerValue: String(value) };
  if (key === "startsAt") return { timestampValue: value };
  return { stringValue: value };
}

function toRunQueryRow(row: Row) {
  const fields: Record<string, Record<string, unknown>> = {};
  for (const [key, value] of Object.entries(row)) {
    if (!META_KEYS.has(key)) fields[key] = firestoreValue(key, value);
  }
  return {
    document: {
      name: `${DOC_PREFIX}${row.id}`,
      fields,
      createTime: row.createTime,
      updateTime: row.updateTime,
    },
    readTime: READ_TIME,
  };
}

// prettier-ignore
const ROWS: Row[] = [
  {"id": "bh-r0", "number": 0, "startsAt": null, "title": "Open", "hares": "", "location": "", "locationUrl": "", "onAfter": "", "kennel": "Big-Hump", "status": "cancelled", "hashCashCents": null, "directions": "", "createTime": "2026-09-15T12:49:27.298847Z", "updateTime": "2026-09-16T19:29:52.044991Z"},
  {"id": "bh-r2", "number": 2, "startsAt": "1999-03-25T00:30:00Z", "title": "KFC", "hares": "KFC", "location": "Belleville", "locationUrl": "", "kennel": "Big-Hump", "status": "done", "hashCashCents": null, "directions": "", "createTime": "2026-09-15T12:49:13.745487Z", "updateTime": "2026-09-16T16:07:51.730031Z"},
  {"id": "bh-r30", "number": 30, "startsAt": "1999-10-09T05:00:00Z", "title": "Open", "hares": "", "location": "", "locationUrl": "", "kennel": "Big-Hump", "status": "done", "hashCashCents": null, "directions": "", "createTime": "2026-09-15T12:49:13.745487Z", "updateTime": "2026-09-16T16:07:53.402239Z"},
  {"id": "bh-o1", "number": null, "startsAt": "2006-08-18T23:45:00Z", "title": "Fe-Fe", "hares": "", "location": "O'Fallon, IL", "locationUrl": "", "kennel": "Bell-Scott", "status": "done", "hashCashCents": null, "directions": "Red Cabose O'Fallon IL From the Arch Take I-64 East to exit 14 (O'Fallon IL) Turn left onto Hwy 50 stay in the Left lane and turn left at the C.F.M . gas station onto W. State follow that to the red Cabose on your right pull into the parking lot and look for hashers. <br /><br /> if you get lost call FE-FE at 618-531-2594", "createTime": "2026-09-15T12:49:32.929247Z", "updateTime": "2026-09-16T16:07:49.780335Z"},
  {"id": "bh-r2039", "number": 2039, "startsAt": "2026-11-19T00:30:00Z", "title": "Roadkill & DDD", "hares": "Road Kill & Diners, Drive-ins, and Dicks", "location": "Meramec Community College-West Parking Lot", "locationUrl": "https://maps.app.goo.gl/RnRotpajSLYjNNTn7?g_st=ic", "onAfter": "", "kennel": "Big-Hump", "status": "done", "hashCashCents": 800, "directions": "<p>Circle Up:  St. Louis Community College-Meramec in Kirkwood. Meet at the West Parking Lot.&nbsp;</p>", "createTime": "2026-09-15T12:49:32.929247Z", "updateTime": "2026-11-21T21:26:07.933823Z"},
  {"id": "bh-r2040", "number": 2040, "startsAt": "2026-11-26T00:30:00Z", "title": "Skanksgiving w/Dos & Headlights 🦃🍁", "hares": "Dos HiXXies & How Do You Like My Headlights NOW", "location": "Rear parking lot of Woerner Elementary School", "locationUrl": "https://maps.app.goo.gl/r9WnzdVDv3QrtCj3A?g_st=ic", "onAfter": "TBD", "kennel": "Big-Hump", "status": "scheduled", "hashCashCents": 0, "directions": "<p>And now for the festive holiday event we know you have all been (im)patiently waiting for… Dos &amp; Headlight’s 5 Years of Crawling to Skanksgiving!&nbsp;&nbsp;We have a full evening of fun planned so your liver will feel nice and ready for the big holiday.&nbsp;&nbsp;</p><p><br></p><p>Meet: rear parking lot of Woerner Elementary School (6131 Leona Street, St. Louis, MO 63116). Near the corner of Federer Pl &amp; Ray Ave.&nbsp;</p><p><a href=\"https://maps.app.goo.gl/r9WnzdVDv3QrtCj3A?g_st=ic\" rel=\"noopener\" target=\"_blank\">https://maps.app.goo.gl/r9WnzdVDv3QrtCj3A?g_st=ic</a></p><p><br></p><p>What to Expect:&nbsp;&nbsp;If you were hoping to run off your sins in advance, please note that this is a PUB CRAWL, so you may want to get your miles in prior to trail!&nbsp;&nbsp;Bring your own cash &amp; your ID for the bars.&nbsp;</p><p><br></p><p>On After:&nbsp;&nbsp;If we still did not satisfy your taste for cheap beer, we can talk about some on-after options in circle</p>", "createTime": "2026-09-15T12:49:32.929247Z", "updateTime": "2026-11-20T21:04:41.012207Z"},
  {"id": "bh-r2042", "number": 2042, "startsAt": "2026-12-03T00:30:00Z", "title": "How Do You Like My Headlights NOW", "hares": "How Do You Like My Headlights NOW", "location": "", "locationUrl": "", "onAfter": "", "kennel": "Big-Hump", "status": "scheduled", "hashCashCents": null, "directions": "", "createTime": "2026-09-15T12:49:32.929247Z", "updateTime": "2026-10-24T11:58:18.294431Z"},
  {"id": "xefYuic8LvaOctWjaju5", "number": 2051, "startsAt": "2027-01-14T00:30:00Z", "title": "", "hares": "", "location": "", "locationUrl": "", "onAfter": "", "kennel": "", "status": "scheduled", "hashCashCents": 800, "directions": "", "createTime": "2026-10-21T18:38:59.455791Z", "updateTime": "2026-11-17T13:58:49.885455Z"},
];

export const BIG_HUMP_RUN_QUERY_FIXTURE = ROWS.map(toRunQueryRow);

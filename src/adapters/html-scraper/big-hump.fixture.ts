/**
 * Live `runQuery` response rows captured from big-hump.com's Firestore
 * (`bighump` project, `hashes` collection) on 2026-11-25, trimmed to the
 * selected fields. Covers: a filled upcoming run (#2040), an upcoming
 * hare-needed run (#2042, title = hares), a blank pre-generated slot (#2051),
 * done runs (#2039; #2 from 1999), a legacy local-midnight "Open" run (#30),
 * another kennel's unnumbered event (Bell-Scott), and the cancelled undated #0.
 */
export const BIG_HUMP_RUN_QUERY_FIXTURE = [
  {
    "document": {
      "name": "projects/bighump/databases/(default)/documents/hashes/bh-r0",
      "fields": {
        "number": {
          "integerValue": "0"
        },
        "startsAt": {
          "nullValue": null
        },
        "title": {
          "stringValue": "Open"
        },
        "hares": {
          "stringValue": ""
        },
        "location": {
          "stringValue": ""
        },
        "locationUrl": {
          "stringValue": ""
        },
        "onAfter": {
          "stringValue": ""
        },
        "kennel": {
          "stringValue": "Big-Hump"
        },
        "status": {
          "stringValue": "cancelled"
        },
        "hashCashCents": {
          "nullValue": null
        },
        "directions": {
          "stringValue": ""
        }
      },
      "createTime": "2026-09-15T12:49:27.298847Z",
      "updateTime": "2026-09-16T19:29:52.044991Z"
    },
    "readTime": "2026-11-25T15:00:00.000000Z"
  },
  {
    "document": {
      "name": "projects/bighump/databases/(default)/documents/hashes/bh-r2",
      "fields": {
        "number": {
          "integerValue": "2"
        },
        "startsAt": {
          "timestampValue": "1999-03-25T00:30:00Z"
        },
        "title": {
          "stringValue": "KFC"
        },
        "hares": {
          "stringValue": "KFC"
        },
        "location": {
          "stringValue": "Belleville"
        },
        "locationUrl": {
          "stringValue": ""
        },
        "kennel": {
          "stringValue": "Big-Hump"
        },
        "status": {
          "stringValue": "done"
        },
        "hashCashCents": {
          "nullValue": null
        },
        "directions": {
          "stringValue": ""
        }
      },
      "createTime": "2026-09-15T12:49:13.745487Z",
      "updateTime": "2026-09-16T16:07:51.730031Z"
    },
    "readTime": "2026-11-25T15:00:00.000000Z"
  },
  {
    "document": {
      "name": "projects/bighump/databases/(default)/documents/hashes/bh-r30",
      "fields": {
        "number": {
          "integerValue": "30"
        },
        "startsAt": {
          "timestampValue": "1999-10-09T05:00:00Z"
        },
        "title": {
          "stringValue": "Open"
        },
        "hares": {
          "stringValue": ""
        },
        "location": {
          "stringValue": ""
        },
        "locationUrl": {
          "stringValue": ""
        },
        "kennel": {
          "stringValue": "Big-Hump"
        },
        "status": {
          "stringValue": "done"
        },
        "hashCashCents": {
          "nullValue": null
        },
        "directions": {
          "stringValue": ""
        }
      },
      "createTime": "2026-09-15T12:49:13.745487Z",
      "updateTime": "2026-09-16T16:07:53.402239Z"
    },
    "readTime": "2026-11-25T15:00:00.000000Z"
  },
  {
    "document": {
      "name": "projects/bighump/databases/(default)/documents/hashes/bh-o1",
      "fields": {
        "number": {
          "nullValue": null
        },
        "startsAt": {
          "timestampValue": "2006-08-18T23:45:00Z"
        },
        "title": {
          "stringValue": "Fe-Fe"
        },
        "hares": {
          "stringValue": ""
        },
        "location": {
          "stringValue": "O'Fallon, IL"
        },
        "locationUrl": {
          "stringValue": ""
        },
        "kennel": {
          "stringValue": "Bell-Scott"
        },
        "status": {
          "stringValue": "done"
        },
        "hashCashCents": {
          "nullValue": null
        },
        "directions": {
          "stringValue": "Red Cabose O'Fallon IL From the Arch Take I-64 East to exit 14 (O'Fallon IL) Turn left onto Hwy 50 stay in the Left lane and turn left at the C.F.M . gas station onto W. State follow that to the red Cabose on your right pull into the parking lot and look for hashers. <br /><br /> if you get lost call FE-FE at 618-531-2594"
        }
      },
      "createTime": "2026-09-15T12:49:32.929247Z",
      "updateTime": "2026-09-16T16:07:49.780335Z"
    },
    "readTime": "2026-11-25T15:00:00.000000Z"
  },
  {
    "document": {
      "name": "projects/bighump/databases/(default)/documents/hashes/bh-r2039",
      "fields": {
        "number": {
          "integerValue": "2039"
        },
        "startsAt": {
          "timestampValue": "2026-11-19T00:30:00Z"
        },
        "title": {
          "stringValue": "Roadkill & DDD"
        },
        "hares": {
          "stringValue": "Road Kill & Diners, Drive-ins, and Dicks"
        },
        "location": {
          "stringValue": "Meramec Community College-West Parking Lot"
        },
        "locationUrl": {
          "stringValue": "https://maps.app.goo.gl/RnRotpajSLYjNNTn7?g_st=ic"
        },
        "onAfter": {
          "stringValue": ""
        },
        "kennel": {
          "stringValue": "Big-Hump"
        },
        "status": {
          "stringValue": "done"
        },
        "hashCashCents": {
          "integerValue": "800"
        },
        "directions": {
          "stringValue": "<p>Circle Up:  St. Louis Community College-Meramec in Kirkwood. Meet at the West Parking Lot.&nbsp;</p>"
        }
      },
      "createTime": "2026-09-15T12:49:32.929247Z",
      "updateTime": "2026-11-21T21:26:07.933823Z"
    },
    "readTime": "2026-11-25T15:00:00.000000Z"
  },
  {
    "document": {
      "name": "projects/bighump/databases/(default)/documents/hashes/bh-r2040",
      "fields": {
        "number": {
          "integerValue": "2040"
        },
        "startsAt": {
          "timestampValue": "2026-11-26T00:30:00Z"
        },
        "title": {
          "stringValue": "Skanksgiving w/Dos & Headlights 🦃🍁"
        },
        "hares": {
          "stringValue": "Dos HiXXies & How Do You Like My Headlights NOW"
        },
        "location": {
          "stringValue": "Rear parking lot of Woerner Elementary School"
        },
        "locationUrl": {
          "stringValue": "https://maps.app.goo.gl/r9WnzdVDv3QrtCj3A?g_st=ic"
        },
        "onAfter": {
          "stringValue": "TBD"
        },
        "kennel": {
          "stringValue": "Big-Hump"
        },
        "status": {
          "stringValue": "scheduled"
        },
        "hashCashCents": {
          "integerValue": "0"
        },
        "directions": {
          "stringValue": "<p>And now for the festive holiday event we know you have all been (im)patiently waiting for… Dos &amp; Headlight’s 5 Years of Crawling to Skanksgiving!&nbsp;&nbsp;We have a full evening of fun planned so your liver will feel nice and ready for the big holiday.&nbsp;&nbsp;</p><p><br></p><p>Meet: rear parking lot of Woerner Elementary School (6131 Leona Street, St. Louis, MO 63116). Near the corner of Federer Pl &amp; Ray Ave.&nbsp;</p><p><a href=\"https://maps.app.goo.gl/r9WnzdVDv3QrtCj3A?g_st=ic\" rel=\"noopener\" target=\"_blank\">https://maps.app.goo.gl/r9WnzdVDv3QrtCj3A?g_st=ic</a></p><p><br></p><p>What to Expect:&nbsp;&nbsp;If you were hoping to run off your sins in advance, please note that this is a PUB CRAWL, so you may want to get your miles in prior to trail!&nbsp;&nbsp;Bring your own cash &amp; your ID for the bars.&nbsp;</p><p><br></p><p>On After:&nbsp;&nbsp;If we still did not satisfy your taste for cheap beer, we can talk about some on-after options in circle</p>"
        }
      },
      "createTime": "2026-09-15T12:49:32.929247Z",
      "updateTime": "2026-11-20T21:04:41.012207Z"
    },
    "readTime": "2026-11-25T15:00:00.000000Z"
  },
  {
    "document": {
      "name": "projects/bighump/databases/(default)/documents/hashes/bh-r2042",
      "fields": {
        "number": {
          "integerValue": "2042"
        },
        "startsAt": {
          "timestampValue": "2026-12-03T00:30:00Z"
        },
        "title": {
          "stringValue": "How Do You Like My Headlights NOW"
        },
        "hares": {
          "stringValue": "How Do You Like My Headlights NOW"
        },
        "location": {
          "stringValue": ""
        },
        "locationUrl": {
          "stringValue": ""
        },
        "onAfter": {
          "stringValue": ""
        },
        "kennel": {
          "stringValue": "Big-Hump"
        },
        "status": {
          "stringValue": "scheduled"
        },
        "hashCashCents": {
          "nullValue": null
        },
        "directions": {
          "stringValue": ""
        }
      },
      "createTime": "2026-09-15T12:49:32.929247Z",
      "updateTime": "2026-10-24T11:58:18.294431Z"
    },
    "readTime": "2026-11-25T15:00:00.000000Z"
  },
  {
    "document": {
      "name": "projects/bighump/databases/(default)/documents/hashes/xefYuic8LvaOctWjaju5",
      "fields": {
        "number": {
          "integerValue": "2051"
        },
        "startsAt": {
          "timestampValue": "2027-01-14T00:30:00Z"
        },
        "title": {
          "stringValue": ""
        },
        "hares": {
          "stringValue": ""
        },
        "location": {
          "stringValue": ""
        },
        "locationUrl": {
          "stringValue": ""
        },
        "onAfter": {
          "stringValue": ""
        },
        "kennel": {
          "stringValue": ""
        },
        "status": {
          "stringValue": "scheduled"
        },
        "hashCashCents": {
          "integerValue": "800"
        },
        "directions": {
          "stringValue": ""
        }
      },
      "createTime": "2026-10-21T18:38:59.455791Z",
      "updateTime": "2026-11-17T13:58:49.885455Z"
    },
    "readTime": "2026-11-25T15:00:00.000000Z"
  }
];

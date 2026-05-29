import { describe, it, expect } from "vitest";
import { parseNCH3Page } from "./nch3";

// Captured from https://nch3.com/ on 2026-05-29. The B / On-After "Google Map"
// links are real HTML comments on the live page — kept here so the test proves
// cheerio ignores them and the Location anchor is the one picked up.
const FIXTURE = `<!DOCTYPE html><html><body>
<div class="main">
  <div class="page" id="mission">
    <div class="content container">
      <h2>Run Start for North County Hash</h2>
      <div class="row">
        <p class="col-xs-5 col-xs-offset-1 col-sm-5 col-sm-offset-1 col-md-5 col-md-offset-1 notes">
          <strong>Run Number:</strong> 1920<br>
          <strong>Saturday,</strong> 5/23/26 10:00am<br>
          <strong>Name: </strong> Memorial Day Beach and Cliffs Run <br>
          <strong>Hare(s):</strong> TNT, Comes and Goes, Acute Triangle, Good Tail and PPI<br>
          <strong>Location: </strong> Eucalyptus Grove on the corner of Horizon Way (it makes a 90 degree turn) in La Jolla. Next to La Jolla Shores Drive.
          <a href="https://maps.app.goo.gl/4Jcbn4fZ1FBABZpt6" >   Google Map</a> <br>
          <strong>B: </strong> <!-- <a href="https://maps.app.goo.gl/iaUmms3HrVz5HWXX6" >   Google Map</a> --><br>
          <strong>Run Fee: $</strong> $8 cash only<br>
          <strong>Trail type: </strong>A to A<br>
          <strong></strong>
          <strong>Dog friendly: </strong>On In Only<br>
          <strong>On After: </strong> <!-- <a href="https://maps.app.goo.gl/GcWGuigeLBtGdVeX7" >   Google Map</a> --><br>
          <strong>Notes: </strong>Happy Memorial Day weekend! It is early this year. Let's celebrate by running the beaches and cliffs of our favorite nude beach.
        </p>
      </div>
    </div>
  </div>
</div>
</body></html>`;

describe("parseNCH3Page", () => {
  const event = parseNCH3Page(FIXTURE);

  it("parses the single current run with all fields", () => {
    expect(event).not.toBeNull();
    expect(event).toMatchObject({
      date: "2026-05-23", // 5/23/26 → UTC noon
      kennelTags: ["nch3-sd"],
      runNumber: 1920,
      title: "Memorial Day Beach and Cliffs Run",
      hares: "TNT, Comes and Goes, Acute Triangle, Good Tail and PPI",
      startTime: "10:00",
      cost: "$8 cash only",
      trailType: "A to A",
      locationUrl: "https://maps.app.goo.gl/4Jcbn4fZ1FBABZpt6",
    });
  });

  it("keeps the Location text but strips the trailing 'Google Map' anchor label", () => {
    expect(event?.location).toBe(
      "Eucalyptus Grove on the corner of Horizon Way (it makes a 90 degree turn) in La Jolla. Next to La Jolla Shores Drive.",
    );
  });

  it("leaves dogFriendly undefined for the ambiguous 'On In Only' phrasing", () => {
    expect(event?.dogFriendly).toBeUndefined();
  });

  it("captures the Notes blurb as description", () => {
    expect(event?.description).toMatch(/^Happy Memorial Day weekend!/);
  });

  it("returns null when no date is present", () => {
    expect(parseNCH3Page("<html><body><p class='notes'>no run scheduled</p></body></html>")).toBeNull();
  });
});

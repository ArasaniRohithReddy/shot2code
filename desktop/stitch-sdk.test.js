const test = require("node:test");
const assert = require("node:assert/strict");

const { parseStitchReference } = require("./stitch-sdk");

test("parses Stitch project and screen identifiers from a URL", () => {
  assert.deepEqual(
    parseStitchReference(
      "https://stitch.withgoogle.com/projects/123456789/screens/987654321"
    ),
    { projectId: "123456789", screenId: "987654321" }
  );
});

test("refuses a non-Stitch URL", () => {
  assert.throws(
    () => parseStitchReference("https://example.com/projects/123456789"),
    /stitch\.withgoogle\.com/
  );
});

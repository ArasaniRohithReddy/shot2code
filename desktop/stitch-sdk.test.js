const test = require("node:test");
const assert = require("node:assert/strict");

const {
  generateStitchScreen,
  parseStitchReference,
} = require("./stitch-sdk");

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

test("reports real generation phases and closes the client", async () => {
  const originalFetch = global.fetch;
  const progress = [];
  let closed = 0;
  global.fetch = async (url) => ({
    ok: true,
    headers: new Headers({
      "content-type": String(url).endsWith(".html")
        ? "text/html"
        : "image/png",
    }),
    arrayBuffer: async () =>
      Buffer.from(
        String(url).endsWith(".html") ? "<main>Generated</main>" : "image"
      ),
  });
  const screen = {
    projectId: "project-1",
    screenId: "screen-1",
    getHtml: async () => "https://example.com/output.html",
    getImage: async () => "https://example.com/output.png",
  };
  const client = {
    close: async () => {
      closed += 1;
    },
  };
  const createClient = async () => ({
    client,
    sdk: {
      createProject: async () => ({
        generate: async () => screen,
      }),
    },
  });

  try {
    const result = await generateStitchScreen(
      {
        apiKey: "test-key",
        prompt: "A useful interface",
        deviceType: "DESKTOP",
      },
      (event) => progress.push(event.phase),
      createClient
    );

    assert.deepEqual(progress, [
      "connecting",
      "creating-project",
      "generating-screen",
      "downloading-output",
      "complete",
    ]);
    assert.equal(result.html, "<main>Generated</main>");
    assert.equal(result.projectId, "project-1");
    assert.equal(closed, 1);
  } finally {
    global.fetch = originalFetch;
  }
});

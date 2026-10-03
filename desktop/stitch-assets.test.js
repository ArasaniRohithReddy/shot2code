const test = require("node:test");
const assert = require("node:assert/strict");

const {
  blockedIp,
  localizeStitchHtml,
  sanitizeSvg,
} = require("./stitch-assets");

test("refuses private, loopback, metadata and multicast addresses", () => {
  for (const address of [
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "192.168.1.1",
    "224.0.0.1",
    "::1",
    "fd00::1",
    "fe80::1",
  ]) {
    assert.equal(blockedIp(address), true, address);
  }
  assert.equal(blockedIp("8.8.8.8"), false);
  assert.equal(blockedIp("2606:4700:4700::1111"), false);
});

test("sanitizes executable SVG content", () => {
  const sanitized = sanitizeSvg(
    '<svg onload=alert(1)><script>alert(1)</script><a href=javascript:x>x</a></svg>'
  );
  assert.doesNotMatch(sanitized, /script|onload|javascript:/i);
  assert.match(sanitized, /<svg/);
});

test("localizes HTML images, stylesheets and nested CSS assets", async () => {
  const reads = [];
  const readResource = async (url) => {
    reads.push(url);
    if (url.endsWith("theme.css")) {
      return {
        contentType: "text/css",
        bytes: Buffer.from(
          '.hero{background:url("./hero.png")}@font-face{src:url("./font.woff2")}'
        ),
      };
    }
    if (url.endsWith("font.woff2")) {
      return {
        contentType: "font/woff2",
        bytes: Buffer.from("wOF2font"),
      };
    }
    return {
      contentType: "image/png",
      bytes: Buffer.from("\x89PNG\r\n\x1a\nasset", "binary"),
    };
  };

  const result = await localizeStitchHtml(
    '<html><head><link rel="stylesheet" href="./theme.css"></head><body><img src="./logo.png" srcset="./logo.png 1x, ./logo-large.png 2x"></body></html>',
    "https://assets.example/screens/index.html",
    readResource
  );

  assert.match(result.html, /href="assets\/stitch-style-/);
  assert.match(result.html, /src="assets\/logo-/);
  assert.match(result.html, /srcset="assets\/logo-/);
  assert.equal(result.assets.length, 5);
  assert.deepEqual(
    new Set(result.assets.map((asset) => asset.mimeType)),
    new Set(["text/css", "image/png", "font/woff2"])
  );
  assert.ok(reads.some((url) => url.endsWith("/theme.css")));
  assert.ok(reads.some((url) => url.endsWith("/hero.png")));
  assert.ok(reads.some((url) => url.endsWith("/font.woff2")));
});

test("rejected asset downloads fail closed instead of preserving their URL", async () => {
  const result = await localizeStitchHtml(
    '<main><img src="https://127.0.0.1/private.png"><style>main{background:url("https://169.254.169.254/meta.png")}</style></main>',
    "https://assets.example/index.html",
    async () => {
      throw new Error("blocked address");
    }
  );

  assert.doesNotMatch(result.html, /127\.0\.0\.1|169\.254\.169\.254/);
  assert.match(result.html, /data:image\/gif;base64/);
  assert.equal(result.warnings.length, 2);
});

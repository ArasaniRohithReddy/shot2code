const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");

function pngDimensions(filePath) {
  const bytes = fs.readFileSync(filePath);
  assert.equal(bytes.subarray(12, 16).toString("ascii"), "IHDR");
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function icoSizes(filePath) {
  const bytes = fs.readFileSync(filePath);
  assert.equal(bytes.readUInt16LE(0), 0);
  assert.equal(bytes.readUInt16LE(2), 1);
  const count = bytes.readUInt16LE(4);
  const sizes = [];
  for (let index = 0; index < count; index += 1) {
    const offset = 6 + index * 16;
    sizes.push(bytes[offset] || 256);
  }
  return sizes;
}

test("keeps desktop and web icon masters synchronized", () => {
  const desktop = path.join(__dirname, "build", "icon.png");
  const main = path.join(repoRoot, "frontend", "public", "favicon", "main.png");
  const coding = path.join(
    repoRoot,
    "frontend",
    "public",
    "favicon",
    "coding.png"
  );
  assert.deepEqual(pngDimensions(desktop), [512, 512]);
  assert.deepEqual(pngDimensions(main), [512, 512]);
  assert.deepEqual(pngDimensions(coding), [512, 512]);
  assert.equal(sha256(desktop), sha256(main));
  assert.notEqual(sha256(main), sha256(coding));
});

test("ships the required Windows ICO resolutions", () => {
  const sizes = icoSizes(path.join(__dirname, "build", "icon.ico"));
  for (const size of [16, 24, 32, 48, 64, 128, 256]) {
    assert.ok(sizes.includes(size), `missing ${size}x${size} ICO frame`);
  }
});

test("uses relative favicon paths that survive packaged file URLs", () => {
  const indicator = fs.readFileSync(
    path.join(repoRoot, "frontend", "src", "hooks", "useBrowserTabIndicator.ts"),
    "utf8"
  );
  const evals = fs.readFileSync(
    path.join(
      repoRoot,
      "frontend",
      "src",
      "components",
      "evals",
      "RunEvalsPage.tsx"
    ),
    "utf8"
  );
  assert.match(indicator, /"\.\/favicon\/main\.png"/);
  assert.doesNotMatch(evals, /["']\/favicon\//);
});

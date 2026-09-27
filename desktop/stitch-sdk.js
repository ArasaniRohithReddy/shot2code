const MAX_HTML_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const STITCH_PROJECT_TIMEOUT_MS = 120_000;
const STITCH_GENERATION_TIMEOUT_MS = 600_000;
const STITCH_DOWNLOAD_TIMEOUT_MS = 120_000;

function emitProgress(onProgress, phase, message) {
  if (typeof onProgress === "function") onProgress({ phase, message });
}

async function withTimeout(operation, timeoutMs, message) {
  let timer;
  try {
    return await Promise.race([
      operation,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function cleanText(value, label, maxLength = 4096) {
  if (typeof value !== "string") throw new Error(`${label} must be text.`);
  const text = value.trim();
  if (!text || text.length > maxLength) {
    throw new Error(`${label} is missing or too long.`);
  }
  return text;
}

function identifierFromUrl(url, queryNames, pathMarker) {
  for (const name of queryNames) {
    const value = url.searchParams.get(name);
    if (value) return value;
  }
  const segments = url.pathname.split("/").filter(Boolean);
  const markerIndex = segments.findIndex(
    (segment) => segment.toLowerCase() === pathMarker
  );
  if (markerIndex >= 0 && segments[markerIndex + 1]) {
    return segments[markerIndex + 1];
  }
  return null;
}

function parseStitchReference(rawUrl) {
  const input = cleanText(rawUrl, "Stitch URL", 2048);
  let url;
  try {
    url = new URL(input);
  } catch {
    throw new Error("Enter a valid Stitch project or screen URL.");
  }
  if (url.protocol !== "https:" || url.hostname !== "stitch.withgoogle.com") {
    throw new Error("Enter an https://stitch.withgoogle.com URL.");
  }

  let projectId = identifierFromUrl(
    url,
    ["projectId", "project", "project_id"],
    "projects"
  );
  let screenId = identifierFromUrl(
    url,
    ["screenId", "screen", "screen_id"],
    "screens"
  );
  const numericSegments = url.pathname
    .split("/")
    .filter((segment) => /^\d{8,}$/.test(segment));
  if (!projectId) projectId = numericSegments[0] || null;
  if (!screenId) screenId = numericSegments[1] || null;
  if (!projectId) {
    throw new Error(
      "The Stitch URL does not expose a project ID. Open the project or screen and copy its full URL."
    );
  }
  return { projectId, screenId };
}

async function readBounded(urlValue, maxBytes, kind) {
  const url = new URL(cleanText(urlValue, `${kind} URL`, 4096));
  if (url.protocol !== "https:") {
    throw new Error(`Stitch returned an unsafe ${kind} URL.`);
  }
  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(STITCH_DOWNLOAD_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Could not download Stitch ${kind} (HTTP ${response.status}).`);
  }
  const declared = Number(response.headers.get("content-length") || "0");
  if (declared > maxBytes) throw new Error(`Stitch ${kind} is too large.`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maxBytes) throw new Error(`Stitch ${kind} is too large.`);
  return { bytes, contentType: response.headers.get("content-type") || "" };
}

async function screenResult(screen, client, onProgress) {
  try {
    emitProgress(
      onProgress,
      "downloading-output",
      "Downloading the generated HTML and preview image…"
    );
    const [htmlUrl, imageUrl] = await Promise.all([
      screen.getHtml(),
      screen.getImage(),
    ]);
    const [htmlDownload, imageDownload] = await Promise.all([
      readBounded(htmlUrl, MAX_HTML_BYTES, "HTML"),
      readBounded(imageUrl, MAX_IMAGE_BYTES, "image"),
    ]);
    return {
      projectId: screen.projectId,
      screenId: screen.screenId,
      html: Buffer.from(htmlDownload.bytes).toString("utf8"),
      image: `data:${
        imageDownload.contentType.split(";")[0] || "image/png"
      };base64,${Buffer.from(imageDownload.bytes).toString("base64")}`,
    };
  } finally {
    await client.close().catch(() => {});
  }
}

async function createClient(apiKey) {
  const key = cleanText(apiKey, "Stitch API key");
  const { Stitch, StitchToolClient } = await import("@google/stitch-sdk");
  const client = new StitchToolClient({ apiKey: key });
  return { client, sdk: new Stitch(client) };
}

async function testStitchKey({ apiKey }) {
  const { client } = await createClient(apiKey);
  try {
    const result = await client.listTools();
    return {
      ok: true,
      toolCount: Array.isArray(result?.tools) ? result.tools.length : 0,
      message: "Stitch accepted the API key.",
    };
  } finally {
    await client.close().catch(() => {});
  }
}

async function generateStitchScreen(
  { apiKey, prompt, deviceType = "DESKTOP" },
  onProgress,
  createClientImpl = createClient
) {
  const instruction = cleanText(prompt, "Stitch prompt", 20_000);
  const allowedDevices = new Set(["MOBILE", "DESKTOP", "TABLET", "AGNOSTIC"]);
  const device = allowedDevices.has(deviceType) ? deviceType : "DESKTOP";
  emitProgress(onProgress, "connecting", "Connecting to Google Stitch…");
  const { client, sdk } = await createClientImpl(apiKey);
  try {
    emitProgress(onProgress, "creating-project", "Creating a Stitch project…");
    const project = await withTimeout(
      sdk.createProject(`shot2code ${new Date().toISOString().slice(0, 10)}`),
      STITCH_PROJECT_TIMEOUT_MS,
      "Stitch did not create the project within 2 minutes."
    );
    emitProgress(
      onProgress,
      "generating-screen",
      "Stitch is generating the screen. This can take several minutes…"
    );
    const screen = await withTimeout(
      project.generate(instruction, device),
      STITCH_GENERATION_TIMEOUT_MS,
      "Stitch did not finish generating the screen within 10 minutes."
    );
    const result = await withTimeout(
      screenResult(screen, client, onProgress),
      STITCH_DOWNLOAD_TIMEOUT_MS,
      "Stitch did not return the generated files within 2 minutes."
    );
    emitProgress(onProgress, "complete", "Stitch generation completed.");
    return result;
  } catch (error) {
    await client.close().catch(() => {});
    throw error;
  }
}

async function importStitchScreen(
  { apiKey, url },
  onProgress,
  createClientImpl = createClient
) {
  const { projectId, screenId } = parseStitchReference(url);
  emitProgress(onProgress, "connecting", "Connecting to Google Stitch…");
  const { client, sdk } = await createClientImpl(apiKey);
  try {
    emitProgress(onProgress, "loading-screen", "Loading the Stitch screen…");
    const project = sdk.project(projectId);
    const screen = screenId
      ? await project.getScreen(screenId)
      : (await project.screens())[0];
    if (!screen) throw new Error("The Stitch project has no screens.");
    const result = await screenResult(screen, client, onProgress);
    emitProgress(onProgress, "complete", "Stitch import completed.");
    return result;
  } catch (error) {
    await client.close().catch(() => {});
    throw error;
  }
}

module.exports = {
  STITCH_GENERATION_TIMEOUT_MS,
  generateStitchScreen,
  importStitchScreen,
  parseStitchReference,
  testStitchKey,
};

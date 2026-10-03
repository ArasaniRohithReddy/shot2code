const MAX_HTML_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const STITCH_PROJECT_TIMEOUT_MS = 120_000;
const STITCH_GENERATION_TIMEOUT_MS = 600_000;
const STITCH_DOWNLOAD_TIMEOUT_MS = 120_000;
const STITCH_STACK_GUIDANCE = Object.freeze({
  html_tailwind:
    "Use semantic HTML and Tailwind CSS with a browser-runnable CDN setup.",
  html_css:
    "Use semantic HTML, plain CSS, and browser JavaScript without a framework.",
  react_tailwind:
    "Design for a React and Tailwind CSS implementation.",
  bootstrap:
    "Use Bootstrap components and utilities in a browser-runnable implementation.",
  vue_tailwind:
    "Design for a Vue 3 and Tailwind CSS implementation.",
  ionic_tailwind:
    "Design for Ionic web components and Tailwind CSS.",
  alpine_tailwind:
    "Use Alpine.js interactions and Tailwind CSS.",
  preact_tailwind:
    "Design for a Preact and Tailwind CSS implementation.",
  tailwind_daisyui:
    "Use Tailwind CSS and daisyUI component conventions.",
  bulma: "Use Bulma classes and browser JavaScript.",
  material_web:
    "Use Material Web components and Material Design typography.",
  htmx_tailwind:
    "Use htmx interactions and Tailwind CSS in a browser-runnable implementation.",
});
const {
  localizeStitchHtml,
  readBoundedHttps,
} = require("./stitch-assets");

function emitProgress(onProgress, phase, message) {
  if (typeof onProgress === "function") onProgress({ phase, message });
}

function buildStitchInstruction(prompt, stack) {
  const stackGuidance = STITCH_STACK_GUIDANCE[stack];
  if (!stackGuidance) return prompt;
  return `${prompt}

Implementation direction from shot2code:
- ${stackGuidance}
- Return a complete responsive screen with no explanatory prose.
- Preserve a clear semantic structure so shot2code can translate the rendered design into the selected stack.`;
}

async function withTimeout(operation, timeoutMs, message, onTimeout) {
  let timer;
  let timedOut = false;
  try {
    return await Promise.race([
      operation,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          if (typeof onTimeout === "function") onTimeout();
          reject(new Error(message));
        }, timeoutMs);
      }),
    ]);
  } catch (error) {
    if (timedOut && typeof onTimeout === "function") {
      await operation.catch(() => {});
    }
    throw error;
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

function findDesignMarkdown(value, depth = 0) {
  if (depth > 6 || value === null || typeof value !== "object") return "";
  if (
    typeof value.designMd === "string" &&
    value.designMd.trim().length > 0
  ) {
    return value.designMd.trim().slice(0, 100_000);
  }
  for (const nested of Object.values(value)) {
    const found = findDesignMarkdown(nested, depth + 1);
    if (found) return found;
  }
  return "";
}

async function loadDesignMarkdown(project, screen) {
  const embedded =
    findDesignMarkdown(screen?.data) || findDesignMarkdown(project?.data);
  if (embedded) return embedded;
  try {
    const systems = await project.listDesignSystems();
    for (const system of systems) {
      const found = findDesignMarkdown(system?.data);
      if (found) return found;
    }
  } catch {
    // A missing design system does not make the generated screen unusable.
  }
  return "";
}

async function screenResult(
  screen,
  project,
  client,
  onProgress,
  readResource = readBoundedHttps
) {
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
      readResource(htmlUrl, MAX_HTML_BYTES, "HTML"),
      readResource(imageUrl, MAX_IMAGE_BYTES, "image"),
    ]);
    const html = Buffer.from(htmlDownload.bytes).toString("utf8");
    const localized = await localizeStitchHtml(html, htmlUrl, readResource);
    const imageMime =
      imageDownload.contentType.split(";")[0] || "image/png";
    const designMd = await loadDesignMarkdown(project, screen);
    const previewAsset = {
      path: `assets/stitch-preview.${
        imageMime === "image/jpeg"
          ? "jpg"
          : imageMime === "image/webp"
            ? "webp"
            : "png"
      }`,
      mimeType: imageMime,
      size: imageDownload.bytes.length,
      encoding: "base64",
      content: Buffer.from(imageDownload.bytes).toString("base64"),
      sourceUrl: imageUrl,
      kind: "preview",
    };
    return {
      projectId: screen.projectId,
      screenId: screen.screenId,
      html: localized.html,
      image: `data:${
        imageMime
      };base64,${Buffer.from(imageDownload.bytes).toString("base64")}`,
      assets: [...localized.assets, previewAsset],
      designMd,
      warnings: localized.warnings,
    };
  } finally {
    await client.close().catch(() => {});
  }
}

async function createClient(apiKey) {
  const key = cleanText(apiKey, "Stitch API key");
  const { Stitch, StitchToolClient } = await import("@google/stitch-sdk");
  // The published 0.3.5 SDK otherwise enforces its own five-minute default
  // before shot2code's honest ten-minute generation budget can elapse.
  const client = new StitchToolClient({
    apiKey: key,
    timeout: STITCH_GENERATION_TIMEOUT_MS,
  });
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
  { apiKey, prompt, deviceType = "DESKTOP", stack = "html_css" },
  onProgress,
  createClientImpl = createClient,
  readResourceImpl = readBoundedHttps
) {
  const instruction = cleanText(
    buildStitchInstruction(prompt, stack),
    "Stitch prompt",
    20_000
  );
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
    const downloadController = new AbortController();
    const result = await withTimeout(
      screenResult(
        screen,
        project,
        client,
        onProgress,
        (url, maxBytes, kind) =>
          readResourceImpl(
            url,
            maxBytes,
            kind,
            downloadController.signal
          )
      ),
      STITCH_DOWNLOAD_TIMEOUT_MS,
      "Stitch did not return the generated files within 2 minutes.",
      () => downloadController.abort()
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
  createClientImpl = createClient,
  readResourceImpl = readBoundedHttps
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
    const downloadController = new AbortController();
    const result = await withTimeout(
      screenResult(
        screen,
        project,
        client,
        onProgress,
        (assetUrl, maxBytes, kind) =>
          readResourceImpl(
            assetUrl,
            maxBytes,
            kind,
            downloadController.signal
          )
      ),
      STITCH_DOWNLOAD_TIMEOUT_MS,
      "Stitch did not return the imported files within 2 minutes.",
      () => downloadController.abort()
    );
    emitProgress(onProgress, "complete", "Stitch import completed.");
    return result;
  } catch (error) {
    await client.close().catch(() => {});
    throw error;
  }
}

module.exports = {
  STITCH_GENERATION_TIMEOUT_MS,
  STITCH_STACK_GUIDANCE,
  buildStitchInstruction,
  generateStitchScreen,
  importStitchScreen,
  parseStitchReference,
  testStitchKey,
};

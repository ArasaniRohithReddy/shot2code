const crypto = require("node:crypto");
const dns = require("node:dns").promises;
const https = require("node:https");
const net = require("node:net");
const path = require("node:path");
const cheerio = require("cheerio");

const MAX_REDIRECTS = 4;
const MAX_ASSETS = 50;
const MAX_TOTAL_ASSET_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_FONT_BYTES = 6 * 1024 * 1024;
const MAX_STYLESHEET_BYTES = 1024 * 1024;
const REQUEST_TIMEOUT_MS = 120_000;

const MIME_EXTENSIONS = Object.freeze({
  "image/gif": ".gif",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "font/otf": ".otf",
  "font/ttf": ".ttf",
  "font/woff": ".woff",
  "font/woff2": ".woff2",
  "text/css": ".css",
});

function blockedIp(address) {
  const normalized = String(address || "").toLowerCase();
  if (!net.isIP(normalized)) return true;
  if (net.isIPv4(normalized)) {
    const [a, b] = normalized.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized);
  if (mapped) return blockedIp(mapped[1]);
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    /^fe[89ab]/.test(normalized) ||
    normalized.startsWith("ff")
  );
}

async function resolvePublicAddress(hostname) {
  const answers = await dns.lookup(hostname, { all: true, verbatim: true });
  if (answers.length === 0) throw new Error(`Could not resolve ${hostname}.`);
  if (answers.some((answer) => blockedIp(answer.address))) {
    throw new Error(`${hostname} resolves to a non-public address.`);
  }
  return answers[0];
}

function validateHttpsUrl(rawUrl, kind) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`Stitch returned an invalid ${kind} URL.`);
  }
  if (url.protocol !== "https:") {
    throw new Error(`Stitch returned an unsafe ${kind} URL.`);
  }
  if (url.username || url.password) {
    throw new Error(`Stitch returned a ${kind} URL containing credentials.`);
  }
  return url;
}

function requestPinned(url, pinned, maxBytes, kind, signal) {
  return new Promise((resolve, reject) => {
    const request = https.request(
      url,
      {
        method: "GET",
        headers: {
          Accept: "*/*",
          "User-Agent": "shot2code-desktop",
        },
        lookup: (_hostname, options, callback) => {
          if (options?.all) {
            callback(null, [{ address: pinned.address, family: pinned.family }]);
            return;
          }
          callback(null, pinned.address, pinned.family);
        },
      },
      (response) => {
        const status = response.statusCode || 0;
        if ([301, 302, 303, 307, 308].includes(status)) {
          response.resume();
          resolve({
            redirect: response.headers.location || "",
            status,
            contentType: "",
            bytes: Buffer.alloc(0),
          });
          return;
        }
        if (status >= 400) {
          response.resume();
          reject(new Error(`Could not download Stitch ${kind} (HTTP ${status}).`));
          return;
        }
        const declared = Number(response.headers["content-length"] || "0");
        if (declared > maxBytes) {
          response.destroy();
          reject(new Error(`Stitch ${kind} is too large.`));
          return;
        }
        const chunks = [];
        let total = 0;
        response.on("data", (chunk) => {
          total += chunk.length;
          if (total > maxBytes) {
            response.destroy(new Error(`Stitch ${kind} is too large.`));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () =>
          resolve({
            redirect: "",
            status,
            contentType: String(response.headers["content-type"] || ""),
            bytes: Buffer.concat(chunks),
          })
        );
        response.on("error", reject);
      }
    );
    request.setTimeout(REQUEST_TIMEOUT_MS, () =>
      request.destroy(new Error(`Stitch ${kind} download timed out.`))
    );
    if (signal) {
      if (signal.aborted) {
        request.destroy(new Error(`Stitch ${kind} download was cancelled.`));
      } else {
        signal.addEventListener(
          "abort",
          () =>
            request.destroy(new Error(`Stitch ${kind} download was cancelled.`)),
          { once: true }
        );
      }
    }
    request.on("error", reject);
    request.end();
  });
}

async function readBoundedHttps(urlValue, maxBytes, kind, signal) {
  let current = validateHttpsUrl(urlValue, kind);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const pinned = await resolvePublicAddress(current.hostname);
    const response = await requestPinned(
      current,
      pinned,
      maxBytes,
      kind,
      signal
    );
    if (!response.redirect) return response;
    if (hop === MAX_REDIRECTS) {
      throw new Error(`Stitch ${kind} redirected too many times.`);
    }
    current = validateHttpsUrl(
      new URL(response.redirect, current).toString(),
      kind
    );
  }
  throw new Error(`Could not download Stitch ${kind}.`);
}

function cleanMime(value) {
  return String(value || "").split(";", 1)[0].trim().toLowerCase();
}

function safeSourceLabel(sourceUrl) {
  if (sourceUrl.startsWith("data:")) return "embedded data";
  try {
    const url = new URL(sourceUrl);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "external asset";
  }
}

function rejectedReference(kind) {
  if (kind === "stylesheet") return "data:text/css,";
  if (kind === "font") return "data:application/octet-stream;base64,";
  return "data:image/gif;base64,R0lGODlhAQABAAAAACw=";
}

function sniffMime(bytes, declared, sourceUrl) {
  if (bytes.subarray(0, 8).equals(Buffer.from("\x89PNG\r\n\x1a\n", "binary"))) {
    return "image/png";
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.subarray(0, 6).toString("ascii") === "GIF87a" ||
    bytes.subarray(0, 6).toString("ascii") === "GIF89a"
  ) {
    return "image/gif";
  }
  if (
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  if (bytes.subarray(0, 4).toString("ascii") === "wOFF") return "font/woff";
  if (bytes.subarray(0, 4).toString("ascii") === "wOF2") return "font/woff2";
  if (bytes.subarray(0, 4).toString("ascii") === "OTTO") return "font/otf";
  if (bytes.length >= 4 && bytes.readUInt32BE(0) === 0x00010000) {
    return "font/ttf";
  }
  const text = bytes.subarray(0, 4096).toString("utf8").trimStart();
  if (/^<\?xml\b|^<svg\b/i.test(text)) return "image/svg+xml";
  if (declared === "text/css" || /\.css(?:$|[?#])/i.test(sourceUrl)) {
    return "text/css";
  }
  return declared;
}

function sanitizeSvg(text) {
  return text
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, "")
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(
      /\s(?:href|xlink:href)\s*=\s*(?:"javascript:[^"]*"|'javascript:[^']*'|javascript:[^\s>]+)/gi,
      ""
    );
}

function safeFilename(sourceUrl, mimeType, usedNames, hint = "asset") {
  let raw = hint;
  if (!sourceUrl.startsWith("data:")) {
    try {
      raw = decodeURIComponent(path.basename(new URL(sourceUrl).pathname)) || hint;
    } catch {
      raw = hint;
    }
  }
  const ext = MIME_EXTENSIONS[mimeType] || "";
  const base = path
    .basename(raw, path.extname(raw))
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72) || "asset";
  const hash = crypto.createHash("sha256").update(sourceUrl).digest("hex").slice(0, 10);
  let filename = `${base}-${hash}${ext}`;
  let counter = 2;
  while (usedNames.has(filename.toLowerCase())) {
    filename = `${base}-${hash}-${counter}${ext}`;
    counter += 1;
  }
  usedNames.add(filename.toLowerCase());
  return filename;
}

function parseDataUrl(value) {
  const match = /^data:([^;,]+);base64,([\s\S]+)$/i.exec(value);
  if (!match) return null;
  try {
    return { mimeType: cleanMime(match[1]), bytes: Buffer.from(match[2], "base64") };
  } catch {
    return null;
  }
}

class AssetCollector {
  constructor(readResource) {
    this.readResource = readResource;
    this.assets = [];
    this.bySource = new Map();
    this.usedNames = new Set();
    this.totalBytes = 0;
    this.warnings = [];
  }

  async add(sourceUrl, baseUrl, kind, hint = "asset") {
    const absolute = sourceUrl.startsWith("data:")
      ? sourceUrl
      : new URL(sourceUrl, baseUrl).toString();
    if (absolute.startsWith("#")) return sourceUrl;
    if (this.bySource.has(absolute)) return this.bySource.get(absolute);
    if (this.assets.length >= MAX_ASSETS) {
      this.warnings.push(
        `Additional Stitch assets were skipped after ${MAX_ASSETS} files.`
      );
      return rejectedReference(kind);
    }

    let bytes;
    let declared;
    if (absolute.startsWith("data:")) {
      const parsed = parseDataUrl(absolute);
      if (!parsed) return sourceUrl;
      ({ bytes, mimeType: declared } = parsed);
    } else {
      const maxBytes =
        kind === "stylesheet"
          ? MAX_STYLESHEET_BYTES
          : kind === "font"
            ? MAX_FONT_BYTES
            : MAX_IMAGE_BYTES;
      const result = await this.readResource(absolute, maxBytes, kind);
      bytes = result.bytes;
      declared = cleanMime(result.contentType);
    }
    const mimeType = sniffMime(bytes, declared, absolute);
    if (!Object.prototype.hasOwnProperty.call(MIME_EXTENSIONS, mimeType)) {
      this.warnings.push(
        `${hint} was skipped because ${mimeType || "its type"} is unsupported.`
      );
      return rejectedReference(kind);
    }
    if (this.totalBytes + bytes.length > MAX_TOTAL_ASSET_BYTES) {
      this.warnings.push("Additional Stitch assets were skipped after the 20 MB import limit.");
      return rejectedReference(kind);
    }
    this.totalBytes += bytes.length;
    const filename = safeFilename(absolute, mimeType, this.usedNames, hint);
    const assetPath = `assets/${filename}`;
    const text = mimeType === "text/css" || mimeType === "image/svg+xml";
    const content = text
      ? mimeType === "image/svg+xml"
        ? sanitizeSvg(bytes.toString("utf8"))
        : bytes.toString("utf8")
      : bytes.toString("base64");
    this.assets.push({
      path: assetPath,
      mimeType,
      size: bytes.length,
      encoding: text ? "utf8" : "base64",
      content,
      sourceUrl: safeSourceLabel(absolute),
      kind,
    });
    this.bySource.set(absolute, assetPath);
    return assetPath;
  }
}

async function rewriteCssUrls(css, baseUrl, collector) {
  const matches = [...css.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/gi)];
  let rewritten = css;
  for (const match of matches) {
    const source = (match[1] || match[2] || match[3] || "").trim();
    if (!source || source.startsWith("#")) continue;
    const kind = /\.(?:woff2?|ttf|otf)(?:$|[?#])/i.test(source)
      ? "font"
      : "image";
    try {
      const local = await collector.add(source, baseUrl, kind, "stitch-asset");
      rewritten = rewritten.replace(match[0], `url("${local}")`);
    } catch (error) {
      collector.warnings.push(
        `Could not localize ${safeSourceLabel(source)}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      rewritten = rewritten.replace(
        match[0],
        `url("${rejectedReference(kind)}")`
      );
    }
  }
  return rewritten;
}

async function localizeStitchHtml(
  html,
  htmlUrl,
  readResource = readBoundedHttps
) {
  const $ = cheerio.load(html);
  const collector = new AssetCollector(readResource);

  for (const element of $('link[rel~="stylesheet"]').toArray()) {
    const href = $(element).attr("href");
    if (!href) continue;
    try {
      const absolute = new URL(href, htmlUrl).toString();
      const downloaded = await readResource(
        absolute,
        MAX_STYLESHEET_BYTES,
        "stylesheet"
      );
      let css = downloaded.bytes.toString("utf8");
      css = await rewriteCssUrls(css, absolute, collector);
      const local = await collector.add(
        `data:text/css;base64,${Buffer.from(css).toString("base64")}`,
        absolute,
        "stylesheet",
        "stitch-style"
      );
      $(element).attr("href", local);
    } catch (error) {
      collector.warnings.push(
        `Could not localize stylesheet ${safeSourceLabel(href)}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      $(element).remove();
    }
  }

  const referenceAttributes = [
    ["img", "src"],
    ["source", "src"],
    ["video", "poster"],
    ['input[type="image"]', "src"],
    ['link[rel~="icon"]', "href"],
    ['link[rel~="apple-touch-icon"]', "href"],
    ['link[rel~="mask-icon"]', "href"],
    ['link[rel~="preload"][as="image"]', "href"],
    ['link[rel~="preload"][as="font"]', "href"],
  ];
  for (const [selector, attribute] of referenceAttributes) {
    for (const element of $(selector).toArray()) {
      const value = $(element).attr(attribute);
      if (!value) continue;
      try {
        const kind =
          selector.includes('as="font"') || /\.(?:woff2?|ttf|otf)(?:$|[?#])/i.test(value)
            ? "font"
            : "image";
        const local = await collector.add(value, htmlUrl, kind, "stitch-asset");
        $(element).attr(attribute, local);
      } catch (error) {
        collector.warnings.push(
          `Could not localize ${safeSourceLabel(value)}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
        $(element).attr(attribute, rejectedReference("image"));
      }
    }
  }

  for (const element of $("img[srcset],source[srcset]").toArray()) {
    const value = $(element).attr("srcset");
    if (!value || /\bdata:/i.test(value)) continue;
    const rewritten = [];
    for (const candidate of value.split(",")) {
      const parts = candidate.trim().split(/\s+/);
      const source = parts.shift();
      if (!source) continue;
      try {
        const local = await collector.add(
          source,
          htmlUrl,
          "image",
          "stitch-asset"
        );
        rewritten.push([local, ...parts].join(" "));
      } catch (error) {
        collector.warnings.push(
          `Could not localize ${safeSourceLabel(source)}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
        rewritten.push([rejectedReference("image"), ...parts].join(" "));
      }
    }
    if (rewritten.length > 0) {
      $(element).attr("srcset", rewritten.join(", "));
    }
  }

  for (const element of $("style").toArray()) {
    $(element).text(await rewriteCssUrls($(element).text(), htmlUrl, collector));
  }
  for (const element of $("[style]").toArray()) {
    const style = $(element).attr("style");
    if (style) {
      $(element).attr("style", await rewriteCssUrls(style, htmlUrl, collector));
    }
  }

  return {
    html: $.html(),
    assets: collector.assets,
    warnings: collector.warnings,
  };
}

module.exports = {
  MAX_ASSETS,
  blockedIp,
  localizeStitchHtml,
  readBoundedHttps,
  sanitizeSvg,
};

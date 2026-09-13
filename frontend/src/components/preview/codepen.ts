import { Stack } from "../../lib/stacks";
import type { ProjectPreviewArtifact } from "../../lib/project-files";

export interface CodePenPayload {
  title?: string;
  html: string;
  head: string;
  css: string;
  js: string;
  html_classes?: string;
  html_pre_processor: "none";
  css_pre_processor: "none";
  css_prefix: "neither";
  js_pre_processor: "none" | "babel";
  js_module?: boolean;
  css_external: string;
  js_external: string;
  editors: string;
  layout: "left";
}

export type CodePenUnsupportedReason =
  | "fallback-preview"
  | "omitted-dependency"
  | "local-runtime-reference"
  | "unsupported-script-order"
  | "stack-mismatch";

export type CodePenShareResult =
  | { kind: "ready"; payload: CodePenPayload; warnings: string[] }
  | {
      kind: "unsupported";
      reason: CodePenUnsupportedReason;
      message: string;
      paths: string[];
    };

interface ParsedDocument {
  title: string;
  htmlAttributes: string;
  bodyAttributes: string;
  head: string;
  body: string;
}

interface ResourceToken {
  id: number;
  section: "head" | "body";
  start: number;
  end: number;
  kind: "link" | "style" | "script";
  raw: string;
  attributes: string;
  content: string;
}

type ResourceDecision =
  | { kind: "keep" }
  | { kind: "remove" }
  | { kind: "css"; content: string }
  | { kind: "js"; content: string }
  | { kind: "css-external"; url: string }
  | { kind: "js-external"; url: string };

function decodeHtmlEntities(value: string): string {
  return value.replace(
    /&(?:amp|quot|apos|lt|gt|#(\d+)|#x([0-9a-f]+));/gi,
    (entity, decimal: string | undefined, hexadecimal: string | undefined) => {
      if (decimal) return String.fromCodePoint(Number.parseInt(decimal, 10));
      if (hexadecimal) return String.fromCodePoint(Number.parseInt(hexadecimal, 16));
      switch (entity.toLowerCase()) {
        case "&amp;":
          return "&";
        case "&quot;":
          return '"';
        case "&apos;":
          return "'";
        case "&lt;":
          return "<";
        case "&gt;":
          return ">";
        default:
          return entity;
      }
    }
  );
}

function getAttribute(attributes: string, name: string): string | null {
  const quoted = attributes.match(
    new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i")
  );
  if (quoted) return decodeHtmlEntities(quoted[1] ?? quoted[2] ?? "");
  const unquoted = attributes.match(
    new RegExp(`(?:^|\\s)${name}\\s*=\\s*([^\\s>]+)`, "i")
  )?.[1];
  return unquoted === undefined ? null : decodeHtmlEntities(unquoted);
}

function hasAttribute(attributes: string, name: string): boolean {
  return new RegExp(`(?:^|\\s)${name}(?:\\s|=|$)`, "i").test(attributes);
}

function stripTags(value: string): string {
  return decodeHtmlEntities(value.replace(/<[^>]*>/g, "")).trim();
}

function parseAttributeEntries(attributes: string): Array<[string, string]> {
  const entries: Array<[string, string]> = [];
  const pattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(attributes))) {
    entries.push([
      match[1],
      decodeHtmlEntities(match[2] ?? match[3] ?? match[4] ?? ""),
    ]);
  }
  return entries;
}

function bodyAttributeBootstrap(attributes: string): string {
  const entries = parseAttributeEntries(attributes);
  if (entries.length === 0) return "";
  const encoded = JSON.stringify(entries).replace(/</g, "\\u003c");
  return `<script>document.addEventListener("DOMContentLoaded",function(){for(const [name,value] of ${encoded}){document.body.setAttribute(name,value);}});</script>`;
}

function findClosingElement(
  source: string,
  tagName: "html" | "head" | "body",
  contentStart: number
): number {
  const lower = source.toLowerCase();
  let cursor = contentStart;
  while (cursor < source.length) {
    const nextTag = lower.indexOf("<", cursor);
    if (nextTag < 0) return -1;
    if (lower.startsWith("<!--", nextTag)) {
      const commentEnd = lower.indexOf("-->", nextTag + 4);
      cursor = commentEnd < 0 ? source.length : commentEnd + 3;
      continue;
    }
    if (
      lower.startsWith("<script", nextTag) ||
      lower.startsWith("<style", nextTag)
    ) {
      const rawTag = lower.startsWith("<script", nextTag) ? "script" : "style";
      const openEnd = findTagEnd(source, nextTag);
      const rawClose = lower.indexOf(`</${rawTag}`, openEnd);
      cursor = rawClose < 0 ? source.length : findTagEnd(source, rawClose);
      continue;
    }
    if (lower.startsWith(`</${tagName}`, nextTag)) return nextTag;
    cursor = findTagEnd(source, nextTag);
  }
  return -1;
}

function extractElement(
  source: string,
  tagName: "html" | "head" | "body"
): { attributes: string; content: string } | null {
  const open = new RegExp(`<${tagName}\\b([^>]*)>`, "i").exec(source);
  if (!open || open.index === undefined) return null;
  const contentStart = open.index + open[0].length;
  const closeStart =
    tagName === "html"
      ? source.toLowerCase().lastIndexOf("</html")
      : findClosingElement(source, tagName, contentStart);
  if (closeStart < contentStart) return null;
  return {
    attributes: open[1] ?? "",
    content: source.slice(contentStart, closeStart),
  };
}

function parseDocument(sourceHtml: string): ParsedDocument {
  const html = sourceHtml.replace(/^\s*<!doctype[^>]*>/i, "");
  const htmlElement = extractElement(html, "html");
  const documentContent = htmlElement?.content ?? html;
  const headElement = extractElement(documentContent, "head");
  const bodyElement = extractElement(documentContent, "body");
  const head = headElement?.content ?? "";
  const body = bodyElement?.content ?? documentContent.replace(headElement?.content ?? "", "");
  const titleMatch = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(head);

  return {
    title: titleMatch ? stripTags(titleMatch[1]) : "",
    htmlAttributes: htmlElement?.attributes ?? "",
    bodyAttributes: bodyElement?.attributes ?? "",
    head: head.replace(/<title\b[^>]*>[\s\S]*?<\/title\s*>/i, ""),
    body,
  };
}

function findTagEnd(source: string, start: number): number {
  let quote: string | null = null;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ">") {
      return index + 1;
    }
  }
  return source.length;
}

function tokenizeResources(
  section: "head" | "body",
  source: string,
  firstId: number
): ResourceToken[] {
  const tokens: ResourceToken[] = [];
  const lower = source.toLowerCase();
  const startTag = /<(script|style|link)\b/gi;
  let match: RegExpExecArray | null;
  let id = firstId;
  while ((match = startTag.exec(source))) {
    const kind = match[1].toLowerCase() as ResourceToken["kind"];
    const start = match.index;
    const openEnd = findTagEnd(source, start);
    const openTag = source.slice(start, openEnd);
    const attributes = openTag
      .replace(/^<[a-z]+\b/i, "")
      .replace(/\/?\s*>$/, "")
      .trim();
    let end = openEnd;
    let content = "";
    if (kind !== "link") {
      const closeStart = lower.indexOf(`</${kind}`, openEnd);
      if (closeStart < 0) continue;
      const closeEnd = findTagEnd(source, closeStart);
      content = source.slice(openEnd, closeStart);
      end = closeEnd;
      startTag.lastIndex = end;
    }
    tokens.push({
      id,
      section,
      start,
      end,
      kind,
      raw: source.slice(start, end),
      attributes,
      content,
    });
    id += 1;
  }
  return tokens;
}

function canonicalExternalUrl(value: string): string | null {
  const url = value.trim();
  if (!/^(?:https?:)?\/\//i.test(url)) return null;
  const absolute = url.startsWith("//") ? `https:${url}` : url;
  try {
    return new URL(absolute).href;
  } catch {
    return null;
  }
}

function isJavaScriptType(type: string): boolean {
  return (
    !type ||
    type === "text/javascript" ||
    type === "application/javascript" ||
    type === "text/ecmascript" ||
    type === "application/ecmascript"
  );
}

function hasOrderingSensitiveAttributes(attributes: string): boolean {
  return ["async", "defer", "nomodule", "integrity", "crossorigin"].some(
    (name) => hasAttribute(attributes, name)
  );
}

function isBabelRuntime(url: string): boolean {
  return /(?:babel(?:-standalone)?|standalone\/babel)(?:[.@/-]|$)/i.test(url);
}

function containsLocalModuleImport(source: string): boolean {
  return /(?:\b(?:import|export)\s+(?:[^"'`]*?\s+from\s*)?|\bimport\s*\()\s*["'](?:\.{1,2}\/|\/)/m.test(
    source
  );
}

function containsBareModuleImport(source: string): boolean {
  return /(?:\b(?:import|export)\s+(?:[^"'`]*?\s+from\s*)?|\bimport\s*\()\s*["'](?!\.|\/|https?:|data:|blob:)[^"']+/m.test(
    source
  );
}

function applyDecisions(
  source: string,
  tokens: ResourceToken[],
  decisions: Map<number, ResourceDecision>
): string {
  let output = "";
  let cursor = 0;
  for (const token of tokens) {
    output += source.slice(cursor, token.start);
    const decision = decisions.get(token.id) ?? { kind: "keep" };
    if (decision.kind === "keep") output += token.raw;
    cursor = token.end;
  }
  return (output + source.slice(cursor)).trim();
}

function pushUnique(target: string[], seen: Set<string>, value: string) {
  const canonical = canonicalExternalUrl(value);
  if (!canonical || seen.has(canonical)) return;
  seen.add(canonical);
  target.push(canonical);
}

function unsupported(
  reason: CodePenUnsupportedReason,
  message: string,
  paths: string[] = []
): CodePenShareResult {
  return { kind: "unsupported", reason, message, paths };
}

function validateStack(
  stack: Stack,
  documentHtml: string,
  tokens: ResourceToken[],
  extractedJs: string
): string | null {
  const urls = tokens
    .map((token) => getAttribute(token.attributes, token.kind === "link" ? "href" : "src"))
    .filter((value): value is string => Boolean(value))
    .join("\n")
    .toLowerCase();
  const source = `${documentHtml}\n${extractedJs}`;

  switch (stack) {
    case Stack.HTML_CSS:
      return null;
    case Stack.HTML_TAILWIND:
      return /tailwindcss/.test(urls) ? null : "Tailwind was not found in the preview document.";
    case Stack.REACT_TAILWIND:
      if (!/(?:^|\/)react(?:@|\/|\.(?:production|development))/m.test(urls)) {
        return "React's browser runtime was not found.";
      }
      if (!/react-dom/.test(urls)) return "ReactDOM's browser runtime was not found.";
      if (!/tailwindcss/.test(urls)) return "Tailwind's browser runtime was not found.";
      if (!extractedJs.trim()) return "Browser-ready React JSX was not found.";
      if (/\b(?:import|export)\b|\brequire\s*\(/m.test(extractedJs)) {
        return "This React source still requires a module build.";
      }
      return null;
    case Stack.VUE_TAILWIND: {
      const hasGlobalEntry =
        /\bVue\.createApp\s*\(/.test(source) ||
        (/\b(?:const|let|var)\s*\{[^}]*\bcreateApp\b[^}]*\}\s*=\s*Vue\b/.test(
          source
        ) && /\bcreateApp\s*\(/.test(source));
      return /vue(?:\.global|@|\/dist\/vue\.global)/.test(urls) && hasGlobalEntry
        ? null
        : "A Vue global build and createApp entry are required.";
    }
    case Stack.BOOTSTRAP:
      if (!/bootstrap[^\n]*\.css/.test(urls)) return "Bootstrap CSS was not found.";
      if (/\bdata-bs-[a-z-]+\s*=/.test(documentHtml) && !/bootstrap[^\n]*(?:bundle|\.min\.js)|bootstrap\.min\.js/.test(urls)) {
        return "Interactive Bootstrap markup requires its browser bundle.";
      }
      return null;
    case Stack.IONIC_TAILWIND: {
      const moduleIndex = tokens.findIndex(
        (token) =>
          token.kind === "script" &&
          getAttribute(token.attributes, "type")?.toLowerCase() === "module" &&
          /ionic/.test(getAttribute(token.attributes, "src") ?? "")
      );
      const noModuleIndex = tokens.findIndex(
        (token) =>
          token.kind === "script" &&
          hasAttribute(token.attributes, "nomodule") &&
          /ionic/.test(getAttribute(token.attributes, "src") ?? "")
      );
      return moduleIndex >= 0 && (noModuleIndex < 0 || noModuleIndex > moduleIndex)
        ? null
        : "Ionic requires its module runtime, with any nomodule fallback kept afterward.";
    }
    case Stack.ALPINE_TAILWIND:
      return tokens.some(
        (token) =>
          token.kind === "script" &&
          /alpine/.test(getAttribute(token.attributes, "src") ?? "") &&
          hasAttribute(token.attributes, "defer")
      )
        ? null
        : "Alpine must be loaded with its deferred browser runtime.";
    case Stack.PREACT_TAILWIND:
      return /\bpreact\b/i.test(extractedJs) && /\bhtm\b/i.test(extractedJs)
        ? null
        : "Preact sharing requires browser-ready HTM module code.";
    case Stack.TAILWIND_DAISYUI:
      return /tailwindcss/.test(urls) && /daisyui/.test(urls)
        ? null
        : "Tailwind and daisyUI browser resources were not both found.";
    case Stack.BULMA:
      return /bulma[^\n]*\.css/.test(urls) ? null : "Bulma CSS was not found.";
    case Stack.MATERIAL_WEB:
      if (!/@material\/web|material-web/i.test(extractedJs)) {
        return "A Material Web browser module was not found.";
      }
      return /fonts\.googleapis|material-symbols|font-family\s*:\s*Roboto/i.test(source)
        ? null
        : "Material Web font resources were not found.";
    case Stack.HTMX_TAILWIND:
      return /htmx/.test(urls) ? null : "The htmx browser runtime was not found.";
  }
}

function detectUnresolvedLocalRuntime(
  head: string,
  body: string,
  tokens: ResourceToken[]
): string[] {
  const paths = new Set<string>();
  for (const token of tokens) {
    if (token.kind === "link") {
      const rel = (getAttribute(token.attributes, "rel") ?? "").toLowerCase();
      const href = getAttribute(token.attributes, "href");
      if (rel.includes("stylesheet") && href && !canonicalExternalUrl(href) && !/^data:/i.test(href)) {
        paths.add(href);
      }
      continue;
    }
    if (token.kind === "script") {
      const src = getAttribute(token.attributes, "src");
      if (src && !canonicalExternalUrl(src) && !/^data:/i.test(src)) paths.add(src);
      if (
        (getAttribute(token.attributes, "type") ?? "").toLowerCase() === "module" &&
        containsLocalModuleImport(token.content)
      ) {
        paths.add("inline module import");
      }
    }
  }

  const markup = `${head}\n${body}`;
  const attributePattern = /\s(?:src|srcset|poster)\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi;
  let match: RegExpExecArray | null;
  while ((match = attributePattern.exec(markup))) {
    const value = match[1] ?? match[2] ?? match[3] ?? "";
    if (/^\s*(?:data:|blob:)/i.test(value)) continue;
    for (const candidate of value.split(",")) {
      const reference = candidate.trim().split(/\s+/)[0];
      if (
        reference &&
        !/^(?:https?:)?\/\//i.test(reference) &&
        !/^(?:data:|blob:|#)/i.test(reference)
      ) {
        paths.add(reference);
      }
    }
  }
  return [...paths].sort((a, b) => a.localeCompare(b));
}

export function createCodePenShareResult({
  stack,
  artifact,
}: {
  stack: Stack;
  artifact: ProjectPreviewArtifact;
}): CodePenShareResult {
  if (artifact.kind !== "html-entry") {
    return unsupported(
      "fallback-preview",
      `CodePen is unavailable because ${artifact.projectEntryPoint} needs a build runtime. Download the Project folder to keep every source file.`,
      [artifact.projectEntryPoint]
    );
  }
  if (artifact.omittedFilePaths.length > 0 || artifact.diagnostics.length > 0) {
    const paths = [...new Set([
      ...artifact.omittedFilePaths,
      ...artifact.diagnostics.map((diagnostic) => diagnostic.path),
    ])].sort((a, b) => a.localeCompare(b));
    return unsupported(
      "omitted-dependency",
      `CodePen cannot represent ${paths.join(", ")} without changing the project. Download the Project folder instead.`,
      paths
    );
  }

  const parsed = parseDocument(artifact.html);
  const headTokens = tokenizeResources("head", parsed.head, 0);
  const bodyTokens = tokenizeResources("body", parsed.body, headTokens.length);
  const tokens = [...headTokens, ...bodyTokens];
  const unresolved = detectUnresolvedLocalRuntime(parsed.head, parsed.body, tokens);
  if (unresolved.length > 0) {
    return unsupported(
      "local-runtime-reference",
      `CodePen cannot resolve local project references: ${unresolved.join(", ")}. Download the Project folder instead.`,
      unresolved
    );
  }

  const decisions = new Map<number, ResourceDecision>();
  const cssCandidates: ResourceToken[] = [];
  const externalScriptCandidates: ResourceToken[] = [];
  const classicInlineScriptCandidates: ResourceToken[] = [];
  const retainedExecutableScripts = new Set<number>();
  const useModulePanel =
    stack === Stack.PREACT_TAILWIND || stack === Stack.MATERIAL_WEB;

  for (const token of tokens) {
    if (token.kind === "link") {
      const rel = (getAttribute(token.attributes, "rel") ?? "").toLowerCase();
      const href = getAttribute(token.attributes, "href");
      const url = href ? canonicalExternalUrl(href) : null;
      if (
        rel.split(/\s+/).includes("stylesheet") &&
        url &&
        !["media", "integrity", "crossorigin", "disabled"].some((name) =>
          hasAttribute(token.attributes, name)
        )
      ) {
        cssCandidates.push(token);
        decisions.set(token.id, { kind: "css-external", url });
      }
      continue;
    }

    if (token.kind === "style") {
      const type = (getAttribute(token.attributes, "type") ?? "").toLowerCase();
      if (!type || type === "text/css") {
        const media = getAttribute(token.attributes, "media");
        cssCandidates.push(token);
        decisions.set(token.id, {
          kind: "css",
          content: media ? `@media ${media} {\n${token.content}\n}` : token.content,
        });
      }
      continue;
    }

    const type = (getAttribute(token.attributes, "type") ?? "").toLowerCase();
    const src = getAttribute(token.attributes, "src");
    const url = src ? canonicalExternalUrl(src) : null;
    if (useModulePanel && type === "module" && !hasOrderingSensitiveAttributes(token.attributes)) {
      const moduleContent = url
        ? `import ${JSON.stringify(url)};`
        : token.content;
      decisions.set(token.id, { kind: "js", content: moduleContent });
      continue;
    }
    if (stack === Stack.REACT_TAILWIND && url && isBabelRuntime(url)) {
      decisions.set(token.id, { kind: "remove" });
      continue;
    }
    if (
      stack === Stack.REACT_TAILWIND &&
      !src &&
      (type === "text/babel" || type === "text/jsx")
    ) {
      classicInlineScriptCandidates.push(token);
      decisions.set(token.id, { kind: "js", content: token.content });
      continue;
    }
    if (
      url &&
      isJavaScriptType(type) &&
      !hasOrderingSensitiveAttributes(token.attributes)
    ) {
      externalScriptCandidates.push(token);
      decisions.set(token.id, { kind: "js-external", url });
      continue;
    }
    if (!src && isJavaScriptType(type)) {
      if (useModulePanel) {
        retainedExecutableScripts.add(token.id);
        continue;
      }
      classicInlineScriptCandidates.push(token);
      decisions.set(token.id, { kind: "js", content: token.content });
      continue;
    }
    if (type === "module" || src) retainedExecutableScripts.add(token.id);
  }

  const firstClassicInlineId =
    classicInlineScriptCandidates[0]?.id ?? Number.POSITIVE_INFINITY;
  const scriptPanelsWouldReorder =
    externalScriptCandidates.some((token) => token.id > firstClassicInlineId) ||
    (classicInlineScriptCandidates.length > 0 &&
      retainedExecutableScripts.size > 0);
  if (scriptPanelsWouldReorder) {
    if (stack === Stack.REACT_TAILWIND) {
      return unsupported(
        "unsupported-script-order",
        "CodePen cannot preserve this React document's script order. Download the Project folder instead."
      );
    }
    for (const token of [
      ...externalScriptCandidates,
      ...classicInlineScriptCandidates,
    ]) {
      decisions.set(token.id, { kind: "keep" });
    }
  }

  const firstStyleId = tokens.find(
    (token) => decisions.get(token.id)?.kind === "css"
  )?.id ?? Number.POSITIVE_INFINITY;
  const stylesWouldReorder = tokens.some(
    (token) => decisions.get(token.id)?.kind === "css-external" && token.id > firstStyleId
  );
  if (stylesWouldReorder) {
    for (const token of cssCandidates) decisions.set(token.id, { kind: "keep" });
  }

  const retainedSignatures = new Set<string>();
  for (const token of tokens) {
    if ((decisions.get(token.id)?.kind ?? "keep") !== "keep") continue;
    const resourceUrl = canonicalExternalUrl(
      getAttribute(token.attributes, token.kind === "link" ? "href" : "src") ?? ""
    );
    if (!resourceUrl) continue;
    const signature = [
      token.kind,
      resourceUrl,
      (getAttribute(token.attributes, "type") ?? "").toLowerCase(),
      hasAttribute(token.attributes, "defer"),
      hasAttribute(token.attributes, "async"),
      hasAttribute(token.attributes, "nomodule"),
      getAttribute(token.attributes, "media") ?? "",
      getAttribute(token.attributes, "integrity") ?? "",
    ].join(":");
    if (retainedSignatures.has(signature)) decisions.set(token.id, { kind: "remove" });
    else retainedSignatures.add(signature);
  }

  const retainedUrls = new Set(
    tokens
      .filter((token) => (decisions.get(token.id)?.kind ?? "keep") === "keep")
      .map((token) =>
        canonicalExternalUrl(
          getAttribute(token.attributes, token.kind === "link" ? "href" : "src") ?? ""
        )
      )
      .filter((value): value is string => Boolean(value))
  );
  const cssExternal: string[] = [];
  const jsExternal: string[] = [];
  const seenCss = new Set<string>();
  const seenJs = new Set<string>();
  const cssParts: string[] = [];
  const jsParts: string[] = [];

  for (const token of tokens) {
    const decision = decisions.get(token.id);
    if (!decision) continue;
    if (decision.kind === "css") cssParts.push(decision.content.trim());
    if (decision.kind === "js") jsParts.push(decision.content.trim());
    if (decision.kind === "css-external") {
      if (retainedUrls.has(decision.url)) decisions.set(token.id, { kind: "remove" });
      else pushUnique(cssExternal, seenCss, decision.url);
    }
    if (decision.kind === "js-external") {
      if (retainedUrls.has(decision.url)) decisions.set(token.id, { kind: "remove" });
      else pushUnique(jsExternal, seenJs, decision.url);
    }
  }

  const js = jsParts.filter(Boolean).join("\n\n");
  const validationError = validateStack(stack, artifact.html, tokens, js);
  if (validationError) {
    return unsupported("stack-mismatch", `${validationError} Download the Project folder instead.`);
  }
  if (stack === Stack.REACT_TAILWIND && (containsLocalModuleImport(js) || containsBareModuleImport(js))) {
    return unsupported(
      "local-runtime-reference",
      "This React source still imports project or package modules, so CodePen cannot run it honestly. Download the Project folder instead."
    );
  }

  const htmlClasses = getAttribute(parsed.htmlAttributes, "class") ?? undefined;
  const transformedHead = [
    bodyAttributeBootstrap(parsed.bodyAttributes),
    applyDecisions(parsed.head, headTokens, decisions),
  ]
    .filter(Boolean)
    .join("\n");
  const transformedBody = applyDecisions(parsed.body, bodyTokens, decisions);
  const warnings = [
    "Opening CodePen sends this preview source and external resource URLs off this device. Public Pens may be visible to others.",
  ];
  if (stack === Stack.HTMX_TAILWIND && /\shx-(?:get|post|put|patch|delete)\s*=/i.test(artifact.html)) {
    warnings.push(
      "HTMX markup is shared as client-only code; project-local server endpoints are not hosted by CodePen."
    );
  }

  const payload: CodePenPayload = {
    ...(parsed.title ? { title: parsed.title } : {}),
    html: transformedBody,
    head: transformedHead,
    css: cssParts.filter(Boolean).join("\n\n"),
    js,
    ...(htmlClasses ? { html_classes: htmlClasses } : {}),
    html_pre_processor: "none",
    css_pre_processor: "none",
    css_prefix: "neither",
    js_pre_processor: stack === Stack.REACT_TAILWIND ? "babel" : "none",
    ...(useModulePanel ? { js_module: true } : {}),
    css_external: cssExternal.join(";"),
    js_external: jsExternal.join(";"),
    editors: `1${cssParts.some(Boolean) ? "1" : "0"}${jsParts.some(Boolean) ? "1" : "0"}`,
    layout: "left",
  };

  return { kind: "ready", payload, warnings };
}

export function submitCodePenPayload(payload: CodePenPayload) {
  const input = document.createElement("input");
  input.type = "hidden";
  input.name = "data";
  input.value = JSON.stringify(payload);

  const form = document.createElement("form");
  form.method = "POST";
  form.action = "https://codepen.io/pen/define";
  form.target = "_blank";
  form.rel = "noopener noreferrer";
  form.appendChild(input);

  document.body.appendChild(form);
  form.submit();
  form.remove();
}

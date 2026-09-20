export type AuditSeverity = "error" | "warning" | "info";

export interface AuditFinding {
  id: string;
  severity: AuditSeverity;
  ruleId: string;
  message: string;
  evidence: string;
  affectedFile: string;
  guidance: string;
}

export interface SourceAuditInput {
  html: string;
  sourcePath?: string | null;
  viewportWidths: readonly number[];
}

interface ParsedText {
  type: "text";
  value: string;
  start: number;
}

interface ParsedElement {
  type: "element";
  tagName: string;
  attributes: Record<string, string>;
  children: ParsedNode[];
  parent: ParsedElement | null;
  start: number;
}

type ParsedNode = ParsedText | ParsedElement;

interface ParsedDocument {
  roots: ParsedNode[];
  elements: ParsedElement[];
  lineAt: (offset: number) => number;
}

const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

const RAW_TEXT_ELEMENTS = new Set(["script", "style", "textarea", "title"]);
const HIDDEN_TEXT_ELEMENTS = new Set(["script", "style", "template"]);

const GUIDANCE = {
  htmlLang:
    'Add a valid lang attribute to <html>, for example <html lang="en">.',
  title: "Add a short, descriptive, non-empty <title> inside <head>.",
  viewport:
    'Add <meta name="viewport" content="width=device-width, initial-scale=1">.',
  heading:
    "Use one clear h1 and progress through heading levels without skipping levels.",
  main: "Wrap the page's primary content in one <main> landmark.",
  imageAlt:
    'Give informative images useful alt text and decorative images alt="".',
  formLabel:
    "Associate a visible <label> with the control, or provide an accurate aria-label/aria-labelledby name.",
  accessibleName:
    "Provide visible text or an accurate aria-label/aria-labelledby accessible name.",
  duplicateId: "Make every id value unique within the document.",
  tabindex:
    "Use tabindex=\"0\" for custom focus targets and rely on DOM order instead of positive tabindex values.",
  nestedInteractive:
    "Do not place one interactive control inside another; use sibling controls or simplify the outer element.",
  tableHeaders:
    "Use <th> cells (with appropriate scope or headers associations) for data-table headers.",
  tableCaption:
    "Add a concise <caption> that identifies the table's purpose.",
  fixedWidth:
    "Prefer fluid sizing such as max-width: 100%, or scope the fixed size behind an appropriate media query.",
} as const;

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };
  return value.replace(
    /&(#x[\da-f]+|#\d+|amp|apos|gt|lt|nbsp|quot);/gi,
    (entity, body: string) => {
      const lower = body.toLowerCase();
      if (lower.startsWith("#x")) {
        const codePoint = Number.parseInt(lower.slice(2), 16);
        return Number.isFinite(codePoint)
          ? String.fromCodePoint(codePoint)
          : entity;
      }
      if (lower.startsWith("#")) {
        const codePoint = Number.parseInt(lower.slice(1), 10);
        return Number.isFinite(codePoint)
          ? String.fromCodePoint(codePoint)
          : entity;
      }
      return named[lower] ?? entity;
    }
  );
}

function findTagEnd(source: string, start: number): number {
  let quote: '"' | "'" | null = null;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ">") {
      return index;
    }
  }
  return source.length - 1;
}

function parseAttributes(value: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const pattern =
    /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value))) {
    const name = match[1].toLowerCase();
    if (name in attributes) continue;
    attributes[name] = decodeHtmlEntities(
      match[2] ?? match[3] ?? match[4] ?? ""
    );
  }
  return attributes;
}

function parseHtml(source: string): ParsedDocument {
  const roots: ParsedNode[] = [];
  const elements: ParsedElement[] = [];
  const stack: ParsedElement[] = [];
  const lineStarts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\n") lineStarts.push(index + 1);
  }

  const append = (node: ParsedNode) => {
    const parent = stack[stack.length - 1];
    if (parent) parent.children.push(node);
    else roots.push(node);
  };

  const appendText = (start: number, end: number) => {
    if (end <= start) return;
    append({ type: "text", value: source.slice(start, end), start });
  };

  let cursor = 0;
  while (cursor < source.length) {
    const tagStart = source.indexOf("<", cursor);
    if (tagStart === -1) {
      appendText(cursor, source.length);
      break;
    }
    appendText(cursor, tagStart);

    if (source.startsWith("<!--", tagStart)) {
      const commentEnd = source.indexOf("-->", tagStart + 4);
      cursor = commentEnd === -1 ? source.length : commentEnd + 3;
      continue;
    }

    const tagEnd = findTagEnd(source, tagStart + 1);
    const rawTag = source.slice(tagStart + 1, tagEnd);
    if (/^\s*[!?]/.test(rawTag)) {
      cursor = tagEnd + 1;
      continue;
    }

    const closingMatch = rawTag.match(/^\s*\/\s*([A-Za-z][\w:-]*)/);
    if (closingMatch) {
      const tagName = closingMatch[1].toLowerCase();
      for (let index = stack.length - 1; index >= 0; index -= 1) {
        if (stack[index].tagName === tagName) {
          stack.length = index;
          break;
        }
      }
      cursor = tagEnd + 1;
      continue;
    }

    const openingMatch = rawTag.match(/^\s*([A-Za-z][\w:-]*)/);
    if (!openingMatch) {
      cursor = tagStart + 1;
      continue;
    }

    const tagName = openingMatch[1].toLowerCase();
    const attributeSource = rawTag.slice(
      (openingMatch.index ?? 0) + openingMatch[0].length
    );
    const parent = stack[stack.length - 1] ?? null;
    const element: ParsedElement = {
      type: "element",
      tagName,
      attributes: parseAttributes(attributeSource),
      children: [],
      parent,
      start: tagStart,
    };
    append(element);
    elements.push(element);
    cursor = tagEnd + 1;

    if (VOID_ELEMENTS.has(tagName) || /\/\s*$/.test(rawTag)) continue;

    if (RAW_TEXT_ELEMENTS.has(tagName)) {
      const closingPattern = new RegExp(`</\\s*${tagName}\\s*>`, "i");
      const remainder = source.slice(cursor);
      const closing = closingPattern.exec(remainder);
      const textEnd = closing ? cursor + (closing.index ?? 0) : source.length;
      if (textEnd > cursor) {
        element.children.push({
          type: "text",
          value: source.slice(cursor, textEnd),
          start: cursor,
        });
      }
      cursor = closing ? textEnd + closing[0].length : source.length;
      continue;
    }

    stack.push(element);
  }

  const lineAt = (offset: number) => {
    let low = 0;
    let high = lineStarts.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (lineStarts[middle] <= offset) low = middle + 1;
      else high = middle;
    }
    return Math.max(1, low);
  };

  return { roots, elements, lineAt };
}

function normalizeText(value: string): string {
  return decodeHtmlEntities(value).replace(/\s+/g, " ").trim();
}

function getTextContent(node: ParsedNode): string {
  if (node.type === "text") return node.value;
  if (
    HIDDEN_TEXT_ELEMENTS.has(node.tagName) ||
    node.attributes["aria-hidden"]?.toLowerCase() === "true" ||
    "hidden" in node.attributes
  ) {
    return "";
  }
  if (node.tagName === "img") return node.attributes.alt ?? "";
  return node.children.map(getTextContent).join(" ");
}

function descendants(
  element: ParsedElement,
  predicate: (candidate: ParsedElement) => boolean,
  skipNestedTables = false
): ParsedElement[] {
  const matches: ParsedElement[] = [];
  const visit = (node: ParsedNode) => {
    if (node.type === "text") return;
    if (skipNestedTables && node !== element && node.tagName === "table") {
      return;
    }
    if (node !== element && predicate(node)) matches.push(node);
    node.children.forEach(visit);
  };
  element.children.forEach(visit);
  return matches;
}

function cleanEvidenceValue(value: string, limit = 48): string {
  const normalized = normalizeText(value);
  return normalized.length <= limit
    ? normalized
    : `${normalized.slice(0, limit - 1)}…`;
}

function describeElement(
  element: ParsedElement,
  lineAt: (offset: number) => number
): string {
  const id = element.attributes.id
    ? `#${cleanEvidenceValue(element.attributes.id, 28)}`
    : "";
  const classes = (element.attributes.class ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((className) => `.${cleanEvidenceValue(className, 24)}`)
    .join("");
  return `<${element.tagName}${id}${classes}> at line ${lineAt(
    element.start
  )}`;
}

function sanitizeProjectPath(value?: string | null): string {
  if (!value) return "composed-preview.html";
  const wasAbsolute = /^[A-Za-z]:[\\/]/.test(value) || /^[\\/]/.test(value);
  const parts = value
    .replace(/^[A-Za-z]:/, "")
    .replace(/\\/g, "/")
    .split("/")
    .filter((part) => part && part !== "." && part !== "..");
  if (wasAbsolute) {
    return parts[parts.length - 1] || "composed-preview.html";
  }
  return parts.join("/") || "composed-preview.html";
}

function affectedFileFor(
  element: ParsedElement | null,
  fallback: string
): string {
  let current = element;
  while (current) {
    const path = current.attributes["data-shot2code-path"];
    if (path) return sanitizeProjectPath(path);
    current = current.parent;
  }
  return fallback;
}

function hasAccessibleName(
  element: ParsedElement,
  ids: Map<string, ParsedElement[]>
): boolean {
  if (normalizeText(element.attributes["aria-label"] ?? "")) return true;
  const labelledBy = (element.attributes["aria-labelledby"] ?? "")
    .split(/\s+/)
    .filter(Boolean);
  if (
    labelledBy.some((id) =>
      normalizeText(getTextContent(ids.get(id)?.[0] ?? { type: "text", value: "", start: 0 }))
    )
  ) {
    return true;
  }
  if (normalizeText(getTextContent(element))) return true;
  return Boolean(normalizeText(element.attributes.title ?? ""));
}

function isInteractive(element: ParsedElement): boolean {
  const role = element.attributes.role?.toLowerCase();
  if (
    role &&
    [
      "button",
      "checkbox",
      "link",
      "menuitem",
      "option",
      "radio",
      "slider",
      "switch",
      "tab",
      "textbox",
    ].includes(role)
  ) {
    return true;
  }
  if (element.tagName === "a") return "href" in element.attributes;
  if (element.tagName === "button") return true;
  if (element.tagName === "input") {
    return (element.attributes.type ?? "text").toLowerCase() !== "hidden";
  }
  if (["select", "textarea", "summary"].includes(element.tagName)) return true;
  if (
    ["audio", "video"].includes(element.tagName) &&
    "controls" in element.attributes
  ) {
    return true;
  }
  return (
    "contenteditable" in element.attributes &&
    element.attributes.contenteditable.toLowerCase() !== "false"
  );
}

function isInteractiveContainer(element: ParsedElement): boolean {
  const role = element.attributes.role?.toLowerCase();
  return (
    element.tagName === "button" ||
    (element.tagName === "a" && "href" in element.attributes) ||
    role === "button" ||
    role === "link"
  );
}

function findInteractiveAncestor(
  element: ParsedElement
): ParsedElement | null {
  let current = element.parent;
  while (current) {
    if (isInteractiveContainer(current)) return current;
    current = current.parent;
  }
  return null;
}

function firstElement(
  elements: readonly ParsedElement[],
  tagName: string
): ParsedElement | undefined {
  return elements.find((element) => element.tagName === tagName);
}

function isFormField(element: ParsedElement): boolean {
  if (element.tagName === "select" || element.tagName === "textarea") {
    return true;
  }
  if (element.tagName !== "input") return false;
  return ![
    "button",
    "hidden",
    "image",
    "reset",
    "submit",
  ].includes((element.attributes.type ?? "text").toLowerCase());
}

function hasFormLabel(
  element: ParsedElement,
  ids: Map<string, ParsedElement[]>,
  labelsByFor: Map<string, ParsedElement[]>
): boolean {
  if (normalizeText(element.attributes["aria-label"] ?? "")) return true;
  const labelledBy = (element.attributes["aria-labelledby"] ?? "")
    .split(/\s+/)
    .filter(Boolean);
  if (
    labelledBy.some((id) => {
      const target = ids.get(id)?.[0];
      return target && normalizeText(getTextContent(target));
    })
  ) {
    return true;
  }

  const id = element.attributes.id;
  if (
    id &&
    labelsByFor
      .get(id)
      ?.some((label) => normalizeText(getTextContent(label)))
  ) {
    return true;
  }

  let current = element.parent;
  while (current) {
    if (
      current.tagName === "label" &&
      normalizeText(getTextContent(current))
    ) {
      return true;
    }
    current = current.parent;
  }
  return Boolean(normalizeText(element.attributes.title ?? ""));
}

export function auditComposedPreviewSource({
  html,
  sourcePath,
  viewportWidths,
}: SourceAuditInput): AuditFinding[] {
  const document = parseHtml(html);
  const sourceFile = sanitizeProjectPath(sourcePath);
  const findings: AuditFinding[] = [];
  const ids = new Map<string, ParsedElement[]>();
  const labelsByFor = new Map<string, ParsedElement[]>();

  const addFinding = ({
    severity,
    ruleId,
    message,
    evidence,
    element = null,
    affectedFile,
    guidance,
  }: {
    severity: AuditSeverity;
    ruleId: string;
    message: string;
    evidence: string;
    element?: ParsedElement | null;
    affectedFile?: string;
    guidance: string;
  }) => {
    const ordinal =
      findings.filter((finding) => finding.ruleId === ruleId).length + 1;
    findings.push({
      id: `${ruleId}-${ordinal}`,
      severity,
      ruleId,
      message,
      evidence,
      affectedFile:
        affectedFile ?? affectedFileFor(element, sourceFile),
      guidance,
    });
  };

  for (const element of document.elements) {
    const id = element.attributes.id?.trim();
    if (id) ids.set(id, [...(ids.get(id) ?? []), element]);
    if (element.tagName === "label") {
      const htmlFor = element.attributes.for?.trim();
      if (htmlFor) {
        labelsByFor.set(htmlFor, [
          ...(labelsByFor.get(htmlFor) ?? []),
          element,
        ]);
      }
    }
  }

  const htmlElement = firstElement(document.elements, "html");
  if (!htmlElement || !normalizeText(htmlElement.attributes.lang ?? "")) {
    addFinding({
      severity: "warning",
      ruleId: "document-html-lang",
      message: "The document does not declare its language.",
      evidence: htmlElement
        ? `${describeElement(
            htmlElement,
            document.lineAt
          )} has no non-empty lang attribute.`
        : "No <html lang> element appears in the composed preview source.",
      element: htmlElement,
      guidance: GUIDANCE.htmlLang,
    });
  }

  const title = document.elements.find(
    (element) =>
      element.tagName === "title" &&
      element.parent?.tagName === "head"
  );
  if (!title || !normalizeText(getTextContent(title))) {
    addFinding({
      severity: "warning",
      ruleId: "document-title",
      message: "The document has no descriptive title.",
      evidence: title
        ? `${describeElement(title, document.lineAt)} is empty.`
        : "No <title> appears inside <head>.",
      element: title,
      guidance: GUIDANCE.title,
    });
  }

  const viewportMeta = document.elements.find(
    (element) =>
      element.tagName === "meta" &&
      element.attributes.name?.toLowerCase() === "viewport"
  );
  const viewportContent = viewportMeta?.attributes.content ?? "";
  if (
    !viewportMeta ||
    !/\bwidth\s*=\s*device-width\b/i.test(viewportContent)
  ) {
    addFinding({
      severity: "warning",
      ruleId: "document-viewport",
      message: "The document is missing a responsive viewport declaration.",
      evidence: viewportMeta
        ? `${describeElement(
            viewportMeta,
            document.lineAt
          )} does not include width=device-width.`
        : 'No <meta name="viewport"> appears in the document.',
      element: viewportMeta,
      guidance: GUIDANCE.viewport,
    });
  }

  const headings = document.elements.filter((element) =>
    /^h[1-6]$/.test(element.tagName)
  );
  if (headings.length === 0) {
    addFinding({
      severity: "warning",
      ruleId: "heading-structure",
      message: "The page has no semantic heading.",
      evidence: "No <h1> through <h6> appears in the composed source.",
      guidance: GUIDANCE.heading,
    });
  } else {
    const firstLevel = Number(headings[0].tagName.slice(1));
    if (firstLevel !== 1) {
      addFinding({
        severity: "warning",
        ruleId: "heading-structure",
        message: "The heading outline does not start with an h1.",
        evidence: `${describeElement(
          headings[0],
          document.lineAt
        )} is the first heading.`,
        element: headings[0],
        guidance: GUIDANCE.heading,
      });
    }
    for (let index = 1; index < headings.length; index += 1) {
      const previousLevel = Number(headings[index - 1].tagName.slice(1));
      const level = Number(headings[index].tagName.slice(1));
      if (level > previousLevel + 1) {
        addFinding({
          severity: "warning",
          ruleId: "heading-structure",
          message: `The heading outline skips from h${previousLevel} to h${level}.`,
          evidence: `${describeElement(
            headings[index],
            document.lineAt
          )} follows an h${previousLevel}.`,
          element: headings[index],
          guidance: GUIDANCE.heading,
        });
      }
    }
  }

  const mainLandmarks = document.elements.filter(
    (element) =>
      element.tagName === "main" ||
      element.attributes.role?.toLowerCase() === "main"
  );
  if (mainLandmarks.length === 0) {
    addFinding({
      severity: "warning",
      ruleId: "landmark-main",
      message: "The page has no main landmark.",
      evidence: "No <main> or role=\"main\" appears in the composed source.",
      guidance: GUIDANCE.main,
    });
  } else if (mainLandmarks.length > 1) {
    addFinding({
      severity: "warning",
      ruleId: "landmark-main",
      message: "The page has more than one main landmark.",
      evidence: `${mainLandmarks.length} main landmarks appear at lines ${mainLandmarks
        .map((element) => document.lineAt(element.start))
        .join(", ")}.`,
      element: mainLandmarks[1],
      guidance: GUIDANCE.main,
    });
  }

  for (const image of document.elements.filter(
    (element) =>
      element.tagName === "img" ||
      (element.tagName === "input" &&
        element.attributes.type?.toLowerCase() === "image")
  )) {
    if (!("alt" in image.attributes)) {
      addFinding({
        severity: "error",
        ruleId: "image-alt",
        message: "An image has no alt attribute.",
        evidence: `${describeElement(
          image,
          document.lineAt
        )} omits alt.`,
        element: image,
        guidance: GUIDANCE.imageAlt,
      });
    }
  }

  for (const field of document.elements.filter(isFormField)) {
    if (!hasFormLabel(field, ids, labelsByFor)) {
      addFinding({
        severity: "error",
        ruleId: "form-control-name",
        message: "A form control has no associated label.",
        evidence: `${describeElement(
          field,
          document.lineAt
        )} has no label or ARIA name.`,
        element: field,
        guidance: GUIDANCE.formLabel,
      });
    }
  }

  const namedControls = document.elements.filter((element) => {
    const role = element.attributes.role?.toLowerCase();
    if (element.tagName === "button") return true;
    if (element.tagName === "a" && "href" in element.attributes) return true;
    if (role === "button" || role === "link") return true;
    return (
      element.tagName === "input" &&
      ["button", "image", "reset", "submit"].includes(
        (element.attributes.type ?? "").toLowerCase()
      )
    );
  });
  for (const control of namedControls) {
    const inputType = control.attributes.type?.toLowerCase();
    const hasNativeInputName =
      control.tagName === "input" &&
      ((inputType === "submit" && !("value" in control.attributes)) ||
        (inputType === "reset" && !("value" in control.attributes)) ||
        normalizeText(control.attributes.value ?? "") !== "");
    const imageAlt =
      inputType === "image" && normalizeText(control.attributes.alt ?? "");
    if (!hasNativeInputName && !imageAlt && !hasAccessibleName(control, ids)) {
      addFinding({
        severity: "error",
        ruleId: "interactive-name",
        message: "A button or link has no accessible name.",
        evidence: `${describeElement(
          control,
          document.lineAt
        )} has no visible text or ARIA name.`,
        element: control,
        guidance: GUIDANCE.accessibleName,
      });
    }
  }

  for (const [id, matches] of ids) {
    if (matches.length < 2) continue;
    addFinding({
      severity: "error",
      ruleId: "duplicate-id",
      message: `The id "${cleanEvidenceValue(id)}" is duplicated.`,
      evidence: `id="${cleanEvidenceValue(id)}" appears ${matches.length} times at lines ${matches
        .map((element) => document.lineAt(element.start))
        .join(", ")}.`,
      element: matches[1],
      guidance: GUIDANCE.duplicateId,
    });
  }

  for (const element of document.elements) {
    const tabindex = element.attributes.tabindex;
    if (tabindex === undefined) continue;
    const numericValue = Number(tabindex);
    if (Number.isInteger(numericValue) && numericValue > 0) {
      addFinding({
        severity: "warning",
        ruleId: "positive-tabindex",
        message: "Positive tabindex changes the expected keyboard order.",
        evidence: `${describeElement(
          element,
          document.lineAt
        )} uses tabindex="${numericValue}".`,
        element,
        guidance: GUIDANCE.tabindex,
      });
    }
  }

  for (const element of document.elements.filter(isInteractive)) {
    const ancestor = findInteractiveAncestor(element);
    if (!ancestor) continue;
    addFinding({
      severity: "error",
      ruleId: "nested-interactive",
      message: "Interactive elements are nested.",
      evidence: `${describeElement(
        element,
        document.lineAt
      )} is inside ${describeElement(ancestor, document.lineAt)}.`,
      element,
      guidance: GUIDANCE.nestedInteractive,
    });
  }

  for (const table of document.elements.filter(
    (element) => element.tagName === "table"
  )) {
    const captions = descendants(
      table,
      (element) => element.tagName === "caption",
      true
    );
    if (
      captions.length === 0 ||
      !captions.some((caption) => normalizeText(getTextContent(caption)))
    ) {
      addFinding({
        severity: "warning",
        ruleId: "table-caption",
        message: "A table has no non-empty caption.",
        evidence: `${describeElement(
          table,
          document.lineAt
        )} has no descriptive <caption>.`,
        element: table,
        guidance: GUIDANCE.tableCaption,
      });
    }

    const headers = descendants(
      table,
      (element) => element.tagName === "th",
      true
    );
    if (headers.length === 0) {
      addFinding({
        severity: "error",
        ruleId: "table-headers",
        message: "A table has no header cells.",
        evidence: `${describeElement(
          table,
          document.lineAt
        )} contains no <th> elements.`,
        element: table,
        guidance: GUIDANCE.tableHeaders,
      });
    }
  }

  const validWidths = viewportWidths.filter(
    (width) => Number.isFinite(width) && width > 0
  );
  const smallestViewport =
    validWidths.length > 0 ? Math.min(...validWidths) : 320;
  const fixedWidthKeys = new Set<string>();
  const addFixedWidthFinding = ({
    element,
    property,
    pixels,
    offset,
  }: {
    element: ParsedElement;
    property: "width" | "min-width";
    pixels: number;
    offset: number;
  }) => {
    if (pixels <= smallestViewport) return;
    const file = affectedFileFor(element, sourceFile);
    const line = document.lineAt(offset);
    const key = `${file}:${line}:${property}:${pixels}`;
    if (fixedWidthKeys.has(key)) return;
    fixedWidthKeys.add(key);
    addFinding({
      severity: "warning",
      ruleId: "fixed-width-overflow",
      message: "A fixed width may overflow a selected viewport.",
      evidence: `${property}: ${pixels}px at line ${line} exceeds the ${smallestViewport}px smallest review viewport.`,
      element,
      affectedFile: file,
      guidance: `${GUIDANCE.fixedWidth} Recheck at ${smallestViewport}px.`,
    });
  };

  for (const element of document.elements) {
    const inlineStyle = element.attributes.style ?? "";
    const inlineHasFluidCap = /\bmax-width\s*:\s*100%/i.test(inlineStyle);
    const declarationPattern =
      /\b(min-width|width)\s*:\s*(\d+(?:\.\d+)?)px\b/gi;
    let declaration: RegExpExecArray | null;
    while ((declaration = declarationPattern.exec(inlineStyle))) {
      const property = declaration[1].toLowerCase() as "width" | "min-width";
      if (property === "width" && inlineHasFluidCap) continue;
      addFixedWidthFinding({
        element,
        property,
        pixels: Math.round(Number(declaration[2])),
        offset: element.start,
      });
    }

    const className = element.attributes.class ?? "";
    const utilityPattern =
      /(?:^|\s)(min-w|w)-\[(\d+(?:\.\d+)?)px\](?=\s|$)/gi;
    let utility: RegExpExecArray | null;
    while ((utility = utilityPattern.exec(className))) {
      addFixedWidthFinding({
        element,
        property:
          utility[1].toLowerCase() === "min-w" ? "min-width" : "width",
        pixels: Math.round(Number(utility[2])),
        offset: element.start,
      });
    }

    const widthAttribute = element.attributes.width;
    if (
      widthAttribute &&
      /^\d+(?:\.\d+)?$/.test(widthAttribute) &&
      !inlineHasFluidCap
    ) {
      addFixedWidthFinding({
        element,
        property: "width",
        pixels: Math.round(Number(widthAttribute)),
        offset: element.start,
      });
    }

    if (element.tagName !== "style") continue;
    const styleText = element.children
      .filter((child): child is ParsedText => child.type === "text")
      .map((child) => child.value)
      .join("");
    const styleStart =
      element.children.find((child) => child.type === "text")?.start ??
      element.start;
    const blockPattern = /([^{}]+)\{([^{}]*)\}/g;
    let block: RegExpExecArray | null;
    while ((block = blockPattern.exec(styleText))) {
      const declarations = block[2];
      const blockHasFluidCap = /\bmax-width\s*:\s*100%/i.test(declarations);
      declarationPattern.lastIndex = 0;
      while ((declaration = declarationPattern.exec(declarations))) {
        const property = declaration[1].toLowerCase() as
          | "width"
          | "min-width";
        if (property === "width" && blockHasFluidCap) continue;
        addFixedWidthFinding({
          element,
          property,
          pixels: Math.round(Number(declaration[2])),
          offset:
            styleStart +
            (block.index ?? 0) +
            block[0].indexOf(declarations) +
            (declaration.index ?? 0),
        });
      }
    }
  }

  return findings;
}

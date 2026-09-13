import type { ProjectFileLanguage } from "./project-files";

/**
 * Conservative, explicit source formatting.
 *
 * Imported and generated projects routinely arrive minified: a whole document
 * on one line is unreadable in the editor. Formatting it is a *user-initiated*
 * action, never automatic, because rewriting someone's file is only acceptable
 * when they asked for it. Exports therefore keep byte-for-byte source unless
 * the user pressed Format first.
 *
 * Three rules keep this safe:
 *
 * 1. Nothing is ever executed or evaluated. Every formatter is a scanner over
 *    text. JSON is the only one that parses, and `JSON.parse` does not run code.
 * 2. Only whitespace *between* tokens changes (JSON excepted, which is
 *    re-serialized). Strings, template literals, regexes, comments, `pre`,
 *    `textarea` and non-JavaScript `<script>` bodies are copied verbatim.
 * 3. Anything ambiguous bails out and returns the input untouched. Framework
 *    dialects (JSX, TSX, TypeScript, Vue) are reported as unsupported rather
 *    than guessed at, so we never corrupt component source.
 */

const INDENT_UNIT = "  ";
const INLINE_BRACE_MAX_LENGTH = 80;

export type FormatSourceStatus = "formatted" | "unchanged" | "unsupported";

export interface FormatSourceResult {
  status: FormatSourceStatus;
  /** Always populated. Equal to the input unless `status` is `"formatted"`. */
  content: string;
  reason?: string;
}

export const FORMATTABLE_LANGUAGES: readonly ProjectFileLanguage[] = [
  "html",
  "css",
  "javascript",
  "json",
];

export function canFormatLanguage(language: ProjectFileLanguage): boolean {
  return FORMATTABLE_LANGUAGES.includes(language);
}

export function describeUnsupportedLanguage(
  language: ProjectFileLanguage
): string {
  switch (language) {
    case "jsx":
    case "tsx":
    case "typescript":
    case "vue":
      return "Formatting is limited to HTML, CSS, JavaScript, and JSON so component source is never rewritten.";
    default:
      return "Formatting is available for HTML, CSS, JavaScript, and JSON files.";
  }
}

export function formatSource(
  content: string,
  language: ProjectFileLanguage
): FormatSourceResult {
  if (!canFormatLanguage(language)) {
    return {
      status: "unsupported",
      content,
      reason: describeUnsupportedLanguage(language),
    };
  }

  if (content.trim().length === 0) {
    return { status: "unchanged", content, reason: "This file is empty." };
  }

  const formatted = runFormatter(content, language);
  if (!formatted.ok) {
    return { status: "unchanged", content, reason: formatted.reason };
  }

  if (formatted.value === content) {
    return {
      status: "unchanged",
      content,
      reason: "This file is already formatted.",
    };
  }

  return { status: "formatted", content: formatted.value };
}

type Attempt =
  | { ok: true; value: string }
  | { ok: false; reason: string };

type LineAttempt =
  | { ok: true; lines: string[] }
  | { ok: false; reason: string };

function runFormatter(
  content: string,
  language: ProjectFileLanguage
): Attempt {
  switch (language) {
    case "json":
      return formatJson(content);
    case "css":
      return fromLines(formatCssLines(content), content, stripWhitespace);
    case "javascript":
      return fromLines(formatJavaScriptLines(content), content, stripWhitespace);
    case "html":
      return fromLines(formatHtmlLines(content), content, stripWhitespace);
    default:
      return { ok: false, reason: "Unsupported language." };
  }
}

/**
 * Whitespace-only formatters must not alter a single non-whitespace character.
 * Comparing the whitespace-stripped input and output is a cheap, total check
 * that catches any scanner bug before it can reach the user's file.
 */
function fromLines(
  attempt: LineAttempt,
  original: string,
  fingerprint: (value: string) => string
): Attempt {
  if (!attempt.ok) return attempt;

  const trailingNewline = /\n$/.test(original) ? "\n" : "";
  const value = attempt.lines.join("\n").replace(/\s+$/, "") + trailingNewline;

  if (fingerprint(value) !== fingerprint(original)) {
    return {
      ok: false,
      reason: "Formatting was skipped because it would have changed the file.",
    };
  }

  return { ok: true, value };
}

function stripWhitespace(value: string) {
  return value.replace(/\s+/g, "");
}

/* ------------------------------------------------------------------ JSON -- */

function formatJson(content: string): Attempt {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return {
      ok: false,
      reason: "This file is not valid JSON, so it was left unchanged.",
    };
  }

  const trailingNewline = /\n$/.test(content) ? "\n" : "";
  return {
    ok: true,
    value: `${JSON.stringify(parsed, null, 2)}${trailingNewline}`,
  };
}

/* ------------------------------------------------------------------- CSS -- */

function isWhitespace(char: string) {
  return char === " " || char === "\t" || char === "\n" || char === "\r" || char === "\f";
}

/**
 * Decides whether a `:` opens a declaration value (`color: red`) or belongs to
 * a selector (`a:hover`, `&:focus` inside a nested rule). Looking ahead for the
 * first structural character answers it for both flat and nested CSS.
 */
function isDeclarationColon(source: string, index: number): boolean {
  let depth = 0;
  for (let i = index + 1; i < source.length; i += 1) {
    const char = source[i];
    if (char === "\\") {
      i += 1;
      continue;
    }
    if (char === '"' || char === "'") {
      const end = scanQuoted(source, i);
      if (end < 0) return false;
      i = end - 1;
      continue;
    }
    if (char === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2);
      if (end < 0) return false;
      i = end + 1;
      continue;
    }
    if (char === "(") depth += 1;
    else if (char === ")") depth = Math.max(0, depth - 1);
    else if (depth === 0) {
      if (char === "{") return false;
      if (char === ";" || char === "}") return true;
    }
  }
  return true;
}

function scanQuoted(source: string, start: number): number {
  const quote = source[start];
  for (let i = start + 1; i < source.length; i += 1) {
    const char = source[i];
    if (char === "\\") {
      i += 1;
      continue;
    }
    if (char === quote) return i + 1;
  }
  return -1;
}

function formatCssLines(source: string, baseIndent = 0): LineAttempt {
  const lines: string[] = [];
  let indent = baseIndent;
  let current = INDENT_UNIT.repeat(indent);
  let hasContent = false;
  let parenDepth = 0;

  const append = (text: string) => {
    current += text;
    hasContent = true;
  };

  const breakLine = () => {
    if (hasContent) lines.push(current.replace(/\s+$/, ""));
    current = INDENT_UNIT.repeat(Math.max(0, indent));
    hasContent = false;
  };

  const skipWhitespace = (from: number) => {
    let i = from;
    while (i < source.length && isWhitespace(source[i])) i += 1;
    return i;
  };

  let i = 0;
  while (i < source.length) {
    const char = source[i];

    if (isWhitespace(char)) {
      const next = skipWhitespace(i);
      if (hasContent && next < source.length) append(" ");
      i = next;
      continue;
    }

    if (char === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2);
      if (end < 0) {
        return { ok: false, reason: "Unterminated CSS comment." };
      }
      append(source.slice(i, end + 2));
      i = end + 2;
      continue;
    }

    if (char === '"' || char === "'") {
      const end = scanQuoted(source, i);
      if (end < 0) {
        return { ok: false, reason: "Unterminated CSS string." };
      }
      append(source.slice(i, end));
      i = end;
      continue;
    }

    if (char === "(") {
      parenDepth += 1;
      append(char);
      i += 1;
      continue;
    }

    if (char === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
      append(char);
      i += 1;
      continue;
    }

    if (parenDepth === 0 && char === "{") {
      if (hasContent && !current.endsWith(" ")) append(" ");
      append("{");
      indent += 1;
      i = skipWhitespace(i + 1);
      breakLine();
      continue;
    }

    if (parenDepth === 0 && char === "}") {
      breakLine();
      indent = Math.max(baseIndent, indent - 1);
      current = INDENT_UNIT.repeat(indent);
      append("}");
      i = skipWhitespace(i + 1);
      breakLine();
      continue;
    }

    if (parenDepth === 0 && char === ";") {
      append(";");
      i = skipWhitespace(i + 1);
      breakLine();
      continue;
    }

    if (parenDepth === 0 && char === "," ) {
      append(",");
      i = skipWhitespace(i + 1);
      if (i < source.length) append(" ");
      continue;
    }

    if (parenDepth === 0 && char === ":" && indent > baseIndent) {
      append(":");
      const next = skipWhitespace(i + 1);
      if (isDeclarationColon(source, i) && next < source.length) append(" ");
      else if (next > i + 1) append(" ");
      i = next;
      continue;
    }

    append(char);
    i += 1;
  }

  if (hasContent) lines.push(current.replace(/\s+$/, ""));
  return { ok: true, lines };
}

/* -------------------------------------------------------------- JavaScript */

type JsTokenType =
  | "word"
  | "number"
  | "string"
  | "template"
  | "regex"
  | "comment"
  | "punct";

interface JsToken {
  type: JsTokenType;
  value: string;
  start: number;
  end: number;
}

const JS_PUNCTUATORS = [
  ">>>=",
  "...",
  "===",
  "!==",
  "**=",
  "<<=",
  ">>=",
  ">>>",
  "&&=",
  "||=",
  "??=",
  "=>",
  "==",
  "!=",
  "<=",
  ">=",
  "&&",
  "||",
  "??",
  "?.",
  "++",
  "--",
  "+=",
  "-=",
  "*=",
  "/=",
  "%=",
  "&=",
  "|=",
  "^=",
  "**",
  "<<",
  ">>",
];

/** Keywords after which a `/` unambiguously begins a regular expression. */
const REGEX_PRECEDING_KEYWORDS = new Set([
  "return",
  "typeof",
  "instanceof",
  "in",
  "of",
  "new",
  "delete",
  "void",
  "throw",
  "case",
  "do",
  "else",
  "yield",
  "await",
]);

const CONTROL_HEAD_KEYWORDS = new Set(["if", "while", "for", "with"]);

const NUMBER_PATTERN =
  /^(?:0[xX][0-9a-fA-F_]+|0[oO][0-7_]+|0[bB][01_]+|(?:[0-9][0-9_]*)?(?:\.[0-9_]*)?(?:[eE][+-]?[0-9_]+)?)n?/;

function isIdentifierStart(char: string) {
  return /[A-Za-z_$\u00a1-\uffff]/.test(char);
}

function isIdentifierPart(char: string) {
  return /[A-Za-z0-9_$\u00a1-\uffff]/.test(char);
}

function scanTemplate(source: string, start: number): number {
  let i = start + 1;
  while (i < source.length) {
    const char = source[i];
    if (char === "\\") {
      i += 2;
      continue;
    }
    if (char === "`") return i + 1;
    if (char === "$" && source[i + 1] === "{") {
      const end = scanTemplateExpression(source, i + 2);
      if (end < 0) return -1;
      i = end;
      continue;
    }
    i += 1;
  }
  return -1;
}

function scanTemplateExpression(source: string, start: number): number {
  let depth = 1;
  let i = start;
  while (i < source.length) {
    const char = source[i];
    if (char === '"' || char === "'") {
      const end = scanQuoted(source, i);
      if (end < 0) return -1;
      i = end;
      continue;
    }
    if (char === "`") {
      const end = scanTemplate(source, i);
      if (end < 0) return -1;
      i = end;
      continue;
    }
    if (char === "/" && source[i + 1] === "/") {
      const newline = source.indexOf("\n", i);
      i = newline < 0 ? source.length : newline;
      continue;
    }
    if (char === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2);
      if (end < 0) return -1;
      i = end + 2;
      continue;
    }
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
    i += 1;
  }
  return -1;
}

function scanRegex(source: string, start: number): number {
  let inClass = false;
  let i = start + 1;
  while (i < source.length) {
    const char = source[i];
    if (char === "\n") return -1;
    if (char === "\\") {
      i += 2;
      continue;
    }
    if (char === "[") inClass = true;
    else if (char === "]") inClass = false;
    else if (char === "/" && !inClass) {
      i += 1;
      while (i < source.length && isIdentifierPart(source[i])) i += 1;
      return i;
    }
    i += 1;
  }
  return -1;
}

function tokenizeJavaScript(
  source: string
): { ok: true; tokens: JsToken[] } | { ok: false; reason: string } {
  const tokens: JsToken[] = [];
  const bracketStack: Array<{ char: string; controlHead: boolean }> = [];
  let lastClosedParenWasControlHead = false;
  let i = 0;

  const lastSignificant = () => {
    for (let index = tokens.length - 1; index >= 0; index -= 1) {
      if (tokens[index].type !== "comment") return tokens[index];
    }
    return undefined;
  };

  while (i < source.length) {
    const char = source[i];

    if (isWhitespace(char)) {
      i += 1;
      continue;
    }

    if (char === "/" && source[i + 1] === "/") {
      const newline = source.indexOf("\n", i);
      const end = newline < 0 ? source.length : newline;
      tokens.push({ type: "comment", value: source.slice(i, end), start: i, end });
      i = end;
      continue;
    }

    if (char === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2);
      if (end < 0) return { ok: false, reason: "Unterminated block comment." };
      tokens.push({
        type: "comment",
        value: source.slice(i, end + 2),
        start: i,
        end: end + 2,
      });
      i = end + 2;
      continue;
    }

    if (char === '"' || char === "'") {
      const end = scanQuoted(source, i);
      if (end < 0) return { ok: false, reason: "Unterminated string literal." };
      const value = source.slice(i, end);
      if (/(^|[^\\])(\\\\)*\n/.test(value)) {
        return { ok: false, reason: "Unterminated string literal." };
      }
      tokens.push({ type: "string", value, start: i, end });
      i = end;
      continue;
    }

    if (char === "`") {
      const end = scanTemplate(source, i);
      if (end < 0) return { ok: false, reason: "Unterminated template literal." };
      tokens.push({ type: "template", value: source.slice(i, end), start: i, end });
      i = end;
      continue;
    }

    if (char === "/") {
      const previous = lastSignificant();
      let isRegex: boolean;
      if (!previous) {
        isRegex = true;
      } else if (
        previous.type === "number" ||
        previous.type === "string" ||
        previous.type === "template" ||
        previous.type === "regex"
      ) {
        isRegex = false;
      } else if (previous.type === "word") {
        isRegex = REGEX_PRECEDING_KEYWORDS.has(previous.value);
      } else if (previous.value === "]") {
        isRegex = false;
      } else if (previous.value === "++" || previous.value === "--") {
        isRegex = false;
      } else if (previous.value === "}") {
        // `}` ends either a block (regex follows) or an object literal
        // (division follows). Guessing risks mangling the file.
        return {
          ok: false,
          reason: "Formatting was skipped because of ambiguous syntax.",
        };
      } else if (previous.value === ")") {
        if (lastClosedParenWasControlHead) {
          return {
            ok: false,
            reason: "Formatting was skipped because of ambiguous syntax.",
          };
        }
        isRegex = false;
      } else {
        isRegex = true;
      }

      if (isRegex) {
        const end = scanRegex(source, i);
        if (end < 0) {
          return { ok: false, reason: "Unterminated regular expression." };
        }
        tokens.push({ type: "regex", value: source.slice(i, end), start: i, end });
        i = end;
        continue;
      }

      const value = source[i + 1] === "=" ? "/=" : "/";
      tokens.push({ type: "punct", value, start: i, end: i + value.length });
      i += value.length;
      continue;
    }

    if (/[0-9]/.test(char) || (char === "." && /[0-9]/.test(source[i + 1] ?? ""))) {
      const match = NUMBER_PATTERN.exec(source.slice(i, i + 64));
      const value = match?.[0];
      if (value) {
        tokens.push({ type: "number", value, start: i, end: i + value.length });
        i += value.length;
        continue;
      }
    }

    if (isIdentifierStart(char)) {
      let end = i + 1;
      while (end < source.length && isIdentifierPart(source[end])) end += 1;
      tokens.push({
        type: "word",
        value: source.slice(i, end),
        start: i,
        end,
      });
      i = end;
      continue;
    }

    const punctuator =
      JS_PUNCTUATORS.find((candidate) => source.startsWith(candidate, i)) ?? char;

    if (punctuator === "(" || punctuator === "[" || punctuator === "{") {
      const previous = lastSignificant();
      bracketStack.push({
        char: punctuator,
        controlHead:
          punctuator === "(" &&
          previous?.type === "word" &&
          CONTROL_HEAD_KEYWORDS.has(previous.value),
      });
    } else if (punctuator === ")" || punctuator === "]" || punctuator === "}") {
      const open = bracketStack.pop();
      if (!open) {
        return { ok: false, reason: "Unbalanced brackets." };
      }
      const expected = open.char === "(" ? ")" : open.char === "[" ? "]" : "}";
      if (expected !== punctuator) {
        return { ok: false, reason: "Unbalanced brackets." };
      }
      if (punctuator === ")") lastClosedParenWasControlHead = open.controlHead;
    }

    tokens.push({
      type: "punct",
      value: punctuator,
      start: i,
      end: i + punctuator.length,
    });
    i += punctuator.length;
  }

  if (bracketStack.length > 0) {
    return { ok: false, reason: "Unbalanced brackets." };
  }

  return { ok: true, tokens };
}

function formatJavaScriptLines(source: string, baseIndent = 0): LineAttempt {
  const tokenized = tokenizeJavaScript(source);
  if (!tokenized.ok) return tokenized;

  const { tokens } = tokenized;
  const braceMatch = new Map<number, number>();
  const openStack: number[] = [];
  tokens.forEach((token, index) => {
    if (token.type !== "punct") return;
    if (token.value === "{") openStack.push(index);
    else if (token.value === "}") {
      const open = openStack.pop();
      if (open !== undefined) braceMatch.set(open, index);
    }
  });

  const inlineGroups = new Set<number>();
  braceMatch.forEach((close, open) => {
    const rawLength = tokens[close].end - tokens[open].start;
    if (rawLength > INLINE_BRACE_MAX_LENGTH) return;

    let depth = 0;
    for (let index = open + 1; index < close; index += 1) {
      const token = tokens[index];
      if (token.type === "comment") return;
      if (token.type !== "punct") continue;
      if (token.value === "(" || token.value === "[" || token.value === "{") {
        depth += 1;
      } else if (
        token.value === ")" ||
        token.value === "]" ||
        token.value === "}"
      ) {
        depth -= 1;
      } else if (token.value === ";" && depth === 0) {
        return;
      }
    }
    inlineGroups.add(open);
  });

  const lines: string[] = [];
  let indent = baseIndent;
  let current = INDENT_UNIT.repeat(indent);
  let hasContent = false;
  const braceStack: boolean[] = [];
  const bracketStack: string[] = [];

  const isInline = () =>
    braceStack.length > 0 && braceStack[braceStack.length - 1];

  const append = (text: string) => {
    current += text;
    hasContent = true;
  };

  const breakLine = (blank = false) => {
    lines.push(current.replace(/\s+$/, ""));
    if (blank) lines.push("");
    current = INDENT_UNIT.repeat(Math.max(0, indent));
    hasContent = false;
  };

  let forcedBreak = false;
  let previousEnd = 0;

  tokens.forEach((token, index) => {
    const gap = source.slice(previousEnd, token.start);
    const newlineCount = (gap.match(/\n/g) ?? []).length;

    if (index > 0) {
      if (forcedBreak) breakLine(newlineCount > 1);
      else if (newlineCount > 0) breakLine(newlineCount > 1);
      else if (gap.length > 0 && hasContent) append(" ");
    }
    forcedBreak = false;

    if (token.type === "punct") {
      if (token.value === "{") {
        const inline = isInline() || inlineGroups.has(index);
        if (!inline && hasContent && !/\s$/.test(current)) append(" ");
        append("{");
        braceStack.push(inline);
        bracketStack.push("{");
        if (!inline) {
          indent += 1;
          forcedBreak = true;
        }
        previousEnd = token.end;
        return;
      }

      if (token.value === "}") {
        const inline = braceStack.pop() ?? true;
        if (bracketStack[bracketStack.length - 1] === "{") bracketStack.pop();
        if (!inline) {
          indent = Math.max(baseIndent, indent - 1);
          if (hasContent) breakLine();
          else current = INDENT_UNIT.repeat(Math.max(0, indent));
        }
        append("}");
        const next = tokens[index + 1];
        if (
          !inline &&
          next &&
          (next.type === "word" ||
            next.type === "number" ||
            next.type === "string" ||
            next.type === "template")
        ) {
          forcedBreak = true;
        }
        previousEnd = token.end;
        return;
      }

      if (token.value === "(" || token.value === "[") {
        bracketStack.push(token.value);
      } else if (token.value === ")" || token.value === "]") {
        const expected = token.value === ")" ? "(" : "[";
        if (bracketStack[bracketStack.length - 1] === expected) bracketStack.pop();
      } else if (token.value === ";") {
        const enclosing = bracketStack[bracketStack.length - 1];
        append(";");
        if (!isInline() && enclosing !== "(" && enclosing !== "[") {
          forcedBreak = true;
        }
        previousEnd = token.end;
        return;
      }
    }

    append(token.value);
    if (token.type === "comment" && token.value.startsWith("//")) {
      forcedBreak = true;
    }
    previousEnd = token.end;
  });

  if (hasContent) lines.push(current.replace(/\s+$/, ""));

  const rendered = lines.join("\n");
  const reTokenized = tokenizeJavaScript(rendered);
  if (!reTokenized.ok) {
    return {
      ok: false,
      reason: "Formatting was skipped because of ambiguous syntax.",
    };
  }
  if (
    reTokenized.tokens.length !== tokens.length ||
    reTokenized.tokens.some(
      (token, position) =>
        token.type !== tokens[position].type ||
        token.value !== tokens[position].value
    )
  ) {
    return {
      ok: false,
      reason: "Formatting was skipped because it would have changed the file.",
    };
  }

  return { ok: true, lines };
}

/* ------------------------------------------------------------------ HTML -- */

const HTML_VOID_ELEMENTS = new Set([
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

/**
 * Whitespace between inline elements is rendered, so these never get a line of
 * their own; everything else is block-level and safe to break around.
 */
const HTML_INLINE_ELEMENTS = new Set([
  "a",
  "abbr",
  "acronym",
  "audio",
  "b",
  "bdi",
  "bdo",
  "big",
  "br",
  "button",
  "canvas",
  "cite",
  "code",
  "data",
  "del",
  "dfn",
  "em",
  "embed",
  "font",
  "i",
  "iframe",
  "img",
  "input",
  "ins",
  "kbd",
  "label",
  "map",
  "mark",
  "meter",
  "nobr",
  "object",
  "output",
  "picture",
  "progress",
  "q",
  "rp",
  "rt",
  "ruby",
  "s",
  "samp",
  "select",
  "small",
  "span",
  "strong",
  "sub",
  "sup",
  "time",
  "tt",
  "u",
  "var",
  "video",
  "wbr",
]);

const HTML_RAW_TEXT_ELEMENTS = new Set(["script", "style"]);
const HTML_VERBATIM_ELEMENTS = new Set(["pre", "textarea"]);

const HTML_AUTO_CLOSE: Record<string, Set<string>> = {
  li: new Set(["li"]),
  dt: new Set(["dt", "dd"]),
  dd: new Set(["dt", "dd"]),
  tr: new Set(["tr", "td", "th"]),
  td: new Set(["td", "th"]),
  th: new Set(["td", "th"]),
  option: new Set(["option"]),
  thead: new Set(["thead", "tbody", "tfoot", "tr", "td", "th"]),
  tbody: new Set(["thead", "tbody", "tfoot", "tr", "td", "th"]),
  tfoot: new Set(["thead", "tbody", "tfoot", "tr", "td", "th"]),
};

type HtmlToken =
  | { kind: "text"; raw: string }
  | { kind: "comment"; raw: string }
  | { kind: "declaration"; raw: string }
  | { kind: "start"; raw: string; name: string; selfClosing: boolean }
  | { kind: "end"; raw: string; name: string }
  | { kind: "raw"; name: string; open: string; inner: string; close: string }
  | { kind: "verbatim"; raw: string };

function scanHtmlTag(source: string, start: number): number {
  for (let i = start + 1; i < source.length; i += 1) {
    const char = source[i];
    if (char === '"' || char === "'") {
      const end = scanQuoted(source, i);
      if (end < 0) return -1;
      i = end - 1;
      continue;
    }
    if (char === ">") return i + 1;
  }
  return -1;
}

function findClosingTag(source: string, name: string, from: number): number {
  const pattern = new RegExp(`</\\s*${name}(?:\\s[^>]*)?>`, "i");
  pattern.lastIndex = 0;
  const match = pattern.exec(source.slice(from));
  return match ? from + match.index : -1;
}

function tokenizeHtml(
  source: string
): { ok: true; tokens: HtmlToken[] } | { ok: false; reason: string } {
  const tokens: HtmlToken[] = [];
  let i = 0;

  while (i < source.length) {
    if (source[i] !== "<") {
      const next = source.indexOf("<", i + 1);
      const end = next < 0 ? source.length : next;
      tokens.push({ kind: "text", raw: source.slice(i, end) });
      i = end;
      continue;
    }

    if (source.startsWith("<!--", i)) {
      const end = source.indexOf("-->", i + 4);
      if (end < 0) return { ok: false, reason: "Unterminated HTML comment." };
      tokens.push({ kind: "comment", raw: source.slice(i, end + 3) });
      i = end + 3;
      continue;
    }

    if (source.startsWith("<![CDATA[", i)) {
      const end = source.indexOf("]]>", i + 9);
      if (end < 0) return { ok: false, reason: "Unterminated CDATA section." };
      tokens.push({ kind: "declaration", raw: source.slice(i, end + 3) });
      i = end + 3;
      continue;
    }

    if (source[i + 1] === "!" || source[i + 1] === "?") {
      const end = source.indexOf(">", i + 2);
      if (end < 0) return { ok: false, reason: "Unterminated HTML declaration." };
      tokens.push({ kind: "declaration", raw: source.slice(i, end + 1) });
      i = end + 1;
      continue;
    }

    if (source[i + 1] === "/") {
      const end = scanHtmlTag(source, i);
      if (end < 0) return { ok: false, reason: "Unterminated HTML tag." };
      const raw = source.slice(i, end);
      const name = /^<\/\s*([A-Za-z][^\s/>]*)/.exec(raw)?.[1]?.toLowerCase() ?? "";
      tokens.push({ kind: "end", raw, name });
      i = end;
      continue;
    }

    if (!/[A-Za-z]/.test(source[i + 1] ?? "")) {
      const next = source.indexOf("<", i + 1);
      const end = next < 0 ? source.length : next;
      tokens.push({ kind: "text", raw: source.slice(i, end) });
      i = end;
      continue;
    }

    const end = scanHtmlTag(source, i);
    if (end < 0) return { ok: false, reason: "Unterminated HTML tag." };
    const raw = source.slice(i, end);
    const name = /^<\s*([A-Za-z][^\s/>]*)/.exec(raw)?.[1]?.toLowerCase() ?? "";
    const selfClosing = /\/>$/.test(raw.trim()) || HTML_VOID_ELEMENTS.has(name);

    if (!selfClosing && HTML_RAW_TEXT_ELEMENTS.has(name)) {
      const closeStart = findClosingTag(source, name, end);
      if (closeStart < 0) {
        return { ok: false, reason: `Unterminated <${name}> element.` };
      }
      const closeEnd = source.indexOf(">", closeStart) + 1;
      tokens.push({
        kind: "raw",
        name,
        open: raw,
        inner: source.slice(end, closeStart),
        close: source.slice(closeStart, closeEnd),
      });
      i = closeEnd;
      continue;
    }

    if (!selfClosing && HTML_VERBATIM_ELEMENTS.has(name)) {
      const closeStart = findClosingTag(source, name, end);
      if (closeStart < 0) {
        return { ok: false, reason: `Unterminated <${name}> element.` };
      }
      const closeEnd = source.indexOf(">", closeStart) + 1;
      tokens.push({ kind: "verbatim", raw: source.slice(i, closeEnd) });
      i = closeEnd;
      continue;
    }

    tokens.push({ kind: "start", raw, name, selfClosing });
    i = end;
  }

  return { ok: true, tokens };
}

function isInlineToken(token: HtmlToken): boolean {
  if (token.kind === "text") return true;
  if (token.kind === "start" || token.kind === "end") {
    return HTML_INLINE_ELEMENTS.has(token.name);
  }
  if (token.kind === "verbatim") {
    return /^<\s*textarea/i.test(token.raw);
  }
  return false;
}

function getScriptLanguage(openTag: string): "javascript" | null {
  const type = /\stype\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(openTag);
  const value = (type?.[2] ?? type?.[3] ?? type?.[4] ?? "").trim().toLowerCase();
  if (!value) return "javascript";
  if (
    value === "module" ||
    value === "text/javascript" ||
    value === "application/javascript" ||
    value === "text/ecmascript"
  ) {
    return "javascript";
  }
  return null;
}

/**
 * A block element whose whole rendering fits inside this budget stays on one
 * line (`<h1>Title</h1>`); anything longer is split across the open tag, its
 * content, and the close tag.
 */
const HTML_LINE_SOFT_LIMIT = 100;

function formatHtmlLines(source: string): LineAttempt {
  const tokenized = tokenizeHtml(source);
  if (!tokenized.ok) return tokenized;

  const { tokens } = tokenized;
  const lines: string[] = [];
  const openElements: Array<{ name: string; tokenIndex: number }> = [];
  let indent = 0;
  let current = "";
  let currentIndent = 0;
  let currentInlineStart = 0;
  let currentHasInline = false;
  let currentOwner: number | null = null;

  const pad = (level: number) => INDENT_UNIT.repeat(Math.max(0, level));

  const reset = () => {
    current = "";
    currentInlineStart = 0;
    currentHasInline = false;
    currentOwner = null;
  };

  const append = (text: string) => {
    if (current.length === 0) currentIndent = indent;
    current += text;
  };

  const appendInline = (text: string) => {
    append(text);
    currentHasInline = true;
  };

  const flush = () => {
    const value = current;
    if (value.trim().length > 0) {
      if (
        currentInlineStart > 0 &&
        value.length > currentInlineStart &&
        value.length > HTML_LINE_SOFT_LIMIT
      ) {
        lines.push(pad(currentIndent) + value.slice(0, currentInlineStart));
        const rest = value.slice(currentInlineStart).trim();
        if (rest.length > 0) lines.push(pad(currentIndent + 1) + rest);
      } else {
        lines.push(pad(currentIndent) + value.trim());
      }
    }
    reset();
  };

  const pushOwnLine = (text: string) => {
    flush();
    lines.push(pad(indent) + text);
  };

  const autoClose = (name: string) => {
    const top = openElements[openElements.length - 1];
    if (!top) return;
    const closable = HTML_AUTO_CLOSE[name];
    if (
      closable?.has(top.name) ||
      (top.name === "p" && !HTML_INLINE_ELEMENTS.has(name))
    ) {
      openElements.pop();
      indent = Math.max(0, indent - 1);
    }
  };

  tokens.forEach((token, index) => {
    if (token.kind === "text") {
      const core = token.raw.trim();
      if (core.length === 0) {
        const next = tokens[index + 1];
        if (currentHasInline && next && isInlineToken(next)) appendInline(" ");
        return;
      }
      if (current.length > 0 && /^\s/.test(token.raw)) appendInline(" ");
      appendInline(core.replace(/\s+/g, " "));
      if (/\s$/.test(token.raw)) {
        const next = tokens[index + 1];
        if (next && isInlineToken(next)) appendInline(" ");
      }
      return;
    }

    if (token.kind === "comment") {
      if (currentHasInline) appendInline(token.raw);
      else pushOwnLine(token.raw);
      return;
    }

    if (token.kind === "declaration") {
      pushOwnLine(token.raw);
      return;
    }

    if (token.kind === "verbatim") {
      if (isInlineToken(token)) appendInline(token.raw);
      else pushOwnLine(token.raw);
      return;
    }

    if (token.kind === "raw") {
      flush();
      if (token.inner.trim().length === 0) {
        lines.push(pad(indent) + token.open + token.close);
        return;
      }

      const language =
        token.name === "style" ? "css" : getScriptLanguage(token.open);
      lines.push(pad(indent) + token.open);
      const formatted =
        language === "css"
          ? formatCssLines(token.inner, indent + 1)
          : language === "javascript"
            ? formatJavaScriptLines(token.inner, indent + 1)
            : null;

      if (formatted?.ok) lines.push(...formatted.lines);
      else lines.push(token.inner.replace(/^\s*\n/, "").replace(/\s+$/, ""));

      lines.push(pad(indent) + token.close);
      return;
    }

    if (token.kind === "start") {
      if (isInlineToken(token)) {
        appendInline(token.raw);
        return;
      }
      flush();
      autoClose(token.name);
      if (token.selfClosing) {
        lines.push(pad(indent) + token.raw);
        return;
      }
      append(token.raw);
      currentInlineStart = current.length;
      currentOwner = index;
      openElements.push({ name: token.name, tokenIndex: index });
      indent += 1;
      return;
    }

    if (isInlineToken(token)) {
      appendInline(token.raw);
      return;
    }

    let position = -1;
    for (let index = openElements.length - 1; index >= 0; index -= 1) {
      if (openElements[index].name === token.name) {
        position = index;
        break;
      }
    }
    if (position < 0) {
      pushOwnLine(token.raw);
      return;
    }

    const element = openElements[position];
    const canMerge =
      currentOwner === element.tokenIndex &&
      position === openElements.length - 1 &&
      current.length + token.raw.length <= HTML_LINE_SOFT_LIMIT;

    while (openElements.length > position) {
      openElements.pop();
      indent = Math.max(0, indent - 1);
    }

    if (canMerge) {
      lines.push(pad(currentIndent) + (current + token.raw).trim());
      reset();
      return;
    }

    flush();
    lines.push(pad(indent) + token.raw);
  });

  flush();
  return { ok: true, lines };
}

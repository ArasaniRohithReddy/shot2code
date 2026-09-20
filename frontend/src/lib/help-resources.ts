/**
 * The Help centre's link catalogue.
 *
 * Every destination lives in the public release hub rather than in this
 * repository, so a user reading Help sees the same text that ships with the
 * downloadable build. Keeping the list here - free of React - means the URLs
 * can be asserted in tests and checked in one place when a document moves.
 *
 * Documentation points at the **rendered** GitHub Pages site, not at the
 * Markdown source on github.com. The source of truth is still the repository,
 * but a reader opening Help wants the published page: it is styled, navigable,
 * searchable and readable on a phone, and it does not ask them to understand
 * that they are looking at a file in a repo. This matches how Threat Model
 * Reviewer publishes the same documents.
 */

/** GitHub Pages product page for shot2code. */
export const HELP_PRODUCT_PAGE_URL =
  "https://arasanirohithreddy.github.io/app-releases/shot2code/";

/** Every published build, with notes and checksums. */
export const HELP_RELEASES_PAGE_URL = `${HELP_PRODUCT_PAGE_URL}releases/`;

/** The rendered documentation site for the product's own documents. */
export const HELP_DOCS_BASE_URL = `${HELP_PRODUCT_PAGE_URL}docs/`;

/**
 * Source Markdown file -> published route under {@link HELP_DOCS_BASE_URL}.
 *
 * Explicit rather than derived from the filename: the site owns these routes,
 * so guessing a slug would silently 404 the day a document is renamed or
 * published under a different path. Every entry here must exist in the docs
 * manifest in app-releases.
 */
export const HELP_DOC_ROUTES = {
  "README.md": "",
  "INSTALL.md": "install/",
  "USER-GUIDE.md": "user-guide/",
  "FAQ.md": "faq/",
  "TROUBLESHOOTING.md": "troubleshooting/",
  "ARCHITECTURE.md": "architecture/",
  "DATA-HANDLING.md": "data-handling/",
  "SECURITY.md": "security/",
  "CHANGELOG.md": "changelog/",
  "RELEASING.md": "releasing/",
  "CONTRIBUTING.md": "contributing/",
  "THIRD-PARTY-NOTICES.md": "third-party-notices/",
} as const;

export type HelpDocFile = keyof typeof HELP_DOC_ROUTES;

/** The published page for one documentation file. */
export function helpDocUrl(file: HelpDocFile): string {
  return `${HELP_DOCS_BASE_URL}${HELP_DOC_ROUTES[file]}`;
}

export const HELP_ISSUES_URL =
  "https://github.com/ArasaniRohithReddy/app-releases/issues";
export const HELP_NEW_ISSUE_URL = `${HELP_ISSUES_URL}/new/choose`;
export const HELP_SOURCE_REPOSITORY_URL =
  "https://github.com/ArasaniRohithReddy/shot2code";

/** Hosts a Help link may point at. Anything else is a mistake, not a feature. */
export const HELP_ALLOWED_HOSTS = [
  "github.com",
  "arasanirohithreddy.github.io",
] as const;

export type HelpSectionId = "get-started" | "guides" | "support";

export type HelpIconName =
  | "book"
  | "bug"
  | "download"
  | "github"
  | "history"
  | "package"
  | "question"
  | "rocket"
  | "scale"
  | "shield"
  | "support"
  | "wrench";

export interface HelpResourceLink {
  id: string;
  title: string;
  description: string;
  href: string;
  icon: HelpIconName;
}

export interface HelpSection {
  id: HelpSectionId;
  label: string;
  intro: string;
  links: HelpResourceLink[];
}

function doc(file: HelpDocFile) {
  return helpDocUrl(file);
}

/** The first-run path, in the order a new user actually walks it. */
export const HELP_GET_STARTED_STEPS = [
  {
    id: "connect",
    title: "Connect a model",
    detail:
      "Sign in to GitHub Copilot, paste an OpenAI, Anthropic or Gemini key, or configure a separate Copilot SDK BYOK endpoint in Settings.",
  },
  {
    id: "describe",
    title: "Start from what you have",
    detail:
      "Upload a screenshot, capture a URL, describe the screen in text, or import code you already wrote.",
  },
  {
    id: "iterate",
    title: "Review, then iterate in Chat",
    detail:
      "Compare real responsive widths, audit the generated source locally, then insert selected findings into Chat. Every edit becomes a new version.",
  },
  {
    id: "ship",
    title: "Read and export the source",
    detail:
      "The Code tab is the authoritative project. Format, copy, download a single file, or export the whole project.",
  },
] as const;

export const HELP_SECTIONS: HelpSection[] = [
  {
    id: "get-started",
    label: "Get started",
    intro:
      "New here, or setting shot2code up on another machine? Start with these.",
    links: [
      {
        id: "product-page",
        title: "shot2code product page",
        description:
          "What the app does, the current version, and the download for your platform.",
        href: HELP_PRODUCT_PAGE_URL,
        icon: "rocket",
      },
      {
        id: "install",
        title: "Install guide",
        description:
          "Installer formats, silent and managed deployment, verification and uninstall.",
        href: doc("INSTALL.md"),
        icon: "download",
      },
      {
        id: "user-guide",
        title: "User guide",
        description:
          "Every panel, tab and control, written for someone using the app rather than building it.",
        href: doc("USER-GUIDE.md"),
        icon: "book",
      },
      {
        id: "releases",
        title: "All releases",
        description:
          "The complete release history with notes, assets and checksums.",
        href: HELP_RELEASES_PAGE_URL,
        icon: "package",
      },
    ],
  },
  {
    id: "guides",
    label: "Guides",
    intro:
      "How shot2code is built, what it does with your data, and how it changes.",
    links: [
      {
        id: "architecture",
        title: "Architecture",
        description:
          "How the desktop shell, the frontend and the backend fit together.",
        href: doc("ARCHITECTURE.md"),
        icon: "book",
      },
      {
        id: "data-handling",
        title: "Data handling and privacy",
        description:
          "What leaves your machine, what stays local, and who can see a prompt.",
        href: doc("DATA-HANDLING.md"),
        icon: "shield",
      },
      {
        id: "security",
        title: "Security policy",
        description:
          "The supported versions and how to report a vulnerability privately.",
        href: doc("SECURITY.md"),
        icon: "shield",
      },
      {
        id: "changelog",
        title: "Changelog",
        description: "What changed in each release, newest first.",
        href: doc("CHANGELOG.md"),
        icon: "history",
      },
      {
        id: "releasing",
        title: "Release process",
        description:
          "How a build is versioned, signed, published and updated in place.",
        href: doc("RELEASING.md"),
        icon: "package",
      },
      {
        id: "contributing",
        title: "Contributing",
        description:
          "Setting up a development environment, the test commands, and pull request conventions.",
        href: doc("CONTRIBUTING.md"),
        icon: "github",
      },
      {
        id: "third-party",
        title: "Third-party notices",
        description: "The open-source licences shipped inside the app.",
        href: doc("THIRD-PARTY-NOTICES.md"),
        icon: "scale",
      },
    ],
  },
  {
    id: "support",
    label: "Support",
    intro:
      "Check the common answers first; if the problem is still there, the issue tracker is the fastest route.",
    links: [
      {
        id: "faq",
        title: "FAQ",
        description:
          "The questions asked most often about models, costs, offline use and exports.",
        href: doc("FAQ.md"),
        icon: "question",
      },
      {
        id: "troubleshooting",
        title: "Troubleshooting",
        description:
          "Blank previews, failed generations, provider errors and update problems.",
        href: doc("TROUBLESHOOTING.md"),
        icon: "wrench",
      },
      {
        id: "report-issue",
        title: "Report a bug or request a feature",
        description:
          "Opens a new issue in the release hub. Never post secrets or keys in an issue.",
        href: HELP_NEW_ISSUE_URL,
        icon: "bug",
      },
      {
        id: "browse-issues",
        title: "Browse open issues",
        description:
          "Someone may already have hit this, and workarounds are posted there.",
        href: HELP_ISSUES_URL,
        icon: "support",
      },
      {
        id: "source",
        title: "Source repository",
        description: "Read the code, watch releases, or open a pull request.",
        href: HELP_SOURCE_REPOSITORY_URL,
        icon: "github",
      },
    ],
  },
];

/**
 * Keys that only work while a control has focus, so they are not application
 * shortcuts but still belong in the one place a user looks for keys.
 */
export const HELP_CONTEXTUAL_SHORTCUTS = [
  {
    id: "resize-step",
    label: "Move a workspace divider",
    detail: "With the divider focused",
    keys: ["←", "→"],
  },
  {
    id: "resize-large-step",
    label: "Move it in larger steps",
    detail: "With the divider focused",
    keys: ["Shift", "←", "→"],
  },
  {
    id: "resize-extremes",
    label: "Jump to the narrowest or widest width",
    detail: "With the divider focused",
    keys: ["Home", "End"],
  },
  {
    id: "resize-reset",
    label: "Restore the default width",
    detail: "Or double-click the divider",
    keys: ["Enter"],
  },
  {
    id: "editor-indent",
    label: "Indent in the code editor",
    detail: "Tab moves focus out of the editor instead",
    keys: ["Ctrl", "]"],
  },
  {
    id: "variant-pick",
    label: "Select a generated option",
    detail: "While the workspace has focus",
    keys: ["Alt", "1–9"],
  },
] as const;

/** Every link in the catalogue, in display order. */
export function getHelpLinks(): HelpResourceLink[] {
  return HELP_SECTIONS.flatMap((section) => section.links);
}

/**
 * A Help link must be an https URL on a host we publish. The Help centre opens
 * links in the system browser, so an unchecked href would hand the user's
 * browser to whatever the string happened to be.
 */
export function isTrustedHelpUrl(href: string): boolean {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  return HELP_ALLOWED_HOSTS.some((host) => url.hostname === host);
}

/** True for a link into the rendered documentation site. */
export function isHelpDocUrl(href: string): boolean {
  return href.startsWith(HELP_DOCS_BASE_URL);
}

/**
 * True for a link at raw Markdown source on github.com.
 *
 * Documentation must never be linked this way from Help - the reader gets an
 * unstyled file view of a repository instead of the published page - so this
 * exists to make that mistake assertable rather than merely discouraged.
 */
export function isGitHubSourceViewUrl(href: string): boolean {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return false;
  }
  if (url.hostname !== "github.com") return false;
  return /\/(blob|raw|tree)\//.test(url.pathname);
}

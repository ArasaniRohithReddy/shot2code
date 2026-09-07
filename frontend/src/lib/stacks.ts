// Keep in sync with backend (prompts/types.py)
// Order here determines order in dropdown
export enum Stack {
  HTML_TAILWIND = "html_tailwind",
  HTML_CSS = "html_css",
  REACT_TAILWIND = "react_tailwind",
  BOOTSTRAP = "bootstrap",
  VUE_TAILWIND = "vue_tailwind",
  IONIC_TAILWIND = "ionic_tailwind",
  ALPINE_TAILWIND = "alpine_tailwind",
  PREACT_TAILWIND = "preact_tailwind",
  TAILWIND_DAISYUI = "tailwind_daisyui",
  BULMA = "bulma",
  MATERIAL_WEB = "material_web",
  HTMX_TAILWIND = "htmx_tailwind",
}

export const STACK_DESCRIPTIONS: {
  [key in Stack]: { components: string[]; inBeta: boolean };
} = {
  html_css: { components: ["HTML", "CSS"], inBeta: false },
  html_tailwind: { components: ["HTML", "Tailwind"], inBeta: false },
  react_tailwind: { components: ["React", "Tailwind"], inBeta: false },
  bootstrap: { components: ["Bootstrap"], inBeta: false },
  vue_tailwind: { components: ["Vue", "Tailwind"], inBeta: true },
  ionic_tailwind: { components: ["Ionic", "Tailwind"], inBeta: true },
  alpine_tailwind: { components: ["Alpine.js", "Tailwind"], inBeta: true },
  preact_tailwind: { components: ["Preact", "Tailwind"], inBeta: true },
  tailwind_daisyui: { components: ["Tailwind", "daisyUI"], inBeta: true },
  bulma: { components: ["Bulma"], inBeta: true },
  material_web: { components: ["Material 3"], inBeta: true },
  htmx_tailwind: { components: ["htmx", "Tailwind"], inBeta: true },
};

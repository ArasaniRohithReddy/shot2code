import { Stack } from "../lib/stacks";
import type {
  ProjectFileLanguage,
  ProjectPreviewArtifactKind,
} from "../lib/project-files";

export type ExpectedCodePenKind = "ready" | "unsupported";

export interface StackAcceptanceFixture {
  name: string;
  stack: Stack;
  generatedHtml: string;
  project: {
    entryPath: string;
    files: Record<string, string>;
    expectedLanguages: Record<string, ProjectFileLanguage>;
    expectedPreviewKind: ProjectPreviewArtifactKind;
    expectedOmittedRuntimePath?: string;
    expectedCodePenKind: ExpectedCodePenKind;
  };
}

function page(
  stack: Stack,
  {
    head = "",
    body = "",
    tail = "",
    includeMarker = true,
  }: {
    head?: string;
    body?: string;
    tail?: string;
    includeMarker?: boolean;
  }
): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${stack}</title>
    ${head}
    <style>.fixture-${stack.replace(/_/g, "-")} { color: rgb(12, 34, 56); }</style>
  </head>
  <body class="fixture-${stack.replace(/_/g, "-")}">
    ${body}
    ${tail}
    ${
      includeMarker
        ? `<script>document.documentElement.dataset.stack = "${stack}";</script>`
        : ""
    }
  </body>
</html>`;
}

function browserProject(html: string, stack: Stack) {
  return {
    entryPath: "index.html",
    files: {
      "index.html": html
        .replace(
          "</head>",
          '  <link rel="stylesheet" href="./styles.css">\n  </head>'
        )
        .replace(
          "</body>",
          '  <script src="./script.js"></script>\n  </body>'
        ),
      "styles.css": `.project-${stack.replace(/_/g, "-")} { outline: 1px solid transparent; }\n`,
      "script.js": `document.body.dataset.projectStack = "${stack}";\n`,
    },
    expectedLanguages: {
      "index.html": "html" as const,
      "script.js": "javascript" as const,
      "styles.css": "css" as const,
    },
    expectedPreviewKind: "html-entry" as const,
    expectedCodePenKind: "ready" as const,
  };
}

const generated = {
  [Stack.HTML_TAILWIND]: page(Stack.HTML_TAILWIND, {
    head: '<script src="https://cdn.tailwindcss.com/3.4.17"></script>',
    body: '<main class="bg-blue-600 p-4 text-white">Tailwind</main>',
  }),
  [Stack.HTML_CSS]: page(Stack.HTML_CSS, {
    body: "<main>Plain HTML and CSS</main>",
  }),
  [Stack.REACT_TAILWIND]: page(Stack.REACT_TAILWIND, {
    head: '<script src="https://cdn.jsdelivr.net/npm/react@18.0.0/umd/react.development.js"></script>\n<script src="https://cdn.jsdelivr.net/npm/react-dom@18.0.0/umd/react-dom.development.js"></script>\n<script src="https://unpkg.com/@babel/standalone@7.25.6/babel.min.js"></script>\n<script src="https://cdn.tailwindcss.com/3.4.17"></script>',
    body: '<div id="root"></div>',
    tail: '<script type="text/babel">\nconst { useState } = React;\nfunction App() {\n  const [count, setCount] = useState(0);\n  return <button onClick={() => setCount(count + 1)}>Count {count}</button>;\n}\nReactDOM.createRoot(document.getElementById("root")).render(<App />);\n</script>',
    includeMarker: false,
  }),
  [Stack.BOOTSTRAP]: page(Stack.BOOTSTRAP, {
    head: '<link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet">\n<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/js/bootstrap.bundle.min.js"></script>',
    body: '<button class="btn btn-primary" data-bs-toggle="collapse" data-bs-target="#fixture-collapse">Toggle</button><div class="collapse" id="fixture-collapse">Bootstrap collapse</div>',
  }),
  [Stack.VUE_TAILWIND]: page(Stack.VUE_TAILWIND, {
    head: '<script src="https://unpkg.com/vue@3.5.42/dist/vue.global.js"></script>\n<script src="https://cdn.tailwindcss.com/3.4.17"></script>',
    body: '<div id="app"><button @click="count++">Count {{ count }}</button></div>',
    tail: '<script>\nconst { createApp, ref } = Vue;\ncreateApp({ setup() { const count = ref(0); return { count }; } }).mount("#app");\n</script>',
    includeMarker: false,
  }),
  [Stack.IONIC_TAILWIND]: page(Stack.IONIC_TAILWIND, {
    head: '<script type="module" src="https://cdn.jsdelivr.net/npm/@ionic/core@8.8.19/dist/ionic/ionic.esm.js"></script>\n<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@ionic/core@8.8.19/css/ionic.bundle.css">\n<script src="https://cdn.tailwindcss.com/3.4.17"></script>',
    body: '<ion-app><ion-content><ion-button><ion-icon slot="start" name="add"></ion-icon>Ionic</ion-button></ion-content></ion-app>',
  }),
  [Stack.ALPINE_TAILWIND]: page(Stack.ALPINE_TAILWIND, {
    head: '<script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.17.1/dist/cdn.min.js"></script>\n<script src="https://cdn.tailwindcss.com/3.4.17"></script>',
    body: '<main x-data="{ count: 0 }"><button x-on:click="count++">Count <span x-text="count"></span></button></main>',
  }),
  [Stack.PREACT_TAILWIND]: page(Stack.PREACT_TAILWIND, {
    head: '<script src="https://cdn.tailwindcss.com/3.4.17"></script>',
    body: '<div id="root"></div>',
    tail: '<script type="module">\nimport { h, render } from "https://esm.sh/preact@10.29.8";\nimport { useState } from "https://esm.sh/preact@10.29.8/hooks";\nimport htm from "https://esm.sh/htm@3.1.1";\nconst html = htm.bind(h);\nfunction App() {\n  const [count, setCount] = useState(0);\n  return html`<button onClick=${() => setCount(count + 1)}>Count ${count}</button>`;\n}\nrender(html`<${App} />`, document.getElementById("root"));\n</script>',
    includeMarker: false,
  }),
  [Stack.TAILWIND_DAISYUI]: page(Stack.TAILWIND_DAISYUI, {
    head: '<script src="https://cdn.tailwindcss.com/3.4.17"></script>\n<link href="https://cdn.jsdelivr.net/npm/daisyui@4.12.14/dist/full.min.css" rel="stylesheet" type="text/css">',
    body: '<button class="btn btn-primary">daisyUI</button>',
  }),
  [Stack.BULMA]: page(Stack.BULMA, {
    head: '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bulma@1.0.2/css/bulma.min.css">',
    body: '<button class="button is-primary">Bulma</button>',
  }),
  [Stack.MATERIAL_WEB]: page(Stack.MATERIAL_WEB, {
    head: '<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200" rel="stylesheet">\n<script type="module" src="https://esm.run/@material/web@2.5.0/all.js"></script>',
    body: '<md-filled-button><md-icon slot="icon">add</md-icon>Material</md-filled-button>',
    tail: '<script type="module">\nimport { styles as typescaleStyles } from "https://esm.run/@material/web@2.5.0/typography/md-typescale-styles.js";\ndocument.adoptedStyleSheets.push(typescaleStyles.styleSheet);\n</script>',
  }),
  [Stack.HTMX_TAILWIND]: page(Stack.HTMX_TAILWIND, {
    head: '<script src="https://cdn.jsdelivr.net/npm/htmx.org@2.0.4/dist/htmx.min.js"></script>\n<script src="https://cdn.tailwindcss.com/3.4.17"></script>',
    body: '<button hx-on:click="this.textContent = \'Done\'">htmx</button>',
  }),
};

const reactProject = {
  entryPath: "src/App.tsx",
  files: {
    "index.html": '<!doctype html><html><head><script src="https://cdn.tailwindcss.com/3.4.17"></script></head><body><div id="root"></div><script type="module" src="./src/main.tsx"></script></body></html>',
    "package.json": '{"dependencies":{"react":"18.3.1","react-dom":"18.3.1"},"scripts":{"build":"vite build"}}',
    "src/App.tsx": 'import { useState } from "react"; export default function App() { const [count, setCount] = useState(0); return <button onClick={() => setCount(count + 1)}>Count {count}</button>; }',
    "src/main.tsx": 'import React from "react"; import { createRoot } from "react-dom/client"; import App from "./App"; import "./styles.css"; createRoot(document.getElementById("root")!).render(<App />);',
    "src/styles.css": "body { margin: 0; }",
  },
  expectedLanguages: {
    "index.html": "html" as const,
    "package.json": "json" as const,
    "src/App.tsx": "tsx" as const,
    "src/main.tsx": "tsx" as const,
    "src/styles.css": "css" as const,
  },
  expectedPreviewKind: "html-fallback" as const,
  expectedOmittedRuntimePath: "src/main.tsx",
  expectedCodePenKind: "unsupported" as const,
};

const vueProject = {
  entryPath: "src/App.vue",
  files: {
    "index.html": '<!doctype html><html><head><script src="https://cdn.tailwindcss.com/3.4.17"></script></head><body><div id="app"></div><script type="module" src="./src/main.ts"></script></body></html>',
    "package.json": '{"dependencies":{"vue":"3.5.42"},"scripts":{"build":"vite build"}}',
    "src/App.vue": '<script setup lang="ts">import { ref } from "vue"; const count = ref(0);</script><template><button @click="count++">Count {{ count }}</button></template>',
    "src/main.ts": 'import { createApp } from "vue"; import App from "./App.vue"; import "./styles.css"; createApp(App).mount("#app");',
    "src/styles.css": "body { margin: 0; }",
  },
  expectedLanguages: {
    "index.html": "html" as const,
    "package.json": "json" as const,
    "src/App.vue": "vue" as const,
    "src/main.ts": "typescript" as const,
    "src/styles.css": "css" as const,
  },
  expectedPreviewKind: "html-fallback" as const,
  expectedOmittedRuntimePath: "src/main.ts",
  expectedCodePenKind: "unsupported" as const,
};

const preactProject = {
  entryPath: "src/main.tsx",
  files: {
    "index.html": '<!doctype html><html><head><script src="https://cdn.tailwindcss.com/3.4.17"></script></head><body><div id="root"></div><script type="module" src="./src/main.tsx"></script></body></html>',
    "package.json": '{"dependencies":{"preact":"10.29.8"},"scripts":{"build":"vite build"}}',
    "src/main.tsx": 'import { render } from "preact"; import { useState } from "preact/hooks"; import "./styles.css"; function App() { const [count, setCount] = useState(0); return <button onClick={() => setCount(count + 1)}>Count {count}</button>; } render(<App />, document.getElementById("root")!);',
    "src/styles.css": "body { margin: 0; }",
  },
  expectedLanguages: {
    "index.html": "html" as const,
    "package.json": "json" as const,
    "src/main.tsx": "tsx" as const,
    "src/styles.css": "css" as const,
  },
  expectedPreviewKind: "html-fallback" as const,
  expectedOmittedRuntimePath: "src/main.tsx",
  expectedCodePenKind: "unsupported" as const,
};

export const STACK_ACCEPTANCE_FIXTURES: StackAcceptanceFixture[] = [
  {
    name: "HTML + Tailwind",
    stack: Stack.HTML_TAILWIND,
    generatedHtml: generated[Stack.HTML_TAILWIND],
    project: browserProject(generated[Stack.HTML_TAILWIND], Stack.HTML_TAILWIND),
  },
  {
    name: "HTML + CSS",
    stack: Stack.HTML_CSS,
    generatedHtml: generated[Stack.HTML_CSS],
    project: browserProject(generated[Stack.HTML_CSS], Stack.HTML_CSS),
  },
  {
    name: "React + Tailwind",
    stack: Stack.REACT_TAILWIND,
    generatedHtml: generated[Stack.REACT_TAILWIND],
    project: reactProject,
  },
  {
    name: "Bootstrap",
    stack: Stack.BOOTSTRAP,
    generatedHtml: generated[Stack.BOOTSTRAP],
    project: browserProject(generated[Stack.BOOTSTRAP], Stack.BOOTSTRAP),
  },
  {
    name: "Vue + Tailwind",
    stack: Stack.VUE_TAILWIND,
    generatedHtml: generated[Stack.VUE_TAILWIND],
    project: vueProject,
  },
  {
    name: "Ionic + Tailwind",
    stack: Stack.IONIC_TAILWIND,
    generatedHtml: generated[Stack.IONIC_TAILWIND],
    project: browserProject(generated[Stack.IONIC_TAILWIND], Stack.IONIC_TAILWIND),
  },
  {
    name: "Alpine + Tailwind",
    stack: Stack.ALPINE_TAILWIND,
    generatedHtml: generated[Stack.ALPINE_TAILWIND],
    project: browserProject(generated[Stack.ALPINE_TAILWIND], Stack.ALPINE_TAILWIND),
  },
  {
    name: "Preact + Tailwind",
    stack: Stack.PREACT_TAILWIND,
    generatedHtml: generated[Stack.PREACT_TAILWIND],
    project: preactProject,
  },
  {
    name: "Tailwind + daisyUI",
    stack: Stack.TAILWIND_DAISYUI,
    generatedHtml: generated[Stack.TAILWIND_DAISYUI],
    project: browserProject(generated[Stack.TAILWIND_DAISYUI], Stack.TAILWIND_DAISYUI),
  },
  {
    name: "Bulma",
    stack: Stack.BULMA,
    generatedHtml: generated[Stack.BULMA],
    project: browserProject(generated[Stack.BULMA], Stack.BULMA),
  },
  {
    name: "Material Web",
    stack: Stack.MATERIAL_WEB,
    generatedHtml: generated[Stack.MATERIAL_WEB],
    project: browserProject(generated[Stack.MATERIAL_WEB], Stack.MATERIAL_WEB),
  },
  {
    name: "htmx + Tailwind",
    stack: Stack.HTMX_TAILWIND,
    generatedHtml: generated[Stack.HTMX_TAILWIND],
    project: browserProject(generated[Stack.HTMX_TAILWIND], Stack.HTMX_TAILWIND),
  },
];

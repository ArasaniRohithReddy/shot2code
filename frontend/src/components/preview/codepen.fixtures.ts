import { Stack } from "../../lib/stacks";
import type { CodePenPayload } from "./codepen";

interface StackFixture {
  name: string;
  stack: Stack;
  html: string;
  expected: CodePenPayload;
  warningCount?: number;
}

const base = (overrides: Partial<CodePenPayload>): CodePenPayload => ({
  html: "<main>Preview</main>",
  head: "",
  css: "",
  js: "",
  html_pre_processor: "none",
  css_pre_processor: "none",
  css_prefix: "neither",
  js_pre_processor: "none",
  css_external: "",
  js_external: "",
  editors: "100",
  layout: "left",
  ...overrides,
});

export const CODEPEN_STACK_FIXTURES: StackFixture[] = [
  {
    name: "HTML + Tailwind",
    stack: Stack.HTML_TAILWIND,
    html: '<!doctype html><html class="dark"><head><title>Tailwind</title><script src="https://cdn.tailwindcss.com/3.4.17"></script><style>body{margin:0}</style></head><body><main>Preview</main></body></html>',
    expected: base({
      title: "Tailwind",
      html_classes: "dark",
      css: "body{margin:0}",
      js_external: "https://cdn.tailwindcss.com/3.4.17",
      editors: "110",
    }),
  },
  {
    name: "HTML + CSS",
    stack: Stack.HTML_CSS,
    html: '<!doctype html><html><head><title>Plain</title><link rel="stylesheet" href="https://example.com/base.css"><style>main{color:red}</style></head><body><main>Preview</main><script src="https://example.com/app.js"></script><script>boot()</script></body></html>',
    expected: base({
      title: "Plain",
      css: "main{color:red}",
      js: "boot()",
      css_external: "https://example.com/base.css",
      js_external: "https://example.com/app.js",
      editors: "111",
    }),
  },
  {
    name: "React + Tailwind",
    stack: Stack.REACT_TAILWIND,
    html: '<!doctype html><html><head><title>React</title><script src="https://cdn.tailwindcss.com/3.4.17"></script><script src="https://unpkg.com/react@18/umd/react.development.js"></script><script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script><script src="https://unpkg.com/@babel/standalone@7/babel.min.js"></script></head><body><div id="root"></div><script type="text/babel">ReactDOM.createRoot(document.getElementById("root")).render(<main>Preview</main>);</script></body></html>',
    expected: base({
      title: "React",
      html: '<div id="root"></div>',
      js: 'ReactDOM.createRoot(document.getElementById("root")).render(<main>Preview</main>);',
      js_pre_processor: "babel",
      js_external:
        "https://cdn.tailwindcss.com/3.4.17;https://unpkg.com/react@18/umd/react.development.js;https://unpkg.com/react-dom@18/umd/react-dom.development.js",
      editors: "101",
    }),
  },
  {
    name: "Vue + Tailwind",
    stack: Stack.VUE_TAILWIND,
    html: '<!doctype html><html><head><title>Vue</title><script src="https://cdn.tailwindcss.com/3.4.17"></script><script src="https://unpkg.com/vue@3/dist/vue.global.js"></script></head><body><div id="app"></div><script>Vue.createApp({template:"<main>Preview</main>"}).mount("#app")</script></body></html>',
    expected: base({
      title: "Vue",
      html: '<div id="app"></div>',
      js: 'Vue.createApp({template:"<main>Preview</main>"}).mount("#app")',
      js_external:
        "https://cdn.tailwindcss.com/3.4.17;https://unpkg.com/vue@3/dist/vue.global.js",
      editors: "101",
    }),
  },
  {
    name: "Bootstrap",
    stack: Stack.BOOTSTRAP,
    html: '<!doctype html><html><head><title>Bootstrap</title><link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css"></head><body><button data-bs-toggle="modal">Open</button><script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/js/bootstrap.bundle.min.js"></script></body></html>',
    expected: base({
      title: "Bootstrap",
      html: '<button data-bs-toggle="modal">Open</button>',
      css_external:
        "https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css",
      js_external:
        "https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/js/bootstrap.bundle.min.js",
    }),
  },
  {
    name: "Ionic + Tailwind",
    stack: Stack.IONIC_TAILWIND,
    html: '<!doctype html><html><head><title>Ionic</title><link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@ionic/core/css/ionic.bundle.css"><script src="https://cdn.tailwindcss.com/3.4.17"></script><script type="module" src="https://cdn.jsdelivr.net/npm/@ionic/core/dist/ionic/ionic.esm.js"></script><script nomodule src="https://cdn.jsdelivr.net/npm/@ionic/core/dist/ionic/ionic.js"></script></head><body><ion-app>Preview</ion-app></body></html>',
    expected: base({
      title: "Ionic",
      html: "<ion-app>Preview</ion-app>",
      head: '<script type="module" src="https://cdn.jsdelivr.net/npm/@ionic/core/dist/ionic/ionic.esm.js"></script><script nomodule src="https://cdn.jsdelivr.net/npm/@ionic/core/dist/ionic/ionic.js"></script>',
      css_external:
        "https://cdn.jsdelivr.net/npm/@ionic/core/css/ionic.bundle.css",
      js_external: "https://cdn.tailwindcss.com/3.4.17",
    }),
  },
  {
    name: "Alpine + Tailwind",
    stack: Stack.ALPINE_TAILWIND,
    html: '<!doctype html><html><head><title>Alpine</title><script src="https://cdn.tailwindcss.com/3.4.17"></script><script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js"></script></head><body><main x-data="{open:true}">Preview</main></body></html>',
    expected: base({
      title: "Alpine",
      html: '<main x-data="{open:true}">Preview</main>',
      head: '<script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js"></script>',
      js_external: "https://cdn.tailwindcss.com/3.4.17",
    }),
  },
  {
    name: "Preact + Tailwind",
    stack: Stack.PREACT_TAILWIND,
    html: '<!doctype html><html><head><title>Preact</title><script src="https://cdn.tailwindcss.com/3.4.17"></script><script type="importmap">{"imports":{"preact":"https://esm.sh/preact@10","htm/preact":"https://esm.sh/htm@3/preact"}}</script><script type="module">import { render } from "preact"; import htm from "htm/preact"; const html=htm.bind(null); render(html`<main>Preview</main>`,document.body);</script></head><body><div id="app"></div></body></html>',
    expected: base({
      title: "Preact",
      html: '<div id="app"></div>',
      head: '<script type="importmap">{"imports":{"preact":"https://esm.sh/preact@10","htm/preact":"https://esm.sh/htm@3/preact"}}</script>',
      js: 'import { render } from "preact"; import htm from "htm/preact"; const html=htm.bind(null); render(html`<main>Preview</main>`,document.body);',
      js_module: true,
      js_external: "https://cdn.tailwindcss.com/3.4.17",
      editors: "101",
    }),
  },
  {
    name: "Tailwind + daisyUI",
    stack: Stack.TAILWIND_DAISYUI,
    html: '<!doctype html><html><head><title>daisyUI</title><link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/daisyui@4.12.14/dist/full.min.css"><script src="https://cdn.tailwindcss.com/3.4.17"></script></head><body><main>Preview</main></body></html>',
    expected: base({
      title: "daisyUI",
      css_external:
        "https://cdn.jsdelivr.net/npm/daisyui@4.12.14/dist/full.min.css",
      js_external: "https://cdn.tailwindcss.com/3.4.17",
    }),
  },
  {
    name: "Bulma",
    stack: Stack.BULMA,
    html: '<!doctype html><html><head><title>Bulma</title><link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bulma@1.0.2/css/bulma.min.css"></head><body><main>Preview</main></body></html>',
    expected: base({
      title: "Bulma",
      css_external:
        "https://cdn.jsdelivr.net/npm/bulma@1.0.2/css/bulma.min.css",
    }),
  },
  {
    name: "Material Web",
    stack: Stack.MATERIAL_WEB,
    html: '<!doctype html><html><head><title>Material</title><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Roboto"><script type="importmap">{"imports":{"@material/web/":"https://esm.run/@material/web/"}}</script><script type="module">import "@material/web/all.js";</script></head><body><md-filled-button>Preview</md-filled-button></body></html>',
    expected: base({
      title: "Material",
      html: "<md-filled-button>Preview</md-filled-button>",
      head: '<script type="importmap">{"imports":{"@material/web/":"https://esm.run/@material/web/"}}</script>',
      js: 'import "@material/web/all.js";',
      js_module: true,
      css_external: "https://fonts.googleapis.com/css2?family=Roboto",
      editors: "101",
    }),
  },
  {
    name: "htmx + Tailwind",
    stack: Stack.HTMX_TAILWIND,
    html: '<!doctype html><html><head><title>htmx</title><script src="https://cdn.tailwindcss.com/3.4.17"></script><script src="https://unpkg.com/htmx.org@2.0.4"></script><script src="https://unpkg.com/htmx-ext-client-side-templates@2.0.1"></script></head><body><button hx-get="/fragment">Load</button></body></html>',
    expected: base({
      title: "htmx",
      html: '<button hx-get="/fragment">Load</button>',
      js_external:
        "https://cdn.tailwindcss.com/3.4.17;https://unpkg.com/htmx.org@2.0.4;https://unpkg.com/htmx-ext-client-side-templates@2.0.1",
    }),
    warningCount: 2,
  },
];

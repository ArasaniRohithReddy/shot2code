from typing import TypedDict


class ProjectFileFixture(TypedDict):
    path: str
    content: str


class ProjectPayloadFixture(TypedDict):
    entryPoint: str
    files: list[ProjectFileFixture]


DATA_IMAGE = "data:image/png;base64,iVBORw0KGgo="


def _page(
    stack: str,
    *,
    head: str = "",
    body: str = "",
    tail: str = "",
    include_default_script: bool = True,
) -> str:
    default_script = (
        f'<script>document.documentElement.dataset.stack = "{stack}";</script>'
        if include_default_script
        else ""
    )
    css_class = stack.replace("_", "-")
    return f'''<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{stack}</title>
    {head}
    <style>.fixture-{css_class} {{ color: rgb(12, 34, 56); }}</style>
  </head>
  <body class="fixture-{css_class}">
    <img alt="fixture" src="{DATA_IMAGE}">
    {body}
    {tail}
    {default_script}
  </body>
</html>
'''


STACK_FIXTURES: dict[str, str] = {
    "html_tailwind": _page(
        "html_tailwind",
        head='<script src="https://cdn.tailwindcss.com/3.4.17"></script>',
        body='<main class="bg-blue-600 p-4 text-white">Tailwind</main>',
    ),
    "html_css": _page(
        "html_css",
        body="<main>Plain HTML and CSS</main>",
    ),
    "react_tailwind": _page(
        "react_tailwind",
        head='''<script src="https://cdn.jsdelivr.net/npm/react@18.0.0/umd/react.development.js"></script>
<script src="https://cdn.jsdelivr.net/npm/react-dom@18.0.0/umd/react-dom.development.js"></script>
<script src="https://unpkg.com/@babel/standalone@7.25.6/babel.min.js"></script>
<script src="https://cdn.tailwindcss.com/3.4.17"></script>''',
        body='<div id="root"></div>',
        tail='''<script type="text/babel">
const { useState } = React;
function App() {
  const [count, setCount] = useState(0);
  return <button className="p-4" onClick={() => setCount(count + 1)}>Count {count}</button>;
}
ReactDOM.createRoot(document.getElementById("root")).render(<App />);
</script>''',
        include_default_script=False,
    ),
    "bootstrap": _page(
        "bootstrap",
        head='''<link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/js/bootstrap.bundle.min.js"></script>''',
        body='''<main class="container">
<button class="btn btn-primary" data-bs-toggle="collapse" data-bs-target="#fixture-collapse">Toggle</button>
<div class="collapse" id="fixture-collapse">Bootstrap collapse</div>
</main>''',
    ),
    "vue_tailwind": _page(
        "vue_tailwind",
        head='''<script src="https://unpkg.com/vue@3.5.42/dist/vue.global.js"></script>
<script src="https://cdn.tailwindcss.com/3.4.17"></script>''',
        body='<div id="app" class="p-4"><button @click="count++">Count {{ count }}</button></div>',
        tail='''<script>
const { createApp, ref } = Vue;
createApp({
  setup() {
    const count = ref(0);
    return { count };
  },
}).mount("#app");
document.documentElement.dataset.stack = "vue_tailwind";
</script>''',
        include_default_script=False,
    ),
    "ionic_tailwind": _page(
        "ionic_tailwind",
        head='''<script type="module" src="https://cdn.jsdelivr.net/npm/@ionic/core@8.8.19/dist/ionic/ionic.esm.js"></script>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@ionic/core@8.8.19/css/ionic.bundle.css">
<script src="https://cdn.tailwindcss.com/3.4.17"></script>''',
        body='<ion-app><ion-content><ion-button><ion-icon slot="start" name="add"></ion-icon>Ionic</ion-button></ion-content></ion-app>',
    ),
    "alpine_tailwind": _page(
        "alpine_tailwind",
        head='''<script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.17.1/dist/cdn.min.js"></script>
<script src="https://cdn.tailwindcss.com/3.4.17"></script>''',
        body='<main x-data="{ count: 0 }"><button x-on:click="count++">Count <span x-text="count"></span></button></main>',
    ),
    "preact_tailwind": _page(
        "preact_tailwind",
        head='<script src="https://cdn.tailwindcss.com/3.4.17"></script>',
        body='<div id="root"></div>',
        tail='''<script type="module">
import { h, render } from "https://esm.sh/preact@10.29.8";
import { useState } from "https://esm.sh/preact@10.29.8/hooks";
import htm from "https://esm.sh/htm@3.1.1";
const html = htm.bind(h);
function App() {
  const [count, setCount] = useState(0);
  return html`<button onClick=${() => setCount(count + 1)}>Count ${count}</button>`;
}
render(html`<${App} />`, document.getElementById("root"));
</script>''',
        include_default_script=False,
    ),
    "tailwind_daisyui": _page(
        "tailwind_daisyui",
        head='''<script src="https://cdn.tailwindcss.com/3.4.17"></script>
<link href="https://cdn.jsdelivr.net/npm/daisyui@4.12.14/dist/full.min.css" rel="stylesheet" type="text/css">''',
        body='<button class="btn btn-primary">daisyUI</button>',
    ),
    "bulma": _page(
        "bulma",
        head='<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bulma@1.0.2/css/bulma.min.css">',
        body='<main class="section"><button class="button is-primary">Bulma</button></main>',
    ),
    "material_web": _page(
        "material_web",
        head='''<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200" rel="stylesheet">
<script type="module" src="https://esm.run/@material/web@2.5.0/all.js"></script>''',
        body='<md-filled-button><md-icon slot="icon">add</md-icon>Material</md-filled-button>',
        tail='''<script type="module">
import { styles as typescaleStyles } from "https://esm.run/@material/web@2.5.0/typography/md-typescale-styles.js";
document.adoptedStyleSheets.push(typescaleStyles.styleSheet);
</script>''',
    ),
    "htmx_tailwind": _page(
        "htmx_tailwind",
        head='''<script src="https://cdn.jsdelivr.net/npm/htmx.org@2.0.4/dist/htmx.min.js"></script>
<script src="https://cdn.tailwindcss.com/3.4.17"></script>''',
        body='<button hx-on:click="this.textContent = \'Done\'">htmx</button>',
    ),
}

EXPECTED_RUNTIME_MARKERS: dict[str, str] = {
    "html_tailwind": "https://cdn.tailwindcss.com/3.4.17",
    "html_css": "Plain HTML and CSS",
    "react_tailwind": "https://cdn.jsdelivr.net/npm/react@18.0.0/umd/react.development.js",
    "bootstrap": "https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css",
    "vue_tailwind": "https://unpkg.com/vue@3.5.42/dist/vue.global.js",
    "ionic_tailwind": "https://cdn.jsdelivr.net/npm/@ionic/core@8.8.19/dist/ionic/ionic.esm.js",
    "alpine_tailwind": "https://cdn.jsdelivr.net/npm/alpinejs@3.17.1/dist/cdn.min.js",
    "preact_tailwind": "https://esm.sh/preact@10.29.8",
    "tailwind_daisyui": "https://cdn.jsdelivr.net/npm/daisyui@4.12.14/dist/full.min.css",
    "bulma": "https://cdn.jsdelivr.net/npm/bulma@1.0.2/css/bulma.min.css",
    "material_web": "https://esm.run/@material/web@2.5.0/all.js",
    "htmx_tailwind": "https://cdn.jsdelivr.net/npm/htmx.org@2.0.4/dist/htmx.min.js",
}

EXPECTED_BEHAVIOR_MARKERS: dict[str, tuple[str, ...]] = {
    "html_tailwind": ("bg-blue-600", "text-white"),
    "html_css": ("Plain HTML and CSS",),
    "react_tailwind": ("setCount", "Count {count}"),
    "bootstrap": ("data-bs-toggle=\"collapse\"", "#fixture-collapse"),
    "vue_tailwind": ("const count = ref(0)", "@click=\"count++\""),
    "ionic_tailwind": ("<ion-icon", 'name="add"'),
    "alpine_tailwind": ('x-on:click="count++"', 'x-text="count"'),
    "preact_tailwind": ("setCount", "Count ${count}"),
    "tailwind_daisyui": ("btn btn-primary",),
    "bulma": ("button is-primary",),
    "material_web": ("<md-icon", ">add</md-icon>"),
    "htmx_tailwind": ("hx-on:click", "Done"),
}


EXPECTED_CODEPEN_RESOURCES: dict[str, tuple[str, ...]] = {
    "html_tailwind": ("https://cdn.tailwindcss.com/3.4.17",),
    "html_css": (),
    "react_tailwind": (
        "https://cdn.jsdelivr.net/npm/react@18.0.0/umd/react.development.js",
        "https://cdn.jsdelivr.net/npm/react-dom@18.0.0/umd/react-dom.development.js",
        "https://unpkg.com/@babel/standalone@7.25.6/babel.min.js",
        "https://cdn.tailwindcss.com/3.4.17",
    ),
    "bootstrap": (
        "https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css",
        "https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/js/bootstrap.bundle.min.js",
    ),
    "vue_tailwind": (
        "https://unpkg.com/vue@3.5.42/dist/vue.global.js",
        "https://cdn.tailwindcss.com/3.4.17",
    ),
    "ionic_tailwind": (
        "https://cdn.jsdelivr.net/npm/@ionic/core@8.8.19/dist/ionic/ionic.esm.js",
        "https://cdn.jsdelivr.net/npm/@ionic/core@8.8.19/css/ionic.bundle.css",
        "https://cdn.tailwindcss.com/3.4.17",
    ),
    "alpine_tailwind": (
        "https://cdn.jsdelivr.net/npm/alpinejs@3.17.1/dist/cdn.min.js",
        "https://cdn.tailwindcss.com/3.4.17",
    ),
    "preact_tailwind": (
        "https://esm.sh/preact@10.29.8",
        "https://esm.sh/preact@10.29.8/hooks",
        "https://esm.sh/htm@3.1.1",
        "https://cdn.tailwindcss.com/3.4.17",
    ),
    "tailwind_daisyui": (
        "https://cdn.tailwindcss.com/3.4.17",
        "https://cdn.jsdelivr.net/npm/daisyui@4.12.14/dist/full.min.css",
    ),
    "bulma": ("https://cdn.jsdelivr.net/npm/bulma@1.0.2/css/bulma.min.css",),
    "material_web": (
        "https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200",
        "https://esm.run/@material/web@2.5.0/all.js",
        "https://esm.run/@material/web@2.5.0/typography/md-typescale-styles.js",
    ),
    "htmx_tailwind": (
        "https://cdn.jsdelivr.net/npm/htmx.org@2.0.4/dist/htmx.min.js",
        "https://cdn.tailwindcss.com/3.4.17",
    ),
}


PROJECT_KINDS: dict[str, str] = {
    stack: (
        "vite_react"
        if stack == "react_tailwind"
        else "vite_preact"
        if stack == "preact_tailwind"
        else "vite_html"
    )
    for stack in STACK_FIXTURES
}


PROJECT_PAYLOAD_FIXTURES: dict[str, ProjectPayloadFixture] = {
    "react_tailwind": {
        "entryPoint": "src/main.jsx",
        "files": [
            {
                "path": "index.html",
                "content": '''<!doctype html>
<html lang="en">
  <head><meta charset="UTF-8"><script src="https://cdn.tailwindcss.com/3.4.17"></script></head>
  <body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body>
</html>
''',
            },
            {
                "path": "package.json",
                "content": '''{
  "name": "shot2code-react-source",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": { "build": "vite build" },
  "dependencies": { "react": "^18.3.1", "react-dom": "^18.3.1" },
  "devDependencies": { "@vitejs/plugin-react": "^4.3.4", "vite": "^6.0.0" }
}
''',
            },
            {
                "path": "vite.config.js",
                "content": '''import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({ base: "./", plugins: [react()] });
''',
            },
            {
                "path": "src/App.jsx",
                "content": '''export default function App() {
  return <main className="p-4">React source project</main>;
}
''',
            },
            {
                "path": "src/main.jsx",
                "content": '''import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode><App /></React.StrictMode>
);
''',
            },
            {
                "path": "src/styles.css",
                "content": "body { margin: 0; }\n",
            },
        ],
    },
    "preact_tailwind": {
        "entryPoint": "src/main.js",
        "files": [
            {
                "path": "index.html",
                "content": '''<!doctype html>
<html lang="en">
  <head><meta charset="UTF-8"><script src="https://cdn.tailwindcss.com/3.4.17"></script></head>
  <body><div id="root"></div><script type="module" src="/src/main.js"></script></body>
</html>
''',
            },
            {
                "path": "package.json",
                "content": '''{
  "name": "shot2code-preact-source",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": { "build": "vite build" },
  "dependencies": { "preact": "^10.26.4" },
  "devDependencies": { "vite": "^6.0.0" }
}
''',
            },
            {
                "path": "src/main.js",
                "content": '''import { h, render } from "preact";
import "./styles.css";

function App() {
  return h("main", { class: "p-4" }, "Preact source project");
}

render(h(App), document.getElementById("root"));
''',
            },
            {
                "path": "src/styles.css",
                "content": "body { margin: 0; }\n",
            },
        ],
    },
    "vue_tailwind": {
        "entryPoint": "src/main.js",
        "files": [
            {
                "path": "index.html",
                "content": '''<!doctype html>
<html lang="en">
  <head><meta charset="UTF-8"><script src="https://cdn.tailwindcss.com/3.4.17"></script></head>
  <body><div id="app"></div><script type="module" src="/src/main.js"></script></body>
</html>
''',
            },
            {
                "path": "package.json",
                "content": '''{
  "name": "shot2code-vue-source",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": { "build": "vite build" },
  "dependencies": { "vue": "^3.5.13" },
  "devDependencies": { "@vitejs/plugin-vue": "^5.2.1", "vite": "^6.0.0" }
}
''',
            },
            {
                "path": "vite.config.js",
                "content": '''import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

export default defineConfig({ base: "./", plugins: [vue()] });
''',
            },
            {
                "path": "src/App.vue",
                "content": '''<script setup>
const message = "Vue source project";
</script>

<template>
  <main class="p-4">{{ message }}</main>
</template>

<style>
body { margin: 0; }
</style>
''',
            },
            {
                "path": "src/main.js",
                "content": '''import { createApp } from "vue";
import App from "./App.vue";

createApp(App).mount("#app");
''',
            },
        ],
    },
}

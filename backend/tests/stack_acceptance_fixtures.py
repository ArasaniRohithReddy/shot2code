from dataclasses import dataclass
from typing import Literal


RuntimeBehavior = Literal[
    "plain-css",
    "tailwind-style",
    "react-counter",
    "bootstrap-collapse",
    "vue-counter",
    "ionic-hydration",
    "alpine-counter",
    "preact-counter",
    "daisyui-style",
    "bulma-style",
    "material-component",
    "htmx-action",
]


@dataclass(frozen=True)
class StackAcceptanceCase:
    stack: str
    prompt_heading: str
    prompt_required: tuple[str, ...]
    prompt_forbidden: tuple[str, ...]
    browser_behavior: RuntimeBehavior


STACK_ACCEPTANCE_CASES = (
    StackAcceptanceCase(
        "html_tailwind",
        "Tailwind",
        ("https://cdn.tailwindcss.com/3.4.17",),
        ('<script src="https://cdn.tailwindcss.com"></script>',),
        "tailwind-style",
    ),
    StackAcceptanceCase(
        "html_css",
        "html_css",
        ("Only use HTML, CSS and JS.", "Do not use Tailwind"),
        (),
        "plain-css",
    ),
    StackAcceptanceCase(
        "react_tailwind",
        "React",
        (
            "https://cdn.jsdelivr.net/npm/react@18.0.0/umd/react.development.js",
            "https://cdn.jsdelivr.net/npm/react-dom@18.0.0/umd/react-dom.development.js",
            "https://unpkg.com/@babel/standalone@7.25.6/babel.min.js",
            "https://cdn.tailwindcss.com/3.4.17",
        ),
        (
            "https://cdn.babeljs.io/babel.min.js",
            "https://unpkg.com/@babel/standalone@7/babel.min.js",
        ),
        "react-counter",
    ),
    StackAcceptanceCase(
        "bootstrap",
        "Bootstrap",
        (
            "https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css",
            "https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/js/bootstrap.bundle.min.js",
            "bundle includes Popper",
        ),
        ("bootstrap@latest",),
        "bootstrap-collapse",
    ),
    StackAcceptanceCase(
        "vue_tailwind",
        "Vue",
        (
            "https://unpkg.com/vue@3.5.42/dist/vue.global.js",
            "https://cdn.tailwindcss.com/3.4.17",
        ),
        ("registry.npmmirror.com", "https://unpkg.com/vue@3/dist/vue.global.js"),
        "vue-counter",
    ),
    StackAcceptanceCase(
        "ionic_tailwind",
        "Ionic",
        (
            "https://cdn.jsdelivr.net/npm/@ionic/core@8.8.19/dist/ionic/ionic.esm.js",
            "https://cdn.jsdelivr.net/npm/@ionic/core@8.8.19/css/ionic.bundle.css",
            "Ionic Core includes Ionicons support",
        ),
        ("https://cdn.jsdelivr.net/npm/ionicons/+esm", "<script nomodule"),
        "ionic-hydration",
    ),
    StackAcceptanceCase(
        "alpine_tailwind",
        "Alpine.js",
        (
            "https://cdn.jsdelivr.net/npm/alpinejs@3.17.1/dist/cdn.min.js",
            "https://cdn.tailwindcss.com/3.4.17",
        ),
        ("alpinejs@3.x.x",),
        "alpine-counter",
    ),
    StackAcceptanceCase(
        "preact_tailwind",
        "Preact",
        (
            "https://esm.sh/preact@10.29.8",
            "https://esm.sh/preact@10.29.8/hooks",
            "https://esm.sh/htm@3.1.1",
        ),
        ("preact@10.29.8.29.8",),
        "preact-counter",
    ),
    StackAcceptanceCase(
        "tailwind_daisyui",
        "daisyUI",
        (
            "https://cdn.tailwindcss.com/3.4.17",
            "https://cdn.jsdelivr.net/npm/daisyui@4.12.14/dist/full.min.css",
        ),
        ("daisyui@latest",),
        "daisyui-style",
    ),
    StackAcceptanceCase(
        "bulma",
        "Bulma",
        (
            "https://cdn.jsdelivr.net/npm/bulma@1.0.2/css/bulma.min.css",
            "Do not use Tailwind.",
        ),
        ("bulma@latest",),
        "bulma-style",
    ),
    StackAcceptanceCase(
        "material_web",
        "Material 3 (material_web)",
        (
            "https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined",
            "https://esm.run/@material/web@2.5.0/all.js",
            "https://esm.run/@material/web@2.5.0/typography/md-typescale-styles.js",
            "Do not use Tailwind.",
        ),
        ("https://esm.run/@material/web/all.js",),
        "material-component",
    ),
    StackAcceptanceCase(
        "htmx_tailwind",
        "htmx",
        (
            "https://cdn.jsdelivr.net/npm/htmx.org@2.0.4/dist/htmx.min.js",
            "https://cdn.tailwindcss.com/3.4.17",
            "There is no server to call",
        ),
        ("https://unpkg.com/htmx.org",),
        "htmx-action",
    ),
)

STACK_ACCEPTANCE_BY_NAME = {
    acceptance.stack: acceptance for acceptance in STACK_ACCEPTANCE_CASES
}

INVALID_LEGACY_RUNTIME_MARKERS = (
    '<script src="https://cdn.tailwindcss.com"></script>',
    "https://cdn.babeljs.io/babel.min.js",
    "https://unpkg.com/@babel/standalone@7/babel.min.js",
    "registry.npmmirror.com",
    "https://unpkg.com/vue@3/dist/vue.global.js",
    "https://cdn.jsdelivr.net/npm/ionicons/+esm",
    "alpinejs@3.x.x",
    "preact@10.29.8.29.8",
    "daisyui@latest",
    "bulma@latest",
    "https://esm.run/@material/web/all.js",
    "https://unpkg.com/htmx.org",
)

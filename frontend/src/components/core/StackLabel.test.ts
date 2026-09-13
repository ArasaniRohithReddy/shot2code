import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Stack, STACK_DESCRIPTIONS } from "../../lib/stacks";
import StackLabel from "./StackLabel";
import { STACK_COMPONENT_LOGOS } from "./stack-icons";

const stacks = Object.values(Stack) as Stack[];

function dataAttributeValues(markup: string, attribute: string) {
  return Array.from(
    markup.matchAll(new RegExp(`data-stack-${attribute}="([^"]+)"`, "g")),
    (match) => match[1],
  );
}

test("every stack component has an icon", () => {
  const missing = Object.values(STACK_DESCRIPTIONS)
    .flatMap((description) => description.components)
    .filter((component) => !STACK_COMPONENT_LOGOS[component]);

  expect(missing).toEqual([]);
});

test("covers all supported stacks", () => {
  expect(stacks).toHaveLength(12);
});

test.each(stacks)(
  "%s renders ordered icon and name pairs",
  (stack) => {
    const components = STACK_DESCRIPTIONS[stack].components;
    const markup = renderToStaticMarkup(
      createElement(StackLabel, { stack }),
    );
    const renderedOrder = Array.from(
      markup.matchAll(/data-stack-(component|separator)="([^"]+)"/g),
      (match) => `${match[1]}:${match[2]}`,
    );
    const expectedOrder = components.flatMap((component, index) =>
      index === 0
        ? [`component:${component}`]
        : ["separator:true", `component:${component}`],
    );

    expect(dataAttributeValues(markup, "component")).toEqual(components);
    expect(dataAttributeValues(markup, "icon")).toEqual(components);
    expect(renderedOrder).toEqual(expectedOrder);
    expect(markup.match(/aria-hidden="true"/g) ?? []).toHaveLength(
      components.length,
    );
    expect(markup).toContain("notranslate");
    expect(markup).toContain('translate="no"');
    expect(markup.replace(/<[^>]+>/g, "").replace(/\s+/g, "")).toBe(
      components.join("+").replace(/\s+/g, ""),
    );
  },
);

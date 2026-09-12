import { STACK_DESCRIPTIONS } from "../../lib/stacks";
import { STACK_COMPONENT_LOGOS } from "./stack-icons";

test("every stack component has an icon", () => {
  const missing = Object.values(STACK_DESCRIPTIONS)
    .flatMap((description) => description.components)
    .filter((component) => !STACK_COMPONENT_LOGOS[component]);

  expect(missing).toEqual([]);
});

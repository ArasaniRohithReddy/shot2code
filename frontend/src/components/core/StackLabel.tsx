import { Fragment } from "react";
import type { FC } from "react";
import { Stack, STACK_DESCRIPTIONS } from "../../lib/stacks";
import { STACK_COMPONENT_LOGOS } from "./stack-icons";

interface StackLabelProps {
  stack: Stack;
}

const StackLabel: FC<StackLabelProps> = ({ stack }) => {
  const stackComponents = STACK_DESCRIPTIONS[stack].components;

  return (
    <span
      className="notranslate inline-flex max-w-full min-w-0 items-center gap-1 overflow-hidden whitespace-nowrap align-middle"
      translate="no"
    >
      {stackComponents.map((component, index) => {
        const logo = STACK_COMPONENT_LOGOS[component];
        if (!logo) {
          throw new Error(`Missing stack icon for "${component}"`);
        }

        const Icon = logo.icon;
        return (
          <Fragment key={component}>
            {index > 0 && (
              <span className="shrink-0" data-stack-separator="true">
                +
              </span>
            )}
            <span
              className="inline-flex min-w-0 items-center gap-1"
              data-stack-component={component}
            >
              <Icon
                data-stack-icon={component}
                className="h-3.5 w-3.5 shrink-0"
                style={{ color: logo.color }}
                aria-hidden="true"
                focusable="false"
              />
              <span className="min-w-0 truncate font-semibold">
                {component}
              </span>
            </span>
          </Fragment>
        );
      })}
    </span>
  );
};

export default StackLabel;

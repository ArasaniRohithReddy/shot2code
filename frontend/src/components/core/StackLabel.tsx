import React from "react";
import { Stack, STACK_DESCRIPTIONS } from "../../lib/stacks";
import { STACK_COMPONENT_LOGOS } from "./stack-icons";

interface StackLabelProps {
  stack: Stack;
}

const StackLabel: React.FC<StackLabelProps> = ({ stack }) => {
  const stackComponents = STACK_DESCRIPTIONS[stack].components;

  return (
    <div className="notranslate flex items-center gap-2" translate="no">
      <span className="flex items-center gap-1">
        {stackComponents.map((component) => {
          const logo = STACK_COMPONENT_LOGOS[component];
          if (!logo) return null;
          const Icon = logo.icon;
          return (
            <Icon
              key={component}
              className="h-3.5 w-3.5 shrink-0"
              style={{ color: logo.color }}
              aria-hidden="true"
            />
          );
        })}
      </span>
      <span>
        {stackComponents.map((component, index) => (
          <React.Fragment key={index}>
            <span className="font-semibold">{component}</span>
            {index < stackComponents.length - 1 && " + "}
          </React.Fragment>
        ))}
      </span>
    </div>
  );
};

export default StackLabel;

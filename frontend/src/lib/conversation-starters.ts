export type ConversationStarterVariant = "imported" | "generated";

export interface ConversationStarter {
  id: string;
  label: string;
  instruction: string;
}

const IMPORTED_STARTERS: ConversationStarter[] = [
  {
    id: "responsive",
    label: "Make the layout responsive",
    instruction:
      "Make the layout responsive down to 360px without changing the content or the visual identity.",
  },
  {
    id: "accessibility",
    label: "Fix accessibility issues",
    instruction:
      "Fix accessibility issues: landmarks, heading order, form labels, focus states, and colour contrast.",
  },
  {
    id: "polish",
    label: "Polish spacing and typography",
    instruction:
      "Polish the spacing rhythm and typographic hierarchy while keeping the existing structure and copy.",
  },
];

const GENERATED_STARTERS: ConversationStarter[] = [
  {
    id: "match",
    label: "Match the reference more closely",
    instruction:
      "Compare the result with the reference and correct the spacing, sizes, and colours that drifted.",
  },
  {
    id: "responsive",
    label: "Make the layout responsive",
    instruction:
      "Make the layout responsive down to 360px without changing the content or the visual identity.",
  },
  {
    id: "interactive",
    label: "Add the missing interactions",
    instruction:
      "Add the hover, focus, and active states the interface needs, plus keyboard support for every control.",
  },
];

export function getConversationStarters(
  variant: ConversationStarterVariant
): ConversationStarter[] {
  return variant === "imported" ? IMPORTED_STARTERS : GENERATED_STARTERS;
}

import { ProjectContext } from "../types";

export function buildGenerationContext(
  designSystemContent: string | null | undefined,
  projectContext: ProjectContext | null | undefined
) {
  const blocks = [designSystemContent, projectContext?.summary].filter(
    (content): content is string => Boolean(content?.trim())
  );
  return blocks.length ? blocks.join("\n\n") : null;
}

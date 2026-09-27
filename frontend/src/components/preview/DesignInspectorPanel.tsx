import { useMemo, useState } from "react";
import {
  LuClipboard,
  LuDownload,
  LuFileText,
  LuPalette,
  LuSearch,
} from "react-icons/lu";
import toast from "react-hot-toast";
import {
  designMarkdown,
  designSkillMarkdown,
  downloadPalettePng,
  downloadTextArtifact,
  inspectDesignSource,
  type DesignInspection,
} from "../../lib/design-inspector";
import { Button } from "../ui/button";

export default function DesignInspectorPanel({
  html,
  sourcePath,
}: {
  html: string;
  sourcePath: string | null;
}) {
  const [inspection, setInspection] = useState<DesignInspection | null>(null);
  const sourceName = sourcePath ?? "composed-preview.html";
  const designMd = useMemo(
    () => (inspection ? designMarkdown(inspection, sourceName) : ""),
    [inspection, sourceName]
  );

  const inspect = () => {
    const next = inspectDesignSource(html);
    setInspection(next);
  };

  return (
    <section
      className="border-t border-gray-200 px-3 py-4 dark:border-zinc-800 sm:px-4"
      aria-labelledby="design-inspector-heading"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2
            id="design-inspector-heading"
            className="flex items-center gap-2 text-sm font-semibold text-gray-950 dark:text-zinc-50"
          >
            <LuSearch className="h-4 w-4" aria-hidden="true" />
            Design inspector
          </h2>
          <p className="mt-1 text-xs leading-5 text-gray-600 dark:text-zinc-300">
            Extract repeated tokens and component patterns locally, then export
            agent-ready design documentation.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={inspect}
          className="min-h-11"
        >
          {inspection ? "Inspect again" : "Inspect design"}
        </Button>
      </div>

      {inspection && (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap gap-2" aria-label="Extracted colors">
            {inspection.colors.slice(0, 10).map((color) => (
              <div
                key={color.value}
                className="flex min-h-9 items-center gap-2 rounded-full border border-gray-200 bg-white pr-3 text-[11px] text-gray-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
                title={`${color.count} occurrences`}
              >
                <span
                  className="h-8 w-8 rounded-full border border-black/10"
                  style={{ background: color.value }}
                  aria-hidden="true"
                />
                <code>{color.value}</code>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            <div className="rounded-lg border border-gray-200 p-2 dark:border-zinc-700">
              <strong className="block text-gray-900 dark:text-zinc-100">
                {inspection.customProperties.length}
              </strong>
              CSS variables
            </div>
            <div className="rounded-lg border border-gray-200 p-2 dark:border-zinc-700">
              <strong className="block text-gray-900 dark:text-zinc-100">
                {inspection.fontFamilies.length}
              </strong>
              font families
            </div>
            <div className="rounded-lg border border-gray-200 p-2 dark:border-zinc-700">
              <strong className="block text-gray-900 dark:text-zinc-100">
                {inspection.spacing.length}
              </strong>
              spacing values
            </div>
            <div className="rounded-lg border border-gray-200 p-2 dark:border-zinc-700">
              <strong className="block text-gray-900 dark:text-zinc-100">
                {inspection.components.length}
              </strong>
              component types
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              className="min-h-11 gap-2"
              onClick={() =>
                downloadTextArtifact("DESIGN.md", designMd)
              }
            >
              <LuFileText className="h-4 w-4" aria-hidden="true" />
              DESIGN.md
            </Button>
            <Button
              type="button"
              variant="outline"
              className="min-h-11 gap-2"
              onClick={() =>
                downloadTextArtifact(
                  "SKILL.md",
                  designSkillMarkdown(inspection, sourceName)
                )
              }
            >
              <LuDownload className="h-4 w-4" aria-hidden="true" />
              SKILL.md
            </Button>
            <Button
              type="button"
              variant="outline"
              className="min-h-11 gap-2"
              onClick={() => downloadPalettePng(inspection)}
            >
              <LuPalette className="h-4 w-4" aria-hidden="true" />
              Palette PNG
            </Button>
            <Button
              type="button"
              variant="outline"
              className="min-h-11 gap-2"
              onClick={() => {
                void navigator.clipboard
                  .writeText(designMd)
                  .then(() => toast.success("Copied DESIGN.md"))
                  .catch(() => toast.error("Could not copy DESIGN.md"));
              }}
            >
              <LuClipboard className="h-4 w-4" aria-hidden="true" />
              Copy
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

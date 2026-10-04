import {
  LuAlertTriangle,
  LuClipboard,
  LuDownload,
  LuImage,
  LuSparkles,
} from "react-icons/lu";
import toast from "react-hot-toast";
import {
  downloadTextArtifact,
  websiteDesignMarkdown,
  type WebsiteDesignInspection,
} from "../../../lib/design-inspector";
import { Button } from "../../ui/button";

export default function WebsiteDesignInspectionResult({
  result,
  onUse,
}: {
  result: WebsiteDesignInspection;
  onUse: (designMd: string) => void;
}) {
  const designMd = websiteDesignMarkdown(result);
  const previews = (
    ["desktop", "tablet", "mobile"] as const
  ).map((name) => ({
    name,
    image: result.screenshots[name],
    metadata: result.screenshotMetadata[name],
  }));

  return (
    <section
      aria-labelledby="website-design-result-heading"
      className="w-full max-w-5xl rounded-xl border border-gray-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900 sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3
            id="website-design-result-heading"
            className="font-semibold text-gray-950 dark:text-zinc-50"
          >
            Website design inspection
          </h3>
          <p className="mt-1 max-w-[65ch] text-xs leading-5 text-gray-600 dark:text-zinc-300">
            Rendered tokens and semantic evidence from{" "}
            <span className="break-all font-medium">{result.url}</span>. This
            does not recover private source code or asset ownership rights.
          </p>
        </div>
        <div className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
          {result.requestCount} bounded requests
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2" aria-label="Detected colors">
        {result.inspection.colors.slice(0, 10).map((color) => (
          <div
            key={color.value}
            className="flex min-h-9 items-center gap-2 rounded-full border border-gray-200 bg-white pr-3 text-[11px] text-gray-700 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200"
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

      <dl className="mt-4 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        {[
          ["CSS variables", result.inspection.customProperties.length],
          ["Fonts", result.inspection.fontFamilies.length],
          ["Components", result.inspection.components.length],
          ["Public assets", result.assets.length],
        ].map(([label, value]) => (
          <div
            key={String(label)}
            className="rounded-lg border border-gray-200 p-3 dark:border-zinc-700"
          >
            <dt className="text-gray-500 dark:text-zinc-400">{label}</dt>
            <dd className="mt-1 text-base font-semibold text-gray-950 dark:text-zinc-50">
              {value}
            </dd>
          </div>
        ))}
      </dl>

      <section className="mt-5" aria-labelledby="website-preview-heading">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h4
              id="website-preview-heading"
              className="flex items-center gap-2 text-sm font-semibold text-gray-950 dark:text-zinc-50"
            >
              <LuImage className="h-4 w-4" aria-hidden="true" />
              Full-page responsive previews
            </h4>
            <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-zinc-400">
              Scroll each frame to inspect the captured page. Very tall pages
              are capped and labelled instead of being silently cut off.
            </p>
          </div>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          {previews.map(({ name, image, metadata }) => (
            <figure
              key={name}
              className="min-w-0 rounded-lg border border-gray-200 bg-gray-50 p-2 dark:border-zinc-700 dark:bg-zinc-950"
            >
              <div
                className="h-64 overflow-y-auto rounded-md border border-gray-200 bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:border-zinc-700"
                tabIndex={0}
                aria-label={`Scrollable ${name} full-page website preview`}
              >
                <img
                  src={image}
                  alt={`${name} website preview at ${metadata.width} by ${metadata.captureHeight} pixels`}
                  className="block h-auto w-full"
                />
              </div>
              <figcaption className="px-1 pb-1 pt-2 text-xs text-gray-600 dark:text-zinc-300">
                <span className="font-semibold capitalize text-gray-900 dark:text-zinc-100">
                  {name}
                </span>
                {" · "}
                {metadata.width}×{metadata.captureHeight}
                {metadata.truncated
                  ? ` · capped from ${metadata.documentHeight}px`
                  : " · full page"}
                {metadata.blank && (
                  <span className="mt-1 flex items-start gap-1 text-amber-700 dark:text-amber-300">
                    <LuAlertTriangle
                      className="mt-0.5 h-3.5 w-3.5 shrink-0"
                      aria-hidden="true"
                    />
                    This viewport rendered nearly blank. The site may block
                    automated browsers or delay its content.
                  </span>
                )}
              </figcaption>
            </figure>
          ))}
        </div>
      </section>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          type="button"
          className="min-h-11 gap-2"
          onClick={() => onUse(designMd)}
        >
          <LuSparkles className="h-4 w-4" aria-hidden="true" />
          Use screenshots + DESIGN.md
        </Button>
        <Button
          type="button"
          variant="outline"
          className="min-h-11 gap-2"
          onClick={() => downloadTextArtifact("DESIGN.md", designMd)}
        >
          <LuDownload className="h-4 w-4" aria-hidden="true" />
          Download DESIGN.md
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
    </section>
  );
}

import { LuExternalLink, LuImageOff } from "react-icons/lu";
import {
  VERIFY_METADATA_WARNING,
  readFreeImageItem,
  type FreeImageResultItem,
} from "../../lib/free-image-search";

export interface FreeImageResultsProps {
  /** The tool result's `images` array, read defensively. */
  items: unknown[];
  /** Candidates that could not be downloaded, with their reason. */
  rejected?: unknown[];
}

function Credit({ item }: { item: FreeImageResultItem }) {
  return (
    <div className="min-w-0 text-xs leading-5 text-gray-600 dark:text-gray-300">
      <p className="truncate font-medium text-gray-800 dark:text-gray-100">
        {item.title}
      </p>
      <p className="truncate">by {item.creator}</p>
      <p className="truncate">
        <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
          {item.licenseName}
        </span>
      </p>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
        {item.sourcePage && (
          <a
            href={item.sourcePage}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-blue-600 hover:underline dark:text-blue-400"
          >
            Source ({item.provider})
            <LuExternalLink aria-hidden="true" />
          </a>
        )}
        {item.licenseUrl && (
          <a
            href={item.licenseUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-blue-600 hover:underline dark:text-blue-400"
          >
            Licence
            <LuExternalLink aria-hidden="true" />
          </a>
        )}
      </div>
    </div>
  );
}

/**
 * Found images, with the credit a user needs to verify them.
 *
 * Laid out as a plain vertical list rather than a fixed-height scroller: a
 * nested scroll area inside the activity card clips the licence line exactly
 * when someone is trying to read it, which defeats the point of showing it.
 * The card itself already expands and collapses.
 */
export default function FreeImageResults({
  items,
  rejected = [],
}: FreeImageResultsProps) {
  const parsed = items.map(readFreeImageItem);
  const found = parsed.filter((item) => item.status === "ok");

  return (
    <div data-testid="free-image-results" className="space-y-3">
      <div className="divide-y divide-gray-100 dark:divide-gray-800">
        {parsed.map((item, index) => (
          <div key={`${item.sourcePage}-${index}`} className="flex gap-3 py-2">
            <div className="w-1/3 shrink-0">
              {item.status === "ok" && item.url ? (
                <img
                  src={item.url}
                  alt={item.title || `Free image ${index + 1}`}
                  className="w-full rounded object-cover"
                  loading="lazy"
                />
              ) : (
                <div
                  role="alert"
                  data-testid="free-image-failure"
                  className="flex aspect-square flex-col justify-center gap-1 rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300"
                >
                  <LuImageOff aria-hidden="true" />
                  <span className="font-medium">Not saved</span>
                  <span className="leading-4">
                    {item.error || "This image could not be downloaded."}
                  </span>
                </div>
              )}
            </div>
            <Credit item={item} />
          </div>
        ))}
      </div>

      {rejected.length > 0 && (
        <div
          data-testid="free-image-rejected"
          className="rounded bg-gray-50 p-2 text-xs leading-5 text-gray-600 dark:bg-gray-800 dark:text-gray-300"
        >
          {rejected.length} other result
          {rejected.length !== 1 ? "s were" : " was"} skipped because{" "}
          {rejected.length !== 1 ? "they" : "it"} could not be downloaded
          safely.
        </div>
      )}

      {found.length > 0 && (
        <p
          data-testid="free-image-verify-warning"
          className="rounded bg-amber-50 p-2 text-xs leading-5 text-amber-800 dark:bg-amber-900/20 dark:text-amber-200"
        >
          {VERIFY_METADATA_WARNING}
        </p>
      )}
    </div>
  );
}

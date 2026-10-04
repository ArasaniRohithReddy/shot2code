import { LuExternalLink, LuImageOff, LuAlertTriangle } from "react-icons/lu";
import {
  ICONIFY_METADATA_WARNING,
  ICONIFY_TRADEMARK_WARNING,
  readIconSearchItem,
  type IconSearchResultItem,
} from "../../lib/icon-search";

export interface IconSearchResultsProps {
  items: unknown[];
  rejected?: unknown[];
}

function ExternalLink({ href, children }: { href: string; children: string }) {
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 text-blue-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-blue-400"
    >
      {children}
      <LuExternalLink aria-hidden="true" />
    </a>
  );
}

function Provenance({ item }: { item: IconSearchResultItem }) {
  return (
    <div className="min-w-0 text-xs leading-5 text-gray-600 dark:text-gray-300">
      <p className="truncate font-mono font-medium text-gray-800 dark:text-gray-100">
        {item.id}
      </p>
      <p className="truncate">
        {item.collection} by {item.author}
      </p>
      <p className="truncate">
        <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
          {item.licenseSpdx}
        </span>
        {item.retrievedAt ? ` · retrieved ${item.retrievedAt}` : ""}
      </p>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
        <ExternalLink href={item.sourceUrl}>SVG source</ExternalLink>
        <ExternalLink href={item.licenseUrl}>Licence</ExternalLink>
        <ExternalLink href={item.authorUrl}>Author</ExternalLink>
      </div>
      {item.brandOrTrademark && (
        <p
          data-testid="icon-brand-warning"
          className="mt-1.5 flex items-start gap-1 text-amber-700 dark:text-amber-300"
        >
          <LuAlertTriangle aria-hidden="true" className="mt-0.5 shrink-0" />
          Brand/trademark icon — verify the owner&apos;s usage rules.
        </p>
      )}
    </div>
  );
}

export default function IconSearchResults({
  items,
  rejected = [],
}: IconSearchResultsProps) {
  const parsed = items.map(readIconSearchItem);
  const found = parsed.filter((item) => item.status === "ok");

  return (
    <div data-testid="icon-search-results" className="space-y-3">
      <div className="divide-y divide-gray-100 dark:divide-gray-800">
        {parsed.map((item, index) => (
          <div key={`${item.id}-${index}`} className="flex gap-3 py-2">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-md border border-gray-200 bg-white p-2 dark:border-zinc-700">
              {item.status === "ok" && item.url ? (
                <img
                  src={item.url}
                  alt={`${item.icon} icon from ${item.collection}`}
                  className="h-10 w-10 object-contain"
                  loading="lazy"
                />
              ) : (
                <div
                  role="alert"
                  data-testid="icon-save-failure"
                  className="flex flex-col items-center gap-1 text-center text-[10px] leading-3 text-red-700"
                >
                  <LuImageOff aria-hidden="true" />
                  <span>{item.error || "Icon not saved"}</span>
                </div>
              )}
            </div>
            <Provenance item={item} />
          </div>
        ))}
      </div>

      {rejected.length > 0 && (
        <p
          data-testid="icon-search-rejected"
          className="rounded bg-gray-50 p-2 text-xs leading-5 text-gray-600 dark:bg-gray-800 dark:text-gray-300"
        >
          {rejected.length} other Iconify candidate
          {rejected.length === 1 ? " was" : "s were"} skipped because it could
          not be licensed, downloaded or sanitized safely.
        </p>
      )}

      {found.length > 0 && (
        <div className="space-y-1 rounded bg-amber-50 p-2 text-xs leading-5 text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
          <p data-testid="icon-metadata-warning">{ICONIFY_METADATA_WARNING}</p>
          <p data-testid="icon-trademark-warning">{ICONIFY_TRADEMARK_WARNING}</p>
        </div>
      )}
    </div>
  );
}

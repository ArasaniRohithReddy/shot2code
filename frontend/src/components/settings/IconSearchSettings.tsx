import { useId } from "react";
import { LuExternalLink, LuInfo, LuShieldCheck } from "react-icons/lu";
import { Switch } from "../ui/switch";
import {
  ICONIFY_ACCESS_NOTE,
  ICONIFY_DOCS_URL,
  ICONIFY_EGRESS_NOTICE,
  ICONIFY_ICON_SETS_URL,
  ICONIFY_METADATA_WARNING,
  ICONIFY_TRADEMARK_WARNING,
  MAX_ICONS,
  MAX_SEARCHES_PER_GENERATION,
  MAX_SEARCHES_PER_TURN,
  PERMISSIVE_LICENSES,
  type IconSearchSettings as IconSearchSettingsValue,
} from "../../lib/icon-search";

export interface IconSearchSettingsProps {
  settings: IconSearchSettingsValue;
  onChange: (
    update: (current: IconSearchSettingsValue) => IconSearchSettingsValue
  ) => void;
}

const HELP_CLASS = "mt-1 text-xs leading-5 text-gray-500 dark:text-zinc-400";
const LABEL_CLASS = "text-sm font-medium text-gray-700 dark:text-zinc-300";

export default function IconSearchSettings({
  settings,
  onChange,
}: IconSearchSettingsProps) {
  const enabledId = useId();

  return (
    <div
      data-testid="icon-search-settings"
      className="rounded-lg border border-gray-200 bg-white dark:border-zinc-700 dark:bg-zinc-800/60"
    >
      <div className="border-b border-gray-100 px-4 py-3 dark:border-zinc-700">
        <h2 className="text-sm font-medium text-gray-900 dark:text-white">
          Iconify design add-on
        </h2>
      </div>

      <div className="space-y-4 p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <label htmlFor={enabledId} className={LABEL_CLASS}>
              Find and localize SVG icons
            </label>
            <p className={HELP_CLASS}>
              Adds a <code className="font-mono">search_icons</code> tool for
              every model runtime. It searches Iconify&apos;s official public API,
              sanitizes selected SVGs and stores local project assets. It does
              not hotlink icons and does not add @iconify/react. Off by default.
            </p>
            <p className={HELP_CLASS} data-testid="iconify-access-note">
              {ICONIFY_ACCESS_NOTE}
            </p>
          </div>
          <Switch
            id={enabledId}
            checked={settings.enabled}
            onCheckedChange={(checked) =>
              onChange((current) => ({ ...current, enabled: checked }))
            }
            aria-label="Find and localize Iconify SVG icons"
          />
        </div>

        <div
          data-testid="iconify-egress"
          className="flex items-start gap-2.5 rounded-md border border-blue-200 bg-blue-50 p-3 dark:border-blue-900/50 dark:bg-blue-900/20"
        >
          <LuInfo aria-hidden="true" className="mt-0.5 shrink-0 text-blue-500" />
          <div className="min-w-0 text-xs leading-5 text-blue-900 dark:text-blue-200">
            <p>{ICONIFY_EGRESS_NOTICE}</p>
            <p className="mt-1.5">
              Requests cannot use a custom host or follow a redirect. Downloaded
              SVGs have scripts, event handlers, foreignObject, animation,
              external href/url references and other active content removed
              before they enter <code className="font-mono">/local-assets/</code>.
            </p>
          </div>
        </div>

        <div data-testid="iconify-licensing">
          <div className="flex items-center gap-2">
            <LuShieldCheck aria-hidden="true" className="text-emerald-600" />
            <p className={LABEL_CLASS}>Conservative automatic-use policy</p>
          </div>
          <p className={HELP_CLASS}>
            Only collections whose metadata names one of these permissive SPDX
            licences are eligible: {PERMISSIVE_LICENSES.join(", ")}.
            Copyleft, share-alike, attribution-only, non-commercial and unknown
            sets are skipped rather than imported silently.
          </p>
          <p className={HELP_CLASS}>
            Each saved SVG embeds its icon id, collection, author, source URL,
            licence name/SPDX/URL and retrieval date so the notice stays with
            the localized asset.
          </p>
        </div>

        <div
          data-testid="iconify-metadata-warning"
          className="flex items-start gap-2.5 rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-700/60 dark:bg-amber-900/20"
        >
          <LuInfo aria-hidden="true" className="mt-0.5 shrink-0 text-amber-500" />
          <div className="min-w-0 space-y-1 text-xs leading-5 text-amber-800 dark:text-amber-200">
            <p>{ICONIFY_METADATA_WARNING}</p>
            <p data-testid="iconify-trademark-warning">
              {ICONIFY_TRADEMARK_WARNING}
            </p>
          </div>
        </div>

        <p className={HELP_CLASS}>
          At most {MAX_ICONS} icons per search, {MAX_SEARCHES_PER_TURN} searches
          per turn and {MAX_SEARCHES_PER_GENERATION} per generation. Icon search
          is separate from generated images and public-domain photo search.
        </p>

        <div className="flex flex-wrap gap-3">
          <a
            href={ICONIFY_DOCS_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-blue-400"
          >
            Iconify API documentation
            <LuExternalLink aria-hidden="true" />
          </a>
          <a
            href={ICONIFY_ICON_SETS_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-blue-400"
          >
            Browse icon sets
            <LuExternalLink aria-hidden="true" />
          </a>
        </div>
      </div>
    </div>
  );
}
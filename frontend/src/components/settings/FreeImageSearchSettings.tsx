import { useId } from "react";
import { LuExternalLink, LuInfo } from "react-icons/lu";
import { Switch } from "../ui/switch";
import {
  ALLOWED_LICENSES,
  EGRESS_NOTICE,
  MAX_IMAGES,
  MAX_SEARCHES_PER_GENERATION,
  MAX_SEARCHES_PER_TURN,
  OPENVERSE_ACCESS_NOTE,
  OPENVERSE_API_DOCS_URL,
  OPENVERSE_HOME_URL,
  OPENVERSE_TERMS_URL,
  VERIFY_METADATA_WARNING,
  licenseLabel,
  type FreeImageSearchSettings,
} from "../../lib/free-image-search";

export interface FreeImageSearchSettingsProps {
  settings: FreeImageSearchSettings;
  onChange: (
    update: (current: FreeImageSearchSettings) => FreeImageSearchSettings
  ) => void;
  /**
   * Whether any paid image provider is configured.
   *
   * Used only for the sentence explaining how the two relate. This feature is
   * additive either way: it is never switched off by a paid provider, and it
   * never replaces one.
   */
  hasPaidImageProvider: boolean;
}

const HELP_CLASS = "mt-1 text-xs leading-5 text-gray-500 dark:text-zinc-400";
const LABEL_CLASS = "text-sm font-medium text-gray-700 dark:text-zinc-300";

export default function FreeImageSearchSettings({
  settings,
  onChange,
  hasPaidImageProvider,
}: FreeImageSearchSettingsProps) {
  const enabledId = useId();

  return (
    <div
      data-testid="free-image-search-settings"
      className="rounded-lg border border-gray-200 bg-white dark:border-zinc-700 dark:bg-zinc-800/60"
    >
      <div className="border-b border-gray-100 px-4 py-3 dark:border-zinc-700">
        <h2 className="text-sm font-medium text-gray-900 dark:text-white">
          Free image search
        </h2>
      </div>

      <div className="space-y-4 p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <label htmlFor={enabledId} className={LABEL_CLASS}>
              Find free public-domain photos
            </label>
            <p className={HELP_CLASS}>
              Adds a <code className="font-mono">search_free_images</code> tool
              so a model can find real photographs and illustrations for a
              design instead of only generating them.{" "}
              <strong className="font-medium text-gray-700 dark:text-zinc-300">
                shot2code sends no API key and no credential
              </strong>{" "}
              — it uses Openverse's public search, so it works even with no
              image-generation provider configured. Off by default.
            </p>
            <p className={HELP_CLASS} data-testid="free-image-access-note">
              {OPENVERSE_ACCESS_NOTE}
            </p>
          </div>
          <Switch
            id={enabledId}
            checked={settings.enabled}
            onCheckedChange={(checked) =>
              onChange((current) => ({ ...current, enabled: checked }))
            }
            aria-label="Find free public-domain photos"
          />
        </div>

        {/* Egress is the irreversible part, so it is stated up front and never
            hidden behind a disclosure triangle. */}
        <div
          data-testid="free-image-egress"
          className="flex items-start gap-2.5 rounded-md border border-blue-200 bg-blue-50 p-3 dark:border-blue-900/50 dark:bg-blue-900/20"
        >
          <LuInfo aria-hidden="true" className="mt-0.5 shrink-0 text-blue-500" />
          <div className="min-w-0 text-xs leading-5 text-blue-900 dark:text-blue-200">
            <p>{EGRESS_NOTICE}</p>
            <p className="mt-1.5">
              Images you keep are downloaded and served from this machine, so a
              generated or exported project never links to somebody else's
              server.
            </p>
          </div>
        </div>

        <div data-testid="free-image-licensing">
          <p className={LABEL_CLASS}>What you get back</p>
          <p className={HELP_CLASS}>
            Results are restricted to{" "}
            <strong className="font-medium text-gray-700 dark:text-zinc-300">
              {ALLOWED_LICENSES.map(licenseLabel).join(" and ")}
            </strong>
            . Those carry no attribution, share-alike or non-commercial
            obligation, so an exported project does not quietly inherit terms
            you would have to honour. Other Creative Commons licences are
            excluded for that reason.
          </p>
          <p className={HELP_CLASS}>
            Each image still arrives with its title, creator, source page,
            provider and licence, so you can credit it if you want to.
          </p>
        </div>

        <div
          data-testid="free-image-verify-warning"
          className="flex items-start gap-2.5 rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-700/60 dark:bg-amber-900/20"
        >
          <LuInfo aria-hidden="true" className="mt-0.5 shrink-0 text-amber-500" />
          <p className="min-w-0 text-xs leading-5 text-amber-800 dark:text-amber-200">
            {VERIFY_METADATA_WARNING}
          </p>
        </div>

        <p className={HELP_CLASS}>
          {hasPaidImageProvider
            ? "This runs alongside your image-generation provider, not instead of it: the model picks whichever fits — a real photograph or an invented one — and the activity feed says which it used."
            : "No image-generation provider is configured, so this is the only way a model can put real imagery into a design. Generating images stays available if you add a provider later."}{" "}
          At most {MAX_IMAGES} images per search,{" "}
          {MAX_SEARCHES_PER_TURN} searches per turn and{" "}
          {MAX_SEARCHES_PER_GENERATION} per generation.
        </p>

        <div className="flex flex-wrap gap-3">
          <a
            href={OPENVERSE_HOME_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline dark:text-blue-400"
          >
            About Openverse
            <LuExternalLink aria-hidden="true" />
          </a>
          <a
            href={OPENVERSE_TERMS_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline dark:text-blue-400"
          >
            Openverse terms
            <LuExternalLink aria-hidden="true" />
          </a>
          <a
            href={OPENVERSE_API_DOCS_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline dark:text-blue-400"
          >
            API documentation
            <LuExternalLink aria-hidden="true" />
          </a>
        </div>
      </div>
    </div>
  );
}

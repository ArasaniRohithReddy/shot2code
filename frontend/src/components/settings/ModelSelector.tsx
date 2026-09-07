import { useEffect, useState } from "react";
import { LuBrain, LuCheck } from "react-icons/lu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../ui/popover";
import { HTTP_BACKEND_URL } from "../../config";

export interface ModelSelectorProps {
  selectedModels: string[];
  setSelectedModels: (models: string[]) => void;
}

interface CopilotModel {
  id: string;
  vision: boolean;
}

/**
 * Compact Copilot model picker for the update toolbar, so the models can be
 * changed while iterating instead of only from Settings.
 */
function ModelSelector({ selectedModels, setSelectedModels }: ModelSelectorProps) {
  const [models, setModels] = useState<CopilotModel[]>([]);
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`${HTTP_BACKEND_URL}/api/capabilities`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setAvailable(Boolean(data.copilot));
        setModels(Array.isArray(data.copilot_models) ? data.copilot_models : []);
      })
      .catch(() => {
        /* leave hidden when the backend can't be reached */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const visionModels = models.filter((m) => m.vision);
  if (!available || visionModels.length === 0) return null;

  const selected = selectedModels ?? [];
  const toggle = (value: string) =>
    setSelectedModels(
      selected.includes(value)
        ? selected.filter((v) => v !== value)
        : [...selected, value]
    );

  const label =
    selected.length === 0
      ? "Auto"
      : selected.length === 1
        ? selected[0].replace("copilot/", "")
        : `${selected.length} models`;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          title="Choose which Copilot models generate each variant"
          className="flex items-center gap-1.5 rounded-lg px-2 py-2 text-xs text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
        >
          <LuBrain className="w-[18px] h-[18px]" />
          <span className="max-w-[110px] truncate notranslate" translate="no">
            {label}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-2">
        <p className="px-2 pb-2 text-xs text-gray-500 dark:text-zinc-400">
          One variant per selected model. None selected means shot2code picks.
        </p>
        <div className="max-h-64 overflow-y-auto">
          {visionModels.map((m) => {
            const value = `copilot/${m.id}`;
            const checked = selected.includes(value);
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => toggle(value)}
                className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm hover:bg-gray-100 dark:hover:bg-zinc-800"
              >
                <span className="notranslate truncate" translate="no">
                  {m.id}
                </span>
                {checked && (
                  <LuCheck className="w-4 h-4 shrink-0 text-violet-600 dark:text-violet-400" />
                )}
              </button>
            );
          })}
        </div>
        {selected.length > 0 && (
          <button
            type="button"
            onClick={() => setSelectedModels([])}
            className="mt-1 w-full rounded px-2 py-1.5 text-left text-xs text-violet-600 hover:bg-gray-100 dark:text-violet-400 dark:hover:bg-zinc-800"
          >
            Reset to automatic
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}

export default ModelSelector;

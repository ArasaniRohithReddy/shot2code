import { useState, useRef, useEffect } from "react";
import { LuLoader2 } from "react-icons/lu";
import { Button } from "../../ui/button";
import { Textarea } from "../../ui/textarea";
import toast from "react-hot-toast";
import OutputSettingsSection from "../../settings/OutputSettingsSection";
import { DesignSystemSelectorProps } from "../../settings/DesignSystemSelector";
import ModelSelector, {
  ModelSelectorProps,
} from "../../settings/ModelSelector";
import { Stack } from "../../../lib/stacks";
import StitchGenerationStatus from "./StitchGenerationStatus";
import {
  formatStitchElapsed,
  type StitchUiPhase,
} from "./stitch-generation-status";

interface Props {
  doCreate: (
    images: string[],
    inputMode: "image" | "video",
    textPrompt?: string,
    isAssetExtractionEnabled?: boolean
  ) => void;
  doCreateFromText: (text: string) => void;
  importFromCode: (
    code: string,
    stack: Stack,
    instruction?: string,
    titleHint?: string
  ) => void;
  stitchApiKey: string | null;
  stack: Stack;
  setStack: (stack: Stack) => void;
  designSystem: DesignSystemSelectorProps;
  modelSelector?: ModelSelectorProps;
  stitchOnly?: boolean;
}

const EXAMPLE_PROMPTS = [
  "An ecommerce homepage for eco-friendly skincare with product grid, reviews, and newsletter signup",
  "A portfolio site for a product designer with case studies, process steps, and contact",
  "A mobile fitness app dashboard with workout plan, progress ring, and quick-start buttons",
  "A music streaming app with now-playing, recommended playlists, and recent listens",
];

function TextTab({
  doCreate,
  doCreateFromText,
  importFromCode,
  stitchApiKey,
  stack,
  setStack,
  designSystem,
  modelSelector,
  stitchOnly = false,
}: Props) {
  const [text, setText] = useState("");
  const [isGeneratingWithStitch, setIsGeneratingWithStitch] = useState(false);
  const [stitchProgress, setStitchProgress] = useState<{
    phase: StitchUiPhase;
    message: string;
  } | null>(null);
  const [stitchStartedAt, setStitchStartedAt] = useState<number | null>(null);
  const [stitchElapsedSeconds, setStitchElapsedSeconds] = useState(0);
  const [stitchError, setStitchError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!isGeneratingWithStitch || stitchStartedAt === null) return;
    const updateElapsed = () =>
      setStitchElapsedSeconds(
        Math.max(0, Math.floor((Date.now() - stitchStartedAt) / 1000))
      );
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 1000);
    return () => window.clearInterval(timer);
  }, [isGeneratingWithStitch, stitchStartedAt]);

  const handleGenerate = () => {
    if (text.trim() === "") {
      toast.error("Please enter a description");
      return;
    }
    doCreateFromText(text);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleGenerate();
    }
  };

  const handleExampleClick = (example: string) => {
    setText(example);
    textareaRef.current?.focus();
  };

  const handleStitchGenerate = async () => {
    if (!text.trim()) {
      toast.error("Please enter a description");
      return;
    }
    const desktop = window.__SHOT2CODE_APP__;
    if (!desktop?.generateStitch || !stitchApiKey?.trim()) {
      toast.error("Add a Stitch API key in Settings in the desktop app.");
      return;
    }
    const startedAt = Date.now();
    setIsGeneratingWithStitch(true);
    setStitchStartedAt(startedAt);
    setStitchElapsedSeconds(0);
    setStitchError(null);
    setStitchProgress({
      phase: "connecting",
      message: "Connecting to Google Stitch…",
    });
    try {
      const result = await desktop.generateStitch(
        {
          apiKey: stitchApiKey,
          prompt: text.trim(),
          deviceType: "DESKTOP",
          stack,
        },
        (progress) =>
          setStitchProgress({
            phase: progress.phase,
            message: progress.message,
          })
      );
      setStitchProgress({
        phase: "importing-code",
        message:
          stack === Stack.HTML_CSS
            ? "Opening the generated files in shot2code…"
            : "Applying the selected stack with your chosen models…",
      });
      if (stack === Stack.HTML_CSS) {
        importFromCode(result.html, Stack.HTML_CSS, "", text.trim());
        toast.success("Stitch screen generated and imported.");
      } else {
        const stackLabel = stack.replace(/_/g, " ");
        doCreate(
          [result.image],
          "image",
          `Recreate this Google Stitch design in the selected ${stackLabel} stack. Preserve the layout, content, visual hierarchy, spacing, colors, and responsive behavior from the supplied Stitch preview.`,
          false
        );
        toast.success(
          "Stitch design generated. shot2code is now applying the selected stack."
        );
      }
    } catch (caught) {
      const message =
        caught instanceof Error
          ? caught.message
          : "Stitch could not generate the screen.";
      setStitchError(message);
      toast.error(message);
    } finally {
      setIsGeneratingWithStitch(false);
    }
  };

  return (
    <div className="flex flex-col items-center gap-6">
      <div className="w-full max-w-lg">
        <div className="flex flex-col gap-6 p-8 border border-gray-200 dark:border-zinc-700 rounded-xl bg-gray-50/50 dark:bg-zinc-900/50">
          <div className="flex flex-col items-center gap-3">
            <div className="w-16 h-16 rounded-full bg-gray-100 dark:bg-zinc-800 flex items-center justify-center">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="28"
                height="28"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-gray-400 dark:text-zinc-500"
              >
                <path d="M17 6.1H3" />
                <path d="M21 12.1H3" />
                <path d="M15.1 18H3" />
              </svg>
            </div>

            <div className="text-center">
              <h3 className="text-gray-700 dark:text-zinc-200 font-medium">
                {stitchOnly ? "Generate with Google Stitch" : "Generate from Text"}
              </h3>
              {stitchOnly && (
                <p className="mt-1 max-w-md text-xs leading-5 text-gray-500 dark:text-zinc-400">
                  Stitch creates the visual design first. shot2code then applies
                  the selected stack and model choices when conversion is needed.
                </p>
              )}
            </div>
          </div>

          <div className="space-y-4">
            <Textarea
              ref={textareaRef}
              rows={4}
              placeholder={
                stitchOnly
                  ? "Describe the screen you want Stitch to design..."
                  : "Describe the UI you want to create..."
              }
              className="w-full resize-none"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isGeneratingWithStitch}
              data-testid="text-input"
            />

            {!stitchOnly && (
              <div className="flex flex-col gap-2">
                <p className="text-xs text-gray-500 dark:text-zinc-400">
                  Try an example:
                </p>
                <div className="flex flex-wrap gap-2">
                  {EXAMPLE_PROMPTS.map((example, index) => (
                    <button
                      key={index}
                      onClick={() => handleExampleClick(example)}
                      disabled={isGeneratingWithStitch}
                      className="max-w-[200px] truncate rounded-full bg-gray-100 px-2.5 py-1.5 text-xs text-gray-600 transition-colors hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                      title={example}
                    >
                      {example.length > 30
                        ? example.slice(0, 30) + "..."
                        : example}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <OutputSettingsSection
              stack={stack}
              setStack={setStack}
              designSystem={designSystem}
            />
            {modelSelector && <ModelSelector {...modelSelector} />}

            {!stitchOnly && (
              <Button
                onClick={handleGenerate}
                disabled={isGeneratingWithStitch}
                className="w-full"
                size="lg"
                data-testid="text-generate"
              >
                Generate
              </Button>
            )}

            {window.__SHOT2CODE_APP__?.generateStitch && (
              <div className="space-y-1.5">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void handleStitchGenerate()}
                  disabled={isGeneratingWithStitch || !stitchApiKey?.trim()}
                  className="w-full"
                  size="lg"
                  data-testid="stitch-generate"
                >
                  {isGeneratingWithStitch ? (
                    <>
                      <LuLoader2
                        className="h-4 w-4 motion-safe:animate-spin"
                        aria-hidden="true"
                      />
                      Stitch is working…
                    </>
                  ) : (
                    "Generate with Google Stitch SDK"
                  )}
                </Button>
                <p className="text-center text-[11px] leading-4 text-gray-500 dark:text-zinc-400">
                  Stitch creates the visual design first. HTML + CSS opens
                  directly; other stacks continue through your selected
                  shot2code models, so provider quota may apply.
                </p>
              </div>
            )}

            {isGeneratingWithStitch && stitchProgress && (
              <StitchGenerationStatus
                phase={stitchProgress.phase}
                message={stitchProgress.message}
                elapsedSeconds={stitchElapsedSeconds}
              />
            )}

            {stitchError && !isGeneratingWithStitch && (
              <div
                role="alert"
                data-testid="stitch-generation-error"
                className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs leading-5 text-red-700 dark:border-red-900/70 dark:bg-red-950/30 dark:text-red-200"
              >
                <p className="font-medium">Stitch generation stopped.</p>
                <p className="mt-1">{stitchError}</p>
                <p className="mt-1 text-red-600 dark:text-red-300">
                  Elapsed time: {formatStitchElapsed(stitchElapsedSeconds)}. You can
                  adjust the prompt or key and try again.
                </p>
              </div>
            )}

            <p className="text-xs text-gray-400 dark:text-zinc-500 text-center">
              Press Cmd/Ctrl + Enter to generate
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default TextTab;

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
  doCreateFromText: (text: string) => void;
  importFromCode: (code: string, stack: Stack, instruction?: string) => void;
  stitchApiKey: string | null;
  stack: Stack;
  setStack: (stack: Stack) => void;
  designSystem: DesignSystemSelectorProps;
  modelSelector?: ModelSelectorProps;
}

const EXAMPLE_PROMPTS = [
  "An ecommerce homepage for eco-friendly skincare with product grid, reviews, and newsletter signup",
  "A portfolio site for a product designer with case studies, process steps, and contact",
  "A mobile fitness app dashboard with workout plan, progress ring, and quick-start buttons",
  "A music streaming app with now-playing, recommended playlists, and recent listens",
];

function TextTab({
  doCreateFromText,
  importFromCode,
  stitchApiKey,
  stack,
  setStack,
  designSystem,
  modelSelector,
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
        },
        (progress) =>
          setStitchProgress({
            phase: progress.phase,
            message: progress.message,
          })
      );
      setStitchProgress({
        phase: "importing-code",
        message: "Opening the generated files in shot2code…",
      });
      importFromCode(result.html, Stack.HTML_CSS);
      toast.success("Stitch screen generated and imported.");
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
              <h3 className="text-gray-700 dark:text-zinc-200 font-medium">Generate from Text</h3>
            </div>
          </div>

          <div className="space-y-4">
            <Textarea
              ref={textareaRef}
              rows={4}
              placeholder="Describe the UI you want to create..."
              className="w-full resize-none"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isGeneratingWithStitch}
              data-testid="text-input"
            />

            <div className="flex flex-col gap-2">
              <p className="text-xs text-gray-500 dark:text-zinc-400">Try an example:</p>
              <div className="flex flex-wrap gap-2">
                {EXAMPLE_PROMPTS.map((example, index) => (
                  <button
                    key={index}
                    onClick={() => handleExampleClick(example)}
                    disabled={isGeneratingWithStitch}
                    className="text-xs px-2.5 py-1.5 rounded-full bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-zinc-300 hover:bg-gray-200 dark:hover:bg-zinc-700 transition-colors truncate max-w-[200px]"
                    title={example}
                  >
                    {example.length > 30 ? example.slice(0, 30) + "..." : example}
                  </button>
                ))}
              </div>
            </div>

            <OutputSettingsSection
              stack={stack}
              setStack={setStack}
              designSystem={designSystem}
            />
            {modelSelector && <ModelSelector {...modelSelector} />}

            <Button
              onClick={handleGenerate}
              disabled={isGeneratingWithStitch}
              className="w-full"
              size="lg"
              data-testid="text-generate"
            >
              Generate
            </Button>

            {window.__SHOT2CODE_APP__?.generateStitch && (
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

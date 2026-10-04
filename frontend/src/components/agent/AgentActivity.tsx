import {
  useEffect,
  useRef,
  useState,
  type ComponentType,
} from "react";
import { useProjectStore } from "../../store/project-store";
import { useAppStore } from "../../store/app-store";
import { AppState } from "../../types";
import {
  AgentEvent,
  AgentEventType,
} from "../commits/types";
import {
  BsChatDots,
  BsChevronDown,
  BsChevronRight,
  BsLightbulb,
  BsFileEarmarkPlus,
  BsPencilSquare,
  BsImage,
  BsImages,
  BsScissors,
  BsFiles,
  BsBookmarkCheck,
  BsBoundingBox,
  BsBook,
  BsCamera,
  BsPlug,
  BsSearch,
} from "react-icons/bs";
import { parseMcpToolName } from "../../lib/integrations";
import ReactMarkdown from "react-markdown";
import {
  Light as SyntaxHighlighterBase,
  type SyntaxHighlighterProps,
} from "react-syntax-highlighter";
import html from "react-syntax-highlighter/dist/esm/languages/hljs/xml";
import { vs2015 } from "react-syntax-highlighter/dist/esm/styles/hljs";
import WorkingPulse from "../core/WorkingPulse";
import ImageFailureTile from "./ImageFailureTile";
import FreeImageResults from "./FreeImageResults";
import IconSearchResults from "./IconSearchResults";
import { imageEventTitle, readImageItem } from "./image-results";
import {
  READ_WEB_PAGE_TOOL_NAME,
  WEB_SEARCH_TOOL_NAME,
} from "../../lib/web-search";
import { FREE_IMAGE_SEARCH_TOOL_NAME } from "../../lib/free-image-search";
import {
  ICON_SEARCH_TOOL_NAME,
  iconEventTitle,
} from "../../lib/icon-search";
import { groupCompletedAgentEvents } from "./activity-order";
import {
  formatDurationBetween,
  isTerminalVariantStatus,
} from "./generation-time";

SyntaxHighlighterBase.registerLanguage("html", html);
const SyntaxHighlighter =
  SyntaxHighlighterBase as unknown as ComponentType<SyntaxHighlighterProps>;

function ExpandablePrompt({ prompt }: { prompt: string }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isClamped, setIsClamped] = useState(false);
  const promptRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    setIsExpanded(false);
  }, [prompt]);

  useEffect(() => {
    const element = promptRef.current;
    if (!element) return;

    const updateClampedState = () => {
      setIsClamped(element.scrollHeight > element.clientHeight + 1);
    };

    updateClampedState();
    if (typeof ResizeObserver === "undefined") return;

    const resizeObserver = new ResizeObserver(updateClampedState);
    resizeObserver.observe(element);
    return () => resizeObserver.disconnect();
  }, [prompt, isExpanded]);

  return (
    <div>
      <p
        ref={promptRef}
        className={`whitespace-pre-wrap break-words text-xs text-gray-600 dark:text-gray-300 ${
          !isExpanded ? "line-clamp-4" : ""
        }`}
      >
        {prompt}
      </p>
      {(isClamped || isExpanded) && (
        <div className="mt-1 flex justify-end">
          <button
            type="button"
            onClick={() => setIsExpanded((previous) => !previous)}
            aria-expanded={isExpanded}
            className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600 transition-colors hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            {isExpanded ? "Less" : "More"}
          </button>
        </div>
      )}
    </div>
  );
}

function CodePreviewBlock({ code, isGenerating }: { code: string; isGenerating: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isGenerating && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [code, isGenerating]);

  return (
    <div ref={containerRef} className="max-h-60 overflow-auto rounded-md">
      <SyntaxHighlighter
        language="html"
        style={vs2015}
        customStyle={{ margin: 0, padding: "0.5rem", fontSize: "0.75rem", borderRadius: "0.375rem" }}
        wrapLongLines
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
}

function formatDuration(startedAt?: number, endedAt?: number): string {
  return formatDurationBetween(startedAt, endedAt);
}

function formatElapsedSince(timestampMs: number | undefined, nowMs: number): string {
  return formatDurationBetween(timestampMs, nowMs);
}

function getArrayField(value: unknown, field: string): unknown[] | null {
  if (!value || typeof value !== "object") return null;
  const fieldValue = (value as Record<string, unknown>)[field];
  return Array.isArray(fieldValue) ? fieldValue : null;
}

function getStringField(value: unknown, field: string): string | null {
  const record = getRecord(value);
  const fieldValue = record?.[field];
  return typeof fieldValue === "string" ? fieldValue : null;
}

function getNumberField(value: unknown, field: string): number | null {
  const record = getRecord(value);
  const fieldValue = record?.[field];
  return typeof fieldValue === "number" ? fieldValue : null;
}

function getStringArrayField(value: unknown, field: string): string[] | null {
  const values = getArrayField(value, field);
  if (!values) return null;
  const strings = values.filter(
    (item): item is string => typeof item === "string"
  );
  return strings.length === values.length ? strings : null;
}

function getRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function getExtractedAssetPreviewUrl(asset: unknown): string | null {
  const assetRecord = getRecord(asset);
  if (!assetRecord) return null;
  if (typeof assetRecord.public_url === "string" && assetRecord.public_url) {
    return assetRecord.public_url;
  }
  if (typeof assetRecord.data_url === "string" && assetRecord.data_url) {
    return assetRecord.data_url;
  }
  return null;
}

function isSuccessfulExtractedAsset(asset: unknown): boolean {
  const assetRecord = getRecord(asset);
  if (!assetRecord) return false;
  const status =
    typeof assetRecord.status === "string" ? assetRecord.status : null;
  return Boolean(
    getExtractedAssetPreviewUrl(asset) &&
      status !== "missing" &&
      status !== "error"
  );
}

function getEventIcon(type: AgentEventType, toolName?: string) {
  if (type === "thinking") {
    return <BsLightbulb className="text-yellow-500" />;
  }
  if (type === "assistant") {
    return <BsChatDots className="text-blue-500" />;
  }
  if (toolName === "create_file") {
    return <BsFileEarmarkPlus className="text-indigo-500" />;
  }
  if (toolName === "edit_file") {
    return <BsPencilSquare className="text-purple-500" />;
  }
  if (toolName === FREE_IMAGE_SEARCH_TOOL_NAME) {
    // A distinct icon from generate_images: found, not invented.
    return <BsImages className="text-emerald-500" />;
  }
  if (toolName === ICON_SEARCH_TOOL_NAME) {
    return <BsBoundingBox className="text-indigo-500" />;
  }
  if (toolName === "generate_images") {
    return <BsImage className="text-pink-500" />;
  }
  if (toolName === "remove_backgrounds") {
    return <BsScissors className="text-teal-500" />;
  }
  if (toolName === "edit_images") {
    return <BsImage className="text-violet-500" />;
  }
  if (toolName === "retrieve_option") {
    return <BsFiles className="text-slate-500" />;
  }
  if (toolName === "save_assets") {
    return <BsBookmarkCheck className="text-emerald-500" />;
  }
  if (toolName === "extract_assets") {
    return <BsBoundingBox className="text-orange-500" />;
  }
  if (toolName === "screenshot_preview") {
    return <BsCamera className="text-cyan-500" />;
  }
  if (toolName === WEB_SEARCH_TOOL_NAME) {
    return <BsSearch className="text-blue-500" />;
  }
  if (toolName === READ_WEB_PAGE_TOOL_NAME) {
    return <BsBook className="text-cyan-600" />;
  }
  // An MCP tool is named `MCP · <server> · <tool>` by the backend, so it is
  // recognised by shape rather than by a list this build would have to know.
  if (parseMcpToolName(toolName)) {
    return <BsPlug className="text-sky-500" />;
  }
  return <BsFileEarmarkPlus className="text-gray-500" />;
}

function getEventTitle(event: AgentEvent): string {
  if (event.type === "thinking") {
    if (event.status === "running") return "Thinking";
    const duration = formatDuration(event.startedAt, event.endedAt);
    return duration ? `Thought for ${duration}` : "Thought";
  }
  if (event.type === "assistant") {
    return "Assistant response";
  }
  if (event.type === "tool") {
    if (event.toolName === "create_file") {
      return event.status === "running" ? "Creating file" : "Created file";
    }
    if (event.toolName === "edit_file") {
      return event.status === "running" ? "Editing file" : "Edited file";
    }
    const iconTitle = iconEventTitle(event);
    if (iconTitle) return iconTitle;
    // Image tools count successes, not tiles: a batch where every prompt
    // failed must not read as a batch that produced images.
    const imageTitle = imageEventTitle(event);
    if (imageTitle) return imageTitle;
    if (event.toolName === "retrieve_option") {
      return event.status === "running"
        ? "Retrieving option"
        : "Retrieved option";
    }
    if (event.toolName === "save_assets") {
      const saveCount =
        getArrayField(event.output, "images")?.length ||
        getArrayField(event.input, "asset_ids")?.length ||
        0;
      if (event.status === "running") {
        return saveCount > 1 ? `Saving ${saveCount} assets` : "Saving asset";
      }
      return saveCount > 1 ? `Saved ${saveCount} assets` : "Saved asset";
    }
    if (event.toolName === "extract_assets") {
      const extractInputDescriptions = getArrayField(event.input, "asset_descriptions");
      const extractOutputAssets = getArrayField(event.output, "assets");
      const requestedCount = extractInputDescriptions?.length || 0;
      const successfulCount =
        extractOutputAssets?.filter(isSuccessfulExtractedAsset).length || 0;
      const extractCount =
        extractOutputAssets?.length || extractInputDescriptions?.length || 0;
      if (event.status === "running") {
        return extractCount > 1
          ? `Extracting ${extractCount} assets`
          : "Extracting asset";
      }
      if (
        extractOutputAssets &&
        requestedCount > 0 &&
        successfulCount < requestedCount
      ) {
        return successfulCount > 0
          ? `Extracted ${successfulCount} of ${requestedCount} assets`
          : "Could not extract assets";
      }
      return extractCount > 1
        ? `Extracted ${extractCount} assets`
        : "Extracted asset";
    }
    if (event.toolName === "screenshot_preview") {
      return event.status === "running"
        ? "Screenshotting preview"
        : "Screenshotted preview";
    }
    if (event.toolName === WEB_SEARCH_TOOL_NAME) {
      return event.status === "running" ? "Searching the web" : "Searched the web";
    }
    if (event.toolName === READ_WEB_PAGE_TOOL_NAME) {
      return event.status === "running" ? "Reading web page" : "Read web page";
    }
    // Server and tool name only; the arguments stay in the details pane, which
    // is where every other tool's input already lives.
    const mcp = parseMcpToolName(event.toolName);
    if (mcp) {
      return event.status === "running"
        ? `Calling ${mcp.server} · ${mcp.tool}`
        : `${mcp.server} · ${mcp.tool}`;
    }
    return event.status === "running" ? "Running tool" : "Tool completed";
  }
  return "Activity";
}


function renderToolDetails(event: AgentEvent, variantCode?: string) {
  if (!event.input && !event.output) return null;

  const renderJson = (data: unknown) => {
    if (!data) return null;
    let json = "";
    try {
      json = JSON.stringify(data, null, 2);
    } catch {
      json = String(data);
    }
    if (json.length > 900) {
      json = json.slice(0, 900) + "...";
    }
    return (
      <pre className="mt-2 rounded-md bg-gray-50 dark:bg-gray-800 p-2 text-xs text-gray-700 dark:text-gray-200 overflow-x-auto">
        {json}
      </pre>
    );
  };

  const output = getRecord(event.output);
  const input = getRecord(event.input);
  const error = getStringField(output, "error");
  const hasError = Boolean(error);
  const images = getArrayField(output, "images");
  const icons = getArrayField(output, "icons");
  // An image batch now reports a per-item reason even when the whole call
  // failed, so the item list stays visible instead of collapsing to one
  // top-level message that says nothing about which prompt went wrong.
  const hideImageItems = hasError && !(images && images.length > 0);
  const edits = getArrayField(output, "edits");
  const extractedAssets = getArrayField(output, "assets");
  const successfulExtractedAssets =
    extractedAssets?.filter(isSuccessfulExtractedAsset) || null;
  const visibleExtractedAssets =
    hasError && successfulExtractedAssets
      ? successfulExtractedAssets
      : extractedAssets;
  const screenshotPreviews = getArrayField(output, "screenshots") ?? [];
  const prompts = getStringArrayField(input, "prompts");
  const sourceImageUrls = getStringArrayField(input, "image_urls");
  const assetIds = getStringArrayField(input, "asset_ids");
  const assetDescriptions = getStringArrayField(
    input,
    "asset_descriptions"
  );
  const requestedEdits = getArrayField(input, "edits");

  return (
    <div className="text-sm text-gray-700 dark:text-gray-200">
      {hasError && (
        <div className="rounded-md border border-red-200 dark:border-red-700 bg-red-50 dark:bg-red-900/30 p-3">
          <div className="text-xs uppercase tracking-wide text-red-500">Error</div>
          <div className="mt-1 text-sm text-red-700 dark:text-red-200">
            {error}
          </div>
          {event.input && (
            <div className="mt-2">
              <div className="text-xs uppercase tracking-wide text-red-400">
                Input
              </div>
              {renderJson(event.input)}
            </div>
          )}
        </div>
      )}
      {event.toolName === "create_file" && !hasError && variantCode && (
        <CodePreviewBlock code={variantCode} isGenerating={event.status === "running"} />
      )}

      {event.toolName === "edit_file" && edits && !hasError && (
        <div className="space-y-2">
          {edits.map((rawEdit, index) => {
            const edit = getRecord(rawEdit);
            const oldText = getStringField(edit, "old_text") ?? "";
            const newText = getStringField(edit, "new_text") ?? "";
            const replaced = getNumberField(edit, "replaced");
            return (
              <div
                key={`${oldText}-${index}`}
                className="rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/60 p-3"
              >
                <div className="text-xs uppercase tracking-wide text-gray-400">
                  Edit {index + 1}
                </div>
                <div className="mt-2 grid gap-2">
                  <div>
                    <div className="text-xs text-gray-500">Old</div>
                    <div className="mt-1 rounded bg-red-50 dark:bg-red-900/30 p-2 text-xs font-mono text-red-700 dark:text-red-200 break-all">
                      {oldText}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">New</div>
                    <div className="mt-1 rounded bg-emerald-50 dark:bg-emerald-900/30 p-2 text-xs font-mono text-emerald-700 dark:text-emerald-200 break-all">
                      {newText}
                    </div>
                  </div>
                </div>
                {replaced !== null && (
                  <div className="mt-2 text-xs text-gray-500">
                    Replaced {replaced} time{replaced === 1 ? "" : "s"}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {event.toolName === FREE_IMAGE_SEARCH_TOOL_NAME && (
        <div>
          {event.status === "running" ? (
            <div className="text-xs text-gray-600 dark:text-gray-400">
              Searching Openverse for public-domain images…
            </div>
          ) : images ? (
            <FreeImageResults
              items={images}
              rejected={getArrayField(output, "rejected") ?? []}
            />
          ) : null}
        </div>
      )}

      {event.toolName === ICON_SEARCH_TOOL_NAME && (
        <div>
          {event.status === "running" ? (
            <div className="text-xs text-gray-600 dark:text-gray-400">
              Searching Iconify and sanitizing selected SVGs…
            </div>
          ) : icons ? (
            <IconSearchResults
              items={icons}
              rejected={getArrayField(output, "rejected") ?? []}
            />
          ) : null}
        </div>
      )}

      {event.toolName === "generate_images" && !hideImageItems && (        <div>
          {/* While running: show prompts with dividers */}
          {event.status === "running" && prompts && (
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              {prompts.map((prompt, index) => (
                <div key={index} className="text-xs text-gray-600 dark:text-gray-400 py-1.5">
                  {prompt}
                </div>
              ))}
            </div>
          )}
          {/* After complete: 50/50 image left, prompt right */}
          {event.status !== "running" && images && (
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              {images.map((rawItem, index) => {
                const item = getRecord(rawItem);
                const prompt = getStringField(item, "prompt") ?? "";
                const outcome = readImageItem(rawItem, "url");
                return (
                  <div key={`${prompt}-${index}`} className="flex gap-3 py-2">
                    <div className="w-1/2 shrink-0">
                      {outcome.succeeded && outcome.url ? (
                        <img
                          src={outcome.url}
                          alt={prompt || `Generated image ${index + 1}`}
                          className="w-full rounded object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <ImageFailureTile
                          outcome={outcome}
                          label={`Image ${index + 1} failed`}
                        />
                      )}
                    </div>
                    <div className="w-1/2 text-xs text-gray-600 dark:text-gray-400 self-center">
                      {prompt}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {event.toolName === "remove_backgrounds" && !hideImageItems && (
        <div>
          {/* While running: show the source images */}
          {event.status === "running" && sourceImageUrls && (
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              {sourceImageUrls.map((url, index) => (
                <div key={index} className="py-2">
                  <img
                    src={url}
                    alt={`Original image ${index + 1}`}
                    className="w-full rounded object-cover"
                    loading="lazy"
                  />
                </div>
              ))}
            </div>
          )}
          {/* After complete: before/after side by side for each image */}
          {event.status !== "running" && images && (
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              {images.map((rawItem, index) => {
                const item = getRecord(rawItem);
                const imageUrl = getStringField(item, "image_url");
                const outcome = readImageItem(rawItem, "result_url");
                return (
                  <div key={`${imageUrl}-${index}`} className="flex gap-2 py-2">
                    <div className="w-1/2">
                      <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Before</div>
                      {imageUrl ? (
                        <img
                          src={imageUrl}
                          alt={`Original image ${index + 1}`}
                          className="w-full rounded object-cover"
                          loading="lazy"
                        />
                      ) : null}
                    </div>
                    <div className="w-1/2">
                      <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">After</div>
                      {outcome.succeeded && outcome.url ? (
                        <div className="relative">
                          <div
                            className="absolute inset-0 rounded"
                            style={{
                              backgroundImage:
                                "linear-gradient(45deg, #e5e7eb 25%, transparent 25%), linear-gradient(-45deg, #e5e7eb 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #e5e7eb 75%), linear-gradient(-45deg, transparent 75%, #e5e7eb 75%)",
                              backgroundSize: "10px 10px",
                              backgroundPosition: "0 0, 0 5px, 5px -5px, -5px 0px",
                            }}
                          />
                          <img
                            src={outcome.url}
                            alt="Background removed"
                            className="relative w-full rounded"
                            loading="lazy"
                          />
                        </div>
                      ) : (
                        <ImageFailureTile
                          outcome={outcome}
                          label={`Image ${index + 1} failed`}
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {event.toolName === "edit_images" && !hideImageItems && (
        <div>
          {event.status === "running" &&
            requestedEdits && (
              <div className="divide-y divide-gray-100 dark:divide-gray-800">
                {requestedEdits.map((rawItem, index) => {
                  const item = getRecord(rawItem);
                  const imageUrls = (getArrayField(item, "image_urls") || []).filter(
                    (url): url is string => typeof url === "string"
                  );
                  const prompt =
                    typeof item?.prompt === "string" ? item.prompt : null;
                  const aspectRatio =
                    typeof item?.aspect_ratio === "string"
                      ? item.aspect_ratio
                      : "match input";
                  return (
                    <div key={`${prompt || "edit"}-${index}`} className="py-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-xs font-medium text-gray-700 dark:text-gray-200">
                          Edit {index + 1}
                        </div>
                        <div className="rounded-full bg-violet-50 px-2 py-0.5 text-[10px] text-violet-600 dark:bg-violet-900/30 dark:text-violet-300">
                          {aspectRatio}
                        </div>
                      </div>
                      {prompt && (
                        <div className="mt-2">
                          <ExpandablePrompt prompt={prompt} />
                        </div>
                      )}
                      <div className="mt-3 grid grid-cols-3 gap-2">
                        {imageUrls.map((url: string, imageIndex: number) => (
                          <div key={`${url}-${imageIndex}`}>
                            <div className="mb-1 text-[10px] text-gray-500 dark:text-gray-400">
                              {imageIndex === 0
                                ? "Main image"
                                : `Reference ${imageIndex}`}
                            </div>
                            <img
                              src={url}
                              alt={
                                imageIndex === 0
                                  ? `Main image for edit ${index + 1}`
                                  : `Reference ${imageIndex} for edit ${index + 1}`
                              }
                              className="aspect-square w-full rounded object-cover bg-gray-50 dark:bg-gray-800"
                              loading="lazy"
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          {event.status !== "running" && images && (
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              {images.map((rawItem, index) => {
                const item = getRecord(rawItem);
                const imageUrls =
                  getStringArrayField(item, "image_urls") ?? [];
                const prompt = getStringField(item, "prompt");
                const aspectRatio =
                  getStringField(item, "aspect_ratio") ?? "match input";
                const outcome = readImageItem(rawItem, "result_url");
                const itemError = outcome.error;
                const resultUrl = outcome.url;
                const succeeded = outcome.succeeded;
                return (
                  <div key={`${prompt || "edit"}-${index}`} className="space-y-3 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs font-medium text-gray-700 dark:text-gray-200">
                        Edit {index + 1}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-500 dark:bg-gray-800 dark:text-gray-300">
                          {aspectRatio}
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] ${
                            succeeded
                              ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-300"
                              : "bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-300"
                          }`}
                        >
                          {succeeded ? "Complete" : "Failed"}
                        </span>
                      </div>
                    </div>
                    {prompt && <ExpandablePrompt prompt={prompt} />}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <div className="mb-1 text-xs text-gray-500 dark:text-gray-400">
                          Before
                        </div>
                        {imageUrls[0] ? (
                          <img
                            src={imageUrls[0]}
                            alt={`Main image for edit ${index + 1}`}
                            className="aspect-square w-full rounded object-contain bg-gray-50 dark:bg-gray-800"
                            loading="lazy"
                          />
                        ) : (
                          <div className="aspect-square rounded bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-xs text-gray-400">
                            Missing
                          </div>
                        )}
                      </div>
                      <div>
                        <div className="mb-1 text-xs text-gray-500 dark:text-gray-400">
                          After
                        </div>
                        {succeeded && resultUrl ? (
                          <img
                            src={resultUrl}
                            alt={`Edited image ${index + 1}`}
                            className="aspect-square w-full rounded object-contain bg-gray-50 dark:bg-gray-800"
                            loading="lazy"
                          />
                        ) : (
                          <ImageFailureTile
                            outcome={outcome}
                            label={`Edit ${index + 1} failed`}
                          />
                        )}
                      </div>
                    </div>
                    {imageUrls.length > 1 && (
                      <div>
                        <div className="mb-1 text-xs text-gray-500 dark:text-gray-400">
                          Reference images
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          {imageUrls
                            .slice(1)
                            .map((url: string, referenceIndex: number) => (
                              <img
                                key={`${url}-${referenceIndex}`}
                                src={url}
                                alt={`Reference ${referenceIndex + 1} for edit ${index + 1}`}
                                className="aspect-square w-full rounded object-cover bg-gray-50 dark:bg-gray-800"
                                loading="lazy"
                              />
                            ))}
                        </div>
                      </div>
                    )}
                    {itemError && (
                      <div
                        role="alert"
                        data-testid="image-edit-error"
                        data-category={outcome.category ?? "unknown"}
                        className="rounded bg-red-50 p-2 text-xs text-red-600 dark:bg-red-900/30 dark:text-red-200"
                      >
                        <p>{itemError}</p>
                        {outcome.action && !itemError.includes(outcome.action) && (
                          <p className="mt-1">{outcome.action}</p>
                        )}
                      </div>
                    )}
                    {succeeded && (
                      <div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          Result URL
                        </div>
                        <div className="mt-1 break-all rounded bg-gray-50 p-2 font-mono text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                          {resultUrl}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {event.toolName === "save_assets" && !hasError && (
        <div className="space-y-3">
          {event.status === "running" && assetIds && (
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              {assetIds.map((assetId, index) => (
                <div key={`${assetId}-${index}`} className="py-2">
                  <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                    Asset ID
                  </div>
                  <div className="break-all rounded bg-gray-50 p-2 font-mono text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                    {assetId}
                  </div>
                </div>
              ))}
            </div>
          )}
          {event.status !== "running" && images && (
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              {images.map((rawItem, index) => {
                const item = getRecord(rawItem);
                const assetId = getStringField(item, "asset_id") ?? "asset";
                const publicUrl = getStringField(item, "public_url");
                return (
                  <div key={`${assetId}-${index}`} className="flex gap-3 py-2">
                    <div className="w-1/2">
                      <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                        Saved asset
                      </div>
                      {publicUrl ? (
                        <img
                          src={publicUrl}
                          alt={`Saved uploaded asset ${index + 1}`}
                          className="w-full rounded object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="aspect-square rounded bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-xs text-gray-400">
                          Failed
                        </div>
                      )}
                    </div>
                    <div className="w-1/2 self-center">
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        Permanent URL
                      </div>
                      <div className="mt-1 break-all rounded bg-gray-50 p-2 font-mono text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                        {publicUrl}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {event.toolName === "extract_assets" &&
        (!hasError || Boolean(visibleExtractedAssets?.length)) && (
          <div>
            {!hasError &&
              event.status === "running" &&
              assetDescriptions && (
                <div className="divide-y divide-gray-100 dark:divide-gray-800">
                  {assetDescriptions.map((description, index) => (
                    <div key={`${description}-${index}`} className="py-2">
                      <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                        Asset {index + 1}
                      </div>
                      <div className="text-xs text-gray-600 dark:text-gray-300">
                        {description}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            {event.status !== "running" && visibleExtractedAssets && (
              <div className="divide-y divide-gray-100 dark:divide-gray-800">
                {visibleExtractedAssets.map((asset, index) => {
                  const assetRecord =
                    asset && typeof asset === "object"
                      ? (asset as Record<string, unknown>)
                      : {};
                  const description =
                    typeof assetRecord.description === "string"
                      ? assetRecord.description
                      : `Asset ${index + 1}`;
                  const publicUrl =
                    typeof assetRecord.public_url === "string"
                      ? assetRecord.public_url
                      : null;
                  const previewUrl =
                    publicUrl ||
                    (typeof assetRecord.data_url === "string"
                      ? assetRecord.data_url
                      : null);
                  const boxText = Array.isArray(assetRecord.box_2d)
                    ? assetRecord.box_2d.join(", ")
                    : "No box";
                  const statusLabel =
                    typeof assetRecord.status === "string"
                      ? assetRecord.status
                      : previewUrl
                        ? "ok"
                        : "missing";
                  return (
                    <div key={`${description}-${index}`} className="flex gap-3 py-2">
                      <div className="w-1/2 shrink-0">
                        <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                          Extracted crop
                        </div>
                        {previewUrl ? (
                          <img
                            src={previewUrl}
                            alt={description}
                            className="max-h-48 w-full rounded object-contain bg-gray-50 dark:bg-gray-800"
                            loading="lazy"
                          />
                        ) : (
                          <div className="aspect-square rounded bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-xs text-gray-400">
                            Missing
                          </div>
                        )}
                      </div>
                      <div className="w-1/2 self-center space-y-2">
                        <div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">
                            Requested asset
                          </div>
                          <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                            {description}
                          </div>
                        </div>
                        {publicUrl && (
                          <div>
                            <div className="text-xs text-gray-500 dark:text-gray-400">
                              Public URL
                            </div>
                            <div className="mt-1 break-all rounded bg-gray-50 p-2 font-mono text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                              {publicUrl}
                            </div>
                          </div>
                        )}
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div>
                            <div className="text-gray-500 dark:text-gray-400">Status</div>
                            <div className="mt-1 font-mono text-gray-600 dark:text-gray-300">
                              {statusLabel}
                            </div>
                          </div>
                          <div>
                            <div className="text-gray-500 dark:text-gray-400">
                              Source image
                            </div>
                            <div className="mt-1 font-mono text-gray-600 dark:text-gray-300">
                              {String(assetRecord.image_index ?? "-")}
                            </div>
                          </div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">
                            Bounding box
                          </div>
                          <div className="mt-1 break-all rounded bg-gray-50 p-2 font-mono text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                            [{boxText}]
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

      {event.toolName === "screenshot_preview" && !hasError && (
        <div>
          {event.status === "running" && (
            <div className="text-xs text-gray-600 dark:text-gray-400 py-1.5">
              Rendering desktop and mobile previews...
            </div>
          )}
          {event.status !== "running" && (
            <div className="grid gap-3 py-2 sm:grid-cols-2">
              {(["desktop", "mobile"] as const).map((viewport) => {
                const screenshot = screenshotPreviews.find((item) => {
                  const itemRecord = getRecord(item);
                  return itemRecord?.viewport === viewport;
                });
                const screenshotRecord = getRecord(screenshot);
                const imageUrl =
                  typeof screenshotRecord?.image_url === "string"
                    ? screenshotRecord.image_url
                    : null;
                return (
                  <div key={viewport}>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mb-1 capitalize">
                      {viewport}
                    </div>
                    {imageUrl ? (
                      <div className="max-h-96 overflow-y-auto rounded border border-gray-200 dark:border-gray-700">
                        <img
                          src={imageUrl}
                          alt={`Screenshot of the generated ${viewport} preview`}
                          className="w-full"
                          loading="lazy"
                        />
                      </div>
                    ) : (
                      <div className="aspect-square rounded bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-xs text-gray-400">
                        Missing
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {!event.toolName && !hasError && (
        <>
          {event.input && (
            <div>
              <div className="text-xs uppercase tracking-wide text-gray-400">
                Input
              </div>
              {renderJson(event.input)}
            </div>
          )}
          {event.output && (
            <div className="mt-3">
              <div className="text-xs uppercase tracking-wide text-gray-400">
                Output
              </div>
              {renderJson(event.output)}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function AgentEventCard({
  event,
  autoExpand,
  variantCode,
}: {
  event: AgentEvent;
  autoExpand?: boolean;
  variantCode?: string;
}) {
  const [expanded, setExpanded] = useState(Boolean(autoExpand));

  useEffect(() => {
    if (autoExpand) {
      setExpanded(true);
    }
  }, [autoExpand]);

  const isExpanded =
    (event.type !== "thinking" && event.status === "running") || expanded;

  if (event.type === "assistant") {
    if (!event.content) return null;
    return (
      <div className="py-1 text-sm text-gray-700 dark:text-gray-300 prose prose-sm dark:prose-invert max-w-none">
        <ReactMarkdown
          components={{
            img: ({ ...props }) => (
              <div className="my-2 flex justify-start max-w-full">
                <img
                  {...props}
                  className="max-h-60 max-w-full object-contain rounded-lg border border-gray-200 dark:border-gray-700"
                  loading="lazy"
                />
              </div>
            ),
          }}
        >
          {event.content}
        </ReactMarkdown>
      </div>
    );
  }

  return (
    <div>
      <button
        onClick={() => setExpanded((prev) => !prev)}
        className="w-full flex items-center gap-2 py-1.5 text-left text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
      >
        {getEventIcon(event.type, event.toolName)}
        <span className={`text-sm flex-1 ${event.status === "running" ? "active-step-shimmer" : ""}`}>
          {getEventTitle(event)}
        </span>
        {isExpanded ? (
          <BsChevronDown className="text-xs shrink-0" />
        ) : (
          <BsChevronRight className="text-xs shrink-0" />
        )}
      </button>
      {isExpanded && (
        <div className="pb-2">
          {event.type === "thinking" && event.content && (
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <ReactMarkdown
                components={{
                  img: ({ ...props }) => (
                    <div className="my-2 flex justify-start max-w-full">
                      <img
                        {...props}
                        className="max-h-60 max-w-full object-contain rounded-lg border border-gray-200 dark:border-gray-700"
                        loading="lazy"
                      />
                    </div>
                  ),
                }}
              >
                {event.content}
              </ReactMarkdown>
            </div>
          )}
          {event.type === "tool" && renderToolDetails(event, variantCode)}
        </div>
      )}
    </div>
  );
}

function AgentActivity() {
  const { head, commits, latestCommitHash } = useProjectStore();
  const [expandedStepGroups, setExpandedStepGroups] = useState<
    Record<string, boolean>
  >({});
  const [nowMs, setNowMs] = useState(() => Date.now());
  const appState = useAppStore((s) => s.appState);

  useEffect(() => {
    if (appState !== AppState.CODING) return;
    const intervalId = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(intervalId);
  }, [appState]);

  const currentCommit = head ? commits[head] : null;
  const selectedVariant = currentCommit
    ? currentCommit.variants[currentCommit.selectedVariantIndex]
    : null;
  const selectedVariantStatus = selectedVariant?.status;
  const variantUiKey =
    currentCommit ? `${currentCommit.hash}:${currentCommit.selectedVariantIndex}` : "";

  const variantCode = selectedVariant?.code || "";
  const events = selectedVariant?.agentEvents || [];
  const lastAssistantId = [...events]
    .reverse()
    .find((event) => event.type === "assistant")?.id;
  const requestStartMs =
    selectedVariant?.requestStartedAt ??
    (currentCommit?.dateCreated
      ? new Date(currentCommit.dateCreated).getTime()
      : undefined);

  const isDone = isTerminalVariantStatus(selectedVariantStatus);
  const isLatestCommit = head === latestCommitHash;
  if (!isLatestCommit || events.length === 0) {
    return null;
  }

  const runningDuration = formatElapsedSince(requestStartMs, nowMs);
  const completedEventGroups = groupCompletedAgentEvents(events);

  return (
    <div className="space-y-1 mb-3">
      {isDone ? (
        <>
          {completedEventGroups.map((group) => {
            if (group.type === "assistant") {
              return (
                <AgentEventCard
                  key={group.event.id}
                  event={group.event}
                  autoExpand={group.event.id === lastAssistantId}
                />
              );
            }

            const firstStep = group.events[0];
            const lastStep = group.events[group.events.length - 1];
            const groupUiKey = `${variantUiKey}:${firstStep.id}`;
            const isExpanded = Boolean(expandedStepGroups[groupUiKey]);
            const groupDuration = formatDuration(
              firstStep.startedAt,
              lastStep.endedAt
            );

            return (
              <div key={groupUiKey}>
                <button
                  onClick={() =>
                    setExpandedStepGroups((previous) => ({
                      ...previous,
                      [groupUiKey]: !previous[groupUiKey],
                    }))
                  }
                  className="w-full flex items-center gap-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/60 px-3 py-2 text-left"
                >
                  {isExpanded ? (
                    <BsChevronDown className="text-gray-400 text-xs" />
                  ) : (
                    <BsChevronRight className="text-gray-400 text-xs" />
                  )}
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    Worked through {group.events.length} step
                    {group.events.length !== 1 ? "s" : ""}
                    {groupDuration ? ` in ${groupDuration}` : ""}
                  </span>
                </button>
                {isExpanded && (
                  <div className="space-y-1">
                    {group.events.map((event) => (
                      <AgentEventCard
                        key={event.id}
                        event={event}
                        variantCode={
                          event.toolName === "create_file"
                            ? variantCode
                            : undefined
                        }
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </>
      ) : (
        <>
          <div className="flex items-center justify-between rounded-xl border border-violet-200 dark:border-violet-800 bg-gradient-to-r from-violet-50 to-white dark:from-violet-900/20 dark:to-zinc-900 px-3 py-2 shadow-[0_0_15px_-3px_rgba(139,92,246,0.3)] dark:shadow-[0_0_15px_-3px_rgba(139,92,246,0.4)] transition-all duration-500">
            <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
              <WorkingPulse />
              <span>Working...</span>
            </div>
            <div className="text-xs font-semibold text-gray-700 dark:text-gray-200">
              Time so far {runningDuration || "--"}
            </div>
          </div>
          {events.map((event) => (
            <AgentEventCard
              key={event.id}
              event={event}
              autoExpand={event.type === "assistant" && event.id === lastAssistantId}
              variantCode={event.toolName === "create_file" ? variantCode : undefined}
            />
          ))}
        </>
      )}
    </div>
  );
}

export default AgentActivity;

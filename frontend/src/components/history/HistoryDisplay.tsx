import {
  HistoryVersionLink,
  renderHistory,
  RenderedHistoryItem,
} from "./utils";
import { useProjectStore } from "../../store/project-store";
import { BsChevronDown, BsChevronRight } from "react-icons/bs";
import { useState, useRef, useEffect, useCallback } from "react";

function MediaThumbnail({
  item,
  onPlayClick,
}: {
  item: RenderedHistoryItem;
  onPlayClick?: () => void;
}) {
  const firstImage = item.images[0];
  const firstVideo = item.videos[0];

  if (!firstImage && !firstVideo) return null;

  return (
    <div className="shrink-0 w-12 h-12 rounded-md overflow-hidden border border-gray-200 dark:border-zinc-700 bg-gray-100 dark:bg-zinc-800">
      {firstImage ? (
        <img
          src={firstImage}
          alt="Input screenshot"
          className="w-full h-full object-cover"
          draggable={false}
        />
      ) : firstVideo ? (
        <button
          type="button"
          aria-label="Play the input recording"
          className="pointer-events-auto relative w-full h-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
          onClick={(e) => {
            e.stopPropagation();
            onPlayClick?.();
          }}
        >
          <video
            src={firstVideo}
            className="w-full h-full object-cover"
            muted
            playsInline
          />
          <div className="absolute inset-0 flex items-center justify-center bg-black/30">
            <svg
              className="w-4 h-4 text-white"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path d="M6.3 2.841A1.5 1.5 0 004 4.11v11.78a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
            </svg>
          </div>
        </button>
      ) : null}
    </div>
  );
}

function ExpandedMedia({
  item,
  autoPlayVideo,
}: {
  item: RenderedHistoryItem;
  autoPlayVideo?: boolean;
}) {
  const hasImages = item.images.length > 0;
  const hasVideos = item.videos.length > 0;
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (autoPlayVideo && videoRef.current) {
      videoRef.current.play().catch(() => {});
    }
  }, [autoPlayVideo]);

  if (!hasImages && !hasVideos) return null;

  return (
    <div className="flex flex-col gap-2 mt-2">
      {item.images.map((img, i) => (
        <div
          key={`img-${i}`}
          className="rounded-md overflow-hidden border border-gray-200 dark:border-zinc-700"
        >
          <img
            src={img}
            alt={`Input ${i + 1}`}
            className="w-full h-auto object-contain max-h-48"
            draggable={false}
          />
        </div>
      ))}
      {item.videos.map((vid, i) => (
        <div
          key={`vid-${i}`}
          className="rounded-md overflow-hidden border border-gray-200 dark:border-zinc-700"
        >
          <video
            ref={i === 0 ? videoRef : undefined}
            src={vid}
            className="w-full h-auto max-h-48"
            controls
            muted
            playsInline
          />
        </div>
      ))}
    </div>
  );
}

interface HistoryAncestryLinksProps {
  parentLink: HistoryVersionLink | null;
  retrySource: HistoryVersionLink | null;
  retryDescendants: HistoryVersionLink[];
  onNavigate: (hash: string) => void;
}

export function HistoryAncestryLinks({
  parentLink,
  retrySource,
  retryDescendants,
  onNavigate,
}: HistoryAncestryLinksProps) {
  return (
    <>
      {retrySource && (
        <button
          type="button"
          className="pointer-events-auto flex min-h-6 items-center rounded px-1.5 text-[10px] font-medium text-violet-700 hover:bg-violet-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:text-violet-300 dark:hover:bg-violet-900/40"
          aria-label={`Go to retry source version ${retrySource.version}`}
          onClick={(event) => {
            event.stopPropagation();
            onNavigate(retrySource.hash);
          }}
        >
          Retried from v{retrySource.version}
        </button>
      )}
      {parentLink && (
        <button
          type="button"
          className="pointer-events-auto flex min-h-6 items-center rounded px-1.5 text-[10px] text-gray-600 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:text-gray-300 dark:hover:bg-zinc-700"
          aria-label={`Go to branch parent version ${parentLink.version}`}
          onClick={(event) => {
            event.stopPropagation();
            onNavigate(parentLink.hash);
          }}
        >
          Branch from v{parentLink.version}
        </button>
      )}
      {retryDescendants.map((descendant) => (
        <button
          key={descendant.hash}
          type="button"
          className="pointer-events-auto flex min-h-6 items-center rounded px-1.5 text-[10px] font-medium text-blue-700 hover:bg-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-blue-300 dark:hover:bg-blue-900/40"
          aria-label={`Go to retry descendant version ${descendant.version}`}
          onClick={(event) => {
            event.stopPropagation();
            onNavigate(descendant.hash);
          }}
        >
          Retried as v{descendant.version}
        </button>
      ))}
    </>
  );
}

export default function HistoryDisplay() {
  const { commits, head, setHead } = useProjectStore();
  const [expandedHash, setExpandedHash] = useState<string | null>(null);
  const [autoPlayHash, setAutoPlayHash] = useState<string | null>(null);

  // Clear auto-play flag when the expanded item changes
  useEffect(() => {
    if (expandedHash !== autoPlayHash) {
      setAutoPlayHash(null);
    }
  }, [expandedHash, autoPlayHash]);

  const handleVideoPlayClick = useCallback((hash: string) => {
    setExpandedHash(hash);
    setAutoPlayHash(hash);
  }, []);

  // Put all commits into an array and sort by created date (oldest first)
  const flatHistory = Object.values(commits).sort(
    (a, b) =>
      new Date(a.dateCreated).getTime() - new Date(b.dateCreated).getTime()
  );

  // Annotate history items with a summary, parent version, etc.
  const renderedHistory = renderHistory(flatHistory);

  if (renderedHistory.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {[...renderedHistory].reverse().map((item) => {
        const versionNumber = item.version;
        const isActive = item.hash === head;
        const isExpanded = expandedHash === item.hash;
        const hasMedia = item.images.length > 0 || item.videos.length > 0;

        return (
          <div
            key={item.hash}
            className={`relative rounded-xl border transition-all ${
              isActive
                ? "bg-white dark:bg-zinc-800 border-blue-300 dark:border-blue-700 shadow-sm"
                : "bg-white dark:bg-zinc-900 border-gray-200 dark:border-zinc-800 hover:border-gray-300 dark:hover:border-zinc-700"
            }`}
          >
            {/* A full-row overlay keeps the whole entry clickable and reachable
                by keyboard without nesting the inline buttons inside it. */}
            <button
              type="button"
              onClick={() => setHead(item.hash)}
              aria-current={isActive ? "true" : undefined}
              aria-label={`Show version ${versionNumber}: ${item.summary}`}
              className="absolute inset-0 z-0 cursor-pointer rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-500"
            />
            <div className="pointer-events-none relative flex items-center gap-3 px-3 py-2.5">
              {/* Version number badge */}
              <span
                className={`shrink-0 flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-semibold ${
                  isActive
                    ? "bg-blue-100 dark:bg-blue-900/50 text-blue-800 dark:text-blue-200"
                    : "bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-gray-300"
                }`}
              >
                {versionNumber}
              </span>

              {/* Thumbnail */}
              <MediaThumbnail
                item={item}
                onPlayClick={() => handleVideoPlayClick(item.hash)}
              />

              {/* Summary */}
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span
                    className={`text-[10px] uppercase tracking-wider font-medium px-1.5 py-0.5 rounded ${
                      item.type === "Create"
                        ? "bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300"
                        : item.type === "Retry"
                          ? "bg-violet-50 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300"
                          : item.type === "Edit"
                            ? "bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300"
                            : "bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-300"
                    }`}
                  >
                    {item.type}
                  </span>
                  <HistoryAncestryLinks
                    parentLink={item.parentLink}
                    retrySource={item.retrySource}
                    retryDescendants={item.retryDescendants}
                    onNavigate={setHead}
                  />
                </div>
                <p
                  className={`text-sm mt-0.5 line-clamp-2 ${
                    isActive
                      ? "font-medium text-gray-900 dark:text-white"
                      : "text-gray-600 dark:text-gray-300"
                  }`}
                >
                  {item.summary}
                  {item.selectedElementTag && (
                    <>
                      {" "}
                      <span className="text-gray-400 dark:text-gray-500" aria-hidden="true">&middot;</span>
                      {" "}
                      <code className="text-xs font-mono text-violet-700 dark:text-violet-300">&lt;{item.selectedElementTag}&gt;</code>
                    </>
                  )}
                </p>
              </div>

              {/* Expand button */}
              {(hasMedia || item.summary.length > 30) && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setExpandedHash(isExpanded ? null : item.hash);
                  }}
                  aria-expanded={isExpanded}
                  aria-label={
                    isExpanded
                      ? `Hide details for version ${versionNumber}`
                      : `Show details for version ${versionNumber}`
                  }
                  className="pointer-events-auto shrink-0 flex h-11 w-11 items-center justify-center text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 rounded-md hover:bg-gray-100 dark:hover:bg-zinc-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
                >
                  {isExpanded ? (
                    <BsChevronDown className="w-3 h-3" aria-hidden="true" />
                  ) : (
                    <BsChevronRight className="w-3 h-3" aria-hidden="true" />
                  )}
                </button>
              )}
            </div>

            {/* Expanded details */}
            {isExpanded && (
              <div className="relative px-3 pb-3 pl-12">
                {item.summary.length > 30 && (
                  <p className="text-xs text-gray-600 dark:text-gray-300 break-words">
                    {item.summary}
                  </p>
                )}
                {item.selectedElementTag && (
                  <p className="text-xs text-violet-700 dark:text-violet-300 mt-1">
                    Target: <code className="font-mono text-[10px] bg-violet-100 dark:bg-violet-900/30 px-1 py-0.5 rounded">&lt;{item.selectedElementTag}&gt;</code>
                  </p>
                )}
                <ExpandedMedia
                  item={item}
                  autoPlayVideo={autoPlayHash === item.hash}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

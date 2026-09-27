import type { ImageItemOutcome } from "./image-results";

export interface ImageFailureTileProps {
  outcome: ImageItemOutcome;
  label: string;
}

/**
 * The per-tile failure card.
 *
 * A bare grey box reading "Failed" told a user nothing and told a screen
 * reader even less. This announces itself as an alert and carries the
 * classified reason plus the action to take, which is exactly what the backend
 * now returns for each item in a batch.
 */
export default function ImageFailureTile({
  outcome,
  label,
}: ImageFailureTileProps) {
  const reason = outcome.error?.trim();
  return (
    <div
      role="alert"
      data-testid="image-failure"
      data-category={outcome.category ?? "unknown"}
      className="flex aspect-square flex-col justify-center gap-1 rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300"
    >
      <span className="font-medium">{label}</span>
      {reason ? (
        <span className="line-clamp-4 leading-4">{reason}</span>
      ) : (
        <span className="leading-4">
          The image provider did not return an image.
        </span>
      )}
      {outcome.action && !reason?.includes(outcome.action) && (
        <span className="line-clamp-3 leading-4">{outcome.action}</span>
      )}
    </div>
  );
}

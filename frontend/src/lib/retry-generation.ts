import type {
  Commit,
  CommitGenerationContext,
  CommitHash,
} from "../components/commits/types";
import type { PromptAsset, PromptAssetType, PromptContent } from "../types";
import {
  buildUpdateGenerationRequest,
  buildUserHistoryMessage,
  type GenerationRequest,
} from "./prompt-history";
import type { Stack } from "./stacks";

interface RetryGenerationPlanOptions {
  sourceCommit: Commit;
  commits: Record<CommitHash, Commit>;
  fallbackInputMode: CommitGenerationContext["inputMode"];
  fallbackStack: Stack;
  fallbackDesignSystem?: string | null;
  registerAssets: (type: PromptAssetType, dataUrls: string[]) => string[];
  getAssetsById: () => Record<string, PromptAsset>;
}

export type GenerationCancelReason =
  | "user_cancelled"
  | "request_failed"
  | "connection_error";

export function shouldRetainGenerationAttempt(
  commit: Commit,
  reason: GenerationCancelReason
): boolean {
  return Boolean(commit.retryOfHash) ||
    (reason === "request_failed" && commit.type === "ai_create");
}

export interface RetryGenerationPlan {
  request: GenerationRequest;
  generationBaseHash: CommitHash | null;
  generationBaseVariantIndex: number | null;
  commitParentHash: CommitHash;
  retryOfHash: CommitHash;
  generationContext: CommitGenerationContext;
  initialVariantModels: Array<string | undefined>;
  selectedVariantIndex: number;
}

function clonePrompt(prompt: PromptContent): PromptContent {
  return {
    ...prompt,
    images: [...prompt.images],
    videos: [...(prompt.videos ?? [])],
  };
}

function inferInputMode(
  prompt: PromptContent,
  fallback: CommitGenerationContext["inputMode"]
): CommitGenerationContext["inputMode"] {
  if ((prompt.videos ?? []).length > 0) return "video";
  if (prompt.images.length > 0) return "image";
  return fallback;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export function findRetryRequestSource(
  sourceCommit: Commit,
  commits: Record<CommitHash, Commit>
): Commit {
  let current = sourceCommit;
  const visited = new Set<CommitHash>();

  while (current.retryOfHash) {
    if (visited.has(current.hash)) {
      throw new Error("Retry ancestry contains a cycle.");
    }
    visited.add(current.hash);
    const next = commits[current.retryOfHash];
    if (!next) {
      throw new Error("The original version needed to retry this request was not found.");
    }
    current = next;
  }

  return current;
}

export function buildRetryGenerationPlan({
  sourceCommit,
  commits,
  fallbackInputMode,
  fallbackStack,
  fallbackDesignSystem,
  registerAssets,
  getAssetsById,
}: RetryGenerationPlanOptions): RetryGenerationPlan {
  if (sourceCommit.type === "code_create") {
    throw new Error("Imported code cannot be regenerated.");
  }

  const requestSource = findRetryRequestSource(sourceCommit, commits);
  if (requestSource.type === "code_create") {
    throw new Error("Imported code cannot be regenerated.");
  }

  const prompt = clonePrompt(requestSource.inputs);
  const storedContext =
    sourceCommit.generationContext ?? requestSource.generationContext;
  const inputMode =
    storedContext?.inputMode ?? inferInputMode(prompt, fallbackInputMode);
  const stack =
    storedContext?.stack ??
    sourceCommit.variants[sourceCommit.selectedVariantIndex]?.stack ??
    sourceCommit.variants.find((variant) => variant.stack)?.stack ??
    fallbackStack;
  const selectedModels = storedContext
    ? [...storedContext.selectedModels]
    : unique(
        requestSource.variants
          .map((variant) => variant.model)
          // Any provider's model can be reselected on a retry, so the id is
          // kept as-is rather than filtered to one provider's prefix.
          .filter(
            (model): model is string =>
              typeof model === "string" && model.length > 0
          )
      );
  const designSystem =
    storedContext?.designSystem !== undefined
      ? storedContext.designSystem
      : fallbackDesignSystem;
  const baseCommitHash =
    storedContext?.baseCommitHash !== undefined
      ? storedContext.baseCommitHash
      : requestSource.parentHash;
  const baseCommit = baseCommitHash ? commits[baseCommitHash] : undefined;
  const baseVariantIndex =
    storedContext?.baseVariantIndex !== undefined
      ? storedContext.baseVariantIndex
      : baseCommit?.selectedVariantIndex ?? null;
  const imageAssetIds = registerAssets("image", prompt.images);
  const videoAssetIds = registerAssets("video", prompt.videos ?? []);
  const generationTargetPath = requestSource.variants.find(
    (variant) => variant.generationTargetPath
  )?.generationTargetPath;
  const initialVariantModels = sourceCommit.variants.map(
    (variant) => variant.model
  );
  const retryModels = initialVariantModels.every(
    (model): model is string => typeof model === "string" && model.length > 0
  )
    ? initialVariantModels
    : undefined;

  let request: GenerationRequest;
  let resolvedBaseVariantIndex: number | null = null;
  if (requestSource.type === "ai_create") {
    request = {
      generationType: "create",
      inputMode,
      prompt,
      ...(storedContext?.isAssetExtractionEnabled === undefined
        ? {}
        : {
            isAssetExtractionEnabled:
              storedContext.isAssetExtractionEnabled,
          }),
      ...(retryModels ? { retryModels } : {}),
      variantHistory: [
        buildUserHistoryMessage(
          prompt.text,
          imageAssetIds,
          videoAssetIds,
          prompt.multiImageMode
        ),
      ],
    };
  } else {
    if (!baseCommitHash || !baseCommit) {
      throw new Error("The previous version needed to retry this edit was not found.");
    }
    resolvedBaseVariantIndex = baseVariantIndex ?? baseCommit.selectedVariantIndex;
    if (!baseCommit.variants[resolvedBaseVariantIndex]) {
      throw new Error("The original option needed to retry this edit was not found.");
    }
    request = {
      ...buildUpdateGenerationRequest({
        inputMode,
        prompt,
        parentCommit: baseCommit,
        parentVariantIndex: resolvedBaseVariantIndex,
        generationTargetPath,
        imageAssetIds,
        videoAssetIds,
        getAssetsById,
      }),
      ...(retryModels ? { retryModels } : {}),
    };
  }

  return {
    request,
    generationBaseHash: request.generationType === "update" ? baseCommitHash : null,
    generationBaseVariantIndex: resolvedBaseVariantIndex,
    commitParentHash: sourceCommit.hash,
    retryOfHash: sourceCommit.hash,
    generationContext: {
      inputMode,
      stack,
      selectedModels,
      ...(storedContext?.isAssetExtractionEnabled === undefined
        ? {}
        : {
            isAssetExtractionEnabled:
              storedContext.isAssetExtractionEnabled,
          }),
      designSystem: designSystem ?? null,
      baseCommitHash: request.generationType === "update" ? baseCommitHash : null,
      baseVariantIndex: resolvedBaseVariantIndex,
    },
    initialVariantModels,
    selectedVariantIndex: Math.min(
      sourceCommit.selectedVariantIndex,
      Math.max(0, sourceCommit.variants.length - 1)
    ),
  };
}

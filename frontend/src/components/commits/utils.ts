import { nanoid } from "nanoid";
import {
  AiCreateCommit,
  AiEditCommit,
  CodeCreateCommit,
  Commit,
} from "./types";

type NewCommit =
  | (Omit<
      AiCreateCommit,
      "hash" | "dateCreated" | "selectedVariantIndex" | "isCommitted"
    > & { selectedVariantIndex?: number })
  | (Omit<
      AiEditCommit,
      "hash" | "dateCreated" | "selectedVariantIndex" | "isCommitted"
    > & { selectedVariantIndex?: number })
  | (Omit<
      CodeCreateCommit,
      "hash" | "dateCreated" | "selectedVariantIndex" | "isCommitted"
    > & { selectedVariantIndex?: number });

export function createCommit(commit: NewCommit): Commit {
  const hash = nanoid();
  return {
    ...commit,
    hash,
    isCommitted: false,
    dateCreated: new Date(),
    selectedVariantIndex: commit.selectedVariantIndex ?? 0,
  };
}

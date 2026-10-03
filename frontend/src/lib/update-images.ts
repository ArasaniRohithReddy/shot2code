export const MAX_UPDATE_IMAGES = 5;
export const MAX_UPDATE_IMAGE_BYTES = 10 * 1024 * 1024;
export const UPDATE_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export interface AppendUpdateImagesResult {
  images: string[];
  added: number;
  duplicates: number;
  rejected: number;
  truncated: number;
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("The image could not be read."));
    reader.onerror = () => reject(reader.error ?? new Error("Image read failed."));
    reader.readAsDataURL(file);
  });
}

export async function appendUpdateImageFiles(
  existing: string[],
  files: File[]
): Promise<AppendUpdateImagesResult> {
  const valid = files.filter(
    (file) =>
      UPDATE_IMAGE_TYPES.has(file.type.toLowerCase()) &&
      file.size > 0 &&
      file.size <= MAX_UPDATE_IMAGE_BYTES
  );
  const rejected = files.length - valid.length;
  const remaining = Math.max(0, MAX_UPDATE_IMAGES - existing.length);
  const seen = new Set(existing);
  const added: string[] = [];
  let duplicates = 0;
  let truncated = 0;
  for (const file of valid) {
    const dataUrl = await fileToDataUrl(file);
    if (seen.has(dataUrl)) {
      duplicates += 1;
      continue;
    }
    if (added.length >= remaining) {
      truncated += 1;
      continue;
    }
    seen.add(dataUrl);
    added.push(dataUrl);
  }
  return {
    images: [...existing, ...added],
    added: added.length,
    duplicates,
    rejected,
    truncated,
  };
}

export function clipboardImageFiles(
  clipboardData: DataTransfer
): File[] {
  return Array.from(clipboardData.items)
    .filter(
      (item) =>
        item.kind === "file" &&
        UPDATE_IMAGE_TYPES.has(item.type.toLowerCase())
    )
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null);
}

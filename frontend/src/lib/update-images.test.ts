import {
  appendUpdateImageFiles,
  MAX_UPDATE_IMAGES,
  MAX_UPDATE_IMAGE_BYTES,
} from "./update-images";

class TestFileReader {
  result: string | ArrayBuffer | null = null;
  error: DOMException | null = null;
  onload: ((this: FileReader, event: ProgressEvent<FileReader>) => unknown) | null =
    null;
  onerror:
    | ((this: FileReader, event: ProgressEvent<FileReader>) => unknown)
    | null = null;

  readAsDataURL(file: File) {
    this.result = `data:${file.type};base64,${btoa(file.name)}`;
    queueMicrotask(() =>
      this.onload?.call(
        this as unknown as FileReader,
        {} as ProgressEvent<FileReader>
      )
    );
  }
}

Object.defineProperty(globalThis, "FileReader", {
  configurable: true,
  value: TestFileReader,
});

test("adds pasted screenshots, skips duplicates and preserves order", async () => {
  const first = new File(["first"], "first.png", { type: "image/png" });
  const second = new File(["second"], "second.webp", { type: "image/webp" });

  const result = await appendUpdateImageFiles([], [first, first, second]);

  expect(result.added).toBe(2);
  expect(result.duplicates).toBe(1);
  expect(result.rejected).toBe(0);
  expect(result.images).toHaveLength(2);
  expect(result.images[0]).toMatch(/^data:image\/png;base64,/);
  expect(result.images[1]).toMatch(/^data:image\/webp;base64,/);
});

test("enforces image type, size and attachment-count limits", async () => {
  const existing = Array.from(
    { length: MAX_UPDATE_IMAGES - 1 },
    (_, index) => `data:image/png;base64,${index}`
  );
  const valid = new File(["valid"], "valid.jpg", { type: "image/jpeg" });
  const overflow = new File(["overflow"], "overflow.png", {
    type: "image/png",
  });
  const wrongType = new File(["text"], "notes.txt", { type: "text/plain" });
  const tooLarge = new File(
    [new Uint8Array(MAX_UPDATE_IMAGE_BYTES + 1)],
    "large.png",
    { type: "image/png" }
  );

  const result = await appendUpdateImageFiles(existing, [
    valid,
    overflow,
    wrongType,
    tooLarge,
  ]);

  expect(result.images).toHaveLength(MAX_UPDATE_IMAGES);
  expect(result.added).toBe(1);
  expect(result.truncated).toBe(1);
  expect(result.rejected).toBe(2);
});

test("a duplicate cannot consume the final available image slot", async () => {
  const duplicate = new File(["duplicate"], "duplicate.png", {
    type: "image/png",
  });
  const duplicateUrl = `data:image/png;base64,${btoa(duplicate.name)}`;
  const existing = [
    "data:image/png;base64,one",
    "data:image/png;base64,two",
    "data:image/png;base64,three",
    duplicateUrl,
  ];
  const unique = new File(["unique"], "unique.png", { type: "image/png" });

  const result = await appendUpdateImageFiles(existing, [duplicate, unique]);

  expect(result.duplicates).toBe(1);
  expect(result.added).toBe(1);
  expect(result.truncated).toBe(0);
  expect(result.images).toHaveLength(MAX_UPDATE_IMAGES);
});

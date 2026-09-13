import { usesHashRouting } from "./router-mode";

describe("desktop routing", () => {
  test.each(["file:", "FILE:"])("uses hash routing for %s URLs", (protocol) => {
    expect(usesHashRouting(protocol)).toBe(true);
  });

  test.each(["http:", "https:", "about:", "blob:"])(
    "keeps browser routing for %s URLs",
    (protocol) => {
      expect(usesHashRouting(protocol)).toBe(false);
    }
  );
});

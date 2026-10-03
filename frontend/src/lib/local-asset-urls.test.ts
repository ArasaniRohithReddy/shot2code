import {
  canonicalizeLocalAssetUrls,
  rebaseLocalAssetUrls,
} from "./local-asset-urls";

test("canonicalizes loopback asset origins before persistence", () => {
  expect(
    canonicalizeLocalAssetUrls(
      '<img src="http://127.0.0.1:54321/local-assets/asset.png">'
    )
  ).toContain("shot2code-local:/local-assets/asset.png");
});

test("rebases canonical and stale asset URLs to the current desktop backend", () => {
  expect(
    rebaseLocalAssetUrls(
      "shot2code-local:/local-assets/one.png " +
        "http://localhost:7001/local-assets/two.png",
      "http://127.0.0.1:61234"
    )
  ).toBe(
    "http://127.0.0.1:61234/local-assets/one.png " +
      "http://127.0.0.1:61234/local-assets/two.png"
  );
});

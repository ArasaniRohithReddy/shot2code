import puppeteer, { type Browser, type Page } from "puppeteer";
import {
  createSandboxedPreviewDocument,
  PREVIEW_BRIDGE_CHANNEL,
  PREVIEW_SANDBOX,
  type PreviewRuntimeMetrics,
} from "./preview-bridge";

const RUN_BROWSER_TESTS =
  process.env.RUN_PREVIEW_REVIEW_BROWSER === "true";
const describeBrowser = RUN_BROWSER_TESTS ? describe : describe.skip;

const VALID_PIXEL =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

async function inspectRuntime(
  page: Page,
  html: string,
  width: number,
  nonce: string
): Promise<PreviewRuntimeMetrics> {
  const document = createSandboxedPreviewDocument(html, nonce);
  await page.setContent("<!doctype html><html><body></body></html>");
  return page.evaluate(
    ({ channel, nonce: expectedNonce, sandbox, source, viewportWidth }) =>
      new Promise<PreviewRuntimeMetrics>((resolve, reject) => {
        const timeout = window.setTimeout(
          () => reject(new Error("Preview runtime metrics timed out")),
          10_000
        );
        const handleMessage = (event: MessageEvent) => {
          const message = event.data as {
            channel?: string;
            nonce?: string;
            type?: string;
            payload?: PreviewRuntimeMetrics;
          };
          if (
            message.channel !== channel ||
            message.nonce !== expectedNonce ||
            message.type !== "runtime-metrics" ||
            !message.payload
          ) {
            return;
          }
          window.clearTimeout(timeout);
          window.removeEventListener("message", handleMessage);
          resolve(message.payload);
        };
        window.addEventListener("message", handleMessage);

        const iframe = window.document.createElement("iframe");
        iframe.setAttribute("sandbox", sandbox);
        iframe.style.width = `${viewportWidth}px`;
        iframe.style.height = "800px";
        iframe.style.border = "0";
        iframe.addEventListener(
          "load",
          () => {
            iframe.contentWindow?.postMessage(
              {
                channel,
                nonce: expectedNonce,
                type: "request-runtime-metrics",
              },
              "*"
            );
          },
          { once: true }
        );
        iframe.srcdoc = source;
        window.document.body.appendChild(iframe);
      }),
    {
      channel: PREVIEW_BRIDGE_CHANNEL,
      nonce,
      sandbox: PREVIEW_SANDBOX,
      source: document.html,
      viewportWidth: width,
    }
  );
}

describeBrowser("bounded preview runtime review in Chromium", () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    const executablePath = process.env.SHOT2CODE_TEST_CHROME_PATH;
    if (!executablePath) {
      throw new Error(
        "SHOT2CODE_TEST_CHROME_PATH is required for preview runtime browser tests."
      );
    }
    browser = await puppeteer.launch({
      executablePath,
      headless: true,
      args: ["--ignore-certificate-errors"],
    });
    page = await browser.newPage();
    page.setDefaultTimeout(30_000);
  });

  afterAll(async () => {
    await browser.close();
  });

  it("returns actionable accessibility and layout evidence for one viewport", async () => {
    const metrics = await inspectRuntime(
      page,
      `<!doctype html><html lang="en"><head><title>Runtime audit</title></head>
      <body style="margin:0">
        <main>
          <h1>Dashboard</h1><h3>Skipped level</h3>
          <div class="wide" data-shot2code-path="src/Hero.tsx" style="width:640px">Wide</div>
          <div id="custom" role="button" style="width:40px;height:40px"></div>
          <button id="tiny" style="width:20px;height:20px;padding:0">X</button>
          <img id="missing-alt" src="${VALID_PIXEL}" style="width:20px;height:20px">
          <img id="broken" alt="Broken example" src="data:image/png;base64,broken" style="width:20px;height:20px">
        </main>
        <main><h2>Second main</h2></main>
      </body></html>`,
      320,
      "runtime_review_browser_test"
    );

    const ruleIds = new Set(metrics.findings.map((finding) => finding.ruleId));
    expect(metrics.viewportWidth).toBe(320);
    expect(metrics.horizontalOverflow).toBe(true);
    expect(ruleIds).toEqual(
      new Set([
        "runtime-horizontal-overflow",
        "runtime-accessible-name",
        "runtime-keyboard-focus",
        "runtime-image-alt",
        "runtime-image-load",
        "runtime-heading-structure",
        "runtime-main-landmark",
        "runtime-target-size",
      ])
    );
    expect(
      metrics.findings.find(
        (finding) => finding.ruleId === "runtime-horizontal-overflow"
      )
    ).toMatchObject({
      category: "responsive",
      sourcePath: "src/Hero.tsx",
    });
    expect(metrics.findingsTruncated).toBe(false);
  });

  it("caps DOM inspection work before a generated page can grow unbounded", async () => {
    const nodes = Array.from(
      { length: 2_600 },
      (_value, index) => `<div data-index="${index}">Item</div>`
    ).join("");
    const metrics = await inspectRuntime(
      page,
      `<!doctype html><html lang="en"><head><title>Large DOM</title></head><body><main><h1>Large DOM</h1>${nodes}</main></body></html>`,
      390,
      "runtime_review_bounds_test"
    );

    expect(metrics.inspectedElementCount).toBe(2_500);
    expect(metrics.inspectionTruncated).toBe(true);
  });

  it("keeps inspection responsive when generated scripts throw", async () => {
    const metrics = await inspectRuntime(
      page,
      `<!doctype html><html lang="en"><head><title>Broken script</title></head>
      <body><main><h1>Still inspectable</h1></main><script>throw new Error("generated failure")</script></body></html>`,
      390,
      "runtime_review_error_test"
    );

    expect(metrics.viewportWidth).toBe(390);
    expect(metrics.findings).toEqual([]);
  });
});

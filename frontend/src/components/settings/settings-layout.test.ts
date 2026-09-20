import * as fs from "node:fs";
import * as path from "node:path";

describe("Settings layout", () => {
  it("keeps the app shell bounded and gives Settings its own scroll container", () => {
    const appSource = fs.readFileSync(
      path.join(process.cwd(), "src", "App.tsx"),
      "utf8"
    );
    const settingsSource = fs.readFileSync(
      path.join(
        process.cwd(),
        "src",
        "components",
        "settings",
        "SettingsTab.tsx"
      ),
      "utf8"
    );

    expect(appSource.replace(/\r\n/g, "\n")).toContain(
      "isSettingsOpen ||\n        appState === AppState.CODING"
    );
    expect(settingsSource).toContain(
      'className="min-h-0 flex-1 overflow-y-auto overscroll-contain"'
    );
  });
});

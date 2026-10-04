export interface ChatToolAccess {
  webSearchEnabled: boolean;
  pageFetchEnabled: boolean;
  freeImageSearchEnabled: boolean;
  generatedImagesEnabled: boolean;
  iconSearchEnabled: boolean;
  activeMcpServers: number;
  writeEnabledMcpServers: number;
}

export interface ChatToolRow {
  name: string;
  detail: string;
  status: string;
  enabled: boolean | null;
}

export function buildChatToolRows(
  access: ChatToolAccess,
  screenshotPreviewAvailable: boolean | null,
  enabledSkills: number | null
): ChatToolRow[] {
  return [
    {
      name: "Project editing",
      detail: "Create, inspect and edit the current project files.",
      status: "Always on",
      enabled: true,
    },
    {
      name: "Preview verification",
      detail: "Render desktop/mobile output and return browser errors.",
      status:
        screenshotPreviewAvailable === null
          ? "Checking"
          : screenshotPreviewAvailable
            ? "Ready"
            : "Unavailable",
      enabled: screenshotPreviewAvailable,
    },
    {
      name: "Web search",
      detail: "Bounded current-information snippets for every model runtime.",
      status: access.webSearchEnabled ? "On" : "Off",
      enabled: access.webSearchEnabled,
    },
    {
      name: "Read public pages",
      detail: "Separately consented, bounded page text for every runtime.",
      status: access.pageFetchEnabled ? "On" : "Off",
      enabled: access.pageFetchEnabled,
    },
    {
      name: "Public-domain photos",
      detail: "Keyless Openverse search restricted to CC0/Public Domain Mark.",
      status: access.freeImageSearchEnabled ? "On" : "Off",
      enabled: access.freeImageSearchEnabled,
    },
    {
      name: "Generated images",
      detail: "Replicate or another configured image provider; provider billing applies.",
      status: access.generatedImagesEnabled ? "Ready" : "Off / unconfigured",
      enabled: access.generatedImagesEnabled,
    },
    {
      name: "Localized icons",
      detail: "Keyless Iconify search with SVG sanitization and licence metadata.",
      status: access.iconSearchEnabled ? "On" : "Off",
      enabled: access.iconSearchEnabled,
    },
    {
      name: "MCP servers",
      detail:
        access.writeEnabledMcpServers > 0
          ? `${access.writeEnabledMcpServers} active server(s) may use explicitly allowed write tools.`
          : "Active servers remain read-only unless write tools are explicitly allowed.",
      status: `${access.activeMcpServers} active`,
      enabled: access.activeMcpServers > 0,
    },
    {
      name: "Agent Skills",
      detail: "Enabled instructions/resources are offered to Copilot runtimes.",
      status: enabledSkills === null ? "Checking" : `${enabledSkills} enabled`,
      enabled: enabledSkills === null ? null : enabledSkills > 0,
    },
  ];
}

import React, { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { Stack } from "../../lib/stacks";
import { DesignSystem, MultiScreenshotMode, Settings } from "../../types";
import UploadTab from "./tabs/UploadTab";
import UrlTab from "./tabs/UrlTab";
import TextTab from "./tabs/TextTab";
import ImportTab from "./tabs/ImportTab";
import { DesignSystemSelectorProps } from "../settings/DesignSystemSelector";
import { ModelSelectorProps } from "../settings/ModelSelector";
import { LuFolderOpen, LuX } from "react-icons/lu";

interface Props {
  doCreate: (
    images: string[],
    inputMode: "image" | "video",
    textPrompt?: string,
    isAssetExtractionEnabled?: boolean,
    multiScreenshotMode?: MultiScreenshotMode
  ) => void;
  doCreateFromText: (text: string) => void;
  importFromCode: (code: string, stack: Stack) => void;
  settings: Settings;
  setSettings: React.Dispatch<React.SetStateAction<Settings>>;
  designSystems: DesignSystem[];
  onAddNewDesignSystem: () => void;
  onManageDesignSystems: () => void;
}

type InputTab = "upload" | "url" | "text" | "import";

function UnifiedInputPane({
  doCreate,
  doCreateFromText,
  importFromCode,
  settings,
  setSettings,
  designSystems,
  onAddNewDesignSystem,
  onManageDesignSystems,
}: Props) {
  const [activeTab, setActiveTab] = useState<InputTab>("upload");

  function setStack(stack: Stack) {
    setSettings((prev: Settings) => ({
      ...prev,
      generatedCodeConfig: stack,
    }));
  }

  function setSelectedDesignSystemId(id: string | null) {
    setSettings((prev: Settings) => ({
      ...prev,
      selectedDesignSystemId: id,
    }));
  }

  const designSystemSelectorProps: DesignSystemSelectorProps = {
    designSystems,
    selectedDesignSystemId: settings.selectedDesignSystemId,
    setSelectedDesignSystemId,
    onAddNew: onAddNewDesignSystem,
    onManage: onManageDesignSystems,
  };

  const modelSelectorProps: ModelSelectorProps = {
    selectedModels: settings.copilotModels ?? [],
    setSelectedModels: (models) =>
      setSettings((s) => ({ ...s, copilotModels: models })),
    githubToken: settings.copilotGithubToken,
  };

  return (
    <div className="w-full max-w-4xl mx-auto px-4">
      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as InputTab)}
        className="w-full"
      >
        {settings.projectContext && (
          <div
            role="status"
            className="mb-3 flex items-center gap-3 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-sm text-violet-900 dark:border-violet-900/60 dark:bg-violet-950/30 dark:text-violet-100"
          >
            <LuFolderOpen className="h-4 w-4 shrink-0 text-violet-600 dark:text-violet-300" />
            <div className="min-w-0 flex-1">
              <span className="font-medium">Using {settings.projectContext.name}</span>
              <span className="ml-2 text-xs text-violet-700 dark:text-violet-300">
                {settings.projectContext.component_count} components ·{" "}
                {settings.projectContext.analyzed_file_count} files
              </span>
            </div>
            <button
              type="button"
              onClick={() =>
                setSettings((previous) => ({
                  ...previous,
                  projectContext: null,
                }))
              }
              aria-label="Clear imported project context"
              title="Clear project context"
              className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg text-violet-500 transition-colors duration-200 hover:bg-violet-100 hover:text-violet-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:hover:bg-violet-900/50 dark:hover:text-violet-100"
            >
              <LuX className="h-4 w-4" />
            </button>
          </div>
        )}

        <TabsList className="grid w-full grid-cols-4 mb-6">
          <TabsTrigger
            value="upload"
            className="flex items-center gap-2"
            data-testid="tab-upload"
          >
            <UploadIcon />
            <span className="hidden sm:inline">Upload</span>
          </TabsTrigger>
          <TabsTrigger
            value="url"
            className="flex items-center gap-2"
            data-testid="tab-url"
          >
            <UrlIcon />
            <span className="hidden sm:inline">URL</span>
          </TabsTrigger>
          <TabsTrigger
            value="text"
            className="flex items-center gap-2"
            data-testid="tab-text"
          >
            <TextIcon />
            <span className="hidden sm:inline">Text</span>
          </TabsTrigger>
          <TabsTrigger
            value="import"
            className="flex items-center gap-2"
            data-testid="tab-import"
          >
            <ImportIcon />
            <span className="hidden sm:inline">Import</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="upload" className="mt-0">
          <UploadTab
            doCreate={doCreate}
            stack={settings.generatedCodeConfig}
            setStack={setStack}
            designSystem={designSystemSelectorProps}
            modelSelector={modelSelectorProps}
          />
        </TabsContent>

        <TabsContent value="url" className="mt-0">
          <UrlTab
            doCreate={doCreate}
            screenshotOneApiKey={settings.screenshotOneApiKey}
            stack={settings.generatedCodeConfig}
            setStack={setStack}
            designSystem={designSystemSelectorProps}
            modelSelector={modelSelectorProps}
          />
        </TabsContent>

        <TabsContent value="text" className="mt-0">
          <TextTab
            doCreateFromText={doCreateFromText}
            stack={settings.generatedCodeConfig}
            setStack={setStack}
            designSystem={designSystemSelectorProps}
            modelSelector={modelSelectorProps}
          />
        </TabsContent>

        <TabsContent value="import" className="mt-0">
          <ImportTab
            importFromCode={importFromCode}
            projectContext={settings.projectContext}
            setProjectContext={(projectContext) =>
              setSettings((previous) => ({ ...previous, projectContext }))
            }
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function UploadIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function UrlIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

function TextIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M17 6.1H3" />
      <path d="M21 12.1H3" />
      <path d="M15.1 18H3" />
    </svg>
  );
}

function ImportIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </svg>
  );
}

export default UnifiedInputPane;

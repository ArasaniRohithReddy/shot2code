import React from "react";
import { DesignSystem, Settings } from "../../types";
import { Stack } from "../../lib/stacks";
import { MultiScreenshotMode } from "../../types";
import UnifiedInputPane from "../unified-input/UnifiedInputPane";
import type { InputTab } from "../unified-input/UnifiedInputPane";
import type { EditableProjectImportHandler } from "../../lib/project-import";
import type { DesignProjectImportHandler } from "../../lib/design-project-import";
import type { RecentHistoryProject } from "../../lib/project-history";
import RecentProjects from "../projects/RecentProjects";

interface Props {
  activeInputTab: InputTab;
  onActiveInputTabChange: (tab: InputTab) => void;
  doCreate: (
    images: string[],
    inputMode: "image" | "video",
    textPrompt?: string,
    isAssetExtractionEnabled?: boolean,
    multiScreenshotMode?: MultiScreenshotMode,
    sourceAssets?: import("../../types").DesignSourceAsset[]
  ) => void;
  doCreateFromText: (text: string) => void;
  importFromCode: (code: string, stack: Stack) => void;
  importProject: EditableProjectImportHandler;
  importDesignProject: DesignProjectImportHandler;
  settings: Settings;
  setSettings: React.Dispatch<React.SetStateAction<Settings>>;
  designSystems: DesignSystem[];
  onAddNewDesignSystem: () => void;
  onManageDesignSystems: () => void;
  recentProjects: RecentHistoryProject[];
  isLoadingRecentProjects: boolean;
  historyError: string | null;
  busyProjectId: string | null;
  onOpenProject: (projectId: string) => Promise<boolean>;
  onDeleteProject: (projectId: string) => Promise<boolean>;
  onNewProject: () => void;
}

const StartPane: React.FC<Props> = ({
  activeInputTab,
  onActiveInputTabChange,
  doCreate,
  doCreateFromText,
  importFromCode,
  importProject,
  importDesignProject,
  settings,
  setSettings,
  designSystems,
  onAddNewDesignSystem,
  onManageDesignSystems,
  recentProjects,
  isLoadingRecentProjects,
  historyError,
  busyProjectId,
  onOpenProject,
  onDeleteProject,
  onNewProject,
}) => {
  return (
    <div className="flex flex-col items-center gap-8 py-8">
      <UnifiedInputPane
        activeTab={activeInputTab}
        onActiveTabChange={onActiveInputTabChange}
        doCreate={doCreate}
        doCreateFromText={doCreateFromText}
        importFromCode={importFromCode}
        importProject={importProject}
        importDesignProject={importDesignProject}
        settings={settings}
        setSettings={setSettings}
        designSystems={designSystems}
        onAddNewDesignSystem={onAddNewDesignSystem}
        onManageDesignSystems={onManageDesignSystems}
      />
      <RecentProjects
        projects={recentProjects}
        isLoading={isLoadingRecentProjects}
        error={historyError}
        busyProjectId={busyProjectId}
        onOpen={onOpenProject}
        onDelete={onDeleteProject}
        onNew={onNewProject}
      />
    </div>
  );
};

export default StartPane;

jest.mock("../../config", () => ({
  HTTP_BACKEND_URL: "http://127.0.0.1:7001",
}));

import { renderToStaticMarkup } from "react-dom/server";
import type { HistoryProject } from "../../lib/history-types";
import { FullHistoryProjectDetails } from "./FullHistoryDialog";
import {
  chooseHistoryProjectId,
  loadAllHistoryProjectSummaries,
} from "./full-history-loader";

function project(): HistoryProject {
  return {
    id: "project-1",
    title: "Northwind Analytics",
    stack: "react_tailwind",
    inputMode: "text",
    metadata: {},
    createdAt: new Date("2026-10-01T10:00:00Z"),
    updatedAt: new Date("2026-10-04T12:00:00Z"),
    headCommitId: "retry",
    selectedCommitId: "retry",
    selectedVariantIndex: 0,
    commitCount: 2,
    variantCount: 2,
    rootCommitIds: ["create"],
    commits: [
      {
        id: "create",
        commitHash: "hash-create",
        parentCommitId: null,
        retryOfCommitId: null,
        versionType: "ai_create",
        inputs: {},
        promptMetadata: {},
        metadata: {},
        createdAt: new Date("2026-10-01T10:00:00Z"),
        prompts: [
          {
            id: "prompt-1",
            position: 0,
            role: "user",
            kind: "text",
            content: { text: "Create an analytics dashboard" },
            metadata: {},
            createdAt: new Date("2026-10-01T10:00:00Z"),
          },
        ],
        variants: [
          {
            index: 0,
            model: "gpt-5.6-sol (high thinking)",
            status: "complete",
            code: "<main>one</main>",
            currentContent: "<main>one</main>",
            createdAt: new Date("2026-10-01T10:00:00Z"),
            startedAt: new Date("2026-10-01T10:00:00Z"),
            completedAt: new Date("2026-10-01T10:00:05Z"),
            durationMs: 5000,
            error: null,
            metadata: {},
            messages: [
              {
                id: "message-1",
                position: 0,
                role: "assistant",
                content: "Created the dashboard.",
                media: [],
                metadata: {},
                createdAt: new Date("2026-10-01T10:00:05Z"),
              },
            ],
          },
        ],
        childCommitIds: ["retry"],
      },
      {
        id: "retry",
        commitHash: "hash-retry",
        parentCommitId: "create",
        retryOfCommitId: "create",
        versionType: "retry",
        inputs: {},
        promptMetadata: {},
        metadata: {},
        createdAt: new Date("2026-10-04T12:00:00Z"),
        prompts: [],
        variants: [
          {
            index: 0,
            model: "sdk-byok/openai/custom/local-model",
            status: "error",
            code: null,
            currentContent: null,
            createdAt: new Date("2026-10-04T12:00:00Z"),
            startedAt: new Date("2026-10-04T12:00:00Z"),
            completedAt: new Date("2026-10-04T12:00:01Z"),
            durationMs: 1000,
            error: "Model stopped.",
            metadata: {},
            messages: [],
          },
        ],
        childCommitIds: [],
      },
    ],
  };
}

describe("FullHistoryProjectDetails", () => {
  it("keeps a valid selection and replaces a stale one", () => {
    const summaries = [
      {
        id: "project-1",
        title: "Project 1",
        stack: "react",
        inputMode: "image",
        thumbnailUrl: null,
        createdAt: new Date("2026-09-01T00:00:00.000Z"),
        updatedAt: new Date("2026-09-01T00:00:00.000Z"),
        commitCount: 1,
        variantCount: 1,
        headCommitId: "commit-1",
        selectedCommitId: "commit-1",
        selectedVariantIndex: 0,
        metadata: {},
      },
    ];

    expect(chooseHistoryProjectId("project-1", summaries)).toBe("project-1");
    expect(chooseHistoryProjectId("deleted-project", summaries)).toBe(
      "project-1"
    );
    expect(chooseHistoryProjectId("deleted-project", [])).toBeNull();
  });

  it("loads every project summary across history API pages", async () => {
    const fullPage = Array.from({ length: 500 }, (_, index) => ({
      id: `project-${index}`,
      title: `Project ${index}`,
      stack: "react",
      inputMode: "image",
      thumbnailUrl: null,
      createdAt: new Date("2026-09-01T00:00:00.000Z"),
      updatedAt: new Date("2026-09-01T00:00:00.000Z"),
      commitCount: 1,
      variantCount: 1,
      headCommitId: `commit-${index}`,
    }));
    const fetchPage = jest
      .fn()
      .mockResolvedValueOnce({ projects: fullPage })
      .mockResolvedValueOnce({
        projects: [{ ...fullPage[0], id: "project-500", title: "Project 500" }],
      });

    const projects = await loadAllHistoryProjectSummaries(undefined, fetchPage);

    expect(projects).toHaveLength(501);
    expect(fetchPage).toHaveBeenNthCalledWith(1, {
      limit: 500,
      offset: 0,
    });
    expect(fetchPage).toHaveBeenNthCalledWith(2, {
      limit: 500,
      offset: 500,
    });
  });

  it("shows the complete project summary, versions, prompts, models and retry ancestry", () => {
    const html = renderToStaticMarkup(
      <FullHistoryProjectDetails
        project={project()}
        onOpenProject={jest.fn().mockResolvedValue(true)}
      />
    );

    expect(html).toContain("Northwind Analytics");
    expect(html).toContain("2 versions");
    expect(html).toContain("2 options");
    expect(html).toContain("Create an analytics dashboard");
    expect(html).toContain("Created the dashboard.");
    expect(html).toContain("gpt-5.6-sol (high thinking)");
    expect(html).toContain("sdk-byok/openai/custom/local-model");
    expect(html).toContain("Retried from v1");
    expect(html).toContain("Model stopped.");
    expect(html).toContain("Open project");
  });

  it("labels locally edited versions as edits", () => {
    const edited = project();
    edited.commits = [
      {
        ...edited.commits[0],
        versionType: "code_edit",
        variants: [],
        childCommitIds: [],
      },
    ];
    edited.commitCount = 1;
    edited.variantCount = 0;

    const html = renderToStaticMarkup(
      <FullHistoryProjectDetails
        project={edited}
        onOpenProject={jest.fn().mockResolvedValue(true)}
      />
    );

    expect(html).toContain(">Edit<");
  });
});

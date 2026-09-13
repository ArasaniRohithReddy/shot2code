import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  LuChevronDown,
  LuChevronRight,
  LuFile,
  LuFolder,
  LuFolderOpen,
  LuLock,
} from "react-icons/lu";
import {
  buildProjectTree,
  type ProjectFileMap,
  type ProjectTreeNode,
} from "../../lib/project-files";

interface Props {
  files: ProjectFileMap;
  activeFilePath: string;
  onSelectFile: (path: string) => void;
}

interface VisibleTreeItem {
  node: ProjectTreeNode;
  parentPath: string | null;
}

function collectFolderPaths(nodes: ProjectTreeNode[]): string[] {
  return nodes.flatMap((node) =>
    node.type === "folder"
      ? [node.path, ...collectFolderPaths(node.children)]
      : []
  );
}

function collectVisibleItems(
  nodes: ProjectTreeNode[],
  expandedFolders: Set<string>,
  parentPath: string | null = null
): VisibleTreeItem[] {
  const items: VisibleTreeItem[] = [];
  for (const node of nodes) {
    items.push({ node, parentPath });
    if (node.type === "folder" && expandedFolders.has(node.path)) {
      items.push(
        ...collectVisibleItems(node.children, expandedFolders, node.path)
      );
    }
  }
  return items;
}

function getAncestorFolderPaths(path: string): string[] {
  const parts = path.split("/");
  parts.pop();
  return parts.map((_, index) => parts.slice(0, index + 1).join("/"));
}

function fileLanguageLabel(node: Extract<ProjectTreeNode, { type: "file" }>) {
  switch (node.file.language) {
    case "javascript":
      return "JS";
    case "typescript":
      return "TS";
    case "markdown":
      return "MD";
    default:
      return node.file.language.toUpperCase();
  }
}

function ProjectFileExplorer({ files, activeFilePath, onSelectFile }: Props) {
  const tree = useMemo(() => buildProjectTree(files), [files]);
  const folderPaths = useMemo(() => collectFolderPaths(tree), [tree]);
  const folderPathKey = folderPaths.join("|");
  const knownFolderPaths = useRef(new Set(folderPaths));
  const itemRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    () => new Set(folderPaths)
  );
  const [focusedPath, setFocusedPath] = useState(activeFilePath);

  useEffect(() => {
    const previousFolders = knownFolderPaths.current;
    setExpandedFolders((current) => {
      const availableFolders = new Set(folderPaths);
      const next = new Set(
        [...current].filter((path) => availableFolders.has(path))
      );
      folderPaths.forEach((path) => {
        if (!previousFolders.has(path)) next.add(path);
      });
      getAncestorFolderPaths(activeFilePath).forEach((path) => next.add(path));
      return next;
    });
    knownFolderPaths.current = new Set(folderPaths);
  }, [activeFilePath, folderPathKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setFocusedPath(activeFilePath);
  }, [activeFilePath]);

  const visibleItems = useMemo(
    () => collectVisibleItems(tree, expandedFolders),
    [expandedFolders, tree]
  );
  const visiblePaths = useMemo(
    () => new Set(visibleItems.map(({ node }) => node.path)),
    [visibleItems]
  );
  const tabStopPath = visiblePaths.has(focusedPath)
    ? focusedPath
    : visiblePaths.has(activeFilePath)
      ? activeFilePath
      : visibleItems[0]?.node.path;

  const focusItem = (path: string) => {
    setFocusedPath(path);
    window.requestAnimationFrame(() => itemRefs.current[path]?.focus());
  };

  const toggleFolder = (path: string) => {
    setExpandedFolders((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const handleTreeKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    node: ProjectTreeNode
  ) => {
    const index = visibleItems.findIndex((item) => item.node.path === node.path);
    if (index < 0) return;

    if (event.key === "ArrowDown" && index < visibleItems.length - 1) {
      event.preventDefault();
      focusItem(visibleItems[index + 1].node.path);
      return;
    }
    if (event.key === "ArrowUp" && index > 0) {
      event.preventDefault();
      focusItem(visibleItems[index - 1].node.path);
      return;
    }
    if (event.key === "Home" && visibleItems[0]) {
      event.preventDefault();
      focusItem(visibleItems[0].node.path);
      return;
    }
    if (event.key === "End" && visibleItems.length > 0) {
      event.preventDefault();
      focusItem(visibleItems[visibleItems.length - 1].node.path);
      return;
    }
    if (event.key === "ArrowRight" && node.type === "folder") {
      event.preventDefault();
      if (!expandedFolders.has(node.path)) {
        setExpandedFolders((current) => new Set(current).add(node.path));
      } else if (node.children[0]) {
        focusItem(node.children[0].path);
      }
      return;
    }
    if (event.key === "ArrowLeft") {
      const currentItem = visibleItems[index];
      if (node.type === "folder" && expandedFolders.has(node.path)) {
        event.preventDefault();
        setExpandedFolders((current) => {
          const next = new Set(current);
          next.delete(node.path);
          return next;
        });
      } else if (currentItem.parentPath) {
        event.preventDefault();
        focusItem(currentItem.parentPath);
      }
    }
  };

  const renderNodes = (nodes: ProjectTreeNode[], depth = 1) => (
    <ul
      role={depth === 1 ? "tree" : "group"}
      aria-label={depth === 1 ? "Project files" : undefined}
      className="space-y-0.5"
    >
      {nodes.map((node) => {
        if (node.type === "folder") {
          const isExpanded = expandedFolders.has(node.path);
          return (
            <li key={node.path} role="none">
              <button
                ref={(element) => {
                  itemRefs.current[node.path] = element;
                }}
                type="button"
                role="treeitem"
                aria-label={node.path}
                aria-level={depth}
                aria-expanded={isExpanded}
                tabIndex={node.path === tabStopPath ? 0 : -1}
                onFocus={() => setFocusedPath(node.path)}
                onClick={() => {
                  setFocusedPath(node.path);
                  toggleFolder(node.path);
                }}
                onKeyDown={(event) => handleTreeKeyDown(event, node)}
                className="flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-md pr-2 text-left text-sm text-gray-700 transition-colors duration-200 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-inset dark:text-zinc-300 dark:hover:bg-zinc-800"
                style={{ paddingLeft: `${(depth - 1) * 12 + 8}px` }}
              >
                {isExpanded ? (
                  <LuChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                ) : (
                  <LuChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                )}
                {isExpanded ? (
                  <LuFolderOpen className="h-4 w-4 shrink-0 text-violet-600 dark:text-violet-300" aria-hidden="true" />
                ) : (
                  <LuFolder className="h-4 w-4 shrink-0 text-gray-500 dark:text-zinc-400" aria-hidden="true" />
                )}
                <span className="truncate">{node.name}</span>
              </button>
              {isExpanded && renderNodes(node.children, depth + 1)}
            </li>
          );
        }

        const isActive = node.path === activeFilePath;
        return (
          <li key={node.path} role="none">
            <button
              ref={(element) => {
                itemRefs.current[node.path] = element;
              }}
              type="button"
              role="treeitem"
              aria-label={`${node.path}${node.file.readonly ? ", read only" : ""}`}
              aria-level={depth}
              aria-selected={isActive}
              tabIndex={node.path === tabStopPath ? 0 : -1}
              onFocus={() => setFocusedPath(node.path)}
              onClick={() => {
                setFocusedPath(node.path);
                onSelectFile(node.path);
              }}
              onKeyDown={(event) => handleTreeKeyDown(event, node)}
              className={`flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-md pr-2 text-left text-sm transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-inset ${
                isActive
                  ? "bg-violet-50 font-medium text-violet-900 dark:bg-violet-950/60 dark:text-violet-100"
                  : "text-gray-700 hover:bg-gray-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
              }`}
              style={{ paddingLeft: `${(depth - 1) * 12 + 28}px` }}
              title={node.path}
            >
              <LuFile className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{node.name}</span>
              {node.file.readonly && (
                <>
                  <LuLock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span className="sr-only">Read only</span>
                </>
              )}
              <span
                aria-hidden="true"
                className="shrink-0 font-mono text-[10px] text-gray-400 dark:text-zinc-500"
              >
                {fileLanguageLabel(node)}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );

  return (
    <nav className="min-h-0 flex-1 overflow-auto px-2 pb-3">
      {tree.length > 0 ? (
        renderNodes(tree)
      ) : (
        <p className="px-2 py-3 text-sm text-gray-500 dark:text-zinc-400">
          No project files are available.
        </p>
      )}
    </nav>
  );
}

export default ProjectFileExplorer;

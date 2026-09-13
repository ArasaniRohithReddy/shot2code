import { useEffect, useRef } from "react";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, ViewUpdate } from "@codemirror/view";
import { espresso, cobalt } from "thememirror";
import {
  defaultKeymap,
  history,
  redo,
  undo,
} from "@codemirror/commands";
import { bracketMatching } from "@codemirror/language";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { vue } from "@codemirror/lang-vue";
import { xml } from "@codemirror/lang-xml";
import { yaml } from "@codemirror/lang-yaml";
import { EditorTheme } from "@/types";
import type { ProjectFileLanguage } from "@/lib/project-files";

interface Props {
  code: string;
  editorTheme: EditorTheme;
  language: ProjectFileLanguage;
  filePath: string;
  readOnly?: boolean;
  onCodeChange: (code: string) => void;
}

function getLanguageExtension(language: ProjectFileLanguage): Extension {
  switch (language) {
    case "html":
      return html();
    case "css":
      return css();
    case "javascript":
      return javascript();
    case "jsx":
      return javascript({ jsx: true });
    case "typescript":
      return javascript({ typescript: true });
    case "tsx":
      return javascript({ jsx: true, typescript: true });
    case "json":
      return json();
    case "markdown":
      return markdown();
    case "vue":
      return vue();
    case "xml":
      return xml();
    case "yaml":
      return yaml();
    case "text":
      return [];
  }
}

function CodeMirror({
  code,
  editorTheme,
  language,
  filePath,
  readOnly = false,
  onCodeChange,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const onCodeChangeRef = useRef(onCodeChange);
  const codeRef = useRef(code);
  codeRef.current = code;

  useEffect(() => {
    onCodeChangeRef.current = onCodeChange;
  }, [onCodeChange]);

  useEffect(() => {
    if (!ref.current) return;

    const editorState = EditorState.create({
      doc: codeRef.current,
      extensions: [
        history(),
        keymap.of([
          ...defaultKeymap,
          { key: "Mod-z", run: undo, preventDefault: true },
          { key: "Mod-Shift-z", run: redo, preventDefault: true },
        ]),
        lineNumbers(),
        bracketMatching(),
        getLanguageExtension(language),
        editorTheme === EditorTheme.ESPRESSO ? espresso : cobalt,
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({
          "aria-label": `Editor for ${filePath}`,
          "aria-describedby": "project-editor-keyboard-help",
        }),
        EditorView.theme({
          "&": { height: "100%" },
          ".cm-scroller": { overflow: "auto" },
          ".cm-content": { minHeight: "100%" },
        }),
        EditorView.updateListener.of((update: ViewUpdate) => {
          if (update.docChanged) {
            onCodeChangeRef.current(update.state.doc.toString());
          }
        }),
      ],
    });

    view.current = new EditorView({
      state: editorState,
      parent: ref.current,
    });

    return () => {
      view.current?.destroy();
      view.current = null;
    };
  }, [editorTheme, filePath, language, readOnly]);

  useEffect(() => {
    if (view.current && view.current.state.doc.toString() !== code) {
      view.current.dispatch({
        changes: { from: 0, to: view.current.state.doc.length, insert: code },
      });
    }
  }, [code]);

  return (
    <div
      className="h-full min-h-0 overflow-hidden bg-[#193549] focus-within:ring-2 focus-within:ring-violet-500 focus-within:ring-inset"
      ref={ref}
    />
  );
}

export default CodeMirror;
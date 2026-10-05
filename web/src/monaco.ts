// Monaco from the bundle, never a CDN: a local tool must work offline and load nothing remote.
import * as monaco from "monaco-editor";
import { loader } from "@monaco-editor/react";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";

self.MonacoEnvironment = {
  getWorker(_id: string, label: string) {
    if (label === "json") {
      return new jsonWorker();
    }
    if (label === "javascript" || label === "typescript") {
      return new tsWorker();
    }
    return new editorWorker();
  },
};

loader.config({ monaco });

export function monacoTheme(): string {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "vs-dark" : "vs";
}

import { useEffect, useState } from "react";
import Editor from "@monaco-editor/react";
import { api } from "../api";
import { monacoTheme } from "../monaco";
import type { TreeFile } from "../types";

/** Any file of the tree, read-only: configuration, an entitlement, a form, a PRD part. */
export function FileView({ file, revision }: { file: string; revision: string }) {
  const [data, setData] = useState<TreeFile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let gone = false;
    api
      .file(file)
      .then((d) => !gone && (setData(d), setError(null)))
      .catch((e: Error) => !gone && setError(e.message));
    return () => {
      gone = true;
    };
  }, [file, revision]);

  if (error) {
    return <div className="banner error">{error}</div>;
  }
  if (!data) {
    return <p className="muted pad">Loading…</p>;
  }
  return (
    <div className="view">
      <div className="viewhead">
        <div>
          <div className="kicker">File · read-only in this spike</div>
          <h2>{file.split("/").pop()}</h2>
          <div className="muted small">{file}</div>
        </div>
        <div className="muted small right">
          Edit through an operation
          <br />
          (Operations, top left) for now.
        </div>
      </div>
      <div className="editor">
        <Editor language={data.language} value={data.content} theme={monacoTheme()} options={{ readOnly: true, minimap: { enabled: false }, scrollBeyondLastLine: false, wordWrap: "on" }} />
      </div>
    </div>
  );
}

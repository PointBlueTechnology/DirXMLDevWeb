import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { Selection, TraceFileEntry } from "../types";

/**
 * Recordings the live trace wrote and trace files uploaded from a server: listed with their size
 * and time, opened in the viewer (parsed once on the server, read in pages), downloaded, removed.
 * A file goes up as its raw body; the server keeps it under the project's data directory and
 * refuses one over its limit (1 GB by default).
 */
export function TraceFilesView({ onSelect }: { onSelect: (s: Selection) => void }) {
  const [files, setFiles] = useState<TraceFileEntry[] | null>(null);
  const [dir, setDir] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const input = useRef<HTMLInputElement | null>(null);

  const load = () => {
    api.traces
      .list()
      .then((r) => {
        setFiles(r.files);
        setDir(r.dir);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  };
  useEffect(load, []);

  const upload = (file: File) => {
    setProgress(`Uploading ${file.name} (${mb(file.size)})…`);
    api.traces
      .upload(file)
      .then((r) => {
        setProgress(`Stored ${r.name}.`);
        load();
      })
      .catch((e: Error) => setProgress(e.message));
  };
  const remove = (name: string) => {
    api.traces
      .remove(name)
      .then(load)
      .catch((e: Error) => setError(e.message));
  };

  return (
    <div className="pad" data-testid="trace-files">
      <div className="viewhead">
        <div>
          <div className="kicker">Trace files</div>
          <h2>Recordings and uploads</h2>
          <div className="muted small">{dir}</div>
        </div>
      </div>
      <div className="addrow">
        <input ref={input} type="file" style={{ display: "none" }} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} data-testid="trace-upload-input" />
        <button className="primary" onClick={() => input.current?.click()} data-testid="trace-upload">
          Upload a trace file…
        </button>
        <button onClick={load}>Refresh</button>
        {progress && <span className="muted small">{progress}</span>}
      </div>
      <p className="muted small">A recording comes from the Trace tab's "record to a file" switch; an upload is a file taken from a server (dstrace output, a driver's trace file). The viewer parses a file once and shows it in pages, so a large one is fine. Drop a file here too.</p>
      {error && <div className="banner error">{error}</div>}
      {files && files.length === 0 && <p className="muted">No trace files yet.</p>}
      {files && files.length > 0 && (
        <table className="grid" data-testid="trace-files-rows">
          <thead>
            <tr>
              <th>File</th>
              <th>Size</th>
              <th>Modified</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {files.map((f) => (
              <tr key={f.name}>
                <td>
                  <button className="link" onClick={() => onSelect({ type: "trace", file: f.name })} data-testid={"trace-open-" + f.name}>
                    {f.name}
                  </button>
                  {f.parsed && <span className="muted small"> (parsed)</span>}
                </td>
                <td className="small">{mb(f.bytes)}</td>
                <td className="small">{f.modified.replace("T", " ").slice(0, 19)}</td>
                <td className="right">
                  <a className="link" href={api.traces.fileUrl(f.name)} download>
                    download
                  </a>{" "}
                  <button className="mini danger" onClick={() => remove(f.name)} title="Remove the file from the server">
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function mb(bytes: number): string {
  if (bytes < 1024) {
    return bytes + " B";
  }
  if (bytes < 1024 * 1024) {
    return (bytes / 1024).toFixed(0) + " KB";
  }
  return (bytes / 1024 / 1024).toFixed(1) + " MB";
}

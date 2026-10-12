import { useEffect, useState } from "react";
import { api } from "../api";
import type { NewProjectFields, ProjectExportResult } from "../types";

type Target = "zip" | "path";

/**
 * The round trip back to Designer (#66), as `idm export` and `idm export-project` do it: the driver set (or one
 * driver) as an export XML to download, and a Designer project updated to match the tree or written new. A project
 * goes back as a zip (an existing one uploaded, or a new one named), or, for a deployer, to a directory on the
 * server's host. Every project write is previewed first; no vault password is ever written.
 */
export function DesignerExportPanel({ drivers }: { drivers: string[] }) {
  const [driver, setDriver] = useState("");
  const [deployer, setDeployer] = useState(false);
  const [hosted, setHosted] = useState(true);
  const [target, setTarget] = useState<Target>("zip");
  const [mode, setMode] = useState<"update" | "new">("update");
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [fields, setFields] = useState<NewProjectFields>({});
  const [preview, setPreview] = useState<ProjectExportResult | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .session()
      .then((s) => {
        setDeployer(!!s.user?.deployer);
        setHosted(s.mode === "hosted");
      })
      .catch(() => undefined);
  }, []);

  const reset = () => {
    setPreview(null);
    setDone(null);
    setError(null);
  };
  const ready = target === "path" ? path.trim() !== "" : mode === "new" ? name.trim() !== "" : file !== null;

  const run = async (dryRun: boolean) => {
    setBusy(dryRun ? "Previewing…" : target === "path" ? "Writing the project…" : "Building the zip…");
    setError(null);
    setDone(null);
    try {
      const f = mode === "new" ? fields : {};
      if (target === "path") {
        const r = await api.designer.project({ mode, path: path.trim(), dryRun, ...f });
        if (dryRun) {
          setPreview(r);
        } else {
          setPreview(r);
          setDone(r.ok ? `Written to ${r.path ?? path}.` : null);
        }
        return;
      }
      const r = await api.designer.projectZip(mode, dryRun, mode === "new" ? name.trim() : "", f, mode === "update" ? file : null);
      if ("blob" in r) {
        const url = URL.createObjectURL(r.blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = r.fileName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
        setDone(`Downloaded ${r.fileName}. Unzip it into your Designer workspace and import it as an existing project.`);
      } else {
        setPreview(r);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const nothing = !!preview && preview.ok && preview.createdFiles.length + preview.changedFiles.length + preview.deletedFiles.length === 0;
  const field = (key: keyof NewProjectFields, label: string, placeholder: string) => (
    <label className="field">
      <em>{label}</em>
      <input value={fields[key] ?? ""} onChange={(e) => (setFields({ ...fields, [key]: e.target.value }), reset())} placeholder={placeholder} spellCheck={false} data-testid={`dx-${key}`} />
    </label>
  );

  return (
    <div className="pad scroll" data-testid="ds-designer">
      <section className="block">
        <h3>Export XML</h3>
        <p className="muted small">The tree as a Designer export, the same file <code>idm export</code> writes, for Designer to import as a configuration file (the whole driver set, or one driver).</p>
        <div className="attrs">
          <label className="field">
            <em>What</em>
            <select value={driver} onChange={(e) => setDriver(e.target.value)} data-testid="dx-driver">
              <option value="">the whole driver set</option>
              {drivers.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
        </div>
        <a className="button" href={api.designer.exportUrl(driver || undefined)} download data-testid="dx-export-xml">
          Download export XML
        </a>
      </section>

      <section className="block">
        <h3>Designer project</h3>
        <p className="muted small">
          Update an existing project to match the tree, or write a new one for it (<code>idm export-project</code>). No vault password is ever written; Designer asks for it on its first connect. A driver removed from the tree is
          removed from a project in Designer, not here.
        </p>
        <div className="attrs">
          <label className="field">
            <em>Project</em>
            <select value={mode} onChange={(e) => (setMode(e.target.value as "update" | "new"), reset())} data-testid="dx-mode">
              <option value="update">update an existing project</option>
              <option value="new">write a new project</option>
            </select>
          </label>
          <label className="field">
            <em>Where</em>
            <select value={target} onChange={(e) => (setTarget(e.target.value as Target), reset())} data-testid="dx-target">
              <option value="zip">{mode === "update" ? "upload it as a zip, download it back" : "download it as a zip"}</option>
              <option value="path" disabled={!deployer}>
                a folder on {hosted ? "the server's host" : "this machine"}
                {deployer ? "" : " (deployers)"}
              </option>
            </select>
          </label>
          {target === "zip" && mode === "update" && (
            <label className="field wide">
              <em>Project zip</em>
              <input type="file" accept=".zip,application/zip" onChange={(e) => (setFile(e.target.files?.[0] ?? null), reset())} data-testid="dx-file" />
            </label>
          )}
          {target === "zip" && mode === "new" && (
            <label className="field">
              <em>Name</em>
              <input value={name} onChange={(e) => (setName(e.target.value), reset())} placeholder="MyProject" spellCheck={false} data-testid="dx-name" />
            </label>
          )}
          {target === "path" && (
            <label className="field wide">
              <em>Folder</em>
              <input value={path} onChange={(e) => (setPath(e.target.value), reset())} placeholder={mode === "update" ? "/path/to/workspace/MyProject" : "/path/to/workspace/NewProject (empty or not there yet)"} spellCheck={false} data-testid="dx-path" />
            </label>
          )}
          {mode === "new" && (
            <>
              {field("vaultName", "Vault name", "the tree name")}
              {field("vaultHost", "Vault host", "host or host:port")}
              {field("vaultUser", "Vault user", "cn=admin,o=system")}
              {field("server", "Server", "the engine server's name")}
              {field("serverContext", "Server context", "ou=servers,o=system")}
            </>
          )}
        </div>
        <div className="actions">
          <button onClick={() => void run(true)} disabled={!ready || busy !== null} data-testid="dx-preview">
            Preview
          </button>
          <button className="primary" onClick={() => void run(false)} disabled={!preview || !preview.ok || nothing || busy !== null} data-testid="dx-apply">
            {target === "path" ? "Write the project" : "Download the project"}
          </button>
          {busy && <span className="muted small">{busy}</span>}
        </div>
        {error && <p className="err-text">{error}</p>}
        {done && <p className="ok-text">{done}</p>}
        {preview && (
          <div className="dx-result" data-testid="dx-result">
            {preview.refusal ? (
              <p className="err-text">Refused: {preview.refusal}</p>
            ) : nothing ? (
              <p className="muted">No differences: the project already matches the tree.</p>
            ) : (
              <ul className="filelist">
                {preview.createdFiles.map((f) => (
                  <li key={`c-${f}`}>
                    <span className="badge st-added">A</span> {f}
                  </li>
                ))}
                {preview.changedFiles.map((f) => (
                  <li key={`m-${f}`}>
                    <span className="badge st-changed">M</span> {f}
                  </li>
                ))}
                {preview.deletedFiles.map((f) => (
                  <li key={`d-${f}`}>
                    <span className="badge st-deleted">D</span> {f}
                  </li>
                ))}
              </ul>
            )}
            {Object.keys(preview.mintedIds).length > 0 && <p className="muted small">{Object.keys(preview.mintedIds).length} new Designer id(s) minted.</p>}
            {preview.notes.map((n, i) => (
              <p key={i} className="muted small">
                {n}
              </p>
            ))}
            {preview.dryRun && preview.ok && !nothing && <p className="muted small">Nothing written yet.</p>}
          </div>
        )}
      </section>
    </div>
  );
}

import { useEffect, useState } from "react";
import { api } from "../api";
import type { Definition, PackagePrompts } from "../types";

interface Props {
  /** SHORT[_ver], comma-separated, base first. */
  packages: string;
  /** The driver the packages go on (a prompt's defaults may depend on its name). */
  driver?: string;
  /** The answers as the core's answers file (`name=value` lines), and whether every mandatory prompt has one. */
  onChange: (answers: string, complete: boolean) => void;
}

/** The answers file: one `name=value` per definition the person set or the package pre-filled. */
export function answersFile(values: Record<string, string>): string {
  return Object.entries(values)
    .filter(([, v]) => v !== "")
    .map(([k, v]) => `${k}=${v.replace(/\n/g, " ")}`)
    .join("\n");
}

/**
 * The questions a package set asks on install (Designer's prompt pages), as a form: each definition
 * with an input that fits its type, pre-filled by the package's prompt stylesheet. The answers go
 * to `package.install` / `driver.add` as the answers file.
 */
export function PromptsForm({ packages, driver, onChange }: Props) {
  const [data, setData] = useState<PackagePrompts | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    let gone = false;
    setData(null);
    setError(null);
    if (!packages) {
      return;
    }
    api
      .packagePrompts(packages, driver)
      .then((d) => {
        if (gone) {
          return;
        }
        setData(d);
        const init: Record<string, string> = {};
        for (const p of d.prompts) {
          for (const def of p.definitions) {
            init[def.name] = def.value ?? "";
          }
        }
        setValues(init);
        onChange(answersFile(init), d.prompts.every((p) => p.unanswered.every((u) => init[u])));
      })
      .catch((e: Error) => !gone && setError(e.message));
    return () => {
      gone = true;
    };
    // the driver name only changes the defaults; re-reading on every keystroke would lose the person's answers
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packages]);

  if (!packages) {
    return null;
  }
  if (error) {
    return <div className="banner error">{error}</div>;
  }
  if (!data) {
    return <p className="muted small">Reading the packages' questions…</p>;
  }
  if (data.prompts.length === 0) {
    return <p className="muted small">These packages ask no questions.</p>;
  }
  const set = (name: string, v: string) => {
    const next = { ...values, [name]: v };
    setValues(next);
    onChange(answersFile(next), data.prompts.every((p) => p.unanswered.every((u) => next[u])));
  };
  const field = (def: Definition) => {
    const v = values[def.name] ?? "";
    if (def.type === "boolean") {
      return (
        <select value={v} onChange={(e) => set(def.name, e.target.value)}>
          <option value="">—</option>
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      );
    }
    if (def.type === "enum" && def.choices.length > 0) {
      return (
        <select value={v} onChange={(e) => set(def.name, e.target.value)}>
          <option value="">—</option>
          {def.choices.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label || c.value}
            </option>
          ))}
        </select>
      );
    }
    return <input value={v} onChange={(e) => set(def.name, e.target.value)} spellCheck={false} placeholder={def.type === "password-ref" ? "a key in the environment's secrets file" : def.type} />;
  };
  return (
    <div className="prompts" data-testid="prompts">
      {data.prompts.map((p) => (
        <details key={p.package + p.prompt} open>
          <summary>
            <strong>{p.prompt}</strong> <span className="muted small">({p.package})</span>
            {p.unanswered.filter((u) => !values[u]).length > 0 && <span className="pill warn small">{p.unanswered.filter((u) => !values[u]).length} to answer</span>}
          </summary>
          <div className="attrs">
            {p.definitions.map((def) => (
              <label key={def.name} className={"field" + (p.unanswered.includes(def.name) && !values[def.name] ? " missing" : "")} title={def.description || def.name}>
                <em>
                  {def.displayName}
                  {p.unanswered.includes(def.name) ? " *" : ""}
                </em>
                {field(def)}
                {def.description && <span className="muted small">{def.description}</span>}
              </label>
            ))}
          </div>
          {p.passwordRefs.length > 0 && <p className="muted small">Named passwords this prompt sets: {p.passwordRefs.join(", ")} — their values come from the environment's secrets file at deploy, never from here.</p>}
        </details>
      ))}
    </div>
  );
}

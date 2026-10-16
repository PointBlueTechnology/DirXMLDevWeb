import { useEffect, useState } from "react";
import { api } from "../api";
import type { SignInCheck } from "../types";

/**
 * The top bar's warning when one of your vault sign-ins needs you (docs/connections-ui.md, Rotated passwords):
 * a rejected password, a changed or untrusted certificate, an unreachable vault, a password expiring within
 * 14 days or on grace logins. Checked when the page opens and every five minutes; each links to the environment.
 */
export function SignInAlerts({ onOpen }: { onOpen: (env: string) => void }) {
  const [problems, setProblems] = useState<SignInCheck[]>([]);
  useEffect(() => {
    let live = true;
    const load = () =>
      api.connections
        .problems()
        .then((r) => live && setProblems(r.problems))
        .catch(() => undefined);
    void load();
    const t = window.setInterval(load, 5 * 60 * 1000);
    const again = () => void load();
    window.addEventListener("idmweb:signin-changed", again);
    return () => {
      live = false;
      window.clearInterval(t);
      window.removeEventListener("idmweb:signin-changed", again);
    };
  }, []);
  if (problems.length === 0) {
    return null;
  }
  return (
    <>
      {problems.map((p) => {
        const label =
          p.state === "rejected"
            ? "password rejected"
            : p.state === "certificate"
              ? p.pinned
                ? "certificate changed"
                : "certificate not trusted"
              : p.state === "unreachable"
                ? "vault unreachable"
                : p.state === "ok" && p.graceRemaining != null
                  ? `${p.graceRemaining} grace login(s) left`
                  : p.state === "ok" && p.daysLeft != null
                    ? `password expires in ${Math.max(0, p.daysLeft)} day(s)`
                    : "sign-in failed";
        const severe = p.state !== "ok" || p.graceRemaining != null;
        return (
          <button key={p.env} className={severe ? "pill err" : "pill warn"} onClick={() => onOpen(p.env!)} title={p.message ?? ""} data-testid={"signin-alert-" + p.env}>
            {p.env}: {label}
          </button>
        );
      })}
    </>
  );
}

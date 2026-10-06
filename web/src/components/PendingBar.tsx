import { useState } from "react";
import type { Pending } from "../pending";
import { ReviewDialog } from "./ReviewDialog";

/** "N pending changes — Review / Discard", and the review dialog behind it. Every editor ends in one. */
export function PendingBar({ pending, title, onSaved }: { pending: Pending; title: string; onSaved: () => void }) {
  const [reviewing, setReviewing] = useState(false);
  if (pending.ops.length === 0 && !reviewing) {
    return null;
  }
  return (
    <div className="pendingbar">
      <span>
        <strong>{pending.ops.length}</strong> pending change{pending.ops.length === 1 ? "" : "s"}
      </span>
      <span className="muted small ellipsis">{pending.ops.map((o) => o.label).join(" · ")}</span>
      <span className="spacer" />
      <button onClick={pending.clear}>Discard</button>
      <button className="primary" onClick={() => setReviewing(true)}>
        Review changes
      </button>
      {reviewing && (
        <ReviewDialog
          title={title}
          ops={pending.ops}
          onClose={() => setReviewing(false)}
          onApplied={() => {
            setReviewing(false);
            pending.clear();
            onSaved();
          }}
        />
      )}
    </div>
  );
}

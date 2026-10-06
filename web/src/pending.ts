import { useCallback, useState } from "react";
import type { OpCall } from "./types";

/**
 * An editor's unsaved changes: a list of operations in the order they were made. A change with a
 * key replaces the earlier change with that key (editing one field twice is one operation), and
 * putting `null` for a key withdraws it (the field went back to what the tree holds).
 */
export interface Pending {
  ops: OpCall[];
  put: (key: string, op: OpCall | null) => void;
  add: (op: OpCall) => void;
  clear: () => void;
  has: (key: string) => boolean;
}

export function usePending(): Pending {
  const [ops, setOps] = useState<OpCall[]>([]);
  const put = useCallback((key: string, op: OpCall | null) => {
    setOps((current) => {
      const without = current.filter((o) => o.key !== key);
      return op ? [...without, { ...op, key }] : without;
    });
  }, []);
  const add = useCallback((op: OpCall) => setOps((current) => [...current, op]), []);
  const clear = useCallback(() => setOps([]), []);
  const has = useCallback((key: string) => ops.some((o) => o.key === key), [ops]);
  return { ops, put, add, clear, has };
}

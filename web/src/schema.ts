import { useEffect, useState } from "react";
import { api } from "./api";
import type { AppSchema, SchemaClass, SchemaData } from "./types";

// one copy of the vault schema per page load (it is a few hundred KB on a real vault); the editors'
// pickers read from it and ask for a class's attributes on demand
let cached: Promise<SchemaData> | null = null;
const classCache = new Map<string, Promise<SchemaClass>>();

export function invalidateSchema() {
  cached = null;
  classCache.clear();
}

export function loadSchema(): Promise<SchemaData> {
  if (!cached) {
    cached = api.schema().catch((e: Error) => {
      cached = null;
      throw e;
    });
  }
  return cached;
}

export function loadClass(name: string): Promise<SchemaClass> {
  let p = classCache.get(name.toLowerCase());
  if (!p) {
    p = api.schemaClass(name);
    classCache.set(name.toLowerCase(), p);
  }
  return p;
}

/** The vault schema, or null while loading / when the tree has none. */
export function useVaultSchema(): SchemaData | null {
  const [s, setS] = useState<SchemaData | null>(null);
  useEffect(() => {
    let gone = false;
    loadSchema()
      .then((d) => !gone && setS(d))
      .catch(() => !gone && setS({ present: false }));
    return () => {
      gone = true;
    };
  }, []);
  return s;
}

/** The attributes of one class (its superclasses' included), or [] until known / when the class is unknown. */
export function useClassAttributes(className: string | null): SchemaClass["attributes"] {
  const [attrs, setAttrs] = useState<SchemaClass["attributes"]>([]);
  useEffect(() => {
    let gone = false;
    setAttrs([]);
    if (!className) {
      return;
    }
    loadClass(className)
      .then((c) => !gone && setAttrs(c.attributes))
      .catch(() => !gone && setAttrs([]));
    return () => {
      gone = true;
    };
  }, [className]);
  return attrs;
}

export function useAppSchema(driver: string | null, revision: string): AppSchema | null {
  const [s, setS] = useState<AppSchema | null>(null);
  useEffect(() => {
    let gone = false;
    if (!driver) {
      return;
    }
    api
      .appSchema(driver)
      .then((d) => !gone && setS(d))
      .catch(() => !gone && setS({ driver, present: false, classes: [] }));
    return () => {
      gone = true;
    };
  }, [driver, revision]);
  return s;
}

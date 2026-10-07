import { useAppSchema, useClassAttributes, useVaultSchema } from "../schema";

/** A datalist of the vault schema's classes (NDS names; LDAP names as the label). Empty without a schema. */
export function SchemaClassList({ id, ldap }: { id: string; ldap?: boolean }) {
  const s = useVaultSchema();
  return (
    <datalist id={id}>
      {(s?.classes ?? []).map((c) => (
        <option key={c.name} value={ldap ? c.ldap : c.name}>
          {ldap ? c.name : c.ldap}
        </option>
      ))}
    </datalist>
  );
}

/** A datalist of one class's attributes (its superclasses' included; empty until read, or when the class is unknown); of every attribute when no class is given. */
export function ClassAttributeList({ id, className, ldap }: { id: string; className: string | null; ldap?: boolean }) {
  const s = useVaultSchema();
  const ofClass = useClassAttributes(className);
  const rows = className ? ofClass.map((a) => ({ name: a.name, ldap: a.ldap, note: a.mandatory ? "mandatory" : "" })) : (s?.attributes ?? []).map((a) => ({ name: a.name, ldap: a.ldap, note: "" }));
  return (
    <datalist id={id}>
      {rows.map((a) => (
        <option key={a.name} value={ldap ? a.ldap : a.name}>
          {(ldap ? a.name : a.ldap) + (a.note ? " · " + a.note : "")}
        </option>
      ))}
    </datalist>
  );
}

/** Datalists of a driver's application schema: its classes, and the attributes of one class. */
export function AppClassList({ id, driver }: { id: string; driver: string }) {
  const s = useAppSchema(driver, "");
  return (
    <datalist id={id}>
      {(s?.classes ?? []).map((c) => (
        <option key={c.name} value={c.name} />
      ))}
    </datalist>
  );
}

export function AppAttributeList({ id, driver, className }: { id: string; driver: string; className: string | null }) {
  const s = useAppSchema(driver, "");
  const cls = className ? s?.classes.find((c) => c.name === className) : null;
  const attrs = cls ? cls.attributes : (s?.classes ?? []).flatMap((c) => c.attributes);
  const seen = new Set<string>();
  return (
    <datalist id={id}>
      {attrs
        .filter((a) => (seen.has(a.name) ? false : (seen.add(a.name), true)))
        .map((a) => (
          <option key={a.name} value={a.name}>
            {a.type || ""}
          </option>
        ))}
    </datalist>
  );
}

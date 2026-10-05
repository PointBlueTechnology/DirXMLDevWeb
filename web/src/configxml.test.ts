import { describe, expect, it } from "vitest";
import { parseFilter, parseMappingTable, parseSchemaMap } from "./configxml";

describe("parseFilter", () => {
  it("reads classes and attributes with their channel settings", () => {
    const f = parseFilter(`<filter><filter-class class-name="User" publisher="sync" subscriber="ignore">
      <filter-attr attr-name="Surname" publisher="sync" subscriber="notify" merge-authority="edir"/>
      <filter-attr attr-name="Title" publisher="ignore" subscriber="sync"/></filter-class></filter>`);
    expect(f).toHaveLength(1);
    expect(f?.[0]).toMatchObject({ name: "User", publisher: "sync", subscriber: "ignore" });
    expect(f?.[0]?.attrs).toEqual([
      { name: "Surname", publisher: "sync", subscriber: "notify", mergeAuthority: "edir" },
      { name: "Title", publisher: "ignore", subscriber: "sync", mergeAuthority: "default" },
    ]);
    expect(parseFilter("<not-a-filter/>")).toBeNull();
  });
});

describe("parseSchemaMap", () => {
  it("reads class mappings, their attributes and top-level attributes", () => {
    const m = parseSchemaMap(`<attr-name-map><class-name><app-name>user</app-name><nds-name>User</nds-name>
      <attr-name><app-name>sn</app-name><nds-name>Surname</nds-name></attr-name></class-name>
      <attr-name><app-name>mail</app-name><nds-name>Internet EMail Address</nds-name></attr-name></attr-name-map>`);
    expect(m?.classes).toEqual([{ nds: "User", app: "user", attrs: [{ nds: "Surname", app: "sn" }] }]);
    expect(m?.attrs).toEqual([{ nds: "Internet EMail Address", app: "mail" }]);
  });
});

describe("parseMappingTable", () => {
  it("reads columns and rows, padding short rows", () => {
    const t = parseMappingTable(`<mapping-table><col-def name="code" type="nocase"/><col-def name="title" type="case"/>
      <row><col>eng</col><col>Engineer</col></row><row><col>mgr</col></row></mapping-table>`);
    expect(t?.columns).toEqual([{ name: "code", type: "nocase" }, { name: "title", type: "case" }]);
    expect(t?.rows).toEqual([["eng", "Engineer"], ["mgr", ""]]);
  });
});

import { describe, expect, it } from "vitest";
import { defaultQuery, parseEntitlement, writeEntitlement } from "./entitlement";

describe("entitlement definitions", () => {
  it("reads a static list", () => {
    const e = parseEntitlement('<entitlement conflict-resolution="union" description="Membership" display-name="Group Membership"><values multi-valued="true"><value>cn=a,o=x</value><value>cn=b,o=x</value></values></entitlement>');
    expect(e).toMatchObject({ displayName: "Group Membership", description: "Membership", conflict: "union", multiValued: true, mode: "static", values: ["cn=a,o=x", "cn=b,o=x"], error: null });
  });

  it("reads a query with its result tokens", () => {
    const e = parseEntitlement(
      '<entitlement conflict-resolution="priority" display-name="Mailbox"><values multi-valued="false"><query-app><query-xml><nds><input><query class-name="msExchPrivateMDB" scope="subtree"><search-class class-name="msExchPrivateMDB"/><read-attr attr-name="CN"/></query></input></nds></query-xml><result-set><display-name><token-attr attr-name="CN"/></display-name><ent-value><token-src-dn/></ent-value></result-set></query-app></values></entitlement>',
    );
    expect(e.mode).toBe("query");
    expect(e.multiValued).toBe(false);
    expect(e.query).toEqual({ className: "msExchPrivateMDB", scope: "subtree", searchClasses: ["msExchPrivateMDB"], readAttrs: ["CN"], displayName: "{CN}", description: null, value: "{src-dn}" });
  });

  it("reads an entitlement whose values come from the requester", () => {
    expect(parseEntitlement('<entitlement conflict-resolution="priority" display-name="Account"><values multi-valued="true"/></entitlement>').mode).toBe("none");
    expect(parseEntitlement('<entitlement conflict-resolution="priority" display-name="Account"/>')).toMatchObject({ mode: "none", multiValued: null });
  });

  it("writes attributes and a value list back, keeping the rest", () => {
    const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<entitlement conflict-resolution="union" description="Membership" display-name="Group Membership">\n  <!-- kept -->\n  <values multi-valued="true">\n    <value>cn=a,o=x</value>\n  </values>\n</entitlement>\n';
    const out = writeEntitlement(xml, { displayName: "Groups", description: "", conflict: "priority", multiValued: false }, ["cn=b,ou=g,o=x", "cn=c,ou=g,o=x"]);
    const back = parseEntitlement(out);
    expect(back).toMatchObject({ displayName: "Groups", description: "", conflict: "priority", multiValued: false, mode: "static", values: ["cn=b,ou=g,o=x", "cn=c,ou=g,o=x"] });
    expect(out).toContain("<!-- kept -->");
    expect(out.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(parseEntitlement(writeEntitlement(xml, { displayName: "G", description: "d", conflict: "union", multiValued: true }, null)).values).toEqual(["cn=a,o=x"]);
  });

  it("writes a query with its tokens, and a list replaces a query", () => {
    const base = '<entitlement conflict-resolution="priority" display-name="G"><values multi-valued="true"><value>x</value></values></entitlement>';
    const q = { ...defaultQuery(), className: "group", scope: "subtree", searchClasses: ["group"], readAttrs: ["CN", "description"], displayName: "{CN}", description: "Group {description} in AD", value: "{association}" };
    const withQuery = writeEntitlement(base, { displayName: "G", description: "", conflict: "priority", multiValued: true }, null, q);
    const back = parseEntitlement(withQuery);
    expect(back.mode).toBe("query");
    expect(back.query).toEqual({ className: "group", scope: "subtree", searchClasses: ["group"], readAttrs: ["CN", "description"], displayName: "{CN}", description: "Group {description} in AD", value: "{association}" });
    expect(withQuery).toContain('<nds dtdversion="2.0">');
    expect(withQuery).toContain("<token-association/>");
    const backToList = parseEntitlement(writeEntitlement(withQuery, { displayName: "G", description: "", conflict: "priority", multiValued: true }, ["a", "b"]));
    expect(backToList.mode).toBe("static");
    expect(backToList.values).toEqual(["a", "b"]);
    expect(parseEntitlement(writeEntitlement(withQuery, { displayName: "G", description: "", conflict: "priority", multiValued: true }, [])).mode).toBe("none");
  });

  it("says when the document is not an entitlement", () => {
    expect(parseEntitlement("<policy/>").error).toContain("<policy>");
    expect(parseEntitlement("<a>").error).toContain("well-formed");
  });
});

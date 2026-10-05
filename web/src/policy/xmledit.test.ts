import { describe, expect, it } from "vitest";
import { allowedChildren, childSpec, grammar, groupOf, label, spec } from "./grammar";
import { at, create, elementChildren, ops, parse } from "./xmledit";

const POLICY = `<?xml version="1.0" encoding="UTF-8"?>
<policy>
  <rule>
    <description>Veto</description>
    <conditions><and><if-op-attr name="Surname" op="changing"/></and></conditions>
    <actions><do-veto/></actions>
  </rule>
</policy>`;

const doc = (xml: string) => parse(xml)!;
const tags = (xml: string, path: number[]) => elementChildren(at(doc(xml), path)!).map((e) => e.tagName);

describe("grammar", () => {
  it("knows the language", () => {
    expect(grammar.version).toBe("4.7.5");
    expect(grammar.groups.actions).toContain("do-set-dest-attr-value");
    expect(groupOf("if-op-attr")).toBe("conditions");
    expect(groupOf("token-text")).toBe("tokens");
    expect(spec("if-op-attr").attrs.find((a) => a.name === "op")?.values).toContain("changing-to");
    expect(allowedChildren("actions")).toEqual(grammar.groups.actions);
    expect(allowedChildren("do-set-dest-attr-value")).toEqual(["arg-dn", "arg-association", "arg-value"]);
    expect(childSpec("rule", "actions")?.spec.min).toBe(1);
    expect(label("do-set-dest-attr-value")).toBe("set destination attribute value");
    expect(label("token-op-attr")).toBe("operation attribute");
  });
});

describe("create", () => {
  it("gives a new element its required attributes and children", () => {
    const d = doc("<policy/>");
    const rule = create(d, "rule");
    expect(elementChildren(rule).map((e) => e.tagName)).toEqual(["conditions", "actions"]);
    expect(elementChildren(elementChildren(rule)[0]!).map((e) => e.tagName)).toEqual(["and"]);
    const set = create(d, "do-set-dest-attr-value");
    expect(set.getAttribute("name")).toBe("");
    expect(elementChildren(set).map((e) => e.tagName)).toEqual(["arg-value"]);
    expect(create(d, "if-op-attr").getAttribute("op")).toBe("available");
  });
});

describe("ops", () => {
  it("adds actions in order and a rule's parts where the grammar puts them", () => {
    let xml = ops.add(POLICY, [0, 2], "do-set-dest-attr-value")!;
    expect(tags(xml, [0, 2])).toEqual(["do-veto", "do-set-dest-attr-value"]);
    // arg-dn belongs before arg-value even though it is added later
    xml = ops.add(xml, [0, 2, 1], "arg-dn")!;
    expect(tags(xml, [0, 2, 1])).toEqual(["arg-dn", "arg-value"]);
    // a rule's comment goes between the description and the conditions
    xml = ops.add(xml, [0], "comment")!;
    expect(tags(xml, [0])).toEqual(["description", "comment", "conditions", "actions"]);
    // a new rule arrives complete
    xml = ops.add(xml, [], "rule")!;
    expect(tags(xml, [1])).toEqual(["conditions", "actions"]);
  });

  it("sets and removes attributes and text", () => {
    let xml = ops.setAttr(POLICY, [0, 1, 0, 0], "op", "changing-to")!;
    xml = ops.setText(xml, [0, 1, 0, 0], "Smith")!;
    const cond = at(doc(xml), [0, 1, 0, 0])!;
    expect(cond.getAttribute("op")).toBe("changing-to");
    expect(cond.textContent).toBe("Smith");
    xml = ops.setAttr(xml, [0, 1, 0, 0], "mode", null)!;
    expect(at(doc(xml), [0, 1, 0, 0])!.hasAttribute("mode")).toBe(false);
    expect(ops.setText(xml, [0], "x")).toBe(xml); // an element with children keeps them
  });

  it("moves within a slot, removes, and retypes keeping what carries over", () => {
    let xml = ops.add(POLICY, [0, 2], "do-break")!;
    xml = ops.move(xml, [0, 2, 1], -1)!;
    expect(tags(xml, [0, 2])).toEqual(["do-break", "do-veto"]);
    // conditions cannot move past actions: different slots of the rule
    expect(tags(ops.move(xml, [0, 1], 1)!, [0])).toEqual(["description", "conditions", "actions"]);
    xml = ops.remove(xml, [0, 2, 0])!;
    expect(tags(xml, [0, 2])).toEqual(["do-veto"]);
    xml = ops.retype(xml, [0, 1, 0, 0], "if-src-attr")!;
    const c = at(doc(xml), [0, 1, 0, 0])!;
    expect(c.tagName).toBe("if-src-attr");
    expect(c.getAttribute("name")).toBe("Surname");
    expect(c.getAttribute("op")).toBe("available"); // "changing" is not an if-src-attr operator
  });

  it("switches every condition group between and / or", () => {
    let xml = ops.add(POLICY, [0, 1], "and")!;
    xml = ops.setGroupKind(xml, [0, 1], "or")!;
    expect(tags(xml, [0, 1])).toEqual(["or", "or"]);
    expect(at(doc(xml), [0, 1, 0])!.children[0]!.tagName).toBe("if-op-attr");
  });

  it("returns null for XML that does not parse, and pretty-prints what does", () => {
    expect(ops.add("<policy><rule></policy>", [], "rule")).toBeNull();
    const xml = ops.setText(POLICY, [0, 0], "Veto <all> & more")!;
    expect(xml).toContain("<description>Veto &lt;all&gt; &amp; more</description>");
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<policy>\n  <rule>')).toBe(true);
  });
});

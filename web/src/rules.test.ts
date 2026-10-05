import { describe, expect, it } from "vitest";
import { summarize } from "./rules";

const POLICY = `<policy>
  <rule>
    <description>Veto a surname change when the GCV says so</description>
    <conditions><and>
      <if-global-variable name="drv.veto.surname" op="equal">true</if-global-variable>
      <if-op-attr name="Surname" op="changing"/>
    </and></conditions>
    <actions><do-veto/></actions>
  </rule>
  <rule disabled="true">
    <description>Set the title</description>
    <conditions/>
    <actions>
      <do-set-dest-attr-value name="title"><arg-value type="string"><token-op-attr name="Title"/><token-text>!</token-text></arg-value></do-set-dest-attr-value>
    </actions>
  </rule>
</policy>`;

describe("summarize", () => {
  it("lists rules with their conditions and actions", () => {
    const s = summarize(POLICY);
    expect(s.kind).toBe("dirxml-script");
    expect(s.rules).toHaveLength(2);
    const [veto, title] = s.rules;
    expect(veto?.description).toBe("Veto a surname change when the GCV says so");
    expect(veto?.logic).toBe("all of");
    expect(veto?.conditions).toEqual(['if-global-variable drv.veto.surname equal "true"', "if-op-attr Surname changing"]);
    expect(veto?.actions).toEqual(["do-veto"]);
    expect(title?.disabled).toBe(true);
    expect(title?.conditions).toEqual([]);
    expect(title?.actions[0]).toBe('do-set-dest-attr-value title ← op-attr(Title) + text("!")');
  });

  it("says when a document is not DirXML Script or not XML", () => {
    expect(summarize("<attr-name-map/>").kind).toBe("other");
    const bad = summarize("<policy><rule></policy>");
    expect(bad.kind).toBe("other");
    expect(bad.error).toBeTruthy();
  });
});

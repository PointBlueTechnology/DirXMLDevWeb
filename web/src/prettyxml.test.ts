// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { prettyXml } from "./prettyxml";

describe("prettyXml", () => {
  it("puts one element per line and keeps text on its element's line", () => {
    expect(prettyXml('<nds><input><add class-name="User"><add-attr attr-name="Surname"><value type="string">Doe</value></add-attr></add></input></nds>')).toBe(
      ["<nds>", "  <input>", '    <add class-name="User">', '      <add-attr attr-name="Surname">', '        <value type="string">Doe</value>', "      </add-attr>", "    </add>", "  </input>", "</nds>", ""].join("\n"),
    );
  });

  it("escapes what it writes back", () => {
    expect(prettyXml('<a b="x &amp; &quot;y&quot;">1 &lt; 2</a>')).toBe('<a b="x &amp; &quot;y&quot;">1 &lt; 2</a>\n');
  });

  it("returns text that is not XML unchanged", () => {
    expect(prettyXml("<a><b></a>")).toBe("<a><b></a>");
  });

  it("writes an empty element closed", () => {
    expect(prettyXml("<a><b></b></a>")).toBe("<a>\n  <b/>\n</a>\n");
  });
});

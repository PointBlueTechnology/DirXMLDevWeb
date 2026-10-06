import { describe, expect, it } from "vitest";
import { fieldsOf } from "./formdoc";

describe("form fields", () => {
  it("lists components in order with what the list shows", () => {
    const r = fieldsOf(
      JSON.stringify({
        title: "Request Access",
        display: "form",
        components: [
          { key: "reason", type: "textfield", label: "Reason", validate: { required: true } },
          { key: "note", type: "textarea", label: "Note", hidden: true },
          { key: "submit", type: "button", label: "Submit" },
        ],
      }),
    );
    expect(r.title).toBe("Request Access");
    expect(r.fields.map((f) => [f.key, f.type, f.required, f.hidden, f.index])).toEqual([
      ["reason", "textfield", true, false, 0],
      ["note", "textarea", false, true, 1],
      ["submit", "button", false, false, 2],
    ]);
    expect(r.fields[0]!.siblings).toEqual(["reason", "note", "submit"]);
  });

  it("descends into panels and columns, remembering the container", () => {
    const r = fieldsOf(
      JSON.stringify({
        components: [
          { key: "panel", type: "panel", components: [{ key: "a", type: "textfield" }] },
          { key: "cols", type: "columns", columns: [{ components: [{ key: "b", type: "textfield" }] }, { components: [{ key: "c", type: "select" }] }] },
        ],
      }),
    );
    expect(r.fields.map((f) => [f.key, f.depth, f.parent, f.container])).toEqual([
      ["panel", 0, null, true],
      ["a", 1, "panel", false],
      ["cols", 0, null, true],
      ["b", 1, "cols", false],
      ["c", 1, "cols", false],
    ]);
  });

  it("reports a document that is not JSON", () => {
    expect(fieldsOf("{").error).not.toBeNull();
  });
});

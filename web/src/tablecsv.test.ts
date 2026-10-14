import { describe, expect, it } from "vitest";
import { tableCsv } from "./tablecsv";

describe("mapping table CSV", () => {
  it("writes a header then rows, quoting what needs it, as the core's export-csv does", () => {
    expect(tableCsv(["code", "dn"], [["1", "ou=a"], ["2", "ou=b,o=x"]])).toBe("code,dn\r\n1,ou=a\r\n2,\"ou=b,o=x\"\r\n");
    expect(tableCsv(["k", "v"], [["q", 'say "hi"'], ["n", "two\nlines"], [" lead", "ok"]])).toBe(
      'k,v\r\nq,"say ""hi"""\r\nn,"two\nlines"\r\n" lead",ok\r\n',
    );
    expect(tableCsv(["a", "b", "c"], [["1"]])).toBe("a,b,c\r\n1,,\r\n");
  });
});

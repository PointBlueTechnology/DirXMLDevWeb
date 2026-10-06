import { describe, expect, it } from "vitest";
import { MANAGERS, managerById, shellQuote } from "./managers";

describe("secret manager commands", () => {
  it("quotes values for the shell", () => {
    expect(shellQuote("plain")).toBe("'plain'");
    expect(shellQuote("it's")).toBe("'it'\\''s'");
  });

  it("builds each manager's command from its fields", () => {
    const h = "/opt/idmweb/bin/secrets";
    expect(managerById("aws")!.command({ secret: "idm/stg/ad", field: "password", region: "us-east-1" }, h)).toBe(
      "aws secretsmanager get-secret-value --secret-id 'idm/stg/ad' --query SecretString --output text --region 'us-east-1' | jq -r '.password'",
    );
    expect(managerById("azure")!.command({ vault: "kv", name: "ad shim" }, h)).toBe("az keyvault secret show --vault-name 'kv' --name 'ad shim' --query value -o tsv");
    expect(managerById("gcp")!.command({ name: "s", project: "p" }, h)).toBe("gcloud secrets versions access 'latest' --secret='s' --project='p'");
    expect(managerById("cyberark")!.command({ host: "h", appid: "A", safe: "S", object: "o" }, h)).toBe("/opt/idmweb/bin/secrets/cyberark-ccp.sh 'h' 'A' 'S' 'o'");
    expect(managerById("beyondtrust")!.command({ host: "h", system: "sys", account: "acct" }, h)).toBe("/opt/idmweb/bin/secrets/beyondtrust.sh 'h' 'sys' 'acct'");
    expect(managerById("bitwarden")!.command({ item: "IDM stg" }, h)).toBe("bw get password 'IDM stg'");
    expect(managerById("bitwarden")!.command({ item: "x", field: "api key" }, h)).toBe("bw get item 'x' | jq -r '.fields[] | select(.name == \"api key\") | .value'");
    expect(managerById("bws")!.command({ id: "abc" }, h)).toBe("bws secret get 'abc' | jq -r .value");
    expect(managerById("terraform")!.command({ output: "pw", dir: "/infra" }, h)).toBe("terraform -chdir='/infra' output -raw 'pw'");
    expect(managerById("command")!.command({ command: "op read x" }, h)).toBe("op read x");
  });

  it("names every manager Jerry asked for", () => {
    expect(MANAGERS.map((m) => m.id)).toEqual(["aws", "azure", "gcp", "cyberark", "beyondtrust", "bitwarden", "bws", "terraform", "command"]);
  });
});

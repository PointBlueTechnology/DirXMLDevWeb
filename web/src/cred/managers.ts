/**
 * Secret managers a credential can be read from, each as the command the core runs for a
 * `…Command=` reference (`/bin/sh -c`, stdout = the value). The page builds the command from a
 * few fields; the person can still edit the line. Nothing here holds a value.
 */
export interface ManagerField {
  key: string;
  label: string;
  placeholder?: string;
  optional?: boolean;
}

export interface Manager {
  id: string;
  name: string;
  fields: ManagerField[];
  /** What must be installed or set for the command to work, shown beside the preview. */
  needs: string;
  command: (v: Record<string, string>, helpers: string) => string;
}

/** A value for a POSIX shell: single-quoted, with embedded quotes closed and reopened. */
export function shellQuote(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

const q = shellQuote;

export const MANAGERS: Manager[] = [
  {
    id: "aws",
    name: "AWS Secrets Manager",
    fields: [
      { key: "secret", label: "Secret name or ARN", placeholder: "idm/stg/ad-shim" },
      { key: "field", label: "JSON key (if the secret is a JSON object)", optional: true, placeholder: "password" },
      { key: "profile", label: "AWS profile", optional: true },
      { key: "region", label: "Region", optional: true, placeholder: "us-east-1" },
    ],
    needs: "the aws CLI, signed in (and jq when a JSON key is given)",
    command: (v) => {
      let c = `aws secretsmanager get-secret-value --secret-id ${q(v.secret ?? "")} --query SecretString --output text`;
      if (v.profile) {
        c += ` --profile ${q(v.profile)}`;
      }
      if (v.region) {
        c += ` --region ${q(v.region)}`;
      }
      if (v.field) {
        c += ` | jq -r ${q("." + v.field)}`;
      }
      return c;
    },
  },
  {
    id: "azure",
    name: "Azure Key Vault",
    fields: [
      { key: "vault", label: "Key Vault name", placeholder: "idm-stg-kv" },
      { key: "name", label: "Secret name", placeholder: "ad-shim-password" },
    ],
    needs: "the az CLI, signed in",
    command: (v) => `az keyvault secret show --vault-name ${q(v.vault ?? "")} --name ${q(v.name ?? "")} --query value -o tsv`,
  },
  {
    id: "gcp",
    name: "Google Cloud Secret Manager",
    fields: [
      { key: "name", label: "Secret name", placeholder: "idm-stg-ad-shim" },
      { key: "project", label: "Project", optional: true },
      { key: "version", label: "Version", optional: true, placeholder: "latest" },
    ],
    needs: "the gcloud CLI, signed in",
    command: (v) => {
      let c = `gcloud secrets versions access ${q(v.version || "latest")} --secret=${q(v.name ?? "")}`;
      if (v.project) {
        c += ` --project=${q(v.project)}`;
      }
      return c;
    },
  },
  {
    id: "cyberark",
    name: "CyberArk (Central Credential Provider)",
    fields: [
      { key: "host", label: "CCP host", placeholder: "ccp.example.com" },
      { key: "appid", label: "Application ID", placeholder: "DirXMLDev" },
      { key: "safe", label: "Safe", placeholder: "IDM-STG" },
      { key: "object", label: "Object (account) name", placeholder: "ad-shim" },
    ],
    needs: "curl and python3; a client certificate through CCP_CERT / CCP_KEY, a private CA through CCP_CA",
    command: (v, helpers) => `${helpers}/cyberark-ccp.sh ${q(v.host ?? "")} ${q(v.appid ?? "")} ${q(v.safe ?? "")} ${q(v.object ?? "")}`,
  },
  {
    id: "beyondtrust",
    name: "BeyondTrust Password Safe",
    fields: [
      { key: "host", label: "Password Safe host", placeholder: "pbps.example.com" },
      { key: "system", label: "Managed system", placeholder: "ad.example.com" },
      { key: "account", label: "Managed account", placeholder: "svc-idm-shim" },
    ],
    needs: "python3; the API registration's key and run-as user in BT_API_KEY and BT_RUNAS of the shell that starts idm / idmweb",
    command: (v, helpers) => `${helpers}/beyondtrust.sh ${q(v.host ?? "")} ${q(v.system ?? "")} ${q(v.account ?? "")}`,
  },
  {
    id: "bitwarden",
    name: "Bitwarden (password manager, bw CLI)",
    fields: [
      { key: "item", label: "Item name or id", placeholder: "IDM stg AD shim" },
      { key: "field", label: "Field: password, username, notes, totp, or a custom field's name", optional: true, placeholder: "password" },
    ],
    needs: "the bw CLI, unlocked: BW_SESSION=$(bw unlock --raw) in the shell that starts idm / idmweb (jq for a custom field)",
    command: (v) => {
      const field = (v.field ?? "").trim() || "password";
      if (["password", "username", "notes", "totp", "uri"].includes(field)) {
        return `bw get ${field} ${q(v.item ?? "")}`;
      }
      return `bw get item ${q(v.item ?? "")} | jq -r ${q(`.fields[] | select(.name == "${field.replace(/"/g, '\\"')}") | .value`)}`;
    },
  },
  {
    id: "bws",
    name: "Bitwarden Secrets Manager (bws CLI)",
    fields: [{ key: "id", label: "Secret id", placeholder: "be8e0ad8-d545-4017-a55a-b02f014d4158" }],
    needs: "the bws CLI with BWS_ACCESS_TOKEN set in the shell that starts idm / idmweb, and jq",
    command: (v) => `bws secret get ${q(v.id ?? "")} | jq -r .value`,
  },
  {
    id: "terraform",
    name: "Terraform output",
    fields: [
      { key: "output", label: "Output name", placeholder: "ad_shim_password" },
      { key: "dir", label: "Terraform directory", optional: true, placeholder: "/infra/idm" },
    ],
    needs: "terraform, with that directory initialised; the value sits in Terraform state, so prefer a manager Terraform provisions the secret into",
    command: (v) => `terraform${v.dir ? ` -chdir=${q(v.dir)}` : ""} output -raw ${q(v.output ?? "")}`,
  },
  {
    id: "command",
    name: "Any command (its output is the value)",
    fields: [{ key: "command", label: "Command", placeholder: "op read op://vault/item/password" }],
    needs: "whatever the command needs",
    command: (v) => v.command ?? "",
  },
];

export function managerById(id: string): Manager | undefined {
  return MANAGERS.find((m) => m.id === id);
}

# Secret managers

A credential in the environments file or a secrets file may be a command instead of a value
(`<key>Command=…`, run with `/bin/sh -c`, stdout is the value). The Connections view writes
that line for you from a preset:

| Manager | Command written | Needs |
|---|---|---|
| AWS Secrets Manager | `aws secretsmanager get-secret-value --secret-id … --query SecretString --output text` (`\| jq -r .field` for a JSON secret) | `aws` signed in |
| Azure Key Vault | `az keyvault secret show --vault-name … --name … --query value -o tsv` | `az` signed in |
| Google Cloud Secret Manager | `gcloud secrets versions access latest --secret=…` | `gcloud` signed in |
| CyberArk CCP | `bin/secrets/cyberark-ccp.sh HOST APPID SAFE OBJECT` | `curl`, `python3`; client certificate via `CCP_CERT`/`CCP_KEY`, CA via `CCP_CA` |
| BeyondTrust Password Safe | `bin/secrets/beyondtrust.sh HOST SYSTEM ACCOUNT` | `python3`; `BT_API_KEY` and `BT_RUNAS` in the server's environment |
| Bitwarden | `bw get password "item"` (or `bw get item … \| jq` for a custom field) | `bw`, unlocked: `BW_SESSION=$(bw unlock --raw)` |
| Bitwarden Secrets Manager | `bws secret get ID \| jq -r .value` | `bws`, `BWS_ACCESS_TOKEN` |
| Terraform output | `terraform -chdir=… output -raw NAME` | `terraform`; the value is in Terraform state, so prefer a manager Terraform provisions the secret into |

Where the command runs, and who may save one, depends on the install:

| | Workstation (`serve <tree>`) | Local container and team server (hosted) |
|---|---|---|
| Runs on | your machine, as you | the server, as its own user, inside the container |
| Its environment | the shell that started the server: export `BW_SESSION`, `BT_API_KEY`, cloud profiles there | the container's: put them in `idmweb.env` |
| The manager's CLI | whatever you have installed | not in the image (it carries `git`, `python3`, `curl` and `ssh`, so the CyberArk and BeyondTrust helpers run): add `aws`, `az`, `gcloud`, `bw`, `bws`, `terraform` or `jq` in an image of your own |
| Who may save one | you | a deployer: for a vault password, an event-store password or a Git token in a person's own file, an editor keeps only the value itself (docs/security.md). Shared driver secrets are a deployer's anyway |

Keys a manager needs (an API key, a session) are themselves credentials. On a macOS workstation,
keep them in the Keychain and export them from it, e.g. `BT_API_KEY=$(security
find-generic-password -s beyondtrust -w)`; in a container, in `idmweb.env` (`0600`). On a
workstation the same lines work for the `idm` CLI, which reads the same files.

**With Terraform**: have Terraform provision the secret into the manager (`aws_secretsmanager_secret_version`,
`azurerm_key_vault_secret`, `google_secret_manager_secret_version`, …) and reference it from
here by name; nothing is copied, and a rotation in Terraform is picked up on the next read. DirXMLDev's Terraform module (`terraform/modules/idm-environment`, [docs/terraform.md](https://github.com/PointBlueTechnology/DirXMLDev/blob/master/docs/terraform.md)) writes the environments and secrets files and runs the deploy from Terraform.

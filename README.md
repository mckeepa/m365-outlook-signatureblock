# Signature Studio

Signature Studio is an early-stage Outlook signature solution. It contains a web portal prototype, an authenticated Azure Functions API for image assets and user preferences, Azure infrastructure-as-code, and a **test-only Outlook add-in proof of concept**.

> **Not production-ready.** Template authoring and publishing are still sample/in-memory data, and the Outlook add-in currently inserts fictitious `TEST ONLY` content. Do not roll it out broadly or use it in mail that could be sent externally. The add-in is not yet connected to live templates, Microsoft Graph, corporate images, saved preferences, or the audit API.

## What works today

- The Portal SPA supports template editing/preview, Entra sign-in, profile preview, selection of a user's preferred template, and a corporate image library.
- Image upload, image metadata, and user-selected template preference are persisted through the API, Cosmos DB, and private Blob Storage.
- The API enforces delegated scopes and the `Signature.TemplateAdmin` app role for image uploads. The signature-application audit endpoint is implemented but is not yet called by Outlook.
- The Outlook add-in proof of concept handles `OnNewMessageCompose` and calls `setSignatureAsync`; it uses sample data only.
- Bicep provisions the Static Web App, Functions API, Cosmos DB, private Blob Storage, VNet/private endpoints, managed identity, and monitoring resources.

The template catalog/publishing API, server-side template persistence and eligibility, production Outlook authentication/cache flow, CID image insertion, and add-in audit delivery remain to be implemented.

## Repository map

| Path | Purpose |
| --- | --- |
| `apps/portal` | Admin and user SPA prototype |
| `apps/outlook-addin` | Outlook event-based signature proof of concept |
| `services/api` | Azure Functions endpoints for image assets, user preferences, and audit events |
| `packages/signature-core` | Shared template types, rendering, and eligibility selection |
| `infra/main.bicep` | Azure resource definitions |
| `scripts/` | Guarded infrastructure deployment and rollback |

For component responsibilities, dependencies, data flows, and sequence diagrams, see [SolutionDesign.md](SolutionDesign.md). For security boundaries and phased delivery decisions, see [design.md](design.md). For infrastructure resources, persisted-data access, deployment, rollback, and cleanup, see [InfrastructureDesign.md](InfrastructureDesign.md).

## Prerequisites

- Node.js **22.12 or later** and npm. `.nvmrc` selects the Node 22 line.
- For Azure deployment: Azure CLI with Bicep, an Azure subscription, and permission to create resources and role assignments in a dedicated resource group.
- Two single-tenant Entra app registrations (Portal SPA and Template API), configured as documented in [apps/portal/README.md](apps/portal/README.md).
- For application deployment: Azure Functions Core Tools v4, the Static Web Apps CLI, and `zip`.
- An Azure region supported by each resource type. The main resources and Static Web App can use different regions; verify the current Static Web Apps region list before deployment.

## Run locally

```sh
nvm install
nvm use
npm ci
npm run dev
```

Open `http://localhost:5173`. To use Entra sign-in and the deployed preference/image API, copy `apps/portal/.env.example` to the ignored `apps/portal/.env.local` and enter the Portal SPA client ID, tenant ID, API URL, and the two API scopes. See the step-by-step app-registration and field-value guide in [apps/portal/README.md](apps/portal/README.md).

Without API configuration, the portal uses sample templates and local preview. Template authoring changes are not persisted. Never add `.env.local`, access tokens, deployment tokens, client secrets, storage keys, or private certificates to Git; the browser app must not contain client secrets.

## Validate the repository

Run these from the repository root with Node 22:

```sh
npm ci
npm test
npm run typecheck
npm run build
```

`npm run build` builds the shared package, Portal, API, and Outlook add-in assets. The add-in files are emitted under `apps/portal/dist/outlook-addin/` for deployment with the Portal. Dependency updates should use `npm install`, run `npm audit`, rerun these checks, and commit both package manifests and `package-lock.json`.

## Configure and deploy to Azure

Deploy to a **dedicated resource group**. The Bicep uses incremental deployment and the script asks for a `what-if` review and explicit confirmation; inspect the changes before typing `deploy`.

### 1. Configure Entra ID

Create and configure the **Signature Studio - Local** SPA registration and the separate **Signature Studio Template API** registration. Add the exact delegated scopes `Templates.Read` and `UserPreferences.ReadWrite` to the API; grant admin consent; create the `Signature.TemplateAdmin` user/group app role and assign it to the Communications administrators. Do not create client secrets or application permissions for the SPA.

Follow [apps/portal/README.md](apps/portal/README.md) for exact portal steps and field values. Record the SPA client ID, tenant ID, and API client ID for the next steps.

### 2. Prepare and deploy the infrastructure

Sign in, select the intended subscription, and copy the parameter example:

```sh
az login
az account set --subscription "<subscription-id>"
az bicep install
cp infra/parameters/dev.parameters.example.json infra/parameters/dev.parameters.local.json
```

Edit `infra/parameters/dev.parameters.local.json`:

- `location`: region for Functions, Cosmos, Storage, VNet, and monitoring (example: `australiaeast`).
- `staticWebAppLocation`: region supported by Static Web Apps Standard (example: `eastasia`).
- `namingPrefix`: 3–5 lowercase characters used to create unique resource names.
- `entraTenantId`: tenant ID from the Entra directory.
- `apiApplicationClientId`: client ID of **Signature Studio Template API**, not the SPA.
- `developmentOrigin`: local Portal origin (default `http://localhost:5173`).
- `vnetAddressPrefix`, `functionSubnetPrefix`, `privateEndpointSubnetPrefix`: ensure these do not overlap connected networks.
- `auditRetentionDays`: audit retention in days (example: `365`).

Tenant and client IDs are identifiers, not secrets. The local parameter file is ignored by Git. Do not add secrets to it.

Set the deployment target and run the guarded script from the repository root:

```sh
export AZURE_SUBSCRIPTION_ID="<subscription-id>"
export AZURE_RESOURCE_GROUP="rg-outlook-signature-dev"
export AZURE_LOCATION="australiaeast"
bash scripts/deploy-azure.sh infra/parameters/dev.parameters.local.json
```

The script creates the resource group if needed, validates Bicep, displays a `what-if`, and proceeds only if you type `deploy`. Save the deployment outputs, especially the Function App name, Static Web App name/URL, Cosmos account, Blob account/container, and managed-identity principal ID.

### 3. Configure the Portal and deploy the API

Copy the portal environment example and fill in values:

```sh
cp apps/portal/.env.example apps/portal/.env.local
```

Set these values in `apps/portal/.env.local`:

```dotenv
VITE_ENTRA_CLIENT_ID=<Signature-Studio-Local-SPA-client-id>
VITE_ENTRA_TENANT_ID=<Entra-directory-tenant-id>
VITE_TEMPLATE_API_URL=https://<function-app-name>.azurewebsites.net
VITE_TEMPLATE_API_SCOPE=api://<Template-API-client-id>/UserPreferences.ReadWrite
VITE_TEMPLATE_READ_SCOPE=api://<Template-API-client-id>/Templates.Read
```

Use the API app's client ID in **both** scope values; the API URL has no `/api` suffix. These `VITE_` values are public client configuration. Never put a secret in them.

Build the API, create a Linux x64 deployment package so `sharp` matches the Function App runtime, and deploy the zip. Run this from the repository root on Linux x64 (or a matching Linux CI runner) with Node 22, Azure CLI, and `zip`:

```sh
npm run build --workspace=@signature/api
DEPLOY_DIR="$(mktemp -d)"
ZIP_FILE="${DEPLOY_DIR}.zip"
trap 'rm -rf "$DEPLOY_DIR"; rm -f "$ZIP_FILE"' EXIT
cp -R services/api/dist "$DEPLOY_DIR/dist"
find "$DEPLOY_DIR/dist" -name '*.test.*' -delete
cp services/api/host.json "$DEPLOY_DIR/host.json"
node -e 'const fs=require("node:fs"); const p=JSON.parse(fs.readFileSync("services/api/package.json","utf8")); fs.writeFileSync(process.argv[1],JSON.stringify({name:p.name,version:p.version,private:p.private,type:p.type,main:p.main,dependencies:p.dependencies},null,2))' "$DEPLOY_DIR/package.json"
npm install --prefix "$DEPLOY_DIR" --omit=dev --no-audit --no-fund
(cd "$DEPLOY_DIR" && zip -qr "$ZIP_FILE" .)
az functionapp deployment source config-zip \
  --resource-group "$AZURE_RESOURCE_GROUP" \
  --name "<function-app-name>" \
  --src "$ZIP_FILE"
```

The temporary directory is removed when the shell exits. Confirm all six functions are listed:

```sh
az functionapp function list --resource-group "$AZURE_RESOURCE_GROUP" --name "<function-app-name>" --query "[].name" -o table
```

An unauthenticated `GET https://<function-app-name>.azurewebsites.net/api/images` should return `401` from Easy Auth.

### 4. Build and deploy the Portal and add-in assets

Set `OUTLOOK_ADDIN_BASE_URL` to the deployed Static Web App origin plus `/outlook-addin`. The add-in's generated manifest needs the final HTTPS origin:

```sh
OUTLOOK_ADDIN_BASE_URL="https://<static-web-app-hostname>/outlook-addin" npm run build
```

Install the [Azure Static Web Apps CLI](https://azure.github.io/static-web-apps-cli/), retrieve a deployment token just in time, then deploy the full Portal bundle:

```sh
npm install -g @azure/static-web-apps-cli
SWA_TOKEN="$(az staticwebapp secrets list \
  --name "<static-web-app-name>" \
  --resource-group "$AZURE_RESOURCE_GROUP" \
  --query "properties.apiKey" -o tsv)"
swa deploy apps/portal/dist --deployment-token "$SWA_TOKEN" --env production
unset SWA_TOKEN
```

Treat the deployment token as a secret. Do not save it in the repository, `.env` files, or shell scripts. After the first successful deployment, add `https://<static-web-app-hostname>/auth-redirect.html` as a **Single-page application** redirect URI on the SPA registration.

The add-in manifest and pages are deployed as static files but are **not automatically installed** into Outlook. Only upload the generated manifest to the Microsoft 365 admin center for a tightly scoped test group after reviewing the test-only warning and steps in [apps/outlook-addin/README.md](apps/outlook-addin/README.md).

### 5. Verify configuration and access

- In the SPA registration, confirm Graph delegated `User.Read` and API delegated `Templates.Read` and `UserPreferences.ReadWrite` show admin consent granted.
- In the API registration, confirm both scopes are enabled and `Signature.TemplateAdmin` is assigned to the intended user/group through **Enterprise applications > Users and groups**.
- Confirm the Function App requires Easy Auth; its system-assigned managed identity has Cosmos data-plane Contributor and Storage data roles; Cosmos and Storage public access are **Disabled**; private endpoints and DNS are approved.
- Sign in to the Portal, verify profile preview and template preference, then upload and preview an image with a user assigned `Signature.TemplateAdmin`. Expect unauthenticated API access to return `401`, missing authorization to return `403`, and a successful upload to return `201`.
- Use [InfrastructureDesign.md](InfrastructureDesign.md#5-how-platform-admins-can-safely-view-persisted-data-for-troubleshooting) for safe, least-privilege Cosmos and Blob troubleshooting access. Do not make data stores public as a troubleshooting shortcut.

## Rollback and cleanup

For an application rollback, redeploy the previously built API or Portal artifact and restore the prior add-in manifest/assignment. For infrastructure changes, use the guarded [rollback script](scripts/rollback-azure.sh) with the last known-good Bicep file and matching parameters. Cleanup and data recovery are separate: see the full [InfrastructureDesign.md](InfrastructureDesign.md) runbook before deleting resources or handling persisted data.

## License

This project is licensed under the permissive MIT License. See [LICENSE](LICENSE).

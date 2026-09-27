# Outlook Signature Management

First-party Outlook signature management with an administrator portal, an Outlook add-in, and a template API. Entra profile fields are read from Microsoft Graph on demand and are never synchronized or persisted by this application.

## Workspace

- `apps/portal`: local admin and end-user selection prototype.
- `apps/outlook-addin`: planned Office.js task pane and compose-event runtime.
- `services/api`: planned published-template API and administrator write API.
- `packages/signature-core`: shared template model, safe placeholder rendering, and selection rules.
- `infra/main.bicep`: Azure foundation for the portal, API, private template database, and private image storage.
- `scripts/deploy-azure.sh` / `scripts/rollback-azure.sh`: guarded infrastructure deployment and non-destructive rollback.
- `design.md`: security boundaries, client constraints, and phased delivery plan.

## Run the portal prototype

Use Node.js 22.12 or later, matching the Azure Functions runtime, Vite 8, and the Azure SDKs. The repository's `.nvmrc` selects the Node 22 line.

```sh
nvm install
nvm use
npm ci
npm run dev
```

The portal uses in-memory sample templates and preferences. Entra/Graph profile preview works after the local SPA registration is configured as described in [apps/portal/README.md](apps/portal/README.md). Templates are not yet connected to the API or persisted; changes disappear when the page reloads.

## Validate

```sh
npm test
npm run typecheck
npm run build
```

The committed `package-lock.json` pins the full dependency graph. After intentional dependency updates, use Node 22 and run `npm install`, `npm audit`, the validation commands above, and commit both package manifests and the updated lockfile. Keep `@types/node` on Node 22 to match the deployed runtime APIs.

## Current boundary

The portal is a standard web SPA. It can manage templates and user preferences, but it does not run inside an Outlook compose item and cannot insert a signature into a message. Outlook's `setSignatureAsync` is an Office.js API used by an Outlook add-in; it inserts or replaces content in the current compose item, but does not create native Outlook **Insert Signature** entries. The add-in runtime and manifest are therefore required for compose-time insertion. The portal and add-in can share code and be hosted together, but Outlook still needs the add-in integration and deployment.

The per-user preference and application-audit API routes are implemented. Corporate PNG/JPEG images can now be uploaded through an authenticated API, normalized and validated on the server, and persisted in private Blob Storage with metadata in Cosmos DB. The portal loads the image catalog through the API and supports drag-and-drop or catalog selection in the rich-text editor; editor HTML refers to stable asset IDs. The **My Signatures** page labels the organization default, lets users explicitly select their eligible template, and previews that selected template. Template data itself is still sample/in-memory and the Outlook event runtime/caller and manifest deployment remain to be implemented.

### Current implementation and release gaps

- Supported profile placeholders are `{{displayName}}`, `{{email}}`, `{{jobTitle}}`, `{{department}}`, and `{{businessPhone}}`. The email placeholder maps to Graph's `mail` value (falling back to `userPrincipalName` in the portal). `{{mail}}` is not a supported token.
- The saved preference API persists only the selected template ID. Favorites are currently in-memory portal UI state; they are not persisted in Cosmos or Outlook roaming settings, and are not shared between the portal and add-in.
- Corporate images are persisted in the private `signature-assets` Blob container, with Cosmos metadata, and are served only through authenticated API routes. API writes require `Templates.Read` and the `Signature.TemplateAdmin` app role; all image reads require `Templates.Read`. The server verifies and re-encodes static PNG/JPEG uploads, strips metadata, and enforces a 1 MiB request/normalized-image limit and 1600 × 1200 pixel dimensions. Browser object URLs are temporary display caches, not the image store.
- **My Signatures** lists profile-eligible templates. Each row shows the organization default where applicable and has an explicit **Select** action to save the user's choice through the preference API when configured; the preview follows that active selection. That saved choice is intended for the Outlook add-in; the SPA itself still cannot update Outlook's native signature or compose body.
- The audit handler enforces a 4 KiB limit while reading the request body, as well as checking a declared `Content-Length`.
- The Static Web Apps configuration sets CSP and other security headers. The build adds only the exact HTTPS API origin from `VITE_TEMPLATE_API_URL` to CSP; without that setting, the API is excluded. Verify the MSAL redirect flow in the deployed environment.
- GitHub Actions CI runs tests, type checks, builds, and `npm audit` on Node.js 22.14.

## User Selection, Outlook Application, and Audit

### Which signatures a user can see

After silent Entra sign-in, **My Signatures** lists Signature Studio templates eligible for the user's Graph profile and previews the selection with those values. The current list still comes from sample data; the published-template API and server-side eligibility source remain to be implemented. It cannot list signatures saved through Outlook's native signature settings.

### How Outlook applies the choice

The intended Outlook add-in flow is:

1. On authenticated template refresh, Outlook downloads the user's eligible published templates and any referenced approved images. The add-in caches the versioned package; compose activation does not call the template/image service.
2. The add-in reads the user's selected template ID from the authenticated preference API. If no choice exists, is stale, or is no longer eligible, it selects the eligible organization default.
3. On new message/reply/forward compose, the event handler reads fresh Graph fields in memory, renders the selected cached template, and calls `setSignatureAsync`. For images, it attaches the cached PNG/JPEG bytes inline and references them using CID.
4. `setSignatureAsync` inserts/replaces the signature in that compose item's body. It does not create a native Outlook **Insert Signature** entry, rewrite old drafts, or guarantee the user won't later edit/remove it.

The preference API stores only the selected template ID under the API-validated Entra object ID. It never stores tokens, profile fields, rendered signatures, or message content. The portal and Outlook add-in share this preference, so a choice made in **My Signatures** is intended to become the add-in's default. The preference route is implemented, but it needs API configuration and the Outlook add-in caller is not built yet.

### Application audit

After `setSignatureAsync` reports success, the add-in will send an idempotent audit event to the authenticated API. The API derives the user's Entra object ID from the validated access token; it must not trust a client-supplied user ID. The audit record contains only:

- Entra user object ID
- Template ID and version
- Unique event ID and `applied-to-compose` outcome
- Server-generated UTC timestamp

It must not contain the user's email address or profile fields, message ID/body, subject, recipients, or attachments. The API stores these events in the separate `SignatureApplicationAudit` Cosmos container, with read access restricted to the audit role and TTL set by the approved retention policy (`auditRetentionDays`, currently 365 days in the example parameters).

The API now implements `POST /api/audit/signature-applications`: Easy Auth supplies the validated principal, the handler verifies tenant/object ID/`Templates.Read`, validates the minimal event payload, and writes idempotently to Cosmos using managed identity. An `applied-to-compose` record means Outlook accepted the insertion API call. It does **not** prove the message was sent/delivered or that the user did not subsequently edit the signature. The Outlook-side sender, pending-event retry/outbox, published-template endpoints, and audit report UI are not implemented yet; until those exist, the audit endpoint is not called by Outlook and does not record production applications.

## Azure Setup

The infrastructure below is a deployable foundation, not a production release. It creates Azure resources but does not deploy the Function API source, publish the portal bundle, or install the Outlook add-in. Those application components and their authorization tests must be completed before users receive the service.

For a Platform Administrator-oriented explanation of every resource, its dependencies, how to safely inspect persisted data for troubleshooting, and fully detailed deploy/rollback/cleanup runbooks with diagrams, see [InfrastructureDesign.md](InfrastructureDesign.md).

### Resources and security

`infra/main.bicep` provisions:

- Azure Static Web Apps Standard for the portal.
- A Linux Azure Functions Premium EP1 plan and Function App. The API endpoint requires an Entra token through App Service Authentication; the API code must still enforce administrator app roles for write operations.
- A serverless Cosmos DB account with local/key authentication disabled, a private endpoint, and seven-day continuous backup. It has separate `Templates`, `UserSignaturePreferences`, and `SignatureApplicationAudit` containers; audit TTL is controlled by `auditRetentionDays` (365 days in the example parameter file).
- A ZRS Storage account with shared-key and public access disabled. Its private `signature-assets` container has Blob versioning and 14-day soft delete. The Function App's managed identity receives only the data roles needed for Functions host storage, image access, and Cosmos data access.
- A VNet, private DNS zones/links, and private endpoints for Cosmos DB and Function Storage. The Function App uses VNet integration to reach these services.
- Log Analytics and Application Insights with 30-day Log Analytics retention.

The Static Web App and authenticated Function HTTPS endpoint are reachable by Outlook clients; Cosmos and Blob data endpoints are private. The API's Entra registration is separate from the portal SPA registration. Do not deploy into a resource group containing unrelated resources: ARM's built-in rollback-on-error can replay a prior deployment in complete mode. The scripts here instead use incremental deployments and a reviewed, known-good Bicep file for rollback.

The default VNet range is `10.42.0.0/16` with `/24` Function and private-endpoint subnets. Check that these ranges do not overlap any connected corporate network and change the parameter file if they do. The Function Premium plan, Static Web Apps Standard, VNet, private endpoints, Cosmos DB, and logging have ongoing costs; this is not a zero-cost setup. Review the Azure estimate before deployment.

### Prerequisites

- Azure CLI with Bicep (`az bicep install` if needed), and an authenticated account (`az login`).
- A dedicated resource group and subscription selected for the deployment.
- Two single-tenant Entra app registrations, configured exactly as in [apps/portal/README.md](apps/portal/README.md#register-the-portal-spa-app-registration):
	- **Portal SPA** (`Signature Studio - Local`): SPA redirect URI(s) ending in `/auth-redirect.html`, delegated Graph `User.Read`, and delegated access to the API's `Templates.Read` and `UserPreferences.ReadWrite` scopes (added via **API permissions > Add a permission > My APIs**, then admin-consented). Put its client and tenant IDs in `apps/portal/.env.local`.
	- **Template API** (`Signature Studio Template API`): a separate registration. Its Application ID URI is `api://<api-client-id>` using its own client ID. It exposes delegated scopes `Templates.Read` and `UserPreferences.ReadWrite` (both **Admins only** consent). It defines the app role `Signature.TemplateAdmin` (**Allowed member types:** Users/Groups), assigned under **Enterprise applications > Signature Studio Template API > Users and groups** to the Communications administrator account or security group. Record this API app's Application (client) ID for the `apiApplicationClientId` Bicep parameter. The API implementation enforces `Templates.Read` for template/image reads, `UserPreferences.ReadWrite` for the caller's own preference, and `Signature.TemplateAdmin` for image/template writes. Do not grant application permissions or create client secrets for either app registration.
- The deployment identity needs resource write permissions on the target resource group and permission to create the managed-identity role assignments in it (for example, Contributor plus User Access Administrator scoped to the dedicated resource group). Creating a new resource group also requires subscription-level permission.
- A region for the main resources (Function, Cosmos, Storage, VNet) and a separate, more limited region for the Static Web App if they differ. As of this writing Static Web Apps Standard is only available in `centralus`, `eastus2`, `westus2`, `westeurope`, and `eastasia`; check the [current list](https://learn.microsoft.com/en-us/azure/static-web-apps/overview) before deploying, since most Azure regions (for example `australiaeast`) are not supported for this resource type.

### Configure and deploy

Sign in and select the intended subscription:

```sh
az login
az account set --subscription "<subscription-id>"
az bicep install
```

Copy the example parameter file. It is ignored by Git so your tenant and app IDs remain local:

```sh
cp infra/parameters/dev.parameters.example.json infra/parameters/dev.parameters.local.json
```

Edit `infra/parameters/dev.parameters.local.json` and replace the placeholder tenant ID and API application client ID. Set `location` for the main resources, `staticWebAppLocation` for the Static Web App (see the region list above), a 3-to-5-character lowercase `namingPrefix`, and non-overlapping VNet/subnet ranges. These IDs are identifiers, not secrets. Never put a client secret, token, storage key, or private certificate in this file.

Set deployment target values and run the script from the repository root. `AZURE_LOCATION` should match the `location` parameter in the JSON file:

```sh
export AZURE_SUBSCRIPTION_ID="<subscription-id>"
export AZURE_RESOURCE_GROUP="rg-outlook-signature-dev"
export AZURE_LOCATION="australiaeast"
bash scripts/deploy-azure.sh infra/parameters/dev.parameters.local.json
```

The script validates the Bicep, shows `what-if`, asks for the exact word `deploy`, then applies an incremental resource-group deployment with a unique history name. Review the proposed changes before confirming. Outputs include the Static Web App URL, API URL, Cosmos account, and Blob container. Build and deploy the application code separately; no application binaries or user data are uploaded by the infrastructure script.

### Deploy the application code

The infrastructure script only provisions resources; it does not upload the API or portal code. Do this once the Function App and Static Web App exist.

**API (Azure Functions, Node 22 on Linux):** install [Azure Functions Core Tools](https://learn.microsoft.com/en-us/azure/azure-functions/functions-run-local) v4 (`npm install -g azure-functions-core-tools@4`; requires Node 22.12+ locally to install and run). From `services/api`, run `npm run build` to compile to `dist/`, then either `func azure functionapp publish <function-app-name>` from a folder containing `host.json`, the compiled `dist/*.js`, and a trimmed `package.json` with only the runtime `dependencies` (no dev dependencies or `.test.js` files), or zip that folder and run `az functionapp deployment source config-zip --resource-group <rg> --name <function-app-name> --src <zip>`. Because `sharp` is a native module, build/zip on a Linux x64 host (or Linux CI runner) to match the Function App's Linux runtime; installing on macOS/Windows will produce the wrong native binary. Confirm with `az functionapp function list --resource-group <rg> --name <function-app-name>` that all six functions are listed, then `curl -i https://<function-app-name>.azurewebsites.net/api/images` should return `401` (Easy Auth blocking an anonymous request).

**Portal (Static Web App):** set `apps/portal/.env.local` (or CI environment variables) to the deployed `templateApiUrl` and the two API scopes, then `npm run build --workspace=@signature/portal` from the repository root. Install the [Static Web Apps CLI](https://azure.github.io/static-web-apps-cli/) (`npm install -g @azure/static-web-apps-cli`), fetch a deployment token with `az staticwebapp secrets list --name <static-app-name> --resource-group <rg> --query "properties.apiKey" -o tsv`, then run `swa deploy apps/portal/dist --deployment-token <token> --env production` from the repository root. Treat the deployment token as a secret: never commit it, and prefer `az staticwebapp secrets list` at deploy time over storing it long-lived. After the Static Web App has a successful first deployment, add its `https://<default-hostname>/auth-redirect.html` URL as an additional SPA redirect URI on the portal's app registration so interactive sign-in works from that URL too.

### Verify the Azure deployment

In **App registrations > Signature Studio - Local > API permissions**, confirm Microsoft Graph `User.Read` **and** both delegated `UserPreferences.ReadWrite` and `Templates.Read` permissions are listed under your Template API (not under Microsoft Graph), each showing a green "Granted for `<tenant name>`" checkmark rather than an orange "Not granted" warning triangle. If a permission is missing, add it through **Add a permission > My APIs > [Template API] > Delegated permissions**; if consent is missing, select **Grant admin consent for `<tenant name>`**. In the API app registration, confirm both scopes are listed under **Expose an API**.

For administrator image uploads, open **App registrations > [Template API] > App roles** and confirm the enabled user/group role value is exactly `Signature.TemplateAdmin`. Then open **Enterprise applications > [Template API] > Users and groups** and confirm the Communications admin or group is assigned that role. A role definition without an assignment does not put the role in the user's access token. Sign out and back in after changing scopes or role assignments so the SPA requests a fresh token.

Check private networking and managed identity in the deployed resource group's Azure portal pages:

- **Function App > Identity > System assigned:** status is On; its object ID matches the deployment output `functionManagedIdentityPrincipalId`. Under **Networking > VNet integration**, confirm integration with `snet-functions` in the solution VNet and that outbound routing is enabled for private endpoints.
- **Function App > Authentication:** require authentication and return 401 for unauthenticated requests. The Function routes are `authLevel: anonymous` because Easy Auth is the authentication boundary.
- **Storage account > Networking:** public network access is Disabled, blob public access and shared-key access are disabled, and the blob private endpoint connection is Approved. The storage account's **Access control (IAM) > Role assignments** should show the Function App identity as **Storage Blob Data Contributor**. Functions host storage also uses managed identity for the Blob, Queue, and Table data roles.
- **Cosmos DB account > Networking:** public network access is Disabled and its private endpoint is Approved. Under **Data Explorer > Role assignments** (data-plane roles), confirm the Function App identity has **Cosmos DB Built-in Data Contributor**. The Azure resource **Access control (IAM)** list is not the Cosmos SQL data-plane role list.
- **Private DNS zones:** confirm the relevant `privatelink.blob.core.windows.net` and `privatelink.documents.azure.com` zones are linked to the solution VNet and have the private endpoint records. The Function App must resolve the storage and Cosmos service hostnames to private IP addresses from its VNet.

The deployment outputs the storage account, image container, Cosmos account, and Function managed-identity principal ID; use these to identify the resources above. A successful authorized `GET <templateApiUrl>/images` from the configured SPA confirms the end-to-end auth, Function-to-Cosmos, and Function-to-Blob path only if the catalog contains an image and its download succeeds. Test upload separately with an assigned template admin. Expect an unauthenticated call to return 401, a signed-in caller without `Templates.Read` or the upload app role to receive 403, and an authorized image upload to return 201. Never make Blob or Cosmos public as a troubleshooting shortcut. Private endpoints intentionally prevent a developer laptop from connecting to these data services directly; the portal talks to the authenticated API, which accesses them from the VNet.

### Rollback and data recovery

To revert infrastructure properties, supply the last known-good Bicep file and its matching parameter file. For example, retrieve the known-good template from source control, then review and apply it:

```sh
git show <known-good-commit>:infra/main.bicep > /tmp/signature-main-known-good.bicep
bash scripts/rollback-azure.sh /tmp/signature-main-known-good.bicep infra/parameters/dev.parameters.local.json
```

The rollback script validates and previews the change, requires typing `rollback`, and reapplies in **Incremental** mode. It does not delete resources that were added after the known-good template. Review those separately; do not use complete mode or delete the resource group as a routine rollback.

Infrastructure rollback does **not** reverse data changes. Cosmos continuous backup supports point-in-time restore to a new account; validate the restored account before changing the API endpoint. Blob versioning and soft delete allow recovery of prior image versions/deletions. Keep and test a separate data-recovery procedure. The scripts do not automatically restore or overwrite database/blob contents.

### Signature images and recipient rendering

Administrators will upload approved images through the authenticated API. The Function App's managed identity writes image bytes to the private Blob container; templates store stable asset IDs, not public URLs or storage credentials. The add-in's scheduled/next-active refresh retrieves each published template and its referenced image bytes and caches them together. Compose insertion uses `addFileAttachmentFromBase64Async` with inline attachment options and an HTML `cid:` reference.

This is the intended add-in delivery contract, not implemented yet: the add-in should make the outgoing email self-contained by attaching image bytes inline and referencing them by CID, rather than relying on Blob or third-party URLs. Inline images increase message size and can appear in recipients' attachment lists. The API currently validates static PNG/JPEG content, normalizes metadata, and limits uploads to 1 MiB and 1600 × 1200 pixels. The future template publishing and Outlook add-in flow must preserve those restrictions, require alt text, and convert approved asset IDs to CID attachments. Test external recipients, mobile clients, dark mode, replies/forwards, and image-stripping policies before production.

The authenticated image catalog/upload/read API is implemented. The image store persists assets, but the template catalog/editor save flow still uses sample templates held in portal memory. Published-template APIs, Outlook image CID insertion, the audit event sender, and audit report UI are planned, not active. Signature selection is persisted only through the preference API; Outlook roaming-setting persistence is not part of the design.

## License

This project is licensed under the permissive MIT License. See [LICENSE](LICENSE) for the full terms.

### References

- [Deploy Bicep with Azure CLI](https://learn.microsoft.com/en-us/azure/azure-resource-manager/bicep/deploy-cli)
- [ARM deployment modes](https://learn.microsoft.com/en-us/azure/azure-resource-manager/templates/deployment-modes)
- [Roll back to a previous successful ARM deployment](https://learn.microsoft.com/en-us/azure/azure-resource-manager/templates/rollback-on-error)
- [Azure Static Web Apps application registration](https://learn.microsoft.com/en-us/entra/identity-platform/scenario-spa-app-registration)
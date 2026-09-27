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

The per-user preference and application-audit API routes are implemented; published-template/image routes, the Outlook event runtime/caller, production image upload UI, and manifest deployment remain to be implemented.

### Current implementation and release gaps

- Supported profile placeholders are `{{displayName}}`, `{{email}}`, `{{jobTitle}}`, `{{department}}`, and `{{businessPhone}}`. The email placeholder maps to Graph's `mail` value (falling back to `userPrincipalName` in the portal). `{{mail}}` is not a supported token.
- The saved preference API persists only the selected template ID. Favorites are currently in-memory portal UI state; they are not persisted in Cosmos or Outlook roaming settings, and are not shared between the portal and add-in.
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
- Two single-tenant Entra app registrations:
	- **Portal SPA:** add the local SPA redirect URI `http://localhost:5173`, delegated Graph `User.Read`, and delegated access to the API's published-template read scope. Put its client and tenant IDs in `apps/portal/.env.local` as described in [apps/portal/README.md](apps/portal/README.md).
	- **Template API:** register another single-tenant app. Under **Expose an API**, set the Application ID URI to `api://<api-client-id>` and add delegated scopes `Templates.Read` and `UserPreferences.ReadWrite`. Under **App roles**, add user/group roles with values `Signature.TemplateAdmin` and `Signature.AuditReader`; assign the former to the Communications security group and the latter to the approved audit-reader group under **Enterprise applications > Users and groups**. Record this API app's Application (client) ID. The API implementation must enforce `Templates.Read` for template reads, `UserPreferences.ReadWrite` for the caller's own preference, `Signature.TemplateAdmin` for template/image writes, and `Signature.AuditReader` for audit reports. In the Portal SPA registration, add both delegated API scopes under **API permissions > My APIs**. Do not grant application permissions or create client secrets for either browser app.
- The deployment identity needs resource write permissions on the target resource group and permission to create the managed-identity role assignments in it (for example, Contributor plus User Access Administrator scoped to the dedicated resource group). Creating a new resource group also requires subscription-level permission.
- A region supported by Azure Static Web Apps and available for the other resources.

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

Edit `infra/parameters/dev.parameters.local.json` and replace the placeholder tenant ID and API application client ID. Set `location`, a 3-to-5-character lowercase `namingPrefix`, and non-overlapping VNet/subnet ranges. These IDs are identifiers, not secrets. Never put a client secret, token, storage key, or private certificate in this file.

Set deployment target values and run the script from the repository root. `AZURE_LOCATION` should match the `location` parameter in the JSON file:

```sh
export AZURE_SUBSCRIPTION_ID="<subscription-id>"
export AZURE_RESOURCE_GROUP="rg-outlook-signature-dev"
export AZURE_LOCATION="australiaeast"
bash scripts/deploy-azure.sh infra/parameters/dev.parameters.local.json
```

The script validates the Bicep, shows `what-if`, asks for the exact word `deploy`, then applies an incremental resource-group deployment with a unique history name. Review the proposed changes before confirming. Outputs include the Static Web App URL, API URL, Cosmos account, and Blob container. Build and deploy the application code separately; no application binaries or user data are uploaded by the infrastructure script.

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

This makes the outgoing email self-contained: the recipient's Outlook loads the image from the message's inline attachment, not from the organization's Blob endpoint or a third-party image host. Inline images increase message size and can appear in the recipient's attachment list in some clients. The upload implementation should initially allow PNG/JPEG only, validate file content and dimensions server-side, require alt text, and enforce a small configurable size/count limit. SVG, remote image URLs, tracking pixels, and arbitrary embedded HTML are not allowed. Test external recipients, mobile clients, dark mode, replies/forwards, and image-stripping policies before production.

The editor currently does not implement image upload; this storage and delivery path is the infrastructure/design contract for that next feature. Published-template/image API routes, the audit event sender, and audit report UI are planned, not active. Signature selection is persisted only through the preference API; Outlook roaming-setting persistence is not part of the design. Until the published-template API is built, the portal's available-signature list is derived from its in-memory sample templates and the signed-in user's profile.

## License

This project is licensed under the permissive MIT License. See [LICENSE](LICENSE) for the full terms.

### References

- [Deploy Bicep with Azure CLI](https://learn.microsoft.com/en-us/azure/azure-resource-manager/bicep/deploy-cli)
- [ARM deployment modes](https://learn.microsoft.com/en-us/azure/azure-resource-manager/templates/deployment-modes)
- [Roll back to a previous successful ARM deployment](https://learn.microsoft.com/en-us/azure/azure-resource-manager/templates/rollback-on-error)
- [Azure Static Web Apps application registration](https://learn.microsoft.com/en-us/entra/identity-platform/scenario-spa-app-registration)
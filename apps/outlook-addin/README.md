# Outlook add-in: test and deployment runbook

> **Test only — not production-ready.** The add-in currently inserts conspicuous `TEST ONLY` content with fictitious profile values. It does not fetch a live template, call Microsoft Graph or the Signature Studio API, load corporate images, honor saved preferences, or write an audit event. Do not deploy it broadly and do not send a message containing the sample signature.

This document is the practical deployment and hand-off guide. For component design, dependencies, sequence diagrams, security boundaries, operations, and detailed troubleshooting, see [Design.md](Design.md). For shared Azure resources and platform operations, see [InfrastructureDesign.md](../../InfrastructureDesign.md).

## Current pilot status

- Target clients: Outlook on the web and new Outlook for Windows.
- Add-in type: Outlook add-in-only XML manifest, with `OnNewMessageCompose` event-based activation.
- Current pilot deployment is in the development Static Web App. Get its hostname from the Azure deployment output or Static Web App resource in the Azure portal; don't rely on a repository-published environment-specific URL.
- Current manifest version: `1.0.1.0`, generated at `apps/portal/dist/outlook-addin/manifest.xml`.
- The static add-in pages and manifest are reachable from the Static Web App. The add-in is **not confirmed installed** in the test mailbox.
- Two Outlook **My add-ins → Custom Addins → Add from File** attempts ended in generic installation failures. No actionable error code was shown.
- The hosted Office manifest acceptance check returned contradictory package/product-ID errors, although Microsoft's local manifest tool parses the XML as a `MailApp` with a GUID. Treat hosted validation as unresolved.
- An Exchange Online PowerShell attempt in Linux Azure Cloud Shell did not deploy anything: its `Connect-ExchangeOnline` lacked `-UserPrincipalName`; `-Device` sign-in failed with `AADSTS900561`; and the script continued into file-path errors because Linux did not define `$env:TEMP`.
- **Do not repeat those failed attempts or use Integrated apps → Upload custom apps for this XML.** That screen requests a ZIP package for a different app flow. The supported next diagnostic is a mailbox-scoped Exchange Online deployment from Windows PowerShell, described below.

The generic Outlook failure does not establish whether the root cause is the sideload path, a manifest rule, tenant policy, or the Outlook service. The updated manifest uses the nested `VersionOverridesV1_1` structure required for the launch event, but Outlook installation still needs to be verified.

## Architecture and behavior at a glance

The add-in's compose handler runs in Outlook, renders one sample signature from `@signature/signature-core`, and calls Outlook's `setSignatureAsync`. It requires Outlook Mailbox requirement set 1.10. Compose activation covers new messages, replies, reply-all, and forwards, but not editing an existing draft.

The manifest grants `ReadWriteItem`, which is needed to update the compose body. The current handler does not make network calls. Office.js is loaded from Microsoft's hosted CDN. Static assets are served from the `/outlook-addin/*` path of the Portal's Static Web App using a route-specific CSP; the Portal itself retains a stricter CSP.

`setSignatureAsync` updates the current compose item's signature area. It does not create a named item in Outlook's native **Insert Signature** menu. Existing native-signature coexistence and repeat-activation behavior must be tested before any wider pilot.

## Build and locally inspect

Use Node.js 22.12 or newer from the repository root:

```sh
npm ci
OUTLOOK_ADDIN_BASE_URL="https://<static-web-app-hostname>/outlook-addin" npm run build
npm test --workspace=@signature/outlook-addin
npm run typecheck --workspace=@signature/outlook-addin
```

The build writes pages, JavaScript, icons, and a generated manifest to `apps/portal/dist/outlook-addin/`. The manifest URL must be the exact HTTPS origin and `/outlook-addin` path that Outlook can reach. Do not sideload the default `https://localhost:5174` URL unless trusted local HTTPS hosting is configured.

Inspect the generated manifest before deployment:

```sh
npm exec --yes --package office-addin-manifest -- office-addin-manifest info \
  apps/portal/dist/outlook-addin/manifest.xml
```

This confirms that the local parser recognizes the package; it is not proof that Outlook will install or activate it. The hosted acceptance endpoint has returned inconsistent errors for this package, so do not treat that result as definitive.

## Deploy the static assets

The pilot assets are deployed to the development Static Web App's **production slot**. This is the application's deployment slot name; it does not make the add-in production-ready. Use the hostname reported by your own Azure deployment.

From the repository root on a Node.js 22 machine with Azure CLI authenticated to the correct subscription:

```sh
OUTLOOK_ADDIN_BASE_URL="https://<static-web-app-hostname>/outlook-addin" npm run build
npm exec --yes --package @azure/static-web-apps-cli -- swa --version
```

Review the generated manifest and ensure the Portal's `.env.local` or build environment has the intended public configuration before publishing the complete Portal bundle. This deploys all of `apps/portal/dist`, not only the add-in subfolder.

```sh
SWA_CLI_DEPLOYMENT_TOKEN="$(az staticwebapp secrets list \
  --name "<static-web-app-name>" \
  --resource-group "<resource-group>" \
  --query properties.apiKey -o tsv)"
test -n "$SWA_CLI_DEPLOYMENT_TOKEN"
export SWA_CLI_DEPLOYMENT_TOKEN
npm exec --yes --package @azure/static-web-apps-cli -- \
  swa deploy apps/portal/dist --env production --app-name "<static-web-app-name>"
unset SWA_CLI_DEPLOYMENT_TOKEN
```

Treat the deployment token as a secret. Do not paste it into chat or save it in source-controlled files. If deployment fails, unset the token and stop; do not print it to diagnose the failure.

After deployment, verify that these URLs return HTTP 200 and the expected content:

- `https://<static-web-app-hostname>/outlook-addin/events.html`
- `https://<static-web-app-hostname>/outlook-addin/assets/events.js`
- `https://<static-web-app-hostname>/outlook-addin/manifest.xml`
- `https://<static-web-app-hostname>/outlook-addin/icon-32.png`
- `https://<static-web-app-hostname>/outlook-addin/icon-80.png`

Verify response headers as well. The add-in route should allow the Office.js CDN and supported Outlook embedding origins. The Portal root should not have those broader add-in allowances. The build adds the configured API origin to `connect-src`; this POC does not call the API.

## Install the event-based add-in for the test mailbox

Event-based add-ins should be centrally deployed by an administrator. The Outlook self-service sideload attempts described above failed, so use the admin-scoped deployment path below rather than retrying repeatedly in Outlook. Do not use the **Upload custom apps** ZIP flow for this XML manifest.

### Windows Exchange Online PowerShell (recommended next step)

Use a Windows machine and an account with the necessary Exchange Online add-in management permissions (the test account was shown as a Global Administrator). Open PowerShell 7 or Windows PowerShell. Do not run these commands in Bash.

1. Install and load the Exchange Online module if needed:

   ```powershell
   $ErrorActionPreference = "Stop"
   Install-Module ExchangeOnlineManagement -Scope CurrentUser
   Import-Module ExchangeOnlineManagement
   Get-Command Connect-ExchangeOnline
   Get-Command New-App -ErrorAction Stop
   ```

   If `New-App` is unavailable or permission is denied, stop and record the exact error; do not substitute a tenant-wide command.

2. Connect using the interactive Windows sign-in flow. Replace the account value with the test administrator's Microsoft 365 sign-in name:

   ```powershell
   $testMailbox = "<test-user-UPN>"
   Connect-ExchangeOnline -UserPrincipalName $testMailbox
   ```

   If this module/version does not accept `-UserPrincipalName`, run `Connect-ExchangeOnline` without that parameter and complete its interactive sign-in. Do not use the Linux Cloud Shell `-Device` workaround that previously failed.

3. Download the current manifest to a Windows-compatible temporary path and verify it exists:

   ```powershell
   $staticWebAppHost = "<static-web-app-hostname>"
   $manifestPath = Join-Path ([System.IO.Path]::GetTempPath()) "SignatureStudio-POC.xml"
   Invoke-WebRequest `
     -Uri "https://$staticWebAppHost/outlook-addin/manifest.xml" `
     -OutFile $manifestPath `
     -ErrorAction Stop
   if (-not (Test-Path -LiteralPath $manifestPath)) {
     throw "Manifest download failed: $manifestPath does not exist."
   }
   ```

4. Confirm the mailbox-scoped deployment command is available, then install to **only** the test mailbox:

   ```powershell
   $manifestBytes = [System.IO.File]::ReadAllBytes($manifestPath)
   New-App `
     -Mailbox $testMailbox `
     -FileData $manifestBytes `
     -Enabled $true `
     -ErrorAction Stop
   ```

   Do not add `-OrganizationApp`, `-UserList`, or a tenant-wide assignment. If the command fails, stop and save the full error text after redacting personal identifiers if sharing publicly. Do not rerun a failed command until the error is understood.

5. Verify that Exchange lists the add-in for that mailbox:

   ```powershell
   Get-App -Mailbox $testMailbox |
     Where-Object { $_.DisplayName -eq "Signature Studio POC" } |
     Format-List DisplayName,AppId,Enabled
   ```

   If no item is returned, installation has not been verified. Record the Exchange error or output and stop. When finished, disconnect:

   ```powershell
   Disconnect-ExchangeOnline -Confirm:$false
   ```

This path was **not yet successfully executed** as of this document update. Microsoft documents [`New-App`](https://learn.microsoft.com/powershell/module/exchangepowershell/new-app?view=exchange-ps) and [event-based activation](https://learn.microsoft.com/office/dev/add-ins/develop/event-based-activation).

### If the admin center has a dedicated Add-ins deployment flow

Some Microsoft 365 admin center experiences provide **Integrated apps → Add-ins → Deploy Add-in**, with a custom add-in manifest upload and a **Just me** assignment. Use that only if the dedicated Add-ins flow is visible and explicitly accepts the XML manifest. The current admin center screenshot showed **Upload custom apps**, which asks for a ZIP; that is not the XML-manifest upload flow.

If the dedicated XML flow is unavailable, do not zip the manifest or upload it under **Upload custom apps**. Use the mailbox-scoped PowerShell path above or ask Microsoft 365 support for the tenant's supported event-based add-in deployment route.

## Test in Outlook after deployment is confirmed

1. Refresh Outlook on the web, or close and reopen new Outlook for Windows. Admin-deployed add-ins can take time to appear.
2. Open **New email**. The handler should run automatically; no task pane button is required for this POC.
3. Confirm the inserted content visibly contains **TEST ONLY**.
4. Repeat with reply, reply-all, and forward. Do not test using a message you intend to send.
5. Check whether existing native signatures are replaced and whether reopening/retriggering duplicates content. Record exact client, browser/Outlook version, and behavior.
6. Close the draft without sending it.

If the add-in is listed in Exchange but does not activate, inspect Outlook's add-in errors and browser developer console/network requests for the event page, script, and CSP. Share the precise error/status, not access tokens, message content, or authentication headers.

## Remove or roll back the pilot

Remove the add-in assignment for the test mailbox using the same Exchange Online admin connection used to install it. The following commands select exactly one matching POC add-in, display its identity, require confirmation, and scope removal to the test mailbox:

```powershell
$testMailbox = "<test-user-UPN>"
$matches = @(
  Get-App -Mailbox $testMailbox |
    Where-Object { $_.DisplayName -eq "Signature Studio POC" }
)
if ($matches.Count -ne 1) {
  throw "Expected exactly one Signature Studio POC assignment; found $($matches.Count). No removal performed."
}
$matches[0] | Format-List DisplayName,AppId,Enabled
Remove-App -Identity $matches[0].AppId -Mailbox $testMailbox
Get-App -Mailbox $testMailbox |
  Where-Object { $_.DisplayName -eq "Signature Studio POC" }
```

The last command should return no result. Do not add `-OrganizationApp`, remove other add-ins, or use an organization-wide removal. Refresh Outlook after the mailbox assignment is confirmed removed.

If the static assets themselves need rollback, redeploy the last known-good complete Portal build to the same Static Web App and verify its root and add-in URLs. This restores the web bundle but does not remove an Exchange assignment. See [InfrastructureDesign.md](../../InfrastructureDesign.md) for broader Azure deployment rollback and cleanup.

## Planned implementation and release gates

1. **Establish installation and activation:** complete the mailbox-only Windows deployment, confirm Outlook lists the app, and test new/reply/reply-all/forward on Outlook on the web and new Outlook for Windows.
2. **Resolve manifest validation:** capture any Exchange/Outlook validation error; validate against the current Office add-in schema and manifest validator; test a corrected, incremented manifest before replacing the pilot.
3. **Define production signature behavior:** decide native-signature coexistence, duplicate prevention, how user edits are preserved, and behavior when no eligible template/profile is available.
4. **Add approved profile lookup:** request the minimum delegated Microsoft Graph permission, obtain profile data on demand, and keep profile data out of logs, API payloads, and persistent cache.
5. **Add live template delivery:** implement authenticated template publishing/reading, eligibility, bounded refresh/cache, and stale-cache/error behavior. Compose activation must render cached data, not make a live API call.
6. **Add assets and preferences:** implement approved CID inline images and load the user's saved eligible-template preference.
7. **Add audit delivery:** send a minimal audit record only after successful insertion, then test retries, duplicate suppression, and API unavailability.
8. **Release hardening:** complete security/privacy review, accessibility and client matrix tests, monitoring, support/rollback procedures, admin deployment documentation, and staged rollout. Never promote this POC's sample profile/signature to production.

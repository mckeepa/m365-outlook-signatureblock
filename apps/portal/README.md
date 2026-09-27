# Management Portal

Organization-hosted portal for Communications administrators to create, review, target, publish, and roll back templates. End users can view their default and eligible alternatives and manage signature favorites. The portal will never collect or store Entra profile attributes.

The portal uses TipTap for rich-text editing, DOMPurify for preview sanitization, and a locally bundled DM Sans font. It supports bold, italic, underline, lists, HTTPS/mailto links, dynamic profile placeholders, and an authenticated corporate image library. Authors can drag PNG/JPEG files onto the editor or upload them to the catalog and select them for insertion at the cursor. Uploads are validated and re-encoded by the API, limited to 1 MiB and 1600 × 1200 pixels, then persisted in private Blob Storage with immutable asset IDs in Cosmos metadata. Only users with the API `Templates.Read` scope can browse/read images; upload additionally requires the `Signature.TemplateAdmin` app role. **My Signatures** displays eligible templates, visually marks the organization default, and provides an explicit action to save the selected template through the API when configured. The image assets are persistent, but the template catalog/editor save remains sample data in this prototype; production publication still needs persistent template APIs and server-side HTML validation.

## Preview with an Entra profile

Use Node.js 22.12 or later for Vite 8 and the current MSAL/Azure package set. From the repository root, `nvm install` and `nvm use` select the version in `.nvmrc`; install the exact locked dependency graph with `npm ci`.

### Register the portal (SPA app registration)

1. Open the [Microsoft Entra admin center](https://entra.microsoft.com), then go to **Identity > Applications > App registrations > New registration**.
2. **Name:** `Signature Studio - Local`. **Supported account types:** **Accounts in this organizational directory only (Single tenant)**. Leave **Redirect URI** blank here. Select **Register**.
3. On the new app's **Overview** page, copy **Application (client) ID** and **Directory (tenant) ID**. These become `VITE_ENTRA_CLIENT_ID` and `VITE_ENTRA_TENANT_ID` below.
4. Go to **Authentication > Add a platform > Single-page application**. Under **Redirect URIs**, add one entry per Vite port you use, each with `/auth-redirect.html` appended, for example `http://localhost:5173/auth-redirect.html` and `http://localhost:5174/auth-redirect.html`. Leave **Front-channel logout URL** blank. Do not check any of the **Implicit grant** boxes. Select **Configure**, then **Save**. Do not add the site root as a redirect URI, create a client secret, or add a Web platform.
5. Go to **API permissions**. Confirm `User.Read` (Delegated, under **Microsoft Graph**) is already listed; if not, **Add a permission > Microsoft Graph > Delegated permissions**, search `User.Read`, add it. Do not add application permissions.

### Register the Template API (separate app registration)

Create a second, separate app registration for the API — do not reuse the SPA registration.

1. **App registrations > New registration**. **Name:** `Signature Studio Template API`. **Supported account types:** **Accounts in this organizational directory only (Single tenant)**. Leave **Redirect URI** blank. Select **Register**.
2. On **Overview**, copy this app's **Application (client) ID**. This is `<api-client-id>` referenced throughout this repository's docs, and becomes the `apiApplicationClientId` Bicep parameter.
3. Go to **Expose an API**. Next to **Application ID URI**, select **Add**, then **Save**, accepting the default `api://<api-client-id>` value (do not put a friendly name or the SPA's client ID here).
4. Under **Scopes defined by this API**, select **Add a scope** and create each of the following, one at a time. For both, leave **User consent display name** and **User consent description** empty, and leave **State** set to **Enabled**.

   | Field | Value (scope 1) | Value (scope 2) |
   | --- | --- | --- |
   | Scope name | `Templates.Read` | `UserPreferences.ReadWrite` |
   | Who can consent | Admins only | Admins only |
   | Admin consent display name | `Read published signature templates and corporate images` | `Read and update the signed-in user's signature preference` |
   | Admin consent description | Same text as display name | Same text as display name |

5. Go to **App roles > Create app role** and create the upload-authorization role:

   | Field | Value |
   | --- | --- |
   | Display name | `Signature.TemplateAdmin` |
   | Allowed member types | Users/Groups |
   | Value | `Signature.TemplateAdmin` |
   | Description | `Can upload and manage corporate signature images and templates.` |
   | Enable this app role | checked |

   Select **Apply**. The role **Value** must match exactly; the API checks this string in the token's `roles` claim.

6. Go to **Enterprise applications > All applications**, find and open **Signature Studio Template API**, then **Users and groups > Add user/group**. Pick the Communications administrator account or a security group under **Users**, pick **Signature.TemplateAdmin** under **Select a role**, then **Assign**. This grants upload authorization; it does not grant the delegated scopes below.

### Grant the SPA access to the API's scopes

1. Back in **App registrations > Signature Studio - Local > API permissions**, select **Add a permission > My APIs**, then choose **Signature Studio Template API**.
2. Select **Delegated permissions**, check both `Templates.Read` and `UserPreferences.ReadWrite`, then **Add permissions**.
3. On the **API permissions** page, select **Grant admin consent for Default Directory**, then confirm. Both new rows under **Signature Studio Template API** should change from a "Not granted for Default Directory" warning triangle to a green "Granted for Default Directory" checkmark. `User.Read` under Microsoft Graph is unaffected.

Configure `VITE_TEMPLATE_READ_SCOPE=api://<api-client-id>/Templates.Read` alongside the preference scope, using the API app's client ID from step 2 of API registration above. Without the API registration, deployed API, and these permissions, image uploads and the shared preference do not work. The [Azure deployment verification checklist](../../README.md#verify-the-azure-deployment) explains how to confirm the scopes and role and test the deployed API.

Microsoft's references: [Register a single-page app](https://learn.microsoft.com/en-us/entra/identity-platform/scenario-spa-app-registration) and [Graph Get user permissions](https://learn.microsoft.com/en-us/graph/api/user-get?view=graph-rest-1.0). The app calls only `GET /me` for the signed-in user.

### Enter the IDs in this workspace

From the repository root, copy the example file:

```sh
cp apps/portal/.env.example apps/portal/.env.local
```

Open `apps/portal/.env.local` and enter the IDs from the two registrations above:

```dotenv
VITE_ENTRA_CLIENT_ID=your-application-client-id
VITE_ENTRA_TENANT_ID=your-directory-tenant-id
VITE_TEMPLATE_API_URL=https://your-function-app.azurewebsites.net
VITE_TEMPLATE_API_SCOPE=api://your-api-client-id/UserPreferences.ReadWrite
VITE_TEMPLATE_READ_SCOPE=api://your-api-client-id/Templates.Read
```

`VITE_ENTRA_CLIENT_ID` and `VITE_ENTRA_TENANT_ID` come from the **Signature Studio - Local** (SPA) registration's Overview page. `VITE_TEMPLATE_API_SCOPE` and `VITE_TEMPLATE_READ_SCOPE` both use the **Signature Studio Template API** registration's Application (client) ID in place of `your-api-client-id` — the same ID used to build the `api://<api-client-id>` Application ID URI. `VITE_TEMPLATE_API_URL` is the deployed Function App's base URL (`https://<function-app-name>.azurewebsites.net`, no trailing `/api`); leave it blank for a local-only Entra profile preview without saved preferences or images.

Replace the example values with the actual IDs, API URL, and delegated scopes. Do not include angle brackets. The client and tenant IDs identify the public SPA and are not secrets. Never put a client secret or certificate private key in a `VITE_` variable or browser code. `.env.local` is excluded from Git.

Stop the running Vite process with `Ctrl+C`, then restart it from the repository root:

```sh
npm run dev
```

Open the Vite URL shown in the terminal and choose **My signatures**. The portal first tries silent sign-in; if Entra needs interaction, choose **Sign in**. After consent, eligible Signature Studio templates appear. Selecting a template previews it; choosing its default control saves the template ID through the preference API when configured. The Outlook add-in will use that same saved preference, or the organization default if none exists.

### If Connect Entra stays disabled

- Confirm the file is `apps/portal/.env.local`, not `.env.local` at the repository root.
- Check that both variable names match exactly and each has a non-empty ID value.
- Restart Vite after changing the file; Vite reads environment variables at startup.
- If the button enables but sign-in times out or the popup stays open, confirm the SPA redirect URI is exactly `<current-origin>/auth-redirect.html` (including the port), restart Vite after changing app code, and try again in a fresh tab. The redirect page is a small MSAL bridge and must not be replaced with the main portal URL.
- If Graph returns an authorization error after the popup closes, confirm the account belongs to this tenant and `User.Read` consent is available under tenant policy.

The portal first attempts silent SSO using the current browser's Entra session. If the browser requires interaction, **Sign in** opens the popup. Once signed in, **Switch user** opens the account picker. The portal uses MSAL's memory-only token cache, reads only `/me` fields used by templates, and keeps the response in React memory; refreshing or closing the page clears the profile. Only the selected template ID is persisted by the preference API, not the profile. No client secret is used. Silent SSO may require interactive sign-in when third-party cookies are blocked or multiple accounts make the session ambiguous.

The list shows Signature Studio templates available for this account; it cannot enumerate signatures from Outlook's native **Settings > Accounts > Signatures** page or **Insert > Signature** ribbon. The Outlook add-in is required to insert a Signature Studio template into a compose item. It does not create or edit native Outlook signature records.
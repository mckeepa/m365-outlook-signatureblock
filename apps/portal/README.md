# Management Portal

Organization-hosted portal for Communications administrators to create, review, target, publish, and roll back templates. End users can view their default and eligible alternatives and manage signature favorites. The portal will never collect or store Entra profile attributes.

The local prototype uses TipTap for rich-text editing, DOMPurify for preview sanitization, and a locally bundled DM Sans font. It supports bold, italic, underline, lists, HTTPS/mailto links, and dynamic profile placeholders. The prototype's data is in memory only; before production, validate and sanitize the published HTML again on the server and define the allowed markup/CSS contract.

## Preview with an Entra profile

Use Node.js 22.12 or later for Vite 8 and the current MSAL/Azure package set. From the repository root, `nvm install` and `nvm use` select the version in `.nvmrc`; install the exact locked dependency graph with `npm ci`.

### Register the portal

1. Open the [Microsoft Entra admin center](https://entra.microsoft.com), then go to **Identity > Applications > App registrations > New registration**.
2. Enter a name such as `Signature Studio - Local`. Under **Supported account types**, select **Accounts in this organizational directory only**. Select **Register**.
3. On the new app's **Overview** page, copy **Application (client) ID** and **Directory (tenant) ID**. These are the two values the portal needs.
4. Go to **Authentication > Add a platform > Single-page application**. Add the redirect URI that matches the Vite port in your browser, with `/auth-redirect.html` appended. Your current screenshot shows port `5174`, so add `http://localhost:5174/auth-redirect.html`. Also add `http://localhost:5173/auth-redirect.html` if you use port 5173. Save. Do not add the site root as the popup redirect, create a client secret, or configure this as a Web platform.
5. Go to **API permissions > Add a permission > Microsoft Graph > Delegated permissions**. Search for and add **User.Read**. Do not add application permissions or directory-wide read permissions. If required by your tenant's consent policy, an administrator selects **Grant admin consent** for the organization.

For a saved default shared with Outlook, also register and deploy the Template API as described in the root [Azure setup](../../README.md#prerequisites). Expose and grant the delegated `UserPreferences.ReadWrite` scope to this SPA under **API permissions > My APIs** (alongside `Templates.Read`). Without the deployed API and scope, a selection only lasts for the current browser session.

Microsoft's references: [Register a single-page app](https://learn.microsoft.com/en-us/entra/identity-platform/scenario-spa-app-registration) and [Graph Get user permissions](https://learn.microsoft.com/en-us/graph/api/user-get?view=graph-rest-1.0). The app calls only `GET /me` for the signed-in user.

### Enter the IDs in this workspace

From the repository root, copy the example file:

```sh
cp apps/portal/.env.example apps/portal/.env.local
```

Open `apps/portal/.env.local` and enter the IDs copied from the app's **Overview** page:

```dotenv
VITE_ENTRA_CLIENT_ID=your-application-client-id
VITE_ENTRA_TENANT_ID=your-directory-tenant-id
VITE_TEMPLATE_API_URL=https://your-function-app.azurewebsites.net
VITE_TEMPLATE_API_SCOPE=api://your-api-client-id/UserPreferences.ReadWrite
```

Replace the example values with the actual IDs, API URL, and delegated scope. Do not include angle brackets. The client and tenant IDs identify the public SPA and are not secrets. Never put a client secret or certificate private key in a `VITE_` variable or browser code. `.env.local` is excluded from Git.

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
# Template API

Organization-hosted API for published-template reads and separately authorized administrator writes. Persist templates and audit metadata only. Do not accept profile values, tokens, or message content in application payloads or logs.

## Per-user Signature Preference

- `GET /api/me/signature-preference` returns the authenticated user's selected template ID, or `null` when no override is saved.
- `PUT /api/me/signature-preference` accepts only `{ "selectedTemplateId": "template-id" }` or `{ "selectedTemplateId": null }`; `null` clears the override so Outlook falls back to the eligible organization default.
- Both routes require Easy Auth and the delegated `UserPreferences.ReadWrite` scope. The API derives the user object ID from validated Easy Auth claims and uses it as the Cosmos ID/partition key; there is no user-ID request parameter.
- The preference container stores no email address, profile fields, token, rendered signature, or message information. It persists until the user clears the override or an authorized retention operation removes it.

The portal calls these routes when `VITE_TEMPLATE_API_URL` and `VITE_TEMPLATE_API_SCOPE` are configured. The Outlook add-in must use the same routes/settings after it is implemented. This does not read or modify native Outlook signature entries.

## Implemented audit endpoint

`POST /api/audit/signature-applications` accepts a successful compose-application event:

```json
{
	"eventId": "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
	"templateId": "corporate-default",
	"templateVersion": 3,
	"addinVersion": "0.1.0"
}
```

The Function App must be behind App Service Authentication (Easy Auth). The handler derives `userObjectId` from the platform-validated `x-ms-client-principal` claims, verifies the configured tenant and delegated `Templates.Read` scope, and ignores client-supplied identity/outcome/timestamp fields. It writes an idempotent `applied-to-compose` event to the Cosmos `SignatureApplicationAudit` container using managed identity. Duplicate event IDs with matching template data return success; reuse with conflicting data returns `409`.

The event contains only actor object ID, template ID/version, event ID, outcome, optional add-in version, and server timestamp. Never send or log profile attributes, tokens, email addresses, message IDs, recipients, subjects, body text, or attachment information. Easy Auth is required at the Function App; the Functions route uses `authLevel: anonymous` only because Easy Auth is the authentication gate. Do not expose the Function App without that gate.

The Functions routes use `authLevel: "anonymous"` because App Service Easy Auth is the authentication boundary. Azure must require authentication (`requireAuthentication: true`) and return 401 for unauthenticated requests; the handlers trust `x-ms-client-principal` only because Easy Auth validates and injects it. A unit test verifies those settings remain in `infra/main.bicep`; also verify the deployed Function App configuration before exposing the API.

## Corporate image assets

- `GET /api/images` lists image metadata for callers with the delegated `Templates.Read` scope.
- `GET /api/images/{assetId}` returns the private image bytes; `?thumbnail=1` returns a reduced preview.
- `POST /api/images` accepts raw image bytes and an encoded `X-File-Name` header. It requires `Templates.Read` and the `Signature.TemplateAdmin` app role.
- Upload bytes are limited to 1 MiB while streaming. The API detects and decodes the actual file content, accepts static PNG/JPEG only, rejects dimensions above 1600 × 1200, re-encodes the image to strip metadata, and writes it to the private Blob container using managed identity. Cosmos stores the immutable asset ID and display metadata; clients never receive Blob credentials or direct Blob URLs.
- Blob bytes and metadata are persistent. Template document publishing is not yet implemented, so editor template data remains in portal memory; a template persistence API must store the asset IDs in sanitized HTML before templates themselves survive reloads.

### Audit request size limit

The audit handler rejects a declared `Content-Length` above 4 KiB and independently stops reading once the actual streamed body exceeds 4 KiB. Image uploads have their separate 1 MiB streaming limit. Keep an ingress-level request limit as defense in depth when exposing the endpoints.

The Outlook add-in sender, retry/outbox mechanism, published-template routes, and authorized audit reporting view remain to be implemented. Unit tests cover claim, image validation, and payload validation; Blob/Cosmos/Easy Auth integration tests require a deployed test environment.
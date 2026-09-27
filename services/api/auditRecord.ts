export interface SignatureApplicationRequest {
  eventId: string;
  templateId: string;
  templateVersion: number;
  addinVersion?: string;
}

export interface SignatureApplicationRecord extends SignatureApplicationRequest {
  id: string;
  userObjectId: string;
  outcome: "applied-to-compose";
  appliedAtUtc: string;
}

interface EasyAuthClaim {
  typ?: string;
  val?: string;
}

interface EasyAuthPrincipal {
  auth_typ?: string;
  claims?: EasyAuthClaim[];
}

export class AuditRequestError extends Error {
  constructor(
    message: string,
    readonly statusCode: 400 | 401 | 403,
  ) {
    super(message);
  }
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const MAX_AUDIT_REQUEST_BYTES = 4096;

interface LimitedBodyReader {
  read(): Promise<{ done: boolean; value?: Uint8Array }>;
  cancel(): Promise<void>;
  releaseLock(): void;
}

interface LimitedRequestBody {
  getReader(): LimitedBodyReader;
}

export async function parseLimitedJsonBody(
  body: LimitedRequestBody | null,
): Promise<unknown> {
  if (!body) {
    throw new AuditRequestError("The request must contain a valid JSON audit event.", 400);
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) {
        throw new AuditRequestError("The request must contain a valid JSON audit event.", 400);
      }
      byteLength += value.byteLength;
      if (byteLength > MAX_AUDIT_REQUEST_BYTES) {
        await reader.cancel();
        throw new AuditRequestError("The audit event is too large.", 400);
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof AuditRequestError) throw error;
    throw new AuditRequestError("The request must contain a valid JSON audit event.", 400);
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new AuditRequestError("The request must contain a valid JSON audit event.", 400);
  }
}

export function getAuthenticatedUserObjectId(
  encodedPrincipal: string | null,
  expectedTenantId: string,
  requiredScope: string,
): string {
  if (!encodedPrincipal) {
    throw new AuditRequestError("Authentication is required.", 401);
  }

  let principal: EasyAuthPrincipal;
  try {
    principal = JSON.parse(Buffer.from(encodedPrincipal, "base64").toString("utf8")) as EasyAuthPrincipal;
  } catch {
    throw new AuditRequestError("The authenticated principal is invalid.", 401);
  }

  if (principal.auth_typ?.toLowerCase() !== "aad") {
    throw new AuditRequestError("An Entra-authenticated user is required.", 401);
  }

  const claims = principal.claims ?? [];
  const claim = (...names: string[]) =>
    claims.find((entry) => entry.typ && names.includes(entry.typ.toLowerCase()))?.val;
  const tenantId = claim("tid", "http://schemas.microsoft.com/identity/claims/tenantid");
  const objectId = claim("oid", "http://schemas.microsoft.com/identity/claims/objectidentifier");
  const scopes = claim("scp", "http://schemas.microsoft.com/identity/claims/scope")?.split(/\s+/) ?? [];

  if (!tenantId || tenantId.toLowerCase() !== expectedTenantId.toLowerCase()) {
    throw new AuditRequestError("The authenticated tenant is not allowed.", 403);
  }
  if (!scopes.includes(requiredScope)) {
    throw new AuditRequestError(`The ${requiredScope} scope is required.`, 403);
  }
  if (!objectId || !uuidPattern.test(objectId)) {
    throw new AuditRequestError("The authenticated user identifier is invalid.", 401);
  }

  return objectId.toLowerCase();
}

export function getAuditActor(encodedPrincipal: string | null, expectedTenantId: string): string {
  return getAuthenticatedUserObjectId(encodedPrincipal, expectedTenantId, "Templates.Read");
}

export function validateApplicationRequest(value: unknown): SignatureApplicationRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AuditRequestError("A JSON audit event is required.", 400);
  }

  const input = value as Record<string, unknown>;
  if (typeof input.eventId !== "string" || !uuidPattern.test(input.eventId)) {
    throw new AuditRequestError("eventId must be a UUID.", 400);
  }
  if (
    typeof input.templateId !== "string" ||
    input.templateId.length < 1 ||
    input.templateId.length > 100 ||
    !/^[a-zA-Z0-9._-]+$/.test(input.templateId)
  ) {
    throw new AuditRequestError("templateId is invalid.", 400);
  }
  if (
    typeof input.templateVersion !== "number" ||
    !Number.isSafeInteger(input.templateVersion) ||
    input.templateVersion < 1
  ) {
    throw new AuditRequestError("templateVersion must be a positive integer.", 400);
  }
  if (
    input.addinVersion !== undefined &&
    (typeof input.addinVersion !== "string" || input.addinVersion.length > 40)
  ) {
    throw new AuditRequestError("addinVersion must be a string of at most 40 characters.", 400);
  }

  return {
    eventId: input.eventId,
    templateId: input.templateId,
    templateVersion: input.templateVersion,
    ...(typeof input.addinVersion === "string" ? { addinVersion: input.addinVersion } : {}),
  };
}

export function createApplicationRecord(
  userObjectId: string,
  request: SignatureApplicationRequest,
  now = new Date(),
): SignatureApplicationRecord {
  return {
    ...request,
    id: request.eventId,
    userObjectId,
    outcome: "applied-to-compose",
    appliedAtUtc: now.toISOString(),
  };
}
import {
  CosmosClient,
  type Container,
} from "@azure/cosmos";
import { DefaultAzureCredential } from "@azure/identity";
import {
  app,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from "@azure/functions";
import {
  AuditRequestError,
  createApplicationRecord,
  getAuditActor,
  MAX_AUDIT_REQUEST_BYTES,
  parseLimitedJsonBody,
  validateApplicationRequest,
  type SignatureApplicationRecord,
} from "./auditRecord.js";

let auditContainer: Container | undefined;

function getAuditContainer(): Container {
  if (auditContainer) return auditContainer;

  const endpoint = process.env.COSMOS_ENDPOINT;
  const databaseName = process.env.COSMOS_DATABASE_NAME;
  if (!endpoint || !databaseName) {
    throw new Error("Audit storage is not configured.");
  }

  const client = new CosmosClient({
    endpoint,
    aadCredentials: new DefaultAzureCredential(),
  });
  auditContainer = client.database(databaseName).container("SignatureApplicationAudit");
  return auditContainer;
}

async function parseRequest(request: HttpRequest) {
  const contentLengthHeader = request.headers.get("content-length");
  const contentLength = contentLengthHeader === null ? Number.NaN : Number(contentLengthHeader);
  if (Number.isFinite(contentLength) && contentLength > MAX_AUDIT_REQUEST_BYTES) {
    throw new AuditRequestError("The audit event is too large.", 400);
  }

  try {
    return validateApplicationRequest(await parseLimitedJsonBody(request.body));
  } catch (error) {
    if (error instanceof AuditRequestError) throw error;
    throw new AuditRequestError("The request must contain a valid JSON audit event.", 400);
  }
}

async function recordSignatureApplication(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  try {
    const tenantId = process.env.API_AUTH_TENANT_ID;
    if (!tenantId) throw new Error("API tenant configuration is missing.");

    const userObjectId = getAuditActor(
      request.headers.get("x-ms-client-principal"),
      tenantId,
    );
    const event = await parseRequest(request);
    const record = createApplicationRecord(userObjectId, event);
    const container = getAuditContainer();

    try {
      await container.items.create(record);
      return {
        status: 201,
        jsonBody: { accepted: true, eventId: record.eventId },
      };
    } catch (error) {
      const cosmosError = error as { code?: number; statusCode?: number };
      if (cosmosError.code !== 409 && cosmosError.statusCode !== 409) throw error;

      const existing = await container.item(record.id, userObjectId).read<SignatureApplicationRecord>();
      if (
        existing.resource?.templateId === record.templateId &&
        existing.resource.templateVersion === record.templateVersion
      ) {
        return {
          status: 200,
          jsonBody: { accepted: true, duplicate: true, eventId: record.eventId },
        };
      }

      return { status: 409, jsonBody: { error: "event_id_conflict" } };
    }
  } catch (error) {
    if (error instanceof AuditRequestError) {
      return { status: error.statusCode, jsonBody: { error: error.message } };
    }

    context.error("Signature application audit write failed.");
    return { status: 503, jsonBody: { error: "audit_unavailable" } };
  }
}

app.http("recordSignatureApplication", {
  route: "audit/signature-applications",
  methods: ["POST"],
  // This anonymous Functions route is safe only behind the Function App's required Easy Auth gate.
  authLevel: "anonymous",
  handler: recordSignatureApplication,
});
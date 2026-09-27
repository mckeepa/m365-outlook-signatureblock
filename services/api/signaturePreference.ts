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
  getAuthenticatedUserObjectId,
} from "./auditRecord.js";

export interface SignaturePreferenceRequest {
  selectedTemplateId: string | null;
}

export interface SignaturePreferenceRecord extends SignaturePreferenceRequest {
  id: string;
  userObjectId: string;
  updatedAtUtc: string;
}

let preferenceContainer: Container | undefined;

export function validateSignaturePreference(value: unknown): SignaturePreferenceRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AuditRequestError("A JSON preference is required.", 400);
  }

  const selectedTemplateId = (value as Record<string, unknown>).selectedTemplateId;
  if (selectedTemplateId === null) return { selectedTemplateId: null };
  if (
    typeof selectedTemplateId !== "string" ||
    selectedTemplateId.length < 1 ||
    selectedTemplateId.length > 100 ||
    !/^[a-zA-Z0-9._-]+$/.test(selectedTemplateId)
  ) {
    throw new AuditRequestError("selectedTemplateId must be null or a valid template ID.", 400);
  }

  return { selectedTemplateId };
}

export function createSignaturePreferenceRecord(
  userObjectId: string,
  preference: SignaturePreferenceRequest,
  now = new Date(),
): SignaturePreferenceRecord {
  return {
    id: userObjectId,
    userObjectId,
    ...preference,
    updatedAtUtc: now.toISOString(),
  };
}

function getPreferenceContainer(): Container {
  if (preferenceContainer) return preferenceContainer;

  const endpoint = process.env.COSMOS_ENDPOINT;
  const databaseName = process.env.COSMOS_DATABASE_NAME;
  if (!endpoint || !databaseName) throw new Error("Preference storage is not configured.");

  const client = new CosmosClient({
    endpoint,
    aadCredentials: new DefaultAzureCredential(),
  });
  preferenceContainer = client.database(databaseName).container("UserSignaturePreferences");
  return preferenceContainer;
}

function getUserObjectId(request: HttpRequest): string {
  const tenantId = process.env.API_AUTH_TENANT_ID;
  if (!tenantId) throw new Error("API tenant configuration is missing.");
  return getAuthenticatedUserObjectId(
    request.headers.get("x-ms-client-principal"),
    tenantId,
    "UserPreferences.ReadWrite",
  );
}

async function getPreference(request: HttpRequest): Promise<HttpResponseInit> {
  try {
    const userObjectId = getUserObjectId(request);
    try {
      const result = await getPreferenceContainer()
        .item(userObjectId, userObjectId)
        .read<SignaturePreferenceRecord>();
      return {
        status: 200,
        jsonBody: {
          selectedTemplateId: result.resource?.selectedTemplateId ?? null,
          updatedAtUtc: result.resource?.updatedAtUtc ?? null,
        },
      };
    } catch (error) {
      if ((error as { code?: number }).code === 404) {
        return { status: 200, jsonBody: { selectedTemplateId: null, updatedAtUtc: null } };
      }
      throw error;
    }
  } catch (error) {
    if (error instanceof AuditRequestError) {
      return { status: error.statusCode, jsonBody: { error: error.message } };
    }
    return { status: 503, jsonBody: { error: "preference_unavailable" } };
  }
}

async function savePreference(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  try {
    const userObjectId = getUserObjectId(request);
    let value: unknown;
    try {
      value = await request.json();
    } catch {
      throw new AuditRequestError("The request must contain valid JSON.", 400);
    }
    const preference = validateSignaturePreference(value);
    const record = createSignaturePreferenceRecord(userObjectId, preference);
    await getPreferenceContainer().items.upsert(record);
    return {
      status: 200,
      jsonBody: {
        selectedTemplateId: record.selectedTemplateId,
        updatedAtUtc: record.updatedAtUtc,
      },
    };
  } catch (error) {
    if (error instanceof AuditRequestError) {
      return { status: error.statusCode, jsonBody: { error: error.message } };
    }
    context.error("Signature preference write failed.");
    return { status: 503, jsonBody: { error: "preference_unavailable" } };
  }
}

app.http("getMySignaturePreference", {
  route: "me/signature-preference",
  methods: ["GET"],
  // These anonymous Functions routes are safe only behind the Function App's required Easy Auth gate.
  authLevel: "anonymous",
  handler: getPreference,
});

app.http("saveMySignaturePreference", {
  route: "me/signature-preference",
  methods: ["PUT"],
  // This anonymous Functions route is safe only behind the Function App's required Easy Auth gate.
  authLevel: "anonymous",
  handler: savePreference,
});
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  AuditRequestError,
  createApplicationRecord,
  getAuditActor,
  getTemplateAdminObjectId,
  MAX_AUDIT_REQUEST_BYTES,
  parseLimitedJsonBody,
  validateApplicationRequest,
} from "./auditRecord.js";

const tenantId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const objectId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

test("infrastructure requires Easy Auth for anonymous Functions routes", () => {
  const infrastructure = readFileSync(new URL("../../infra/main.bicep", import.meta.url), "utf8");
  const auditRoute = readFileSync(new URL("./signatureAudit.ts", import.meta.url), "utf8");
  const preferenceRoute = readFileSync(new URL("./signaturePreference.ts", import.meta.url), "utf8");

  assert.match(infrastructure, /requireAuthentication:\s*true/);
  assert.match(infrastructure, /unauthenticatedClientAction:\s*'Return401'/);
  assert.match(auditRoute, /authLevel:\s*"anonymous"/);
  assert.match(preferenceRoute, /authLevel:\s*"anonymous"/);
});

function encodePrincipal(claims: Array<{ typ: string; val: string }>) {
  return Buffer.from(JSON.stringify({ auth_typ: "aad", claims })).toString("base64");
}

test("derives audit actor from Easy Auth claims and requires the API scope", () => {
  const principal = encodePrincipal([
    { typ: "tid", val: tenantId },
    { typ: "oid", val: objectId },
    { typ: "scp", val: "openid Templates.Read" },
  ]);

  assert.equal(getAuditActor(principal, tenantId), objectId);
});

test("rejects a different tenant and a token without Templates.Read", () => {
  const wrongTenant = encodePrincipal([
    { typ: "tid", val: objectId },
    { typ: "oid", val: objectId },
    { typ: "scp", val: "Templates.Read" },
  ]);
  const missingScope = encodePrincipal([
    { typ: "tid", val: tenantId },
    { typ: "oid", val: objectId },
    { typ: "scp", val: "User.Read" },
  ]);

  assert.throws(() => getAuditActor(wrongTenant, tenantId), AuditRequestError);
  assert.throws(() => getAuditActor(missingScope, tenantId), AuditRequestError);
});

test("requires the template administrator app role to upload assets", () => {
  const reader = encodePrincipal([
    { typ: "tid", val: tenantId },
    { typ: "oid", val: objectId },
    { typ: "scp", val: "Templates.Read" },
  ]);
  const admin = encodePrincipal([
    { typ: "tid", val: tenantId },
    { typ: "oid", val: objectId },
    { typ: "scp", val: "Templates.Read" },
    { typ: "roles", val: "Signature.TemplateAdmin" },
  ]);

  assert.throws(
    () => getTemplateAdminObjectId(reader, tenantId),
    (error: unknown) => error instanceof AuditRequestError && error.statusCode === 403,
  );
  assert.equal(getTemplateAdminObjectId(admin, tenantId), objectId);
});

test("accepts only the minimal audit event fields and ignores supplied identity", () => {
  const event = validateApplicationRequest({
    eventId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    templateId: "corporate-default",
    templateVersion: 3,
    userObjectId: "forged-user-id",
    messageBody: "must not be recorded",
  });

  assert.deepEqual(event, {
    eventId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    templateId: "corporate-default",
    templateVersion: 3,
  });
});

test("parses a JSON body within the hard byte limit", async () => {
  const body = new TextEncoder().encode(JSON.stringify({
    eventId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    templateId: "corporate-default",
    templateVersion: 3,
  }));
  const parsed = await parseLimitedJsonBody(new ReadableStream({
    start(controller) {
      controller.enqueue(body);
      controller.close();
    },
  }));

  assert.deepEqual(validateApplicationRequest(parsed), {
    eventId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    templateId: "corporate-default",
    templateVersion: 3,
  });
});

test("rejects oversized streamed bodies even when Content-Length is not available", async () => {
  const body = new Uint8Array(MAX_AUDIT_REQUEST_BYTES + 1);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(body);
      controller.close();
    },
  });

  await assert.rejects(
    parseLimitedJsonBody(stream),
    (error: unknown) => error instanceof AuditRequestError && error.statusCode === 413,
  );
});

test("creates a server-timestamped applied-to-compose audit record", () => {
  const event = validateApplicationRequest({
    eventId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    templateId: "corporate-default",
    templateVersion: 3,
  });
  const record = createApplicationRecord(
    objectId,
    event,
    new Date("2026-09-27T12:00:00.000Z"),
  );

  assert.deepEqual(record, {
    id: event.eventId,
    eventId: event.eventId,
    userObjectId: objectId,
    templateId: "corporate-default",
    templateVersion: 3,
    outcome: "applied-to-compose",
    appliedAtUtc: "2026-09-27T12:00:00.000Z",
  });
});
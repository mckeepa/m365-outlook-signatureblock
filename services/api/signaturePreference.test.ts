import assert from "node:assert/strict";
import test from "node:test";
import { AuditRequestError } from "./auditRecord.js";
import {
  createSignaturePreferenceRecord,
  validateSignaturePreference,
} from "./signaturePreference.js";

const userObjectId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

test("accepts a selected template ID or null to clear the selection", () => {
  assert.deepEqual(validateSignaturePreference({ selectedTemplateId: "corporate-default" }), {
    selectedTemplateId: "corporate-default",
  });
  assert.deepEqual(validateSignaturePreference({ selectedTemplateId: null }), {
    selectedTemplateId: null,
  });
});

test("rejects malformed and oversized preference values", () => {
  assert.throws(() => validateSignaturePreference({ selectedTemplateId: "../other-user" }), AuditRequestError);
  assert.throws(() => validateSignaturePreference({ selectedTemplateId: 123 }), AuditRequestError);
  assert.throws(() => validateSignaturePreference({}), AuditRequestError);
});

test("keys saved preferences by token-derived user ID and stamps the update server-side", () => {
  const preference = validateSignaturePreference({ selectedTemplateId: "leadership-v2" });
  const record = createSignaturePreferenceRecord(
    userObjectId,
    preference,
    new Date("2026-09-27T12:00:00.000Z"),
  );

  assert.deepEqual(record, {
    id: userObjectId,
    userObjectId,
    selectedTemplateId: "leadership-v2",
    updatedAtUtc: "2026-09-27T12:00:00.000Z",
  });
});
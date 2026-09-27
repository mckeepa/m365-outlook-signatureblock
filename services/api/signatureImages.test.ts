import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { AuditRequestError } from "./auditRecord.js";
import { normalizeSignatureImage } from "./signatureImages.js";

test("normalizes a PNG and reports verified image metadata", async () => {
  const input = await sharp({
    create: {
      width: 20,
      height: 12,
      channels: 4,
      background: { r: 20, g: 120, b: 80, alpha: 1 },
    },
  }).png().toBuffer();

  const normalized = await normalizeSignatureImage(input);
  const metadata = await sharp(normalized.data).metadata();

  assert.equal(normalized.contentType, "image/png");
  assert.equal(normalized.width, 20);
  assert.equal(normalized.height, 12);
  assert.equal(metadata.format, "png");
  assert.equal(metadata.width, 20);
  assert.equal(metadata.height, 12);
});

test("rejects malformed and unsupported image formats", async () => {
  await assert.rejects(
    normalizeSignatureImage(Buffer.from("not an image")),
    (error: unknown) => error instanceof AuditRequestError && error.statusCode === 415,
  );

  const gif = await sharp({
    create: {
      width: 2,
      height: 2,
      channels: 3,
      background: { r: 0, g: 0, b: 0 },
    },
  }).gif().toBuffer();
  await assert.rejects(
    normalizeSignatureImage(gif),
    (error: unknown) => error instanceof AuditRequestError && error.statusCode === 415,
  );
});

test("rejects images exceeding configured pixel dimensions", async () => {
  const input = await sharp({
    create: {
      width: 1601,
      height: 1,
      channels: 3,
      background: { r: 0, g: 0, b: 0 },
    },
  }).png().toBuffer();

  await assert.rejects(
    normalizeSignatureImage(input),
    (error: unknown) => error instanceof AuditRequestError && error.statusCode === 400,
  );
});

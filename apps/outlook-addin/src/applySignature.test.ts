import assert from "node:assert/strict";
import test from "node:test";
import { applySignature, type ComposeBody } from "./applySignature.js";

test("applies HTML and completes after the Outlook API succeeds", () => {
  let capturedHtml = "";
  let completed: boolean | undefined;
  const body: ComposeBody = {
    setSignatureAsync(signatureHtml, callback) {
      capturedHtml = signatureHtml;
      callback({ succeeded: true });
    },
  };

  applySignature(body, "<p>Test signature</p>", (succeeded) => {
    completed = succeeded;
  });

  assert.equal(capturedHtml, "<p>Test signature</p>");
  assert.equal(completed, true);
});

test("reports an Outlook API failure and completes only once", () => {
  let completionCount = 0;
  let succeeded: boolean | undefined;
  const body: ComposeBody = {
    setSignatureAsync(_signatureHtml, callback) {
      callback({ succeeded: false });
      callback({ succeeded: true });
    },
  };

  applySignature(body, "<p>Test signature</p>", (result) => {
    completionCount += 1;
    succeeded = result;
  });

  assert.equal(completionCount, 1);
  assert.equal(succeeded, false);
});

test("completes with failure if the Outlook API throws synchronously", () => {
  let succeeded: boolean | undefined;
  const body: ComposeBody = {
    setSignatureAsync() {
      throw new Error("Host API unavailable");
    },
  };

  applySignature(body, "<p>Test signature</p>", (result) => {
    succeeded = result;
  });

  assert.equal(succeeded, false);
});

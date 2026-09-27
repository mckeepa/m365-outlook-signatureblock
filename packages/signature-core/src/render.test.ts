import assert from "node:assert/strict";
import test from "node:test";
import type { SignatureProfile, SignatureTemplate } from "./model.js";
import {
  chooseDefaultTemplate,
  chooseSignatureTemplate,
  renderSignature,
} from "./render.js";

const templates: SignatureTemplate[] = [
  {
    id: "general",
    name: "General",
    version: 1,
    html: "<strong>{{displayName}}</strong><br>{{jobTitle}}",
    isDefault: true,
  },
  {
    id: "leadership",
    name: "Leadership",
    version: 1,
    html: "{{displayName}} | Leadership",
    isDefault: false,
    eligibleJobTitles: ["Director"],
  },
];

test("renders profile values as text and omits missing values", () => {
  const profile: SignatureProfile = {
    displayName: "<Taylor & Co>",
    jobTitle: null,
  };

  assert.equal(
    renderSignature(templates[0]!, profile),
    "<strong>&lt;Taylor &amp; Co&gt;</strong><br>",
  );
});

test("renders the email placeholder from the profile mail field", () => {
  assert.equal(renderSignature(
    { ...templates[0]!, html: "{{email}}" },
    { mail: "taylor@example.com" },
  ), "taylor@example.com");
});

test("uses the first eligible favorite before the default", () => {
  const selected = chooseDefaultTemplate(
    templates,
    ["leadership", "general"],
    { jobTitle: "Director" },
  );

  assert.equal(selected?.id, "leadership");
});

test("falls back to the default when no favorite is eligible", () => {
  const selected = chooseDefaultTemplate(
    templates,
    ["leadership"],
    { jobTitle: "Analyst" },
  );

  assert.equal(selected?.id, "general");
});

test("uses an eligible explicit selection before the organization default", () => {
  const selected = chooseSignatureTemplate(
    templates,
    "leadership",
    { jobTitle: "Director" },
  );

  assert.equal(selected?.id, "leadership");
});

test("falls back to the organization default for missing or ineligible choices", () => {
  const profile = { jobTitle: "Analyst" };

  assert.equal(chooseSignatureTemplate(templates, null, profile)?.id, "general");
  assert.equal(chooseSignatureTemplate(templates, "leadership", profile)?.id, "general");
});
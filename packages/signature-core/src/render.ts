import type { SignatureProfile, SignatureTemplate } from "./model.js";

const fields: Record<string, keyof SignatureProfile> = {
  displayName: "displayName",
  email: "mail",
  jobTitle: "jobTitle",
  department: "department",
  businessPhone: "businessPhone",
};

export function renderSignature(
  template: SignatureTemplate,
  profile: SignatureProfile,
): string {
  return template.html.replace(/\{\{([a-zA-Z]+)\}\}/g, (_token, name: string) => {
    const field = fields[name];
    return field ? escapeHtml(profile[field] ?? "") : "";
  });
}

export function chooseDefaultTemplate(
  templates: SignatureTemplate[],
  preferences: string[],
  profile: SignatureProfile,
): SignatureTemplate | undefined {
  const eligible = templates.filter((template) => isEligible(template, profile));
  const preferred = preferences
    .map((id) => eligible.find((template) => template.id === id))
    .find((template): template is SignatureTemplate => template !== undefined);

  return preferred ?? eligible.find((template) => template.isDefault);
}

export function chooseSignatureTemplate(
  templates: SignatureTemplate[],
  selectedTemplateId: string | null,
  profile: SignatureProfile,
): SignatureTemplate | undefined {
  const eligible = templates.filter((template) => isEligible(template, profile));
  return (
    eligible.find((template) => template.id === selectedTemplateId) ??
    eligible.find((template) => template.isDefault)
  );
}

function isEligible(template: SignatureTemplate, profile: SignatureProfile): boolean {
  const departmentMatches =
    !template.eligibleDepartments?.length ||
    template.eligibleDepartments.includes(profile.department ?? "");
  const titleMatches =
    !template.eligibleJobTitles?.length ||
    template.eligibleJobTitles.includes(profile.jobTitle ?? "");

  return departmentMatches && titleMatches;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };

    return entities[character] ?? character;
  });
}
export const entraConfigured = Boolean(
  import.meta.env.VITE_ENTRA_CLIENT_ID?.trim() &&
  import.meta.env.VITE_ENTRA_TENANT_ID?.trim(),
);

export const preferenceApiUrl = import.meta.env.VITE_TEMPLATE_API_URL?.trim() ?? "";
export const preferenceApiScope = import.meta.env.VITE_TEMPLATE_API_SCOPE?.trim() ?? "";
export const templateReadScope = import.meta.env.VITE_TEMPLATE_READ_SCOPE?.trim() ?? "";
export const signaturePreferenceApiConfigured = Boolean(preferenceApiUrl && preferenceApiScope);
export const signatureImageApiConfigured = Boolean(preferenceApiUrl && templateReadScope);
import {
  BrowserCacheLocation,
  InteractionRequiredAuthError,
  PublicClientApplication,
  type AuthenticationResult,
} from "@azure/msal-browser";
import type { SignatureProfile } from "@signature/signature-core";
import {
  entraConfigured,
  preferenceApiScope,
  preferenceApiUrl,
  signatureImageApiConfigured,
  signaturePreferenceApiConfigured,
  templateReadScope,
} from "./entraConfig.js";

interface GraphMe {
  displayName?: string;
  mail?: string;
  userPrincipalName?: string;
  jobTitle?: string;
  department?: string;
  businessPhones?: string[];
}

export interface SignedInProfile {
  displayName: string;
  profile: SignatureProfile;
}

export interface UserSignaturePreference {
  selectedTemplateId: string | null;
  updatedAtUtc: string | null;
}

export interface SignatureImageAsset {
  id: string;
  name: string;
  contentType: "image/png" | "image/jpeg";
  width: number;
  height: number;
  byteLength: number;
  previewUrl: string;
  imageUrl?: string;
}

const clientId = import.meta.env.VITE_ENTRA_CLIENT_ID?.trim() ?? "";
const tenantId = import.meta.env.VITE_ENTRA_TENANT_ID?.trim() ?? "";

let application: PublicClientApplication | undefined;
let initialization: Promise<void> | undefined;
let silentProfileRequest: Promise<SignedInProfile | null> | undefined;

function getApplication() {
  if (!entraConfigured) {
    throw new Error("Set VITE_ENTRA_CLIENT_ID and VITE_ENTRA_TENANT_ID to enable Entra sign-in.");
  }

  application ??= new PublicClientApplication({
    auth: {
      clientId,
      authority: `https://login.microsoftonline.com/${tenantId}`,
      redirectUri: `${window.location.origin}/auth-redirect.html`,
    },
    cache: {
      cacheLocation: BrowserCacheLocation.MemoryStorage,
    },
    system: {
      popupBridgeTimeout: 45_000,
    },
  });

  return application;
}

async function readProfileFromAuthentication(
  msal: PublicClientApplication,
  authentication: AuthenticationResult,
): Promise<SignedInProfile> {
  if (!authentication.account || !authentication.accessToken) {
    throw new Error("Entra sign-in did not return a profile access token.");
  }
  msal.setActiveAccount(authentication.account);

  const response = await fetch(
    "https://graph.microsoft.com/v1.0/me?$select=displayName,mail,userPrincipalName,jobTitle,department,businessPhones",
    { headers: { Authorization: `Bearer ${authentication.accessToken}` } },
  );
  if (!response.ok) {
    throw new Error(`Microsoft Graph profile request failed (${response.status}).`);
  }

  const user = (await response.json()) as GraphMe;
  return {
    displayName: user.displayName || user.mail || user.userPrincipalName || "Signed-in user",
    profile: {
      displayName: user.displayName,
      mail: user.mail || user.userPrincipalName,
      jobTitle: user.jobTitle,
      department: user.department,
      businessPhone: user.businessPhones?.[0],
    },
  };
}

async function initializeApplication() {
  const msal = getApplication();
  initialization ??= msal.initialize();
  await initialization;
  return msal;
}

export function trySilentSignInAndReadProfile(): Promise<SignedInProfile | null> {
  silentProfileRequest ??= (async () => {
    const msal = await initializeApplication();
    try {
      const authentication = await msal.ssoSilent({ scopes: ["User.Read"] });
      return await readProfileFromAuthentication(msal, authentication);
    } catch (error) {
      if (error instanceof InteractionRequiredAuthError) return null;
      throw error;
    }
  })();

  return silentProfileRequest;
}

export async function signInAndReadProfile(switchAccount = false): Promise<SignedInProfile> {
  const msal = await initializeApplication();
  const authentication = await msal.loginPopup({
    scopes: ["User.Read"],
    ...(switchAccount ? { prompt: "select_account" as const } : {}),
  });
  return readProfileFromAuthentication(msal, authentication);
}

async function acquireApiToken(scope: string, interactive: boolean) {
  const msal = await initializeApplication();
  const account = msal.getActiveAccount();
  if (!account) throw new Error("Sign in before accessing your saved signature choice.");

  try {
    return await msal.acquireTokenSilent({ account, scopes: [scope] });
  } catch (error) {
    if (error instanceof InteractionRequiredAuthError && interactive) {
      return msal.acquireTokenPopup({ account, scopes: [scope] });
    }
    throw error;
  }
}

export async function loadUserSignaturePreference(): Promise<UserSignaturePreference | null> {
  if (!signaturePreferenceApiConfigured) return null;

  try {
    const token = await acquireApiToken(preferenceApiScope, false);
    const response = await fetch(`${preferenceApiUrl}/api/me/signature-preference`, {
      headers: { Authorization: `Bearer ${token.accessToken}` },
    });
    if (!response.ok) throw new Error(`Unable to load your saved signature choice (${response.status}).`);
    return (await response.json()) as UserSignaturePreference;
  } catch (error) {
    if (error instanceof InteractionRequiredAuthError) return null;
    throw error;
  }
}

export async function saveUserSignaturePreference(
  selectedTemplateId: string | null,
): Promise<UserSignaturePreference> {
  if (!signaturePreferenceApiConfigured) {
    throw new Error("Saved choices are unavailable until the template API is configured.");
  }

  const token = await acquireApiToken(preferenceApiScope, true);
  const response = await fetch(`${preferenceApiUrl}/api/me/signature-preference`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ selectedTemplateId }),
  });
  if (!response.ok) throw new Error(`Unable to save your signature choice (${response.status}).`);
  return (await response.json()) as UserSignaturePreference;
}

async function downloadSignatureImage(
  imageId: string,
  accessToken: string,
  thumbnail = false,
): Promise<Blob> {
  const suffix = thumbnail ? "?thumbnail=1" : "";
  const response = await fetch(`${preferenceApiUrl}/api/images/${encodeURIComponent(imageId)}${suffix}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new Error(`Unable to load corporate image (${response.status}).`);
  }
  const image = await response.blob();
  if (image.type !== "image/png" && image.type !== "image/jpeg") {
    throw new Error("The image service returned an unsupported image format.");
  }
  return image;
}

export async function loadSignatureImageLibrary(): Promise<SignatureImageAsset[]> {
  if (!signatureImageApiConfigured) {
    throw new Error("Set VITE_TEMPLATE_API_URL and VITE_TEMPLATE_READ_SCOPE to load corporate images.");
  }

  const { accessToken } = await acquireApiToken(templateReadScope, false);
  const response = await fetch(`${preferenceApiUrl}/api/images`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error(`Unable to load corporate images (${response.status}).`);
  const records = await response.json() as Omit<SignatureImageAsset, "previewUrl">[];

  const images: SignatureImageAsset[] = [];
  try {
    for (let index = 0; index < records.length; index += 4) {
      const batch = await Promise.all(records.slice(index, index + 4).map(async (record) => {
        const image = await downloadSignatureImage(record.id, accessToken, true);
        return { ...record, previewUrl: URL.createObjectURL(image) };
      }));
      images.push(...batch);
    }
    return images;
  } catch (error) {
    images.forEach((image) => URL.revokeObjectURL(image.previewUrl));
    throw error;
  }
}

export async function uploadSignatureImage(file: File): Promise<SignatureImageAsset> {
  if (!signatureImageApiConfigured) {
    throw new Error("Corporate image uploads require the authenticated image API.");
  }

  const { accessToken } = await acquireApiToken(templateReadScope, true);
  const response = await fetch(`${preferenceApiUrl}/api/images`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/octet-stream",
      "X-File-Name": encodeURIComponent(file.name),
    },
    body: file,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error ?? `Image upload failed (${response.status}).`);
  }

  const record = await response.json() as Omit<SignatureImageAsset, "previewUrl">;
  try {
    const thumbnail = await downloadSignatureImage(record.id, accessToken, true);
    return {
      ...record,
      previewUrl: URL.createObjectURL(thumbnail),
    };
  } catch (error) {
    throw new Error(`The image was uploaded but its preview could not be loaded: ${error instanceof Error ? error.message : "image preview unavailable"}`);
  }
}

export async function loadFullSignatureImage(imageId: string): Promise<string> {
  const { accessToken } = await acquireApiToken(templateReadScope, false);
  const image = await downloadSignatureImage(imageId, accessToken);
  return URL.createObjectURL(image);
}

export async function signOutOfEntra() {
  if (!application || !initialization) return;
  await initialization;
  await application.logoutPopup({
    account: application.getActiveAccount(),
    postLogoutRedirectUri: `${window.location.origin}/auth-redirect.html`,
  });
}
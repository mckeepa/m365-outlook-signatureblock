import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronLeft,
  FileSignature,
  LoaderCircle,
  Menu,
  PanelLeftClose,
  Plus,
  Search,
  ShieldCheck,
  Star,
  UserRound,
  X,
} from "lucide-react";
import {
  chooseSignatureTemplate,
  renderSignature,
  type SignatureProfile,
  type SignatureTemplate,
} from "@signature/signature-core";
import {
  entraConfigured,
  signatureImageApiConfigured,
  signaturePreferenceApiConfigured,
} from "./entraConfig.js";
import {
  loadUserSignaturePreference,
  loadFullSignatureImage,
  loadSignatureImageLibrary,
  saveUserSignaturePreference,
  signInAndReadProfile,
  trySilentSignInAndReadProfile,
  uploadSignatureImage,
  type SignatureImageAsset,
  type SignedInProfile,
  type UserSignaturePreference,
} from "./entraProfile.js";
import { hydrateSignatureImages } from "./signatureImages.js";
import { sanitizeSignatureHtml } from "./sanitizeSignatureHtml.js";

const TemplateEditor = lazy(() => import("./TemplateEditor.js"));

const editorPreviewProfile: SignatureProfile = {
  displayName: "Jordan Lee",
  mail: "jordan.lee@contoso.example",
  jobTitle: "Director",
  department: "Operations",
  businessPhone: "+1 555 014 0280",
};

const initialTemplates: SignatureTemplate[] = [
  {
    id: "corporate-default",
    name: "Corporate standard",
    version: 3,
    html: "<p><strong>{{displayName}}</strong><br>{{jobTitle}} · {{department}}<br>{{businessPhone}}</p>",
    isDefault: true,
  },
  {
    id: "operations-leadership",
    name: "Operations leadership",
    version: 2,
    html: "<p><strong>{{displayName}}</strong><br>{{jobTitle}} | {{department}}<br>{{email}}</p>",
    isDefault: false,
    eligibleDepartments: ["Operations"],
    eligibleJobTitles: ["Director"],
  },
  {
    id: "regional-compact",
    name: "Regional compact",
    version: 1,
    html: "<p>{{displayName}} · {{department}} · {{businessPhone}}</p>",
    isDefault: false,
    eligibleDepartments: ["Operations"],
  },
];

type View = "templates" | "choices";

function eligibleForProfile(template: SignatureTemplate, profile: SignatureProfile) {
  return (
    (!template.eligibleDepartments?.length ||
      template.eligibleDepartments.includes(profile.department ?? "")) &&
    (!template.eligibleJobTitles?.length ||
      template.eligibleJobTitles.includes(profile.jobTitle ?? ""))
  );
}

export default function App() {
  const [templates, setTemplates] = useState(initialTemplates);
  const [imageLibrary, setImageLibrary] = useState<SignatureImageAsset[]>([]);
  const imageLibraryRef = useRef<SignatureImageAsset[]>([]);
  const [favorites, setFavorites] = useState<string[]>(["operations-leadership"]);
  const [activeView, setActiveView] = useState<View>("templates");
  const [editing, setEditing] = useState<SignatureTemplate | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState("");
  const [signedIn, setSignedIn] = useState<SignedInProfile | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [authReady, setAuthReady] = useState(!entraConfigured);
  const [authError, setAuthError] = useState("");
  const [preferenceBusy, setPreferenceBusy] = useState(false);
  const [selectedPreviewId, setSelectedPreviewId] = useState("corporate-default");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);

  useEffect(() => () => {
    imageLibraryRef.current.forEach((asset) => URL.revokeObjectURL(asset.previewUrl));
  }, []);

  function replaceImageLibrary(images: SignatureImageAsset[]) {
    imageLibraryRef.current.forEach((asset) => URL.revokeObjectURL(asset.previewUrl));
    imageLibraryRef.current = images;
    setImageLibrary(images);
  }

  function applyPreference(preference: UserSignaturePreference | null) {
    setSelectedTemplateId(preference?.selectedTemplateId ?? null);
    setSelectedPreviewId(
      preference?.selectedTemplateId ??
      templates.find((template) => template.isDefault)?.id ??
      "",
    );
  }

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setDrawerOpen(false);
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, []);

  useEffect(() => {
    if (!entraConfigured) {
      setAuthReady(true);
      return;
    }

    let active = true;
    setAuthBusy(true);
    void (async () => {
      const profile = await trySilentSignInAndReadProfile();
      if (!profile || !active) return;
      setSignedIn(profile);
      setSelectedPreviewId("");
      try {
        applyPreference(await loadUserSignaturePreference());
      } catch {
        applyPreference(null);
        setAuthError("Your profile loaded, but the saved signature choice could not be reached.");
      }
      if (signatureImageApiConfigured) {
        try {
          replaceImageLibrary(await loadSignatureImageLibrary());
        } catch (error) {
          setAuthError(error instanceof Error ? error.message : "Corporate images could not be loaded.");
        }
      }
    })()
      .catch((error: unknown) => {
        if (active) {
          setAuthError(error instanceof Error ? error.message : "Automatic Entra sign-in failed.");
        }
      })
      .finally(() => {
        if (active) {
          setAuthBusy(false);
          setAuthReady(true);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  const eligible = signedIn
    ? templates.filter((template) => eligibleForProfile(template, signedIn.profile))
    : [];
  const activeChoice = signedIn
    ? chooseSignatureTemplate(eligible, selectedTemplateId, signedIn.profile)
    : undefined;
  const selectedPreview = eligible.find((template) => template.id === selectedPreviewId)
    ?? activeChoice;
  const filteredTemplates = templates.filter((template) =>
    template.name.toLowerCase().includes(search.toLowerCase()),
  );

  function openNewTemplate() {
    setEditing({
      id: `template-${Date.now()}`,
      name: "Untitled signature",
      version: 1,
      html: "<p><strong>{{displayName}}</strong><br>{{jobTitle}} · {{department}}<br>{{businessPhone}}</p>",
      isDefault: false,
    });
  }

  function saveTemplate(template: SignatureTemplate) {
    const existing = templates.find((item) => item.id === template.id);
    const saved = { ...template, version: existing ? existing.version + 1 : 1 };
    setTemplates((current) => {
      const remaining = current.filter((item) => item.id !== saved.id);
      const withoutOtherDefaults = saved.isDefault
        ? remaining.map((item) => ({ ...item, isDefault: false }))
        : remaining;
      return [...withoutOtherDefaults, saved];
    });
    setEditing(null);
    setNotice("Changes are saved in this prototype session only.");
  }

  function addImageAsset(asset: SignatureImageAsset) {
    const images = [...imageLibraryRef.current, asset];
    imageLibraryRef.current = images;
    setImageLibrary(images);
  }

  async function getFullImageUrl(assetId: string): Promise<string> {
    const current = imageLibraryRef.current.find((asset) => asset.id === assetId);
    if (!current) throw new Error("This image is no longer in the corporate image library.");
    if (current.imageUrl) return current.imageUrl;

    const imageUrl = await loadFullSignatureImage(assetId);
    const images = imageLibraryRef.current.map((asset) =>
      asset.id === assetId ? { ...asset, imageUrl } : asset,
    );
    imageLibraryRef.current = images;
    setImageLibrary(images);
    return imageUrl;
  }

  function setDefault(templateId: string) {
    setTemplates((current) =>
      current.map((template) => ({
        ...template,
        isDefault: template.id === templateId,
      })),
    );
    setNotice("Organization default updated for this prototype session.");
  }

  function toggleFavorite(templateId: string) {
    setFavorites((current) =>
      current.includes(templateId)
        ? current.filter((id) => id !== templateId)
        : [...current, templateId],
    );
  }

  async function connectEntra(switchAccount = false) {
    setAuthBusy(true);
    setAuthError("");
    try {
      const result = await signInAndReadProfile(switchAccount);
      setSignedIn(result);
      setSelectedPreviewId("");
      setAuthReady(true);
      try {
        applyPreference(await loadUserSignaturePreference());
      } catch {
        applyPreference(null);
        setAuthError("Your profile loaded, but the saved signature choice could not be reached.");
      }
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Unable to read your Entra profile.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function setUserDefault(templateId: string | null) {
    const previousTemplateId = selectedTemplateId;
    const previousPreviewId = selectedPreviewId;
    setSelectedTemplateId(templateId);
    setSelectedPreviewId(
      templateId ??
      templates.find((template) => template.isDefault)?.id ??
      "",
    );
    setNotice("");

    if (!signedIn) return;
    if (!signaturePreferenceApiConfigured) {
      setNotice("This choice is for this session only; the template preference API is not configured.");
      return;
    }

    setPreferenceBusy(true);
    try {
      applyPreference(await saveUserSignaturePreference(templateId));
      setNotice(templateId ? "Default signature saved for Outlook." : "Using the organization default in Outlook.");
    } catch (error) {
      setSelectedTemplateId(previousTemplateId);
      setSelectedPreviewId(previousPreviewId);
      setAuthError(error instanceof Error ? error.message : "Unable to save your Outlook signature choice.");
    } finally {
      setPreferenceBusy(false);
    }
  }

  function navigate(view: View) {
    setActiveView(view);
    setEditing(null);
    setDrawerOpen(false);
  }

  return (
    <div className="portal-shell">
      <header className="topbar">
        <button
          aria-expanded={drawerOpen}
          aria-label={drawerOpen ? "Close navigation" : "Open navigation"}
          aria-controls="main-navigation"
          className="menu-trigger"
          onClick={() => setDrawerOpen((open) => !open)}
          type="button"
        >
          {drawerOpen ? <PanelLeftClose size={19} /> : <Menu size={19} />}
        </button>
        <a aria-label="Signature Studio home" className="brand" href="#top">
          <span className="brand-mark"><FileSignature size={17} /></span>
          <span>Signature Studio</span>
        </a>
        <div className="topbar-context">Communications <span>/</span> Email signatures</div>
        <div className="topbar-right">
          <span className="environment-label"><span /> Prototype</span>
          {signedIn ? (
            <button className="profile-button" onClick={() => connectEntra(true)} title="Switch to another work account" type="button">
              <span className="avatar">{signedIn.displayName.slice(0, 1).toUpperCase()}</span>
              <span className="profile-name">{signedIn.displayName}</span>
              {authBusy ? <LoaderCircle className="spin" size={14} /> : <span className="switch-label">Switch user</span>}
            </button>
          ) : (
            <button className="connect-button" disabled={!entraConfigured || authBusy || !authReady} onClick={() => connectEntra()} title={entraConfigured ? "Sign in to your work account" : "Configure the Entra app registration first"} type="button">
              {authBusy || !authReady ? <LoaderCircle className="spin" size={15} /> : <UserRound size={15} />}
              <span>{authBusy || !authReady ? "Checking account" : "Sign in"}</span>
            </button>
          )}
        </div>
      </header>

      {drawerOpen ? (
        <button
          aria-label="Close navigation"
          className="drawer-scrim"
          onClick={() => setDrawerOpen(false)}
          type="button"
        />
      ) : null}
      <aside
        aria-hidden={!drawerOpen}
        className={`side-drawer ${drawerOpen ? "is-open" : ""}`}
        id="main-navigation"
      >
        <div className="drawer-heading">
          <span>WORKSPACE</span>
          <button aria-label="Close navigation" onClick={() => setDrawerOpen(false)} type="button"><X size={17} /></button>
        </div>
        <button
          aria-current={activeView === "templates" ? "page" : undefined}
          className={`drawer-link ${activeView === "templates" ? "is-active" : ""}`}
          onClick={() => navigate("templates")}
          type="button"
        >
          <FileSignature size={17} /> Corporate signatures <span>{templates.length}</span>
        </button>
        <button
          aria-current={activeView === "choices" ? "page" : undefined}
          className={`drawer-link ${activeView === "choices" ? "is-active" : ""}`}
          onClick={() => navigate("choices")}
          type="button"
        >
          <Star size={17} /> My signatures
        </button>
        <div className="drawer-context">
          <ShieldCheck size={16} />
          <span>{signedIn ? "Your Graph profile is held in memory for this session only." : "Connect Entra to preview signatures using your directory profile."}</span>
        </div>
        <div className="drawer-bottom">SIGNATURE STUDIO <span>0.2</span></div>
      </aside>

      <main className="main-content" id="top">
        {editing ? (
          <Suspense fallback={<p className="editor-loading">Loading signature editor…</p>}>
            <TemplateEditor
              imageLibrary={imageLibrary}
              key={editing.id}
              onCancel={() => setEditing(null)}
              onImageUpload={async (file) => {
                const asset = await uploadSignatureImage(file);
                addImageAsset(asset);
                return asset;
              }}
              onImageSelect={getFullImageUrl}
              onSave={saveTemplate}
              template={editing}
            />
          </Suspense>
        ) : activeView === "templates" ? (
          <section className="view" aria-label="Corporate signatures">
            <div className="view-heading">
              <div>
                <div className="eyebrow">SIGNATURE MANAGEMENT</div>
                <h1>Corporate signatures</h1>
                <p>Approved templates for your people and teams.</p>
              </div>
              <button className="primary-button" onClick={openNewTemplate} type="button">
                <Plus size={16} /> New signature
              </button>
            </div>
            {notice ? <Notice message={notice} onDismiss={() => setNotice("")} /> : null}
            {authError ? <Notice message={authError} onDismiss={() => setAuthError("")} /> : null}
            <div className="list-controls">
              <label className="search-field">
                <Search size={16} />
                <input
                  aria-label="Search signatures"
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search signatures"
                  value={search}
                />
              </label>
              <span className="result-count">{filteredTemplates.length} signatures</span>
            </div>
            <div className="signature-table">
              <div className="table-heading"><span>NAME</span><span>ASSIGNED TO</span><span>STATUS</span><span /></div>
              {filteredTemplates.map((template) => (
                <div className="signature-row" key={template.id}>
                  <button className="signature-main" onClick={() => setEditing(template)} type="button">
                    <span className="signature-symbol"><FileSignature size={17} /></span>
                    <span className="signature-copy"><strong>{template.name}</strong><small>Version {template.version}</small></span>
                  </button>
                  <span className="audience-copy">
                    {template.eligibleDepartments?.join(", ") ?? "Everyone"}
                    {template.eligibleJobTitles?.length ? <small>{template.eligibleJobTitles.join(", ")}</small> : null}
                  </span>
                  <span className="status-cell">
                    {template.isDefault ? <span className="default-status"><Check size={13} /> Default</span> : <span className="published-status"><span /> Published</span>}
                  </span>
                  <button
                    aria-label={`Edit ${template.name}`}
                    className="row-action"
                    onClick={() => setEditing(template)}
                    title="Edit signature"
                    type="button"
                  >Edit <ChevronLeft className="edit-chevron" size={14} /></button>
                </div>
              ))}
              {filteredTemplates.length === 0 ? <p className="empty-state">No signatures match your search.</p> : null}
            </div>
            <div className="list-footnote"><ShieldCheck size={15} /> Templates are cached by Outlook and refreshed when users next open the add-in.</div>
          </section>
        ) : (
          <section className="view choices-view" aria-label="My signature choices">
            <div className="view-heading">
              <div>
                <div className="eyebrow">OUTLOOK PREFERENCES</div>
                <h1>My signatures</h1>
                <p>Choose which Signature Studio template the Outlook add-in applies by default. Native Outlook saved signatures are separate.</p>
              </div>
            </div>
            {notice ? <Notice message={notice} onDismiss={() => setNotice("")} /> : null}
            {authError ? <Notice message={authError} onDismiss={() => setAuthError("")} /> : null}
            {!signedIn ? (
              <div className="profile-gate">
                <span className="profile-gate-icon"><UserRound size={19} /></span>
                <div>
                  <h2>Preview with your work profile</h2>
                  <p>{!entraConfigured ? "Set your app registration IDs in apps/portal/.env.local, then restart the dev server." : !authReady ? "Checking for your existing work account…" : "Sign in to load your name, title, department, and phone from Microsoft Graph."}</p>
                  {!entraConfigured ? <code>VITE_ENTRA_CLIENT_ID · VITE_ENTRA_TENANT_ID · npm run dev</code> : null}
                </div>
                {entraConfigured && authReady ? (
                  <button className="primary-button" disabled={authBusy} onClick={() => connectEntra()} type="button">
                    {authBusy ? <LoaderCircle className="spin" size={15} /> : <UserRound size={15} />}
                    {authBusy ? "Signing in" : "Sign in"}
                  </button>
                ) : null}
              </div>
            ) : (
            <>
            <div className="active-signature">
              <span className="active-star"><Star size={19} /></span>
              <div><small>{selectedTemplateId && activeChoice?.id === selectedTemplateId ? "YOUR SIGNATURE STUDIO DEFAULT" : "ORGANIZATION DEFAULT"}</small><strong>{activeChoice?.name ?? "No signature selected"}</strong></div>
              <span className="active-check"><Check size={15} /> {activeChoice ? "ACTIVE" : "NONE"}</span>
              {selectedTemplateId ? (
                <button className="reset-default-button" disabled={preferenceBusy} onClick={() => void setUserDefault(null)} type="button">
                  Use organization default
                </button>
              ) : null}
            </div>
            <div className="signature-preferences">
              <div className="choice-list-panel">
                <div className="choice-heading"><h2>Available to you</h2><span>{eligible.length} signatures</span></div>
                <div className="choice-list">
                  {eligible.map((template) => (
                    <div className={`choice-row ${selectedPreview?.id === template.id ? "is-previewing" : ""}`} key={template.id}>
                      <button
                        aria-pressed={selectedPreview?.id === template.id}
                        className="choice-select"
                        onClick={() => setSelectedPreviewId(template.id)}
                        type="button"
                      >
                        <span className="choice-icon"><FileSignature size={17} /></span>
                        <span className="choice-copy">
                          <strong>{template.name}</strong>
                          <small>{template.eligibleDepartments?.join(", ") ?? "Available to all"}</small>
                        </span>
                        {template.isDefault ? <span className="organization-default-badge">ORG DEFAULT</span> : null}
                      </button>
                      <button
                        aria-pressed={favorites.includes(template.id)}
                        className={`favorite-button ${favorites.includes(template.id) ? "is-favorite" : ""}`}
                        onClick={() => toggleFavorite(template.id)}
                        title={favorites.includes(template.id) ? "Remove favorite" : "Add favorite"}
                        type="button"
                      ><Star size={15} /> <span>{favorites.includes(template.id) ? "Saved" : "Save"}</span></button>
                      <button
                        aria-label={activeChoice?.id === template.id ? `${template.name} is selected` : `Select ${template.name}`}
                        aria-pressed={activeChoice?.id === template.id}
                        className={`select-template-button ${activeChoice?.id === template.id ? "is-selected" : ""}`}
                        disabled={preferenceBusy}
                        onClick={() => void setUserDefault(template.id)}
                        type="button"
                      >{activeChoice?.id === template.id ? <><Check size={13} /> Selected</> : "Select"}</button>
                    </div>
                  ))}
                  {eligible.length === 0 ? <p className="empty-state">No signatures are assigned to your current profile.</p> : null}
                </div>
                <div className="list-footnote"><ShieldCheck size={15} /> {signaturePreferenceApiConfigured ? "Your selected template ID is saved to your work profile." : "Your selection is session-only until the template preference API is configured."} This list does not read Outlook's native signature settings.</div>
              </div>
              <SignaturePreview
                imageLibrary={imageLibrary}
                template={selectedPreview}
                profile={signedIn.profile}
              />
            </div>
            </>
            )}
          </section>
        )}
      </main>
      <div aria-live="polite" className="toast-region">
        <span className="prototype-tag">Local prototype · Changes are not persisted</span>
      </div>
    </div>
  );
}

function SignaturePreview({
  template,
  profile,
  imageLibrary,
}: {
  template: SignatureTemplate | undefined;
  profile: SignatureProfile;
  imageLibrary: SignatureImageAsset[];
}) {
  const html = template
    ? sanitizeSignatureHtml(
      hydrateSignatureImages(renderSignature(template, profile), imageLibrary),
      new Set(imageLibrary.flatMap((asset) =>
        [asset.previewUrl, ...(asset.imageUrl ? [asset.imageUrl] : [])],
      )),
    )
    : "";

  return (
    <aside className="signature-preview-panel" aria-label="Selected signature preview">
      <div className="preview-panel-heading">
        <div><h2>Signature preview</h2><span>{template?.name ?? "Select a signature"}</span></div>
        <span className="preview-live">LIVE</span>
      </div>
      <div className="signature-preview-paper">
        <div className="preview-message-label">NEW MESSAGE</div>
        <p>Hello,</p>
        <p>Thanks,</p>
        {template ? (
          <div className="actual-signature" dangerouslySetInnerHTML={{ __html: html }} />
        ) : <p className="preview-empty">Choose a signature to preview it with your profile details.</p>}
      </div>
      <div className="profile-preview-details">
        <span className="avatar">{profile.displayName?.slice(0, 1).toUpperCase() || "U"}</span>
        <div><strong>{profile.displayName || "Name not set"}</strong><span>{profile.jobTitle || "Title not set"} · {profile.department || "Department not set"}</span></div>
      </div>
      <p className="profile-memory-note">Profile read from Microsoft Graph for this session. It is not saved by this portal.</p>
    </aside>
  );
}

function Notice({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="inline-notice" role="status">
      <Check size={15} /> {message}
      <button aria-label="Dismiss notice" onClick={onDismiss} type="button"><X size={14} /></button>
    </div>
  );
}

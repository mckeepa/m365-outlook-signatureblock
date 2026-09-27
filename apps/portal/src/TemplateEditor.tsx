import { useRef, useState, type ChangeEvent, type FormEvent, type MouseEvent } from "react";
import {
  Bold,
  Check,
  ChevronLeft,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListOrdered,
  ShieldCheck,
  Underline as UnderlineIcon,
} from "lucide-react";
import { EditorContent, useEditor } from "@tiptap/react";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import Underline from "@tiptap/extension-underline";
import StarterKit from "@tiptap/starter-kit";
import {
  renderSignature,
  type SignatureProfile,
  type SignatureTemplate,
} from "@signature/signature-core";
import type { SignatureImageAsset } from "./entraProfile.js";
import { hydrateSignatureImages, serializeSignatureImages } from "./signatureImages.js";
import { sanitizeSignatureHtml } from "./sanitizeSignatureHtml.js";

const MAX_IMAGE_BYTES = 1024 * 1024;

const previewProfile: SignatureProfile = {
  displayName: "Jordan Lee",
  mail: "jordan.lee@contoso.example",
  jobTitle: "Director",
  department: "Operations",
  businessPhone: "+1 555 014 0280",
};

const editorExtensions = [
  StarterKit.configure({ link: false, underline: false }),
  Link.configure({
    autolink: false,
    linkOnPaste: false,
    openOnClick: false,
    protocols: ["https", "mailto"],
  }),
  Image.extend({
    addAttributes() {
      return {
        ...this.parent?.(),
        assetId: {
          default: null,
          parseHTML: (element) => element.getAttribute("data-asset-id"),
          renderHTML: (attributes) => attributes.assetId
            ? { "data-asset-id": attributes.assetId }
            : {},
        },
      };
    },
  }).configure({ allowBase64: false, inline: true }),
  Underline,
];

const profileFields = [
  ["Name", "{{displayName}}"],
  ["Email", "{{email}}"],
  ["Role", "{{jobTitle}}"],
  ["Department", "{{department}}"],
  ["Phone", "{{businessPhone}}"],
] as const;

export default function TemplateEditor({
  template,
  imageLibrary,
  onImageUpload,
  onImageSelect,
  onCancel,
  onSave,
}: {
  template: SignatureTemplate;
  imageLibrary: SignatureImageAsset[];
  onImageUpload: (file: File) => Promise<SignatureImageAsset>;
  onImageSelect: (assetId: string) => Promise<string>;
  onCancel: () => void;
  onSave: (template: SignatureTemplate) => void;
}) {
  const [name, setName] = useState(template.name);
  const [departmentText, setDepartmentText] = useState(template.eligibleDepartments?.join(", ") ?? "");
  const [jobTitleText, setJobTitleText] = useState(template.eligibleJobTitles?.join(", ") ?? "");
  const [isDefault, setIsDefault] = useState(template.isDefault);
  const [html, setHtml] = useState(template.html);
  const [linkError, setLinkError] = useState("");
  const [imageError, setImageError] = useState("");
  const [imageBusyId, setImageBusyId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const allowedImageSources = new Set(imageLibrary.flatMap((asset) =>
    [asset.previewUrl, ...(asset.imageUrl ? [asset.imageUrl] : [])],
  ));
  const editor = useEditor({
    extensions: editorExtensions,
    content: sanitizeSignatureHtml(
      hydrateSignatureImages(template.html, imageLibrary),
      allowedImageSources,
    ),
    editorProps: {
      attributes: { "aria-label": "Signature rich text editor" },
      transformPastedHTML: (html) => sanitizeSignatureHtml(html),
      handleDrop: (view, event) => {
        const file = Array.from(event.dataTransfer?.files ?? []).find((item) =>
          item.type === "image/png" || item.type === "image/jpeg",
        );
        if (!file) return false;

        event.preventDefault();
        const position = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
        void uploadImageFile(file, position);
        return true;
      },
    },
    onUpdate: ({ editor: currentEditor }) =>
      setHtml(serializeSignatureImages(currentEditor.getHTML())),
  });

  const rendered = sanitizeSignatureHtml(
    renderSignature({
      ...template,
      html: hydrateSignatureImages(html, imageLibrary),
    }, previewProfile),
    allowedImageSources,
  );

  function preserveEditorFocus(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
  }

  function insertLink() {
    const href = window.prompt("Enter an HTTPS website or mailto link");
    if (!href) return;
    try {
      const parsed = new URL(href);
      if (parsed.protocol !== "https:" && parsed.protocol !== "mailto:") {
        setLinkError("Only HTTPS websites and mailto links are allowed.");
        return;
      }
    } catch {
      setLinkError("Enter a complete HTTPS website or mailto link.");
      return;
    }
    editor?.chain().focus().extendMarkRange("link").setLink({ href }).run();
    setLinkError("");
  }

  async function uploadImageFile(file: File, position?: number) {
    setImageError("");

    const mimeType = file.type.toLowerCase();
    if (mimeType !== "image/png" && mimeType !== "image/jpeg") {
      setImageError("Choose a PNG or JPEG image.");
      return;
    }
    if (file.size < 1 || file.size > MAX_IMAGE_BYTES) {
      setImageError("Images must be smaller than 1 MB.");
      return;
    }

    try {
      const asset = await onImageUpload(file);
      await insertImage(asset, position);
    } catch (error) {
      setImageError(error instanceof Error ? error.message : "The image upload failed.");
    }
  }

  async function insertImage(asset: SignatureImageAsset, position?: number) {
    setImageBusyId(asset.id);
    setImageError("");
    try {
      const imageUrl = asset.imageUrl ?? await onImageSelect(asset.id);
      const imageNode = {
        type: "image",
        attrs: {
          src: imageUrl,
          alt: asset.name,
          title: asset.name,
          assetId: asset.id,
        },
      };
      if (position === undefined) editor?.chain().focus().insertContent(imageNode).run();
      else editor?.chain().insertContentAt(position, imageNode).run();
      setHtml(serializeSignatureImages(editor?.getHTML() ?? html));
    } catch (error) {
      setImageError(error instanceof Error ? error.message : "Unable to load the selected corporate image.");
    } finally {
      setImageBusyId(null);
    }
  }

  async function uploadImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (file) await uploadImageFile(file);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const departments = departmentText.split(",").map((item) => item.trim()).filter(Boolean);
    const jobTitles = jobTitleText.split(",").map((item) => item.trim()).filter(Boolean);
    onSave({
      ...template,
      name: name.trim(),
      html: serializeSignatureImages(editor?.getHTML() ?? html),
      isDefault,
      ...(departments.length ? { eligibleDepartments: departments } : { eligibleDepartments: undefined }),
      ...(jobTitles.length ? { eligibleJobTitles: jobTitles } : { eligibleJobTitles: undefined }),
    });
  }

  return (
    <form className="editor-view" onSubmit={submit}>
      <div className="editor-heading">
        <div>
          <button className="back-link" onClick={onCancel} type="button"><ChevronLeft size={16} /> All signatures</button>
          <div className="eyebrow">TEMPLATE EDITOR <span>·</span> VERSION {template.version}</div>
          <h1>{template.name === "Untitled signature" ? "New signature" : "Edit signature"}</h1>
        </div>
        <div className="editor-actions">
          <button className="secondary-button" onClick={onCancel} type="button">Cancel</button>
          <button className="primary-button" disabled={!name.trim() || !editor} type="submit"><Check size={15} /> Save changes</button>
        </div>
      </div>

      <div className="editor-settings">
        <label className="metadata-field name-field">Signature name<input maxLength={80} onChange={(event) => setName(event.target.value)} required value={name} /></label>
        <label className="metadata-field">Departments <small>Optional · comma-separated</small><input onChange={(event) => setDepartmentText(event.target.value)} placeholder="Everyone" value={departmentText} /></label>
        <label className="metadata-field">Job titles <small>Optional · comma-separated</small><input onChange={(event) => setJobTitleText(event.target.value)} placeholder="All roles" value={jobTitleText} /></label>
        <label className="default-toggle"><input checked={isDefault} onChange={(event) => setIsDefault(event.target.checked)} type="checkbox" /><span className="toggle-track" /><span>Organization default</span></label>
      </div>

      <div className="editor-workspace">
        <section className="composer-column" aria-label="Signature content editor">
          <div className="column-heading"><div><h2>Signature content</h2><p>Format the block and insert dynamic profile fields.</p></div><span className="format-label">RICH TEXT</span></div>
          <div className="rich-toolbar" role="toolbar" aria-label="Signature formatting">
            <button aria-label="Bold" aria-pressed={editor?.isActive("bold") ?? false} disabled={!editor} onClick={() => editor?.chain().focus().toggleBold().run()} onMouseDown={preserveEditorFocus} title="Bold" type="button"><Bold size={16} /></button>
            <button aria-label="Italic" aria-pressed={editor?.isActive("italic") ?? false} disabled={!editor} onClick={() => editor?.chain().focus().toggleItalic().run()} onMouseDown={preserveEditorFocus} title="Italic" type="button"><Italic size={16} /></button>
            <button aria-label="Underline" aria-pressed={editor?.isActive("underline") ?? false} disabled={!editor} onClick={() => editor?.chain().focus().toggleUnderline().run()} onMouseDown={preserveEditorFocus} title="Underline" type="button"><UnderlineIcon size={16} /></button>
            <span className="toolbar-separator" />
            <button aria-label="Bulleted list" aria-pressed={editor?.isActive("bulletList") ?? false} disabled={!editor} onClick={() => editor?.chain().focus().toggleBulletList().run()} onMouseDown={preserveEditorFocus} title="Bulleted list" type="button"><List size={16} /></button>
            <button aria-label="Numbered list" aria-pressed={editor?.isActive("orderedList") ?? false} disabled={!editor} onClick={() => editor?.chain().focus().toggleOrderedList().run()} onMouseDown={preserveEditorFocus} title="Numbered list" type="button"><ListOrdered size={16} /></button>
            <span className="toolbar-separator" />
            <button aria-label="Add HTTPS link" disabled={!editor} onClick={insertLink} onMouseDown={preserveEditorFocus} title="Add HTTPS link" type="button"><Link2 size={16} /></button>
            <span className="toolbar-spacer" />
            <span className="toolbar-hint">Insert field</span>
            {profileFields.map(([label, token]) => (
              <button className="field-chip" key={token} onClick={() => editor?.chain().focus().insertContent(token).run()} onMouseDown={preserveEditorFocus} title={`Insert ${label}`} type="button">{label}</button>
            ))}
          </div>
          <div className="image-library" aria-label="Corporate image library">
            <div className="image-library-heading">
              <div>
                <strong>Corporate images</strong>
                <span>Upload PNG/JPEG or drag an image onto the signature editor to insert it there.</span>
              </div>
              <button
                className="secondary-button image-upload-button"
                onClick={() => fileInputRef.current?.click()}
                onMouseDown={preserveEditorFocus}
                type="button"
              ><ImagePlus size={14} /> Upload image</button>
              <input
                accept="image/png,image/jpeg"
                aria-label="Upload a corporate PNG or JPEG image"
                className="visually-hidden"
                onChange={(event) => void uploadImage(event)}
                ref={fileInputRef}
                type="file"
              />
            </div>
            <p className="image-library-note">Images are stored in the organization’s private image library. Upload permission is restricted to template administrators.</p>
            {imageError ? <p className="field-error" role="alert">{imageError}</p> : null}
            {imageLibrary.length ? (
              <div className="image-library-grid">
                {imageLibrary.map((asset) => (
                  <button
                    className="image-asset"
                    disabled={imageBusyId === asset.id}
                    key={asset.id}
                    onClick={() => void insertImage(asset)}
                    onMouseDown={preserveEditorFocus}
                    title={`Insert ${asset.name}`}
                    type="button"
                  >
                    <img alt="" src={asset.previewUrl} />
                    <span>{asset.name}</span>
                  </button>
                ))}
              </div>
            ) : <p className="image-library-empty">No images uploaded yet.</p>}
          </div>
          <div className="editor-frame"><EditorContent editor={editor} /></div>
          {linkError ? <p className="field-error" role="alert">{linkError}</p> : null}
          <div className="editor-footnote"><ShieldCheck size={15} /> Profile fields are filled in Outlook at compose time. They are not saved in this template.</div>
        </section>

        <aside className="preview-column" aria-label="Signature preview">
          <div className="column-heading"><div><h2>Preview</h2><p>Example using a sample profile.</p></div><span className="preview-dot" /></div>
          <div className="preview-paper">
            <div className="preview-mail-chrome"><span>New message</span><span>To</span><span>Subject</span></div>
            <div className="preview-message">Hello,<br /><br />Thanks,<br /><div className="rendered-signature" dangerouslySetInnerHTML={{ __html: rendered }} /></div>
          </div>
          <div className="preview-profile-note"><span className="avatar small-avatar">JL</span><span><strong>Jordan Lee</strong><small>Sample profile · Operations</small></span></div>
          <p className="preview-disclaimer">Preview data only. Your actual details are requested from Microsoft Graph when Outlook inserts the signature.</p>
        </aside>
      </div>
    </form>
  );
}
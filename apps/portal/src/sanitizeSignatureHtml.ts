import DOMPurify from "dompurify";

const allowedImageDataUrl = /^data:image\/(?:png|jpeg);base64,[a-z0-9+/]+={0,2}$/i;

export function sanitizeSignatureHtml(
  html: string,
  allowedImageSources: ReadonlySet<string> = new Set(),
): string {
  DOMPurify.addHook("uponSanitizeAttribute", (node, data) => {
    if (
      node.nodeName === "IMG" &&
      data.attrName === "src" &&
      (!allowedImageDataUrl.test(data.attrValue) && !data.attrValue.startsWith("blob:") ||
        !allowedImageSources.has(data.attrValue))
    ) {
      data.keepAttr = false;
    }
  });

  try {
    return DOMPurify.sanitize(html, {
      ALLOWED_ATTR: ["href", "title", "target", "rel", "src", "alt", "data-asset-id"],
      FORBID_TAGS: ["iframe", "object", "embed", "svg", "style", "video", "audio", "source", "track"],
      ALLOWED_URI_REGEXP: /^(?:(?:https|mailto):|blob:|data:image\/(?:png|jpeg);base64,)/i,
    });
  } finally {
    DOMPurify.removeHook("uponSanitizeAttribute");
  }
}

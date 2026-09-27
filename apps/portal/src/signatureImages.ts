import type { SignatureImageAsset } from "./entraProfile.js";

export function hydrateSignatureImages(
  html: string,
  assets: SignatureImageAsset[],
): string {
  const images = new Map(assets.map((asset) => [asset.id, asset.imageUrl ?? asset.previewUrl]));
  const document = new DOMParser().parseFromString(html, "text/html");

  for (const image of document.querySelectorAll("img")) {
    const assetId = image.getAttribute("data-asset-id");
    const previewUrl = assetId ? images.get(assetId) : undefined;
    if (!previewUrl) {
      image.remove();
      continue;
    }
    image.setAttribute("src", previewUrl);
  }

  return document.body.innerHTML;
}

export function serializeSignatureImages(html: string): string {
  const document = new DOMParser().parseFromString(html, "text/html");

  for (const image of document.querySelectorAll("img")) {
    const assetId = image.getAttribute("data-asset-id");
    if (!assetId) {
      image.remove();
      continue;
    }
    image.setAttribute("src", `asset:${assetId}`);
  }

  return document.body.innerHTML;
}

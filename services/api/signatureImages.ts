import {
  BlobServiceClient,
  type ContainerClient,
} from "@azure/storage-blob";
import {
  CosmosClient,
  type Container,
} from "@azure/cosmos";
import { DefaultAzureCredential } from "@azure/identity";
import {
  app,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from "@azure/functions";
import sharp from "sharp";
import {
  AuditRequestError,
  getAuthenticatedUserObjectId,
  getTemplateAdminObjectId,
  readLimitedBody,
} from "./auditRecord.js";

const maxImageBytes = 1024 * 1024;
const maxImageWidth = 1600;
const maxImageHeight = 1200;
const assetIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type SharpInstance = ReturnType<typeof sharp>;
type ImageMetadata = Awaited<ReturnType<SharpInstance["metadata"]>>;

export interface SignatureImageRecord {
  id: string;
  name: string;
  contentType: "image/png" | "image/jpeg";
  width: number;
  height: number;
  byteLength: number;
  createdAtUtc: string;
  createdByObjectId: string;
}

export interface NormalizedSignatureImage {
  data: Buffer;
  contentType: "image/png" | "image/jpeg";
  width: number;
  height: number;
}

let imagesContainer: Container | undefined;
let assetsContainer: ContainerClient | undefined;

function getImagesContainer(): Container {
  if (imagesContainer) return imagesContainer;

  const endpoint = process.env.COSMOS_ENDPOINT;
  const databaseName = process.env.COSMOS_DATABASE_NAME;
  if (!endpoint || !databaseName) throw new Error("Image metadata storage is not configured.");

  const client = new CosmosClient({
    endpoint,
    aadCredentials: new DefaultAzureCredential(),
  });
  imagesContainer = client.database(databaseName).container("SignatureImages");
  return imagesContainer;
}

function getAssetsContainer(): ContainerClient {
  if (assetsContainer) return assetsContainer;

  const endpoint = process.env.ASSETS_BLOB_ENDPOINT;
  const containerName = process.env.ASSETS_CONTAINER_NAME;
  if (!endpoint || !containerName) throw new Error("Image asset storage is not configured.");

  assetsContainer = new BlobServiceClient(endpoint, new DefaultAzureCredential())
    .getContainerClient(containerName);
  return assetsContainer;
}

function getTenantId(): string {
  const tenantId = process.env.API_AUTH_TENANT_ID;
  if (!tenantId) throw new Error("API tenant configuration is missing.");
  return tenantId;
}

function getReaderObjectId(request: HttpRequest): string {
  return getAuthenticatedUserObjectId(
    request.headers.get("x-ms-client-principal"),
    getTenantId(),
    "Templates.Read",
  );
}

function getImageName(request: HttpRequest): string {
  const input = request.headers.get("x-file-name") ?? "corporate-image";
  let decoded: string;
  try {
    decoded = decodeURIComponent(input);
  } catch {
    decoded = "corporate-image";
  }
  const basename = decoded.split(/[\\/]/).at(-1) ?? "corporate-image";
  const safeName = basename.replace(/[^a-zA-Z0-9._ -]/g, "_").trim().slice(0, 100);
  return safeName || "corporate-image";
}

export async function normalizeSignatureImage(input: Buffer): Promise<NormalizedSignatureImage> {
  let image: SharpInstance;
  let metadata: ImageMetadata;
  try {
    image = sharp(input, {
      limitInputPixels: maxImageWidth * maxImageHeight,
      animated: false,
      failOn: "error",
    });
    metadata = await image.metadata();
  } catch {
    throw new AuditRequestError("The uploaded file is not a valid PNG or JPEG image.", 415);
  }

  if (
    (metadata.format !== "png" && metadata.format !== "jpeg") ||
    (metadata.pages ?? 1) !== 1
  ) {
    throw new AuditRequestError("Only static PNG and JPEG images are supported.", 415);
  }
  if (
    !metadata.width ||
    !metadata.height ||
    metadata.width > maxImageWidth ||
    metadata.height > maxImageHeight
  ) {
    throw new AuditRequestError(`Images must be no larger than ${maxImageWidth} × ${maxImageHeight} pixels.`, 400);
  }

  try {
    const normalized = metadata.format === "png"
      ? await image.rotate().png({ compressionLevel: 9 }).toBuffer({ resolveWithObject: true })
      : await image.rotate().jpeg({ quality: 90, mozjpeg: true }).toBuffer({ resolveWithObject: true });
    if (
      normalized.info.width > maxImageWidth ||
      normalized.info.height > maxImageHeight ||
      normalized.data.byteLength > maxImageBytes
    ) {
      throw new AuditRequestError("The normalized image exceeds the supported size or dimensions.", 400);
    }

    return {
      data: normalized.data,
      contentType: metadata.format === "png" ? "image/png" : "image/jpeg",
      width: normalized.info.width,
      height: normalized.info.height,
    };
  } catch (error) {
    if (error instanceof AuditRequestError) throw error;
    throw new AuditRequestError("The uploaded file could not be safely decoded.", 415);
  }
}

async function listSignatureImages(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  try {
    getReaderObjectId(request);
    const result = await getImagesContainer().items
      .query<SignatureImageRecord>({
        query: "SELECT TOP 200 c.id, c.name, c.contentType, c.width, c.height, c.byteLength, c.createdAtUtc FROM c ORDER BY c.createdAtUtc DESC",
      })
      .fetchAll();
    return {
      status: 200,
      jsonBody: result.resources,
      headers: { "Cache-Control": "no-store" },
    };
  } catch (error) {
    if (error instanceof AuditRequestError) {
      return { status: error.statusCode, jsonBody: { error: error.message } };
    }
    context.error("Corporate image library read failed.", error);
    return { status: 503, jsonBody: { error: "image_library_unavailable" } };
  }
}

async function uploadSignatureImage(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  let blobName: string | undefined;
  try {
    const createdByObjectId = getTemplateAdminObjectId(
      request.headers.get("x-ms-client-principal"),
      getTenantId(),
    );
    const declaredLength = request.headers.get("content-length");
    if (declaredLength !== null && Number(declaredLength) > maxImageBytes) {
      throw new AuditRequestError("Images must be no larger than 1 MiB.", 413);
    }
    const input = Buffer.from(await readLimitedBody(request.body, maxImageBytes));
    if (!input.byteLength) throw new AuditRequestError("Choose a non-empty PNG or JPEG image.", 400);

    const normalized = await normalizeSignatureImage(input);
    const id = crypto.randomUUID();
    const contentType = normalized.contentType;
    const extension = contentType === "image/png" ? "png" : "jpg";
    blobName = `${id}.${extension}`;
    const blob = getAssetsContainer().getBlockBlobClient(blobName);
    await blob.uploadData(normalized.data, {
      blobHTTPHeaders: { blobContentType: contentType },
    });

    const record: SignatureImageRecord = {
      id,
      name: getImageName(request),
      contentType,
      width: normalized.width,
      height: normalized.height,
      byteLength: normalized.data.byteLength,
      createdAtUtc: new Date().toISOString(),
      createdByObjectId,
    };
    try {
      await getImagesContainer().items.create(record);
    } catch (error) {
      await blob.deleteIfExists();
      blobName = undefined;
      throw error;
    }

    return { status: 201, jsonBody: record };
  } catch (error) {
    if (error instanceof AuditRequestError) {
      return { status: error.statusCode, jsonBody: { error: error.message } };
    }
    context.error("Corporate image upload failed.", error);
    return { status: 503, jsonBody: { error: "image_upload_unavailable" } };
  }
}

async function getSignatureImage(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  try {
    getReaderObjectId(request);
    const id = request.params.assetId ?? "";
    if (!assetIdPattern.test(id)) {
      throw new AuditRequestError("Image asset ID is invalid.", 400);
    }

    let record: SignatureImageRecord;
    try {
      const response = await getImagesContainer().item(id, id).read<SignatureImageRecord>();
      if (!response.resource) throw new AuditRequestError("Image not found.", 404);
      record = response.resource;
    } catch (error) {
      if (error instanceof AuditRequestError) throw error;
      if ((error as { code?: number }).code === 404) {
        return { status: 404, jsonBody: { error: "image_not_found" } };
      }
      throw error;
    }

    const extension = record.contentType === "image/png" ? "png" : "jpg";
    // downloadToBuffer's `count` is a hard requirement, not a cap: passing a
    // count larger than the actual blob length throws "Stream drains before
    // getting enough data needed". Use the exact stored size instead.
    const original = await getAssetsContainer()
      .getBlockBlobClient(`${id}.${extension}`)
      .downloadToBuffer(0, record.byteLength);
    const thumbnail = request.query.get("thumbnail") === "1";
    const image = thumbnail
      ? await sharp(original)
        .resize({ width: 240, height: 120, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 70 })
        .toBuffer()
      : original;
    return {
      status: 200,
      body: image,
      headers: {
        "Content-Type": thumbnail ? "image/jpeg" : record.contentType,
        "Content-Length": String(image.byteLength),
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": "inline",
      },
    };
  } catch (error) {
    if (error instanceof AuditRequestError) {
      return { status: error.statusCode, jsonBody: { error: error.message } };
    }
    context.error("Corporate image read failed.", error);
    return { status: 503, jsonBody: { error: "image_read_unavailable" } };
  }
}

app.http("listSignatureImages", {
  route: "images",
  methods: ["GET"],
  authLevel: "anonymous",
  handler: listSignatureImages,
});

app.http("uploadSignatureImage", {
  route: "images",
  methods: ["POST"],
  authLevel: "anonymous",
  handler: uploadSignatureImage,
});

app.http("getSignatureImage", {
  route: "images/{assetId}",
  methods: ["GET"],
  authLevel: "anonymous",
  handler: getSignatureImage,
});

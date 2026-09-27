import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const projectDirectory = path.dirname(fileURLToPath(import.meta.url));
const outputDirectory = path.resolve(projectDirectory, "../../portal/dist/outlook-addin");
const manifestTemplate = await readFile(
  path.resolve(projectDirectory, "../manifest.xml.template"),
  "utf8",
);
const configuredBaseUrl = (process.env.OUTLOOK_ADDIN_BASE_URL ?? "https://localhost:5174").replace(/\/+$/, "");
await mkdir(outputDirectory, { recursive: true });

let parsedBaseUrl;
try {
  parsedBaseUrl = new URL(configuredBaseUrl);
} catch {
  throw new Error("OUTLOOK_ADDIN_BASE_URL must be an absolute HTTPS URL.");
}
if (parsedBaseUrl.protocol !== "https:") throw new Error("OUTLOOK_ADDIN_BASE_URL must use HTTPS.");
if (parsedBaseUrl.username || parsedBaseUrl.password || parsedBaseUrl.search || parsedBaseUrl.hash) {
  throw new Error("OUTLOOK_ADDIN_BASE_URL must not include credentials, a query string, or a fragment.");
}
const baseUrl = `${parsedBaseUrl.origin}${parsedBaseUrl.pathname.replace(/\/+$/, "")}`;
const xmlSafeBaseUrl = baseUrl.replaceAll("&", "&amp;").replaceAll('"', "&quot;");

await writeFile(
  path.join(outputDirectory, "manifest.xml"),
  manifestTemplate
    .replaceAll("__ADDIN_BASE_URL__", xmlSafeBaseUrl)
    .replaceAll("__ADDIN_ORIGIN__", parsedBaseUrl.origin),
);

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, crc]);
}

function createIcon(size) {
  const pixels = Buffer.alloc((size * 4 + 1) * size);
  const scale = size / 16;
  for (let y = 0; y < size; y += 1) {
    const row = y * (size * 4 + 1);
    const gridY = Math.floor(y / scale);
    pixels[row] = 0;
    for (let x = 0; x < size; x += 1) {
      const gridX = Math.floor(x / scale);
      const offset = row + 1 + x * 4;
      pixels[offset] = 17;
      pixels[offset + 1] = 103;
      pixels[offset + 2] = 94;
      pixels[offset + 3] = 255;
      const mark =
        (gridY < 3 && gridX >= 4 && gridX <= 11) ||
        (gridX <= 5 && gridY >= 2 && gridY <= 7) ||
        (gridY >= 6 && gridY <= 9 && gridX >= 4 && gridX <= 11) ||
        (gridX >= 10 && gridY >= 8 && gridY <= 13) ||
        (gridY >= 12 && gridX >= 4 && gridX <= 11);
      if (mark) {
        pixels[offset] = 255;
        pixels[offset + 1] = 255;
        pixels[offset + 2] = 255;
      }
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  const compressed = deflateSync(pixels);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", compressed),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

await Promise.all([
  writeFile(path.join(outputDirectory, "icon-32.png"), createIcon(32)),
  writeFile(path.join(outputDirectory, "icon-80.png"), createIcon(80)),
  writeFile(path.join(outputDirectory, "taskpane.html"), await readFile(path.resolve(projectDirectory, "../taskpane.html"))),
]);

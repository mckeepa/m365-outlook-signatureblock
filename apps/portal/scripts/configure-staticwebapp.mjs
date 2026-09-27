import { readFile, writeFile } from "node:fs/promises";

const configPath = new URL("../dist/staticwebapp.config.json", import.meta.url);
const config = JSON.parse(await readFile(configPath, "utf8"));
const apiUrl = process.env.VITE_TEMPLATE_API_URL?.trim();

if (apiUrl) {
  const apiOrigin = new URL(apiUrl);
  if (
    apiOrigin.protocol !== "https:" ||
    apiOrigin.username ||
    apiOrigin.password ||
    apiOrigin.pathname !== "/" ||
    apiOrigin.search ||
    apiOrigin.hash
  ) {
    throw new Error("VITE_TEMPLATE_API_URL must be an HTTPS origin without a path, query, or credentials.");
  }

  const directives = config.globalHeaders["Content-Security-Policy"].split("; ");
  const connectDirectiveIndex = directives.findIndex((directive) => directive.startsWith("connect-src "));
  if (connectDirectiveIndex === -1) {
    throw new Error("Content Security Policy is missing its connect-src directive.");
  }

  directives[connectDirectiveIndex] += ` ${apiOrigin.origin}`;
  config.globalHeaders["Content-Security-Policy"] = directives.join("; ");
}

await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);

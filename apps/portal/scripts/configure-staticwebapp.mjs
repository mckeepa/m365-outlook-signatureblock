import { readFile, writeFile } from "node:fs/promises";
import { loadEnv } from "vite";

const configPath = new URL("../dist/staticwebapp.config.json", import.meta.url);
const config = JSON.parse(await readFile(configPath, "utf8"));

// Vite only exposes VITE_-prefixed .env values to client code via import.meta.env; it does not
// export them into process.env for separate Node scripts like this one. Load the same .env files
// Vite would (.env, .env.local, .env.production, .env.production.local, in increasing priority)
// so a value set only in .env.local (the common local/CI case) is still picked up here.
const projectRoot = new URL("..", import.meta.url).pathname;
const env = loadEnv(process.env.NODE_ENV ?? "production", projectRoot, "VITE_");
const apiUrl = (process.env.VITE_TEMPLATE_API_URL ?? env.VITE_TEMPLATE_API_URL)?.trim();

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
} else {
  console.warn(
    "[configure-staticwebapp] VITE_TEMPLATE_API_URL is not set. The deployed Content-Security-Policy will " +
      "NOT allow calls to the Template API (connect-src), so image upload/list and signature preference " +
      "requests will be blocked by the browser. Set it in apps/portal/.env.local or the build environment " +
      "before building if this deployment should call a live API.",
  );
}

await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);

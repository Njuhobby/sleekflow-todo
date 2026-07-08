/**
 * Writes the generated OpenAPI document to docs/openapi.json (T-6.2).
 * The document is derived from the Zod route schemas — regenerate after
 * any route change: npm run docs:openapi
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { buildApp } from "../src/app.js";

const app = buildApp();
await app.ready();

const doc = app.swagger();
mkdirSync(new URL("../../docs", import.meta.url).pathname, { recursive: true });
const out = new URL("../../docs/openapi.json", import.meta.url).pathname;
writeFileSync(out, JSON.stringify(doc, null, 2) + "\n");
console.log(`Wrote ${out} (${Object.keys(doc.paths ?? {}).length} paths)`);

await app.close();
process.exit(0);

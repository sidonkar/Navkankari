import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import JavaScriptObfuscator from "javascript-obfuscator";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const PUBLIC_ASSETS = path.join(DIST, "public", "assets");
const SERVER_DIST = path.join(DIST, "server");

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(PUBLIC_ASSETS, { recursive: true });
fs.mkdirSync(SERVER_DIST, { recursive: true });

await build({
  entryPoints: [path.join(ROOT, "src", "client", "app.js")],
  bundle: true,
  format: "esm",
  minify: true,
  platform: "browser",
  target: "es2022",
  outfile: path.join(PUBLIC_ASSETS, "app.js")
});

await build({
  entryPoints: [path.join(ROOT, "src", "client", "styles.css")],
  bundle: true,
  minify: true,
  loader: { ".css": "css" },
  outfile: path.join(PUBLIC_ASSETS, "styles.css")
});

await build({
  entryPoints: [path.join(ROOT, "server", "app.js")],
  bundle: true,
  format: "cjs",
  minify: true,
  platform: "node",
  target: "node22",
  outfile: path.join(SERVER_DIST, "app.cjs")
});

const clientPath = path.join(PUBLIC_ASSETS, "app.js");
const clientCode = fs.readFileSync(clientPath, "utf8");
const clientObfuscated = JavaScriptObfuscator.obfuscate(clientCode, {
  compact: true,
  controlFlowFlattening: true,
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 0.08,
  renameGlobals: false,
  rotateStringArray: true,
  selfDefending: true,
  simplify: true,
  splitStrings: true,
  splitStringsChunkLength: 6,
  stringArray: true,
  stringArrayThreshold: 1,
  target: "browser"
}).getObfuscatedCode();
fs.writeFileSync(clientPath, clientObfuscated);

const serverPath = path.join(SERVER_DIST, "app.cjs");
if (process.env.OBFUSCATE_SERVER === "1") {
  const serverCode = fs.readFileSync(serverPath, "utf8");
  const serverObfuscated = JavaScriptObfuscator.obfuscate(serverCode, {
    compact: true,
    controlFlowFlattening: false,
    deadCodeInjection: false,
    renameGlobals: false,
    rotateStringArray: true,
    selfDefending: false,
    simplify: true,
    stringArray: true,
    stringArrayThreshold: 1,
    target: "node"
  }).getObfuscatedCode();
  fs.writeFileSync(serverPath, serverObfuscated);
}

console.log("Build complete: dist/public/assets and dist/server ready.");

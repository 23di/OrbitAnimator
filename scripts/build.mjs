import { build, context } from "esbuild";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const watch = process.argv.includes("--watch");

await mkdir(resolve(root, "dist"), { recursive: true });
await copyFile(
  resolve(root, "THIRD_PARTY_NOTICES.md"),
  resolve(root, "dist/THIRD_PARTY_NOTICES.md"),
);

const shared = {
  bundle: true,
  sourcemap: true,
  target: "es2020",
  logLevel: "info",
};

async function buildMain() {
  return build({
    ...shared,
    entryPoints: [resolve(root, "src/code.ts")],
    outfile: resolve(root, "dist/code.js"),
    format: "iife",
  });
}

async function buildUi() {
  const result = await build({
    ...shared,
    // The UI is inlined into ui.html. Source-map directives inside inline CSS
    // or JS are resolved against the open Figma document URL and trigger CSP
    // network requests (for example, ui.css.map on figma.com).
    sourcemap: false,
    entryPoints: [resolve(root, "src/ui.tsx")],
    outfile: resolve(root, "dist/ui.js"),
    write: false,
    format: "iife",
    loader: { ".svg": "dataurl", ".png": "dataurl" },
  });

  const js = result.outputFiles.find((file) => file.path.endsWith(".js"));
  const css = result.outputFiles.find((file) => file.path.endsWith(".css"));
  const offlineCss = (css?.text ?? "").replace(
    /^@import\s+["']https:\/\/fonts\.googleapis\.com\/[^"']+["'];?\s*/gm,
    "",
  );
  const template = await readFile(resolve(root, "src/ui.html"), "utf8");
  const html = template
    .replace("/*__STYLES__*/", offlineCss)
    .replace("/*__SCRIPT__*/", (js?.text ?? "").replaceAll("</script>", "<\\/script>"));

  if (html.includes("sourceMappingURL=")) {
    throw new Error("Inline plugin UI must not contain source-map URLs");
  }

  await writeFile(resolve(root, "dist/ui.html"), html);
}

if (watch) {
  const main = await context({
    ...shared,
    entryPoints: [resolve(root, "src/code.ts")],
    outfile: resolve(root, "dist/code.js"),
    format: "iife",
  });
  await main.watch();
  await buildUi();
  console.log("Watching plugin code. Re-run npm run build after UI changes.");
} else {
  await Promise.all([buildMain(), buildUi()]);
}

import {createHash} from "node:crypto";
import {build} from "esbuild";
import {cp, copyFile, mkdir, readFile, readdir, writeFile} from "node:fs/promises";
await mkdir("dist", {recursive: true});
await build({entryPoints: ["app.mjs", "rpc.mjs"], bundle: true, splitting: true, chunkNames: "studio-client", minify: true,
  outdir: "dist", format: "esm", outExtension: {".js": ".mjs"}, loader: {".proto": "text"}});
const version = createHash("sha256").update(await readFile("dist/app.mjs")).digest("hex").slice(0, 12);
const html = (await readFile("index.html", "utf8")).replace('src="app.mjs"', `src="app.mjs?v=${version}"`);
await writeFile("dist/index.html", html);
await copyFile("style.css", "dist/style.css");
await cp("icons", "dist/icons", {recursive: true});

const deps = ["@zmkfirmware/zmk-studio-ts-client", "protobufjs", "long", "web-serial-polyfill",
  ...(await readdir("node_modules/@protobufjs")).map(name => "@protobufjs/" + name)];
const licenses = [await readFile("../LICENSE.studio-template", "utf8")];
for (const dep of deps) {
  licenses.push(dep + "\n" + await readFile("node_modules/" + dep + "/LICENSE", "utf8"));
}
await writeFile("dist/LICENSES.txt", licenses.join("\n\n"));

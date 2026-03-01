import * as esbuild from "esbuild";

await esbuild.build({
  entryPoints: ["src/sidecar/index.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  outfile: "dist/scripts/sidecar/index.js",
  // Node built-ins should not be bundled
  external: [
    "node:child_process",
    "node:fs",
    "node:http",
    "node:net",
    "node:path",
    "node:module",
    "node:os",
    "node:process",
    "node:tty",
    "node:url",
    "node:util",
  ],
});

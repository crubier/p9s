import { cp } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

// GraphiQL loads its scripts from /ruru-static/. The server serves them in development; the build copies them to dist,
// so that Vercel serves them as static files rather than through the function
const ruruStatic = (): Plugin => ({
  name: "ruru-static",
  apply: "build",
  async closeBundle() {
    const fromPostgraphile = createRequire(createRequire(import.meta.url).resolve("postgraphile"));
    // The package root, above dist/index.js: ruru does not export its package.json
    const ruru = dirname(dirname(createRequire(fromPostgraphile.resolve("grafserv")).resolve("ruru")));
    await cp(join(ruru, "static"), new URL("./dist/ruru-static", import.meta.url).pathname, {
      recursive: true,
      filter: (source) => !source.endsWith(".map") && !source.endsWith(".LICENSE.txt"),
    });
  },
});

export default defineConfig({
  plugins: [react(), tailwindcss(), ruruStatic()],
  resolve: { alias: { "@": new URL("./web", import.meta.url).pathname } },
  // One bundle for the whole app, which the pages share most of
  build: { outDir: "dist", chunkSizeWarningLimit: 1000 },
});

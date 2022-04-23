import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFile } from "node:fs/promises";

export default defineConfig(async ({ mode }) => ({
  plugins: [react()],
  resolve: {
    alias: {
      icbucket: new URL("canisters/icbucket", import.meta.url).pathname,
    },
  },
  define: {
    global: "globalThis",
    process: JSON.stringify({
      env: await env(mode),
    }),
  },
  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
}));

async function env(mode: string) {
  const ids = await canisterIds(mode);

  return Object.fromEntries(
    Object.entries(ids).map(([name, id]) => [
      name.toUpperCase() + "_CANISTER_ID",
      id,
    ])
  );
}

async function canisterIds(mode: string): Promise<Record<string, string>> {
  switch (mode) {
    case "development": {
      const canisters: Record<string, { local: string }> = JSON.parse(
        await readFile(
          new URL("../.dfx/local/canister_ids.json", import.meta.url).pathname,
          "utf-8"
        )
      );

      return Object.fromEntries(
        Object.entries(canisters).map(([name, { local: id }]) => [name, id])
      );
    }

    case "production":
      const canisters: Record<string, { ic: string }> = JSON.parse(
        await readFile(
          new URL("../canister_ids.json", import.meta.url).pathname,
          "utf-8"
        )
      );

      return Object.fromEntries(
        Object.entries(canisters).map(([name, { ic: id }]) => [name, id])
      );

    default:
      throw new Error(`Unknown mode: ${mode}`);
  }
}

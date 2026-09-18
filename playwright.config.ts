import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/ui",
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:1420",
    viewport: { width: 1120, height: 780 },
    launchOptions: { channel: "chrome", args: ["--no-sandbox"] },
  },
  reporter: "list",
});

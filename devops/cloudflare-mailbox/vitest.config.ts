import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [cloudflareTest(async () => ({
    wrangler: { configPath: "./wrangler.jsonc" },
    miniflare: {
      bindings: {
        MAILBOX_ADDRESS: "inbox@example.com",
        MAILBOX_API_SECRET: "xem-relay-fixture-secret-v1-change-me",
        TEST_MIGRATIONS: await readD1Migrations("./migrations")
      }
    }
  }))],
  test: {
    globals: true
  }
});

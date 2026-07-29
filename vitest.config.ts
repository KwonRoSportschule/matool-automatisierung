import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => {
      const migrations = await readD1Migrations("./migrations");

      return {
        wrangler: {
          configPath: "./wrangler.jsonc",
          environment: "staging"
        },
        miniflare: {
          bindings: {
            APP_ENV: "test",
            ACCESS_AUD: "test-audience",
            ACCESS_SERVICE_AUD: "test-service-audience",
            ACCESS_TEAM_DOMAIN: "test.cloudflareaccess.com",
            CSRF_SECRET: "synthetic-test-secret-that-is-not-used-anywhere-else",
            DEV_AUTH_BYPASS: "allow-loopback-only",
            ZAPIER_SERVICE_TOKEN:
              "synthetic-service-token-at-least-32-characters",
            ZAPIER_WEBHOOK_SIGNING_SECRET:
              "synthetic-webhook-signing-secret-for-tests",
            TEST_MIGRATIONS: migrations
          },
          d1Databases: ["DB"]
        }
      };
    })
  ],
  test: {
    include: ["test/**/*.test.ts"],
    setupFiles: ["./test/setup.ts"]
  }
});

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      MATOOL_MIDDLEWARE_ORIGIN:
        "https://middleware.example.invalid"
    },
    include: ["test/**/*.test.ts"]
  }
});

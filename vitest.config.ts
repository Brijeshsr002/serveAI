import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname) } },
  test: {
    globalSetup: ["tests/global-setup.ts"],
    setupFiles: ["tests/setup.ts"],
    include: ["tests/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://serveai:serveai@localhost:5434/serveai_test",
      NEXTAUTH_SECRET: "test-secret-test-secret-test-secret",
      APP_URL: "https://serveai.test",
      SENDIEE_API_KEY: "test-sendiee-key",
      SENDIEE_BRAND_NUMBER: "917012345678",
      SENDIEE_WEBHOOK_SECRET: "test-webhook-secret",
      PAYMENT_PROVIDER: "razorpay",
      RAZORPAY_KEY_ID: "rzp_test",
      RAZORPAY_KEY_SECRET: "rzp_secret",
      RAZORPAY_WEBHOOK_SECRET: "rzp_webhook_secret",
    },
  },
});

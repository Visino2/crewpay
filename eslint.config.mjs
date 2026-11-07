import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // All configuration must go through the validated env modules so secrets
    // cannot leak into client code via ad-hoc process.env reads.
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/lib/env/**"],
    rules: {
      "no-restricted-properties": [
        "error",
        {
          object: "process",
          property: "env",
          message:
            "Read configuration via '@/lib/env/server' (secrets) or '@/lib/env/client' (public values).",
        },
      ],
    },
  },
  {
    // Session cookies are HttpOnly because no browser Supabase client exists.
    // Data access stays on the server, behind Server Actions and RLS.
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@supabase/ssr",
              importNames: ["createBrowserClient"],
              message: "Do not create a browser Supabase client; use Server Actions.",
            },
            {
              name: "@supabase/supabase-js",
              importNames: ["createClient"],
              message: "Use createSupabaseServerClient from '@/lib/supabase/server'.",
            },
          ],
        },
      ],
      "react/no-danger": "error",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Test artifacts:
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    "blob-report/**",
  ]),
]);

export default eslintConfig;

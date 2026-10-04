import { publicApiOrigin } from "./lib/public-config";

export function register() {
  // NEXT_PUBLIC_API_ORIGIN is embedded at build; PUBLIC_API_ORIGIN is runtime.
  const builtOrigin =
    process.env.NEXT_PUBLIC_API_ORIGIN || "http://localhost:3001";
  try {
    publicApiOrigin(
      {
        PUBLIC_API_ORIGIN: process.env.PUBLIC_API_ORIGIN || builtOrigin,
        NEXT_PUBLIC_API_ORIGIN: builtOrigin,
        COOKIE_SECURE: process.env.COOKIE_SECURE,
      },
      builtOrigin,
    );
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Configuração pública inválida.",
    );
    // Next catches rejected instrumentation hooks; explicitly stop Node instead
    // of leaving a process listening with an unusable authentication contract.
    if (process.env.NEXT_RUNTIME === "nodejs") process.exit(1);
    throw error;
  }
}

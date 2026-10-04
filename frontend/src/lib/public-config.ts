const LOCAL_API = "http://localhost:3001";

// No shared application package: the HTTP deployment contract supplies this origin.
export function publicApiOrigin(
  env: Record<string, string | undefined>,
  builtOrigin?: string,
) {
  const value =
    env.PUBLIC_API_ORIGIN || env.NEXT_PUBLIC_API_ORIGIN || LOCAL_API;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("PUBLIC_API_ORIGIN deve ser uma origem HTTP(S) válida.");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.origin !== value)
    throw new Error(
      "PUBLIC_API_ORIGIN deve conter somente a origem HTTP(S), sem caminho.",
    );
  if (
    (env.NEXT_PUBLIC_API_ORIGIN && env.NEXT_PUBLIC_API_ORIGIN !== value) ||
    (builtOrigin && builtOrigin !== value)
  )
    throw new Error(
      "PUBLIC_API_ORIGIN diverge da origem incorporada no frontend. Reconstrua a imagem com a mesma origem usada pelo backend.",
    );
  if (env.COOKIE_SECURE !== undefined)
    throw new Error(
      "COOKIE_SECURE foi removida. Use somente PUBLIC_API_ORIGIN para configurar os cookies.",
    );
  return value;
}
export function sessionCookieName(origin: string) {
  return new URL(origin).protocol === "https:"
    ? "__Host-login_session"
    : "login_session";
}

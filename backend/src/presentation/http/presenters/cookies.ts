// The public API origin is the sole authority, including HTTPS development.
export function cookiePolicy(publicApiOrigin: string) {
  const secure = new URL(publicApiOrigin).protocol === "https:";
  const prefix = secure ? "__Host-" : "";
  return {
    sessionName: `${prefix}login_session`,
    deviceName: `${prefix}login_master_device`,
    options: { httpOnly: true, secure, sameSite: "lax" as const, path: "/" },
  };
}

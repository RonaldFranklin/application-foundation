import Login from "@/features/auth/components/Login";
import { headers } from "next/headers";
export default async function Page() {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return <Login nonce={nonce} />;
}

import type { Metadata } from "next";
import AcceptInvitation from "@/features/invitations/AcceptInvitation";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Aceitar convite",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};
export default function Page() {
  return <AcceptInvitation />;
}

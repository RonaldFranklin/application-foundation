import type { Metadata } from "next";
import ActivateAdmin from "@/features/platform-admin/ActivateAdmin";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Ativar acesso administrativo",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};
export default function Page() {
  return <ActivateAdmin />;
}

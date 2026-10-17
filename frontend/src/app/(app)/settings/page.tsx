import Welcome from "@/features/auth/components/Welcome";
export const dynamic = "force-dynamic";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  return <Welcome tab={tab === "sessions" ? "sessions" : "profile"} />;
}

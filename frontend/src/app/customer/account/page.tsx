import CustomerAccount from "@/features/customers/CustomerAccount";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Minha conta de cliente",
  robots: { index: false, follow: false },
};
export default function Page() {
  return <CustomerAccount />;
}

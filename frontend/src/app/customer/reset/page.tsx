import CustomerEntry from "@/features/customers/CustomerEntry";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Conta de cliente",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export default function Page() {
  return <CustomerEntry mode="reset" />;
}

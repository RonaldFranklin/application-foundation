import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Application Foundation · Acesse sua conta",
  description: "Seu próximo passo começa aqui.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}

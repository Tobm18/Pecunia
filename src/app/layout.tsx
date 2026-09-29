import type { Metadata, Viewport } from "next";
import { Archivo } from "next/font/google";
import { cookies } from "next/headers";
import { Suspense } from "react";
import { THEME_COOKIE } from "@/lib/theme";
import { NavigationProgress } from "@/components/ui/navigation-progress";
import "./globals.css";

const archivo = Archivo({ subsets: ["latin"], variable: "--font-archivo", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Pecunia", template: "%s · Pecunia" },
  description: "Chaque euro à sa place - budget, comptes et prévisionnel.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#148270",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const theme = (await cookies()).get(THEME_COOKIE)?.value === "dark" ? "dark" : "light";
  return (
    <html lang="fr" data-theme={theme} className={archivo.variable}>
      <body className="min-h-dvh font-sans">
        <Suspense fallback={null}>
          <NavigationProgress />
        </Suspense>
        {children}
      </body>
    </html>
  );
}

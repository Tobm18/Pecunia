import type { Metadata, Viewport } from "next";
import { Archivo } from "next/font/google";
import { cookies } from "next/headers";
import { Suspense } from "react";
import { THEME_COLORS, THEME_COOKIE, type Theme } from "@/lib/theme";
import { NavigationProgress } from "@/components/ui/navigation-progress";
import { ServiceWorker } from "@/components/app/service-worker";
import "./globals.css";

const archivo = Archivo({ subsets: ["latin"], variable: "--font-archivo", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Pecunia", template: "%s · Pecunia" },
  description: "Chaque euro à sa place - budget, comptes et prévisionnel.",
  robots: { index: false, follow: false },
  // installée sur l'iPhone : plein écran, barre d'état aux couleurs de l'app (theme-color)
  appleWebApp: { capable: true, title: "Pecunia", statusBarStyle: "default" },
  formatDetection: { telephone: false },
  // Next n'émet que mobile-web-app-capable ; les iOS antérieurs au manifeste lisent cette balise-ci
  other: { "apple-mobile-web-app-capable": "yes" },
};

const currentTheme = async (): Promise<Theme> => ((await cookies()).get(THEME_COOKIE)?.value === "dark" ? "dark" : "light");

export async function generateViewport(): Promise<Viewport> {
  return {
    width: "device-width",
    initialScale: 1,
    viewportFit: "cover",
    themeColor: THEME_COLORS[await currentTheme()],
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const theme = await currentTheme();
  return (
    <html lang="fr" data-theme={theme} className={archivo.variable}>
      <body className="min-h-dvh font-sans">
        {/* iOS 27, app installée : sans cette bande opaque collée en haut, iOS floute le haut de la page (voir globals.css) */}
        <div aria-hidden="true" className="status-bar-edge" />
        <Suspense fallback={null}>
          <NavigationProgress />
        </Suspense>
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}

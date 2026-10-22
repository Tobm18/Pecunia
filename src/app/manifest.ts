import type { MetadataRoute } from "next";

/**
 * Manifeste de la PWA : installée (écran d'accueil), Pecunia s'ouvre en plein écran, sans l'interface du
 * navigateur. Servi en /manifest.webmanifest, hors du contrôle de session (src/proxy.ts).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Pecunia",
    short_name: "Pecunia",
    description: "Chaque euro à sa place - budget, comptes et prévisionnel.",
    lang: "fr",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f5f6f8",
    theme_color: "#f5f6f8",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [{ name: "Nouvelle saisie", short_name: "Saisie", url: "/saisie", icons: [{ src: "/icon-192.png", sizes: "192x192" }] }],
  };
}

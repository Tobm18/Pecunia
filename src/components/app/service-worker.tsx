"use client";

import { useEffect } from "react";

/** Enregistre public/sw.js (écran hors connexion), en production seulement : en dev il gênerait le rechargement à chaud. */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // sans service worker, l'app fonctionne normalement (pas d'écran hors connexion)
    });
  }, []);
  return null;
}

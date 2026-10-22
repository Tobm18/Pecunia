"use client";

import { useEffect, useState, useTransition } from "react";
import { sendTestPush, subscribePush, unsubscribePush } from "@/lib/data/push-actions";
import { Button } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/overlay";
import { Row } from "./settings-form";

const PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

type State = "loading" | "unsupported" | "install" | "unconfigured" | "denied" | "off" | "on";

/** Clé VAPID publique (base64url) → octets attendus par pushManager.subscribe */
function keyBytes(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent);
const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

async function registration() {
  return (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register("/sw.js"));
}

const HINTS: Record<State, string> = {
  loading: "…",
  unsupported: "Ce navigateur ne gère pas les notifications",
  install: "Sur iPhone : ajoute d'abord Pecunia à l'écran d'accueil (Partager → Sur l'écran d'accueil), puis ouvre-la depuis l'icône",
  unconfigured: "Non configurées sur le serveur (clés VAPID)",
  denied: "Refusées : autorise-les dans les réglages de l'appareil pour Pecunia",
  off: "Rappels sur cet appareil (intérêts d'épargne le 31 décembre)",
  on: "Activées sur cet appareil",
};

/** Notifications push de l'appareil courant : activation, désactivation, test. */
export function PushNotificationsRow() {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<State>("loading");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let next: State;
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        next = isIos() && !isStandalone() ? "install" : "unsupported";
      } else if (!PUBLIC_KEY) next = "unconfigured";
      else if (Notification.permission === "denied") next = "denied";
      else {
        const reg = await navigator.serviceWorker.getRegistration();
        next = (await reg?.pushManager.getSubscription()) ? "on" : "off";
      }
      if (!cancelled) setState(next);
    })().catch(() => !cancelled && setState("unsupported"));
    return () => {
      cancelled = true;
    };
  }, []);

  function enable() {
    startTransition(async () => {
      try {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          startTransition(() => setState(permission === "denied" ? "denied" : "off"));
          return;
        }
        const reg = await registration();
        await navigator.serviceWorker.ready;
        const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(PUBLIC_KEY!) }));
        const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
        const r = await subscribePush({ endpoint: json.endpoint, keys: json.keys });
        startTransition(() => {
          if (!r.ok) return toast(r.error, "error");
          setState("on");
          toast("Notifications activées");
        });
      } catch {
        startTransition(() => toast("Activation impossible sur cet appareil.", "error"));
      }
    });
  }

  function disable() {
    startTransition(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await unsubscribePush(sub.endpoint);
        await sub.unsubscribe();
      }
      startTransition(() => {
        setState("off");
        toast("Notifications désactivées");
      });
    });
  }

  function test() {
    startTransition(async () => {
      const r = await sendTestPush();
      startTransition(() => toast(r.ok ? "Notification envoyée" : r.error, r.ok ? "success" : "error"));
    });
  }

  return (
    <Row label="Notifications" hint={HINTS[state]}>
      {state === "off" && (
        <Button variant="primary" onClick={enable} loading={pending}>
          Activer
        </Button>
      )}
      {state === "on" && (
        <div className="flex items-center gap-2">
          <Button onClick={test} loading={pending}>
            Tester
          </Button>
          <Button variant="ghost" onClick={disable} disabled={pending}>
            Désactiver
          </Button>
        </div>
      )}
    </Row>
  );
}

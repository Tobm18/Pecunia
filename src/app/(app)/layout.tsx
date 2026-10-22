import { getClientAppData } from "@/lib/data/queries";
import { AppDataProvider } from "@/components/app/app-data";
import { BottomNav, Sidebar } from "@/components/app/navigation";
import { ToastProvider } from "@/components/ui/overlay";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const data = await getClientAppData();
  return (
    <AppDataProvider value={data}>
      <ToastProvider>
        {/* Installée sur iPhone, la page défilerait sous la barre d'état : bande opaque de la couleur du fond */}
        <div aria-hidden className="status-bar-fill fixed inset-x-0 top-0 z-40 h-[env(safe-area-inset-top)] lg:hidden" />
        <div className="flex min-h-dvh">
          <Sidebar />
          <main className="relative min-w-0 flex-1 px-4 pt-[calc(env(safe-area-inset-top)+1.25rem)] pb-[calc(env(safe-area-inset-bottom)+7rem)] md:px-8 md:pt-7 lg:pb-10">
            <div className="mx-auto max-w-6xl">{children}</div>
          </main>
        </div>
        <BottomNav />
      </ToastProvider>
    </AppDataProvider>
  );
}

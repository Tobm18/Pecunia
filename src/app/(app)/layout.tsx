import { getClientAppData } from "@/lib/data/queries";
import { AppDataProvider } from "@/components/app/app-data";
import { BottomNav, MoreMenu, Sidebar } from "@/components/app/navigation";
import { ToastProvider } from "@/components/ui/overlay";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const data = await getClientAppData();
  return (
    <AppDataProvider value={data}>
      <ToastProvider>
        <div className="flex min-h-dvh">
          <Sidebar />
          <main className="relative min-w-0 flex-1 px-4 pt-5 pb-28 md:px-8 md:pt-7 lg:pb-10">
            <MoreMenu />
            <div className="mx-auto max-w-6xl">{children}</div>
          </main>
        </div>
        <BottomNav />
      </ToastProvider>
    </AppDataProvider>
  );
}

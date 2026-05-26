import { PreviewTable } from "@/components/preview-table";
import { Logo } from "@/components/logo";

export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center">
          <Logo className="h-5 w-auto" />
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-10">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight mb-1">
            PR Previews
          </h1>
          <p className="text-sm text-muted-foreground">
            Live preview deployments running on Akash Network for open pull
            requests.
          </p>
        </div>

        <PreviewTable />
      </main>
    </div>
  );
}

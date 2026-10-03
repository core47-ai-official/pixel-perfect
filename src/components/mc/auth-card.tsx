import { HospitalLogo } from "./hospital-logo";
import { PreferenceControls } from "./preference-controls";

/** Shared staff-style frame for sign-in, forgot-password and reset pages. */
export function AuthCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col bg-muted/40">
      <div className="flex justify-end p-4">
        <PreferenceControls />
      </div>
      <div className="flex flex-1 items-center justify-center px-4 pb-16">
        <div className="w-full max-w-sm rounded-lg border bg-card p-8 shadow-sm">
          <div className="mb-6 flex flex-col items-center gap-3 text-center">
            <HospitalLogo />
            <h1 className="text-xl font-semibold text-foreground">{title}</h1>
            {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
          </div>
          {children}
        </div>
      </div>
    </main>
  );
}

<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- UI preferences (language, theme, density) live in `PreferencesProvider` (src/lib/preferences.tsx) and are applied to `<html>` (lang/dir, `.dark`, `data-density`); components read them via `usePreferences`, never directly from storage.
- All visible text goes through react-i18next keys in src/i18n/en.json and ur.json; wrap codes/numbers/drug names in `<Ltr>`.
- Staff navigation, role→page access and quick-add buttons all come from src/config/navigation.ts; sidebar, bottom nav, page guards (rolesForPage) and page titles read only from it, so menus and access never drift apart.
- Act-as-user state lives only in src/lib/impersonation.ts (per-tab sessionStorage); callEdgeFunction sends it as the x-impersonation-session header, so impersonation is enforced server-side by getCaller, never by the UI.
- Company settings fields/tabs/defaults/public flags are defined only in src/config/company-settings.ts; the settings page renders from it and SessionGate applies accent, favicon, timeout and default language app-wide, so new settings need no page code.
- Every printed document renders through PrintDocument/PrintPreviewPanel (src/components/mc/print-document.tsx): English first, then the patient print language, with header/branding from company settings, so print layout and job logging stay consistent.
- Dashboard widgets are defined only in src/config/widgets.tsx (id, roles, sizes, component, code defaults); the dashboard page and widget library read from it, and the layout/data server functions must mirror its ids and roles.
- Waiting-room TV pages (/tv/*) are public and read only through the get-tv-queue function, gated by the display token in company settings; staff actions broadcast a data-free "refresh" on channel tv-<hospital_id>, so no patient data is ever exposed without sign-in.
- Charges are posted only through the billing helpers in edge-functions/_shared/billing.ts (copied verbatim into each function, since the Supabase editor allows one file); they recompute invoice totals from lines and rely on unique indexes (one open bill per patient/admission, one line per source) instead of DB transactions, which are unavailable without database functions.
- Offline mode covers only register-patient, record-payment and record-deposit: src/lib/offline-queue.ts (IndexedDB, client uuid) syncs via sync-offline-queue, which forwards to the real function once per id, so numbering and rules stay server-side; the app worker is registered only from src/lib/pwa-register.ts and imports public/push-sw.js for push.
- Supabase Edge Function sources live flat in /edge-functions/<slug>.ts (one self-contained file each); the GitHub Action .github/workflows/deploy-edge-functions.yml arranges and deploys them all on push to main, since Lovable cannot deploy to this external Supabase project.
- OT checklist item keys live in CHECKLIST_ITEMS (src/lib/ot.ts) and are mirrored in save-ot-checklist; a checklist is complete only when the server sees every key ticked, and start-ot-case requires completed pre_op and who_sign_in.

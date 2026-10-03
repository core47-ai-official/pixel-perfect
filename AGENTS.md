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

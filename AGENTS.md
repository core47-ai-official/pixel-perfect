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

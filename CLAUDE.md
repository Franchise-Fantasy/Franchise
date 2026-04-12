Code quality:

- Prefer simple, readable code over clever one-liners
- No premature abstraction — don't create utilities or helpers until you actually need them twice (unless we have an anticipated need in the near future)
- Functions should do one thing; if you have to use "and" to describe what it does, split it.
- Delete dead code rather than commenting it out, unless is will be useful for futureproofing.
- Write comments only if it helps future coders understand what is happening.
- Create Edge functions wherever it would speed things up.

- If there is something I've told you to remember, or something that you think will be needed in future sessions, please write a rule in this file under the "Iterations" section.

- Accessibility labelling needs to be added to an changes or new files by default.

Iterations:

- When adding/removing/renaming pages, hooks, edge functions, database tables, RPCs, or real-time subscriptions, update the relevant notes in the Obsidian wiki at `C:/Users/Joe/Desktop/Franchise Wiki/Franchise Wiki/`. Don't stress about perfection — just keep the affected notes roughly in sync.

- Supabase realtime channel names created inside a `useEffect` MUST include a `-${Date.now()}` (or equivalent unique) suffix. Deterministic names like `` `draft_status_${leagueId}` `` collide when React reconnects passive effects (tab switch, auth transition, concurrent re-render) because `supabase.removeChannel()` is async — the old channel is still in `joined` state when the new effect re-registers `postgres_changes` callbacks, Supabase throws, and Hermes crashes natively. Match the existing convention (see `useAnnouncements.ts`, `useWeekScores.ts`, etc.).

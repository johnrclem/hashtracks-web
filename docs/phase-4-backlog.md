# Phase 4: Structural Splits (Backlog)

These items were identified during the Phases 1-3 refactoring and deferred as lower-priority, higher-risk changes. Each should be done as its own PR.

---

## 4A. Split Large Server Action Files

| File | Lines | Split Strategy |
|------|-------|----------------|
| `src/app/admin/kennels/actions.ts` | 648 | CRUD vs profile fields vs helpers |
| `src/app/admin/alerts/actions.ts` | 592 | Status lifecycle vs repair actions |
| `src/app/misman/[slug]/attendance/actions.ts` | 700+ | Recording vs polling vs suggestions |

**Approach:** One commit per file split. Keep exports stable (re-export from original location if needed). Run tests after each split.

---

## 4B. Split Large Component Files

| File | Lines | Split Strategy |
|------|-------|----------------|
| `src/components/admin/EventTable.tsx` | 647 | Filter bar, table body, bulk actions |
| `src/components/admin/RosterGroupsAdmin.tsx` | 582 | Group card, create form, pending queue |
| `src/components/admin/SourceTable.tsx` | 517 | Row component, health badge, actions |
| `src/components/admin/KennelForm.tsx` | 516 | Main form, alias manager, social links |
| `src/components/misman/ImportWizard.tsx` | 502 | Per-step sub-components |

**Approach:** Extract to co-located sub-components in the same directory. One commit per file split.

---

## 4C. Centralize `revalidatePath` Strings

124 hardcoded `revalidatePath("/hareline")` etc. calls scattered across server actions.

**Proposed:** Create `src/lib/paths.ts` with path constants, then find-and-replace all hardcoded path strings.

**Risk:** Low risk but high blast radius (touches many files). Should be done as a single focused PR.

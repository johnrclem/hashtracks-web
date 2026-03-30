Sync `.claude/rules/active-sources.md` with the current state of `prisma/seed.ts`.

## Steps

1. **Read current seed data**
   - Parse `prisma/seed.ts` to extract all Source records
   - Group sources by region

2. **Read current rule**
   - Read `.claude/rules/active-sources.md`

3. **Compare and update**
   - Add any sources present in seed.ts but missing from the rule
   - Remove any sources listed in the rule but no longer in seed.ts
   - Update the total count in the heading
   - Preserve the format: `**Source Name** -> SOURCE_TYPE -> kennel(s)`

4. **Write the updated rule**
   - Update `.claude/rules/active-sources.md` with the synced content
   - Update the description frontmatter with the new count

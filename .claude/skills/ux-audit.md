---
description: UX audit methodology for HashTracks UI components and pages
globs:
  - src/components/**
  - src/app/**/page.tsx
---

# UX Audit

<!-- TODO: Replace this placeholder with your UX audit prompt. -->
<!-- Paste the prompt you currently use manually for UX audits here. -->
<!-- This skill auto-activates when working on components or page files. -->

## Placeholder
This skill needs your UX audit prompt content. Please replace this file with your audit criteria covering:
- Accessibility (ARIA, keyboard navigation, color contrast)
- Component consistency (shadcn/ui patterns, Tailwind conventions)
- Responsive design (mobile-first, breakpoints)
- Loading states and error handling
- User feedback (toasts, confirmations, empty states)

## Tech Stack Context
- **UI Framework:** shadcn/ui components (`src/components/ui/`)
- **Styling:** Tailwind CSS
- **Auth:** Clerk (sign-in/sign-up flows)
- **Maps:** Google Maps (@vis.gl/react-google-maps)
- **Key pages:** Hareline (calendar), Kennel Directory, Logbook, Misman attendance, Admin dashboard

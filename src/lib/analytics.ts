import posthog from "posthog-js";

/**
 * Custom analytics events tracked in PostHog.
 * Each event has a typed properties interface.
 */

// ── Community Health Events ──────────────────────────────────────────

interface HarelineViewProps {
  tab: "list" | "map";
  filters?: Record<string, string>;
}

interface EventDetailViewProps {
  kennelSlug: string;
  region?: string;
  daysUntil?: number;
}

interface KennelProfileViewProps {
  kennelSlug: string;
  region?: string;
}

interface CheckInProps {
  kennelSlug: string;
  status: "intending" | "confirmed";
}

interface KennelSubscribeProps {
  kennelSlug: string;
  region?: string;
}

interface KennelUnsubscribeProps {
  kennelSlug: string;
}

// ── Product Direction Events ─────────────────────────────────────────

interface LogbookStatsViewProps {
  totalRuns: number;
}

interface SearchUsedProps {
  query: string;
  resultCount: number;
  context: "hareline" | "kennels";
}

interface FilterAppliedProps {
  filterType: string;
  value: string;
  page: string;
}

interface NearMeUsedProps {
  distanceOption: string;
  resultCount: number;
}

interface EmptyStateShownProps {
  context: string;
}

interface FeedbackSubmittedProps {
  category: string;
}

// ── Growth Events ────────────────────────────────────────────────────

interface SuggestKennelProps {
  entryPoint: string;
  relationship?: string;
}

interface SignupCompletedProps {
  method: "google" | "email";
}

// ── Map / Location Events (migrated from Vercel Analytics) ──────────

interface LocationPromptShownProps {
  page: string;
}

interface LocationPromptActionProps {
  action: string;
  [key: string]: unknown;
}

interface MapColocatedPopoverProps {
  eventCount: number;
}

interface MapColocatedKennelPopoverProps {
  kennelCount: number;
}

// ── Event Map ────────────────────────────────────────────────────────

interface AnalyticsEventMap {
  // Community Health
  hareline_view: HarelineViewProps;
  event_detail_view: EventDetailViewProps;
  kennel_profile_view: KennelProfileViewProps;
  check_in: CheckInProps;
  kennel_subscribe: KennelSubscribeProps;
  kennel_unsubscribe: KennelUnsubscribeProps;
  // Product Direction
  logbook_stats_view: LogbookStatsViewProps;
  search_used: SearchUsedProps;
  filter_applied: FilterAppliedProps;
  near_me_used: NearMeUsedProps;
  strava_connected: Record<string, never>;
  empty_state_shown: EmptyStateShownProps;
  feedback_submitted: FeedbackSubmittedProps;
  // Growth
  suggest_kennel: SuggestKennelProps;
  suggest_kennel_submit: SuggestKennelProps;
  signup_completed: SignupCompletedProps;
  // Migrated from Vercel Analytics
  location_prompt_shown: LocationPromptShownProps;
  location_prompt_action: LocationPromptActionProps;
  map_colocated_popover: MapColocatedPopoverProps;
  map_colocated_kennel_popover: MapColocatedKennelPopoverProps;
}

/**
 * Type-safe analytics capture. No-ops if PostHog is not loaded.
 */
export function capture<E extends keyof AnalyticsEventMap>(
  event: E,
  properties: AnalyticsEventMap[E],
) {
  if (typeof window === "undefined") return;
  if (!posthog.__loaded) return;
  posthog.capture(event, properties);
}

/**
 * Identify the current user in PostHog with person properties.
 */
export function identifyUser(
  userId: string,
  properties?: Record<string, unknown>,
) {
  if (typeof window === "undefined") return;
  if (!posthog.__loaded) return;
  posthog.identify(userId, properties);
}

/**
 * Reset PostHog identity (call on logout).
 */
export function resetIdentity() {
  if (typeof window === "undefined") return;
  if (!posthog.__loaded) return;
  posthog.reset();
}

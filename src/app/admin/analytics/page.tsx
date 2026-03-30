import {
  getCommunityHealthMetrics,
  getUserEngagementMetrics,
  getOperationalHealthMetrics,
  type CommunityHealthMetrics,
  type UserEngagementMetrics,
  type OperationalHealthMetrics,
} from "./actions";
import { AnalyticsDashboard } from "@/components/admin/AnalyticsDashboard";

const EMPTY_COMMUNITY: CommunityHealthMetrics = {
  activeKennelsByRegion: [],
  topKennels: [],
  attendanceTrends: [],
  totalActiveKennels: 0,
};

const EMPTY_ENGAGEMENT: UserEngagementMetrics = {
  totalUsers: 0,
  newUsersThisWeek: 0,
  newUsersThisMonth: 0,
  activeUsers30d: 0,
  usersWithCheckins: 0,
  usersWithoutCheckins: 0,
  subscriptionDistribution: [],
  mismanKennelCount: 0,
  totalVisibleKennels: 0,
};

const EMPTY_OPERATIONAL: OperationalHealthMetrics = {
  sourceHealthByRegion: [],
  scrapeSuccessRates: [],
  staleSources: [],
  totalEnabledSources: 0,
  totalHealthySources: 0,
};

export default async function AnalyticsPage() {
  const [communityResult, engagementResult, operationalResult] =
    await Promise.allSettled([
      getCommunityHealthMetrics("30d"),
      getUserEngagementMetrics(),
      getOperationalHealthMetrics(),
    ]);

  return (
    <AnalyticsDashboard
      community={communityResult.status === "fulfilled" ? communityResult.value : EMPTY_COMMUNITY}
      engagement={engagementResult.status === "fulfilled" ? engagementResult.value : EMPTY_ENGAGEMENT}
      operational={operationalResult.status === "fulfilled" ? operationalResult.value : EMPTY_OPERATIONAL}
    />
  );
}

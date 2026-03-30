import {
  getCommunityHealthMetrics,
  getUserEngagementMetrics,
  getOperationalHealthMetrics,
} from "./actions";
import { AnalyticsDashboard } from "@/components/admin/AnalyticsDashboard";

export default async function AnalyticsPage() {
  const [community, engagement, operational] = await Promise.all([
    getCommunityHealthMetrics("30d"),
    getUserEngagementMetrics(),
    getOperationalHealthMetrics(),
  ]);

  return (
    <AnalyticsDashboard
      community={community}
      engagement={engagement}
      operational={operational}
    />
  );
}


-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "TimeDisplayPref" AS ENUM ('EVENT_LOCAL', 'USER_LOCAL');

-- CreateEnum
CREATE TYPE "UserKennelRole" AS ENUM ('MEMBER', 'ADMIN', 'MISMAN');

-- CreateEnum
CREATE TYPE "RegionLevel" AS ENUM ('COUNTRY', 'STATE_PROVINCE', 'METRO');

-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('HTML_SCRAPER', 'GOOGLE_CALENDAR', 'GOOGLE_SHEETS', 'ICAL_FEED', 'RSS_FEED', 'JSON_API', 'HASHREGO', 'MEETUP', 'STATIC_SCHEDULE', 'HARRIER_CENTRAL', 'MANUAL');

-- CreateEnum
CREATE TYPE "ScrapeStatus" AS ENUM ('RUNNING', 'SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "SourceHealth" AS ENUM ('HEALTHY', 'DEGRADED', 'FAILING', 'STALE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('CONFIRMED', 'TENTATIVE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "HareRole" AS ENUM ('HARE', 'CO_HARE', 'LIVE_HARE');

-- CreateEnum
CREATE TYPE "HareSourceType" AS ENUM ('SCRAPED', 'MISMAN_SYNC');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('INTENDING', 'CONFIRMED', 'DECLINED');

-- CreateEnum
CREATE TYPE "ParticipationLevel" AS ENUM ('RUN', 'HARE', 'BAG_HERO', 'DRINK_CHECK', 'BEER_MILE', 'WALK', 'CIRCLE_ONLY');

-- CreateEnum
CREATE TYPE "AlertType" AS ENUM ('EVENT_COUNT_ANOMALY', 'FIELD_FILL_DROP', 'STRUCTURE_CHANGE', 'SCRAPE_FAILURE', 'CONSECUTIVE_FAILURES', 'UNMATCHED_TAGS', 'SOURCE_KENNEL_MISMATCH', 'EXCESSIVE_CANCELLATIONS');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'SNOOZED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "RequestSource" AS ENUM ('ADMIN', 'PUBLIC');

-- CreateEnum
CREATE TYPE "SuggestionRelationship" AS ENUM ('HASH_WITH', 'ON_MISMAN', 'FOUND_ONLINE');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "HasherLinkStatus" AS ENUM ('SUGGESTED', 'CONFIRMED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "ReferralSource" AS ENUM ('WORD_OF_MOUTH', 'SOCIAL_MEDIA', 'REDDIT', 'MEETUP', 'GOOGLE_SEARCH', 'OTHER');

-- CreateEnum
CREATE TYPE "MismanInviteStatus" AS ENUM ('PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "DiscoveryStatus" AS ENUM ('NEW', 'MATCHED', 'ADDED', 'LINKED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'ERROR');

-- CreateEnum
CREATE TYPE "AuditType" AS ENUM ('HARELINE', 'KENNEL_DEEP_DIVE');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "clerkId" TEXT NOT NULL,
    "hashName" TEXT,
    "nerdName" TEXT,
    "email" TEXT NOT NULL,
    "bio" TEXT,
    "timeDisplayPref" "TimeDisplayPref" NOT NULL DEFAULT 'EVENT_LOCAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserKennel" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kennelId" TEXT NOT NULL,
    "role" "UserKennelRole" NOT NULL DEFAULT 'MEMBER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserKennel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Region" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'USA',
    "level" "RegionLevel" NOT NULL DEFAULT 'METRO',
    "timezone" TEXT NOT NULL,
    "abbrev" TEXT NOT NULL,
    "colorClasses" TEXT NOT NULL,
    "pinColor" TEXT NOT NULL,
    "centroidLat" DOUBLE PRECISION,
    "centroidLng" DOUBLE PRECISION,
    "parentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Region_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Kennel" (
    "id" TEXT NOT NULL,
    "kennelCode" TEXT NOT NULL,
    "shortName" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "regionId" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'USA',
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "description" TEXT,
    "website" TEXT,
    "scheduleDayOfWeek" TEXT,
    "scheduleTime" TEXT,
    "scheduleFrequency" TEXT,
    "scheduleNotes" TEXT,
    "facebookUrl" TEXT,
    "instagramHandle" TEXT,
    "twitterHandle" TEXT,
    "discordUrl" TEXT,
    "mailingListUrl" TEXT,
    "contactEmail" TEXT,
    "contactName" TEXT,
    "hashCash" TEXT,
    "paymentLink" TEXT,
    "foundedYear" INTEGER,
    "logoUrl" TEXT,
    "dogFriendly" BOOLEAN,
    "walkersWelcome" BOOLEAN,
    "isHidden" BOOLEAN NOT NULL DEFAULT false,
    "lastEventDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Kennel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KennelAlias" (
    "id" TEXT NOT NULL,
    "kennelId" TEXT NOT NULL,
    "alias" TEXT NOT NULL,

    CONSTRAINT "KennelAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Source" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "type" "SourceType" NOT NULL,
    "config" JSONB,
    "trustLevel" INTEGER NOT NULL DEFAULT 5,
    "scrapeFreq" TEXT NOT NULL DEFAULT 'daily',
    "lastScrapeAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "healthStatus" "SourceHealth" NOT NULL DEFAULT 'UNKNOWN',
    "scrapeDays" INTEGER NOT NULL DEFAULT 90,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Source_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScrapeLog" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "status" "ScrapeStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "eventsFound" INTEGER NOT NULL DEFAULT 0,
    "eventsCreated" INTEGER NOT NULL DEFAULT 0,
    "eventsUpdated" INTEGER NOT NULL DEFAULT 0,
    "eventsSkipped" INTEGER NOT NULL DEFAULT 0,
    "eventsCancelled" INTEGER NOT NULL DEFAULT 0,
    "unmatchedTags" TEXT[],
    "errors" TEXT[],
    "forced" BOOLEAN NOT NULL DEFAULT false,
    "fillRateTitle" INTEGER,
    "fillRateLocation" INTEGER,
    "fillRateHares" INTEGER,
    "fillRateStartTime" INTEGER,
    "fillRateRunNumber" INTEGER,
    "structureHash" TEXT,
    "errorDetails" JSONB,
    "sampleBlocked" JSONB,
    "sampleSkipped" JSONB,
    "fetchDurationMs" INTEGER,
    "mergeDurationMs" INTEGER,
    "diagnosticContext" JSONB,

    CONSTRAINT "ScrapeLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceKennel" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "kennelId" TEXT NOT NULL,
    "externalSlug" TEXT,

    CONSTRAINT "SourceKennel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RawEvent" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "rawData" JSONB NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "scrapedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "eventId" TEXT,

    CONSTRAINT "RawEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "kennelId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "dateUtc" TIMESTAMP(3),
    "timezone" TEXT,
    "runNumber" INTEGER,
    "title" TEXT,
    "description" TEXT,
    "haresText" TEXT,
    "locationName" TEXT,
    "locationStreet" TEXT,
    "locationCity" TEXT,
    "locationAddress" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "startTime" TEXT,
    "sourceUrl" TEXT,
    "trustLevel" INTEGER NOT NULL DEFAULT 5,
    "isSeriesParent" BOOLEAN NOT NULL DEFAULT false,
    "parentEventId" TEXT,
    "status" "EventStatus" NOT NULL DEFAULT 'CONFIRMED',
    "isManualEntry" BOOLEAN NOT NULL DEFAULT false,
    "submittedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventLink" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sourceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventHare" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "hareName" TEXT NOT NULL,
    "userId" TEXT,
    "role" "HareRole" NOT NULL DEFAULT 'HARE',
    "sourceType" "HareSourceType" NOT NULL DEFAULT 'SCRAPED',

    CONSTRAINT "EventHare_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attendance" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "status" "AttendanceStatus" NOT NULL DEFAULT 'CONFIRMED',
    "participationLevel" "ParticipationLevel" NOT NULL DEFAULT 'RUN',
    "stravaUrl" TEXT,
    "beezThere" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "verifiedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "scrapeLogId" TEXT,
    "type" "AlertType" NOT NULL,
    "severity" "AlertSeverity" NOT NULL DEFAULT 'WARNING',
    "title" TEXT NOT NULL,
    "details" TEXT,
    "context" JSONB,
    "repairLog" JSONB,
    "status" "AlertStatus" NOT NULL DEFAULT 'OPEN',
    "snoozedUntil" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KennelRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "kennelName" TEXT NOT NULL,
    "region" TEXT,
    "country" TEXT,
    "sourceUrl" TEXT,
    "notes" TEXT,
    "relationship" "SuggestionRelationship",
    "email" TEXT,
    "ipHash" TEXT,
    "regionId" TEXT,
    "source" "RequestSource" DEFAULT 'ADMIN',
    "status" "RequestStatus" NOT NULL DEFAULT 'PENDING',
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KennelRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KennelHasher" (
    "id" TEXT NOT NULL,
    "rosterGroupId" TEXT NOT NULL,
    "kennelId" TEXT,
    "hashName" TEXT,
    "nerdName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "notes" TEXT,
    "mergeLog" JSONB,
    "profileInviteToken" TEXT,
    "profileInviteExpiresAt" TIMESTAMP(3),
    "profileInvitedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KennelHasher_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KennelHasherLink" (
    "id" TEXT NOT NULL,
    "kennelHasherId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "HasherLinkStatus" NOT NULL DEFAULT 'SUGGESTED',
    "suggestedBy" TEXT,
    "confirmedBy" TEXT,
    "dismissedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KennelHasherLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KennelAttendance" (
    "id" TEXT NOT NULL,
    "kennelHasherId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "paid" BOOLEAN NOT NULL DEFAULT false,
    "haredThisTrail" BOOLEAN NOT NULL DEFAULT false,
    "isVirgin" BOOLEAN NOT NULL DEFAULT false,
    "isVisitor" BOOLEAN NOT NULL DEFAULT false,
    "visitorLocation" TEXT,
    "referralSource" "ReferralSource",
    "referralOther" TEXT,
    "recordedBy" TEXT NOT NULL,
    "editLog" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KennelAttendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MismanRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kennelId" TEXT NOT NULL,
    "message" TEXT,
    "status" "RequestStatus" NOT NULL DEFAULT 'PENDING',
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MismanRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RosterGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RosterGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RosterGroupKennel" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "kennelId" TEXT NOT NULL,

    CONSTRAINT "RosterGroupKennel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MismanInvite" (
    "id" TEXT NOT NULL,
    "kennelId" TEXT NOT NULL,
    "inviterId" TEXT NOT NULL,
    "inviteeEmail" TEXT,
    "token" TEXT NOT NULL,
    "status" "MismanInviteStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedBy" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MismanInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RosterGroupRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "proposedName" TEXT NOT NULL,
    "kennelIds" JSONB NOT NULL,
    "message" TEXT,
    "status" "RequestStatus" NOT NULL DEFAULT 'PENDING',
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RosterGroupRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StravaConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "athleteId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'activity:read_all',
    "athleteData" JSONB,
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StravaConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StravaActivity" (
    "id" TEXT NOT NULL,
    "stravaConnectionId" TEXT NOT NULL,
    "stravaActivityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sportType" TEXT NOT NULL,
    "dateLocal" TEXT NOT NULL,
    "timeLocal" TEXT,
    "distanceMeters" DOUBLE PRECISION NOT NULL,
    "movingTimeSecs" INTEGER NOT NULL,
    "startLat" DOUBLE PRECISION,
    "startLng" DOUBLE PRECISION,
    "timezone" TEXT,
    "city" TEXT,
    "matchedAttendanceId" TEXT,
    "matchDismissed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StravaActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KennelDiscovery" (
    "id" TEXT NOT NULL,
    "externalSource" TEXT NOT NULL,
    "externalSlug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "location" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "schedule" TEXT,
    "externalUrl" TEXT,
    "website" TEXT,
    "contactEmail" TEXT,
    "yearStarted" INTEGER,
    "trailPrice" INTEGER,
    "logoUrl" TEXT,
    "memberCount" INTEGER,
    "paymentInfo" JSONB,
    "status" "DiscoveryStatus" NOT NULL DEFAULT 'NEW',
    "matchedKennelId" TEXT,
    "matchScore" DOUBLE PRECISION,
    "matchCandidates" JSONB,
    "regionId" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedBy" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KennelDiscovery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceProposal" (
    "id" TEXT NOT NULL,
    "regionId" TEXT NOT NULL,
    "kennelId" TEXT,
    "url" TEXT NOT NULL,
    "sourceName" TEXT,
    "discoveryMethod" TEXT NOT NULL,
    "searchQuery" TEXT,
    "detectedType" "SourceType",
    "extractedConfig" JSONB,
    "confidence" TEXT,
    "explanation" TEXT,
    "kennelName" TEXT,
    "status" "ProposalStatus" NOT NULL DEFAULT 'PENDING',
    "processedBy" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdSourceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourceProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "type" "AuditType" NOT NULL,
    "eventsScanned" INTEGER NOT NULL,
    "findingsCount" INTEGER NOT NULL,
    "groupsCount" INTEGER NOT NULL,
    "issuesFiled" INTEGER NOT NULL,
    "findings" JSONB NOT NULL,
    "summary" JSONB NOT NULL,
    "kennelCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditSuppression" (
    "id" TEXT NOT NULL,
    "kennelCode" TEXT,
    "rule" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "AuditSuppression_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_clerkId_key" ON "User"("clerkId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "UserKennel_userId_kennelId_key" ON "UserKennel"("userId", "kennelId");

-- CreateIndex
CREATE UNIQUE INDEX "Region_name_key" ON "Region"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Region_slug_key" ON "Region"("slug");

-- CreateIndex
CREATE INDEX "Region_parentId_idx" ON "Region"("parentId");

-- CreateIndex
CREATE INDEX "Region_country_idx" ON "Region"("country");

-- CreateIndex
CREATE INDEX "Region_level_idx" ON "Region"("level");

-- CreateIndex
CREATE UNIQUE INDEX "Kennel_kennelCode_key" ON "Kennel"("kennelCode");

-- CreateIndex
CREATE UNIQUE INDEX "Kennel_slug_key" ON "Kennel"("slug");

-- CreateIndex
CREATE INDEX "Kennel_regionId_idx" ON "Kennel"("regionId");

-- CreateIndex
CREATE UNIQUE INDEX "Kennel_shortName_regionId_key" ON "Kennel"("shortName", "regionId");

-- CreateIndex
CREATE INDEX "KennelAlias_alias_idx" ON "KennelAlias"("alias");

-- CreateIndex
CREATE UNIQUE INDEX "KennelAlias_kennelId_alias_key" ON "KennelAlias"("kennelId", "alias");

-- CreateIndex
CREATE INDEX "ScrapeLog_sourceId_startedAt_idx" ON "ScrapeLog"("sourceId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SourceKennel_sourceId_kennelId_key" ON "SourceKennel"("sourceId", "kennelId");

-- CreateIndex
CREATE INDEX "RawEvent_sourceId_scrapedAt_idx" ON "RawEvent"("sourceId", "scrapedAt");

-- CreateIndex
CREATE INDEX "RawEvent_fingerprint_idx" ON "RawEvent"("fingerprint");

-- CreateIndex
CREATE INDEX "Event_date_idx" ON "Event"("date");

-- CreateIndex
CREATE INDEX "Event_kennelId_date_idx" ON "Event"("kennelId", "date");

-- CreateIndex
CREATE INDEX "Event_parentEventId_idx" ON "Event"("parentEventId");

-- CreateIndex
CREATE INDEX "EventLink_eventId_idx" ON "EventLink"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "EventLink_eventId_url_key" ON "EventLink"("eventId", "url");

-- CreateIndex
CREATE INDEX "EventHare_eventId_idx" ON "EventHare"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "EventHare_eventId_hareName_key" ON "EventHare"("eventId", "hareName");

-- CreateIndex
CREATE UNIQUE INDEX "Attendance_userId_eventId_key" ON "Attendance"("userId", "eventId");

-- CreateIndex
CREATE INDEX "Alert_sourceId_status_idx" ON "Alert"("sourceId", "status");

-- CreateIndex
CREATE INDEX "Alert_status_createdAt_idx" ON "Alert"("status", "createdAt");

-- CreateIndex
CREATE INDEX "KennelRequest_userId_idx" ON "KennelRequest"("userId");

-- CreateIndex
CREATE INDEX "KennelRequest_ipHash_idx" ON "KennelRequest"("ipHash");

-- CreateIndex
CREATE INDEX "KennelRequest_regionId_idx" ON "KennelRequest"("regionId");

-- CreateIndex
CREATE UNIQUE INDEX "KennelHasher_profileInviteToken_key" ON "KennelHasher"("profileInviteToken");

-- CreateIndex
CREATE INDEX "KennelHasher_rosterGroupId_idx" ON "KennelHasher"("rosterGroupId");

-- CreateIndex
CREATE INDEX "KennelHasher_rosterGroupId_hashName_idx" ON "KennelHasher"("rosterGroupId", "hashName");

-- CreateIndex
CREATE INDEX "KennelHasher_rosterGroupId_nerdName_idx" ON "KennelHasher"("rosterGroupId", "nerdName");

-- CreateIndex
CREATE INDEX "KennelHasher_kennelId_idx" ON "KennelHasher"("kennelId");

-- CreateIndex
CREATE UNIQUE INDEX "KennelHasherLink_kennelHasherId_key" ON "KennelHasherLink"("kennelHasherId");

-- CreateIndex
CREATE INDEX "KennelHasherLink_userId_status_idx" ON "KennelHasherLink"("userId", "status");

-- CreateIndex
CREATE INDEX "KennelAttendance_eventId_idx" ON "KennelAttendance"("eventId");

-- CreateIndex
CREATE INDEX "KennelAttendance_kennelHasherId_idx" ON "KennelAttendance"("kennelHasherId");

-- CreateIndex
CREATE UNIQUE INDEX "KennelAttendance_kennelHasherId_eventId_key" ON "KennelAttendance"("kennelHasherId", "eventId");

-- CreateIndex
CREATE INDEX "MismanRequest_userId_kennelId_status_idx" ON "MismanRequest"("userId", "kennelId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RosterGroupKennel_groupId_kennelId_key" ON "RosterGroupKennel"("groupId", "kennelId");

-- CreateIndex
CREATE UNIQUE INDEX "RosterGroupKennel_kennelId_key" ON "RosterGroupKennel"("kennelId");

-- CreateIndex
CREATE UNIQUE INDEX "MismanInvite_token_key" ON "MismanInvite"("token");

-- CreateIndex
CREATE INDEX "MismanInvite_kennelId_status_idx" ON "MismanInvite"("kennelId", "status");

-- CreateIndex
CREATE INDEX "MismanInvite_token_idx" ON "MismanInvite"("token");

-- CreateIndex
CREATE INDEX "RosterGroupRequest_status_idx" ON "RosterGroupRequest"("status");

-- CreateIndex
CREATE UNIQUE INDEX "StravaConnection_userId_key" ON "StravaConnection"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "StravaConnection_athleteId_key" ON "StravaConnection"("athleteId");

-- CreateIndex
CREATE INDEX "StravaConnection_userId_idx" ON "StravaConnection"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "StravaActivity_stravaActivityId_key" ON "StravaActivity"("stravaActivityId");

-- CreateIndex
CREATE INDEX "StravaActivity_stravaConnectionId_dateLocal_idx" ON "StravaActivity"("stravaConnectionId", "dateLocal");

-- CreateIndex
CREATE INDEX "StravaActivity_matchedAttendanceId_idx" ON "StravaActivity"("matchedAttendanceId");

-- CreateIndex
CREATE INDEX "StravaActivity_dateLocal_idx" ON "StravaActivity"("dateLocal");

-- CreateIndex
CREATE INDEX "KennelDiscovery_status_idx" ON "KennelDiscovery"("status");

-- CreateIndex
CREATE INDEX "KennelDiscovery_regionId_status_idx" ON "KennelDiscovery"("regionId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "KennelDiscovery_externalSource_externalSlug_key" ON "KennelDiscovery"("externalSource", "externalSlug");

-- CreateIndex
CREATE INDEX "SourceProposal_regionId_status_idx" ON "SourceProposal"("regionId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SourceProposal_url_regionId_key" ON "SourceProposal"("url", "regionId");

-- CreateIndex
CREATE UNIQUE INDEX "AuditSuppression_kennelCode_rule_key" ON "AuditSuppression"("kennelCode", "rule");

-- AddForeignKey
ALTER TABLE "UserKennel" ADD CONSTRAINT "UserKennel_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserKennel" ADD CONSTRAINT "UserKennel_kennelId_fkey" FOREIGN KEY ("kennelId") REFERENCES "Kennel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Region" ADD CONSTRAINT "Region_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Region"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Kennel" ADD CONSTRAINT "Kennel_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KennelAlias" ADD CONSTRAINT "KennelAlias_kennelId_fkey" FOREIGN KEY ("kennelId") REFERENCES "Kennel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScrapeLog" ADD CONSTRAINT "ScrapeLog_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceKennel" ADD CONSTRAINT "SourceKennel_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceKennel" ADD CONSTRAINT "SourceKennel_kennelId_fkey" FOREIGN KEY ("kennelId") REFERENCES "Kennel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RawEvent" ADD CONSTRAINT "RawEvent_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RawEvent" ADD CONSTRAINT "RawEvent_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_submittedByUserId_fkey" FOREIGN KEY ("submittedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_kennelId_fkey" FOREIGN KEY ("kennelId") REFERENCES "Kennel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_parentEventId_fkey" FOREIGN KEY ("parentEventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventLink" ADD CONSTRAINT "EventLink_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventLink" ADD CONSTRAINT "EventLink_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventHare" ADD CONSTRAINT "EventHare_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventHare" ADD CONSTRAINT "EventHare_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_scrapeLogId_fkey" FOREIGN KEY ("scrapeLogId") REFERENCES "ScrapeLog"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KennelRequest" ADD CONSTRAINT "KennelRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KennelRequest" ADD CONSTRAINT "KennelRequest_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KennelHasher" ADD CONSTRAINT "KennelHasher_rosterGroupId_fkey" FOREIGN KEY ("rosterGroupId") REFERENCES "RosterGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KennelHasher" ADD CONSTRAINT "KennelHasher_kennelId_fkey" FOREIGN KEY ("kennelId") REFERENCES "Kennel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KennelHasherLink" ADD CONSTRAINT "KennelHasherLink_kennelHasherId_fkey" FOREIGN KEY ("kennelHasherId") REFERENCES "KennelHasher"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KennelHasherLink" ADD CONSTRAINT "KennelHasherLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KennelAttendance" ADD CONSTRAINT "KennelAttendance_kennelHasherId_fkey" FOREIGN KEY ("kennelHasherId") REFERENCES "KennelHasher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KennelAttendance" ADD CONSTRAINT "KennelAttendance_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KennelAttendance" ADD CONSTRAINT "KennelAttendance_recordedBy_fkey" FOREIGN KEY ("recordedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MismanRequest" ADD CONSTRAINT "MismanRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MismanRequest" ADD CONSTRAINT "MismanRequest_kennelId_fkey" FOREIGN KEY ("kennelId") REFERENCES "Kennel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RosterGroupKennel" ADD CONSTRAINT "RosterGroupKennel_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "RosterGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RosterGroupKennel" ADD CONSTRAINT "RosterGroupKennel_kennelId_fkey" FOREIGN KEY ("kennelId") REFERENCES "Kennel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MismanInvite" ADD CONSTRAINT "MismanInvite_kennelId_fkey" FOREIGN KEY ("kennelId") REFERENCES "Kennel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MismanInvite" ADD CONSTRAINT "MismanInvite_inviterId_fkey" FOREIGN KEY ("inviterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MismanInvite" ADD CONSTRAINT "MismanInvite_acceptedBy_fkey" FOREIGN KEY ("acceptedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RosterGroupRequest" ADD CONSTRAINT "RosterGroupRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StravaConnection" ADD CONSTRAINT "StravaConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StravaActivity" ADD CONSTRAINT "StravaActivity_stravaConnectionId_fkey" FOREIGN KEY ("stravaConnectionId") REFERENCES "StravaConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KennelDiscovery" ADD CONSTRAINT "KennelDiscovery_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KennelDiscovery" ADD CONSTRAINT "KennelDiscovery_matchedKennelId_fkey" FOREIGN KEY ("matchedKennelId") REFERENCES "Kennel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceProposal" ADD CONSTRAINT "SourceProposal_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceProposal" ADD CONSTRAINT "SourceProposal_kennelId_fkey" FOREIGN KEY ("kennelId") REFERENCES "Kennel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_kennelCode_fkey" FOREIGN KEY ("kennelCode") REFERENCES "Kennel"("kennelCode") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditSuppression" ADD CONSTRAINT "AuditSuppression_kennelCode_fkey" FOREIGN KEY ("kennelCode") REFERENCES "Kennel"("kennelCode") ON DELETE SET NULL ON UPDATE CASCADE;


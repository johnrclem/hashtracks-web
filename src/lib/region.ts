import type { RegionData } from "@/lib/types/region";

/**
 * Region data module — single source of truth for region display data.
 *
 * Provides:
 * 1. REGION_SEED_DATA — canonical region records for migration & seed
 * 2. Sync compat wrappers — drop-in replacements for the old REGION_CONFIG lookups
 * 3. DB-backed async queries — for admin CRUD and future use
 *
 * The sync wrappers use an in-memory fallback map built from REGION_SEED_DATA so they
 * work even without a DB connection (tests, build-time, etc.). Once the Region table
 * is populated, the async functions read from DB with caching.
 */

// ── Canonical region data (used for seed + migration + sync fallback) ──

export type RegionLevel = "COUNTRY" | "STATE_PROVINCE" | "METRO";

export interface RegionSeedRecord {
  name: string;
  country: string;
  level?: RegionLevel; // defaults to METRO
  timezone: string;
  abbrev: string;
  colorClasses: string;
  pinColor: string;
  centroidLat: number | null;
  centroidLng: number | null;
  /** Names that should resolve to this region (e.g., "London, England" → "London") */
  aliases?: string[];
}

/**
 * Canonical region seed data — merges the old REGION_CONFIG, REGION_CENTROIDS,
 * and REGION_COLORS into a single array. Deduplicated: variants like
 * "London, England" / "London, UK" map to the canonical "London" record via aliases.
 */
// NOTE: colorClasses values below are referenced by RegionBadge via the DB.
// Tailwind scans this file at build time, so these classes are NOT purged.
// Do not remove these string literals. Dark mode variants are appended at
// runtime by withDarkVariants() — see the CSS safelist in globals.css.
export const REGION_SEED_DATA: RegionSeedRecord[] = [
  // ── COUNTRIES (top-level) ──
  {
    name: "United States",
    country: "USA",
    level: "COUNTRY",
    timezone: "America/New_York",
    abbrev: "USA",
    colorClasses: "bg-slate-200 text-slate-800",
    pinColor: "#475569",
    centroidLat: 39.83,
    centroidLng: -98.58,
    aliases: ["USA", "US"],
  },
  {
    name: "United Kingdom",
    country: "UK",
    level: "COUNTRY",
    timezone: "Europe/London",
    abbrev: "UK",
    colorClasses: "bg-rose-200 text-rose-800",
    pinColor: "#e11d48",
    centroidLat: 54.0,
    centroidLng: -2.0,
    aliases: ["UK", "Great Britain", "GB"],
  },
  // ── US East Coast — New York ──
  {
    name: "New York",
    country: "USA",
    level: "STATE_PROVINCE",
    timezone: "America/New_York",
    abbrev: "NY",
    colorClasses: "bg-blue-100 text-blue-700",
    pinColor: "#3b82f6",
    centroidLat: 42.65,
    centroidLng: -73.75,
    aliases: ["New York State", "NYS"],
  },
  {
    name: "New York City, NY",
    country: "USA",
    timezone: "America/New_York",
    abbrev: "NYC",
    colorClasses: "bg-blue-200 text-blue-800",
    pinColor: "#2563eb",
    centroidLat: 40.71,
    centroidLng: -74.01,
  },
  {
    name: "Long Island, NY",
    country: "USA",
    timezone: "America/New_York",
    abbrev: "LI",
    colorClasses: "bg-cyan-200 text-cyan-800",
    pinColor: "#0891b2",
    centroidLat: 40.79,
    centroidLng: -73.13,
  },
  {
    name: "Syracuse, NY",
    country: "USA",
    timezone: "America/New_York",
    abbrev: "SYR",
    colorClasses: "bg-violet-100 text-violet-700",
    pinColor: "#7c3aed",
    centroidLat: 43.05,
    centroidLng: -76.15,
    aliases: ["Syracuse"],
  },
  {
    name: "Capital District, NY",
    country: "USA",
    timezone: "America/New_York",
    abbrev: "ALB",
    colorClasses: "bg-emerald-100 text-emerald-700",
    pinColor: "#059669",
    centroidLat: 42.65,
    centroidLng: -73.76,
    aliases: ["Albany, NY", "Albany", "Capital Region"],
  },
  {
    name: "Ithaca, NY",
    country: "USA",
    timezone: "America/New_York",
    abbrev: "ITH",
    colorClasses: "bg-amber-100 text-amber-700",
    pinColor: "#d97706",
    centroidLat: 42.44,
    centroidLng: -76.50,
    aliases: ["Ithaca"],
  },
  {
    name: "Rochester, NY",
    country: "USA",
    timezone: "America/New_York",
    abbrev: "ROC",
    colorClasses: "bg-rose-100 text-rose-700",
    pinColor: "#e11d48",
    centroidLat: 43.16,
    centroidLng: -77.61,
    aliases: ["Rochester"],
  },
  {
    name: "Buffalo, NY",
    country: "USA",
    timezone: "America/New_York",
    abbrev: "BUF",
    colorClasses: "bg-sky-100 text-sky-700",
    pinColor: "#0284c7",
    centroidLat: 42.89,
    centroidLng: -78.88,
    aliases: ["Buffalo"],
  },
  {
    name: "Boston, MA",
    country: "USA",
    timezone: "America/New_York",
    abbrev: "BOS",
    colorClasses: "bg-red-200 text-red-800",
    pinColor: "#dc2626",
    centroidLat: 42.36,
    centroidLng: -71.06,
  },
  {
    name: "North NJ",
    country: "USA",
    timezone: "America/New_York",
    abbrev: "NNJ",
    colorClasses: "bg-emerald-200 text-emerald-800",
    pinColor: "#059669",
    centroidLat: 40.78,
    centroidLng: -74.11,
  },
  {
    name: "New Jersey",
    country: "USA",
    timezone: "America/New_York",
    abbrev: "NJ",
    colorClasses: "bg-green-200 text-green-800",
    pinColor: "#16a34a",
    centroidLat: 40.06,
    centroidLng: -74.41,
  },
  {
    name: "Philadelphia, PA",
    country: "USA",
    timezone: "America/New_York",
    abbrev: "PHI",
    colorClasses: "bg-amber-200 text-amber-800",
    pinColor: "#d97706",
    centroidLat: 39.95,
    centroidLng: -75.17,
  },
  // ── US East Coast — Pennsylvania ──
  {
    name: "Pennsylvania",
    country: "USA",
    level: "STATE_PROVINCE",
    timezone: "America/New_York",
    abbrev: "PA",
    colorClasses: "bg-blue-100 text-blue-700",
    pinColor: "#3b82f6",
    centroidLat: 40.59,
    centroidLng: -77.21,
    aliases: ["PA"],
  },
  {
    name: "Pittsburgh, PA",
    country: "USA",
    timezone: "America/New_York",
    abbrev: "PIT",
    colorClasses: "bg-yellow-100 text-yellow-700",
    pinColor: "#ca8a04",
    centroidLat: 40.44,
    centroidLng: -79.99,
    aliases: ["Pittsburgh"],
  },
  {
    name: "State College, PA",
    country: "USA",
    timezone: "America/New_York",
    abbrev: "SCE",
    colorClasses: "bg-indigo-100 text-indigo-700",
    pinColor: "#4f46e5",
    centroidLat: 40.79,
    centroidLng: -77.86,
    aliases: ["State College", "Central PA", "Happy Valley PA"],
  },
  {
    name: "Lehigh Valley, PA",
    country: "USA",
    timezone: "America/New_York",
    abbrev: "ABE",
    colorClasses: "bg-teal-100 text-teal-700",
    pinColor: "#0d9488",
    centroidLat: 40.60,
    centroidLng: -75.49,
    aliases: ["Lehigh Valley", "Allentown", "Bethlehem PA"],
  },
  {
    name: "Reading, PA",
    country: "USA",
    timezone: "America/New_York",
    abbrev: "RDG",
    colorClasses: "bg-orange-100 text-orange-700",
    pinColor: "#ea580c",
    centroidLat: 40.34,
    centroidLng: -75.93,
    aliases: ["Reading"],
  },
  {
    name: "Harrisburg, PA",
    country: "USA",
    timezone: "America/New_York",
    abbrev: "HAR",
    colorClasses: "bg-fuchsia-100 text-fuchsia-700",
    pinColor: "#c026d3",
    centroidLat: 40.27,
    centroidLng: -76.88,
    aliases: ["Harrisburg", "Hershey"],
  },
  // ── US East Coast — Delaware ──
  {
    name: "Delaware",
    country: "USA",
    level: "STATE_PROVINCE",
    timezone: "America/New_York",
    abbrev: "DE",
    colorClasses: "bg-cyan-100 text-cyan-700",
    pinColor: "#0891b2",
    centroidLat: 39.16,
    centroidLng: -75.52,
    aliases: ["DE"],
  },
  {
    name: "Wilmington, DE",
    country: "USA",
    timezone: "America/New_York",
    abbrev: "ILG",
    colorClasses: "bg-lime-100 text-lime-700",
    pinColor: "#65a30d",
    centroidLat: 39.74,
    centroidLng: -75.55,
    aliases: ["Wilmington"],
  },
  // ── US New England ──
  {
    name: "Massachusetts",
    country: "USA",
    level: "STATE_PROVINCE",
    timezone: "America/New_York",
    abbrev: "MA",
    colorClasses: "bg-red-100 text-red-700",
    pinColor: "#ef4444",
    centroidLat: 42.41,
    centroidLng: -71.38,
    aliases: ["MA"],
  },
  {
    name: "Pioneer Valley, MA",
    country: "USA",
    timezone: "America/New_York",
    abbrev: "PV",
    colorClasses: "bg-rose-100 text-rose-700",
    pinColor: "#f43f5e",
    centroidLat: 42.39,
    centroidLng: -72.53,
    aliases: ["Pioneer Valley", "Western Massachusetts", "Western MA"],
  },
  {
    name: "Vermont",
    country: "USA",
    level: "STATE_PROVINCE",
    timezone: "America/New_York",
    abbrev: "VT",
    colorClasses: "bg-green-200 text-green-800",
    pinColor: "#16a34a",
    centroidLat: 44.26,
    centroidLng: -72.58,
    aliases: ["VT"],
  },
  {
    name: "Connecticut",
    country: "USA",
    level: "STATE_PROVINCE",
    timezone: "America/New_York",
    abbrev: "CT",
    colorClasses: "bg-sky-200 text-sky-800",
    pinColor: "#0284c7",
    centroidLat: 41.60,
    centroidLng: -72.70,
    aliases: ["CT"],
  },
  {
    name: "Rhode Island",
    country: "USA",
    level: "STATE_PROVINCE",
    timezone: "America/New_York",
    abbrev: "RI",
    colorClasses: "bg-indigo-200 text-indigo-800",
    pinColor: "#4f46e5",
    centroidLat: 41.58,
    centroidLng: -71.48,
    aliases: ["RI"],
  },
  {
    name: "Maine",
    country: "USA",
    level: "STATE_PROVINCE",
    timezone: "America/New_York",
    abbrev: "ME",
    colorClasses: "bg-red-100 text-red-700",
    pinColor: "#dc2626",
    centroidLat: 45.25,
    centroidLng: -69.45,
    aliases: ["ME"],
  },
  {
    name: "Portland, ME",
    country: "USA",
    timezone: "America/New_York",
    abbrev: "PME",
    colorClasses: "bg-red-100 text-red-700",
    pinColor: "#ef4444",
    centroidLat: 43.66,
    centroidLng: -70.26,
    aliases: ["Portland, Maine"],
  },
  // ── US Midwest ──
  {
    name: "Illinois",
    country: "USA",
    level: "STATE_PROVINCE",
    timezone: "America/Chicago",
    abbrev: "IL",
    colorClasses: "bg-purple-100 text-purple-700",
    pinColor: "#7c3aed",
    centroidLat: 40.06,
    centroidLng: -89.40,
    aliases: ["IL"],
  },
  {
    name: "Chicago, IL",
    country: "USA",
    timezone: "America/Chicago",
    abbrev: "CHI",
    colorClasses: "bg-purple-200 text-purple-800",
    pinColor: "#9333ea",
    centroidLat: 41.88,
    centroidLng: -87.63,
  },
  {
    name: "South Shore, IN",
    country: "USA",
    timezone: "America/Chicago",
    abbrev: "IN",
    colorClasses: "bg-violet-200 text-violet-800",
    pinColor: "#7c3aed",
    centroidLat: 41.6,
    centroidLng: -87.34,
  },
  // ── US Midwest — Ohio ──
  {
    name: "Ohio",
    country: "USA",
    level: "STATE_PROVINCE",
    timezone: "America/New_York",
    abbrev: "OH",
    colorClasses: "bg-red-100 text-red-700",
    pinColor: "#ef4444",
    centroidLat: 40.42,
    centroidLng: -82.91,
    aliases: ["OH"],
  },
  {
    name: "Columbus, OH",
    country: "USA",
    timezone: "America/New_York",
    abbrev: "CMH",
    colorClasses: "bg-orange-200 text-orange-800",
    pinColor: "#f97316",
    centroidLat: 39.96,
    centroidLng: -82.99,
  },
  {
    name: "Cincinnati, OH",
    country: "USA",
    timezone: "America/New_York",
    abbrev: "CIN",
    colorClasses: "bg-violet-200 text-violet-800",
    pinColor: "#8b5cf6",
    centroidLat: 39.10,
    centroidLng: -84.51,
  },
  {
    name: "Dayton, OH",
    country: "USA",
    timezone: "America/New_York",
    abbrev: "DAY",
    colorClasses: "bg-blue-200 text-blue-800",
    pinColor: "#3b82f6",
    centroidLat: 39.76,
    centroidLng: -84.19,
  },
  {
    name: "Cleveland, OH",
    country: "USA",
    timezone: "America/New_York",
    abbrev: "CLE",
    colorClasses: "bg-emerald-200 text-emerald-800",
    pinColor: "#10b981",
    centroidLat: 41.50,
    centroidLng: -81.69,
  },
  {
    name: "Akron, OH",
    country: "USA",
    timezone: "America/New_York",
    abbrev: "AKR",
    colorClasses: "bg-teal-200 text-teal-800",
    pinColor: "#14b8a6",
    centroidLat: 41.08,
    centroidLng: -81.52,
  },
  // ── US DC / DMV ──
  {
    name: "Washington, DC",
    country: "USA",
    timezone: "America/New_York",
    abbrev: "DC",
    colorClasses: "bg-slate-200 text-slate-800",
    pinColor: "#475569",
    centroidLat: 38.91,
    centroidLng: -77.04,
  },
  {
    name: "Northern Virginia",
    country: "USA",
    timezone: "America/New_York",
    abbrev: "NoVA",
    colorClasses: "bg-stone-300 text-stone-900",
    pinColor: "#57534e",
    centroidLat: 38.85,
    centroidLng: -77.2,
  },
  {
    name: "Maryland",
    country: "USA",
    level: "STATE_PROVINCE",
    timezone: "America/New_York",
    abbrev: "MD",
    colorClasses: "bg-orange-100 text-orange-700",
    pinColor: "#ea580c",
    centroidLat: 39.05,
    centroidLng: -76.79,
    aliases: ["MD"],
  },
  {
    name: "Baltimore, MD",
    country: "USA",
    timezone: "America/New_York",
    abbrev: "BAL",
    colorClasses: "bg-orange-200 text-orange-800",
    pinColor: "#ea580c",
    centroidLat: 39.29,
    centroidLng: -76.61,
  },
  {
    name: "Frederick, MD",
    country: "USA",
    timezone: "America/New_York",
    abbrev: "FRD",
    colorClasses: "bg-orange-100 text-orange-700",
    pinColor: "#f97316",
    centroidLat: 39.41,
    centroidLng: -77.41,
  },
  {
    name: "Fredericksburg, VA",
    country: "USA",
    timezone: "America/New_York",
    abbrev: "FXBG",
    colorClasses: "bg-stone-200 text-stone-900",
    pinColor: "#78716c",
    centroidLat: 38.3,
    centroidLng: -77.46,
  },
  {
    name: "Southern Maryland",
    country: "USA",
    timezone: "America/New_York",
    abbrev: "SMD",
    colorClasses: "bg-orange-100 text-orange-700",
    pinColor: "#f97316",
    centroidLat: 38.55,
    centroidLng: -76.8,
  },
  {
    name: "Jefferson County, WV",
    country: "USA",
    timezone: "America/New_York",
    abbrev: "WV",
    colorClasses: "bg-lime-200 text-lime-800",
    pinColor: "#65a30d",
    centroidLat: 39.32,
    centroidLng: -77.87,
  },
  // ── US East Coast — Virginia ──
  {
    name: "Virginia",
    country: "USA",
    level: "STATE_PROVINCE",
    timezone: "America/New_York",
    abbrev: "VA",
    colorClasses: "bg-stone-200 text-stone-800",
    pinColor: "#57534e",
    centroidLat: 37.43,
    centroidLng: -78.66,
    aliases: ["VA"],
  },
  {
    name: "Richmond, VA",
    country: "USA",
    timezone: "America/New_York",
    abbrev: "RVA",
    colorClasses: "bg-red-100 text-red-700",
    pinColor: "#ef4444",
    centroidLat: 37.54,
    centroidLng: -77.44,
    aliases: ["Richmond", "RVA"],
  },
  {
    name: "Hampton Roads, VA",
    country: "USA",
    timezone: "America/New_York",
    abbrev: "HRV",
    colorClasses: "bg-blue-100 text-blue-700",
    pinColor: "#3b82f6",
    centroidLat: 36.85,
    centroidLng: -76.29,
    aliases: ["Hampton Roads", "Norfolk", "Virginia Beach", "Newport News"],
  },
  {
    name: "Charlottesville, VA",
    country: "USA",
    timezone: "America/New_York",
    abbrev: "CVL",
    colorClasses: "bg-violet-100 text-violet-700",
    pinColor: "#7c3aed",
    centroidLat: 38.03,
    centroidLng: -78.48,
    aliases: ["Charlottesville"],
  },
  {
    name: "Lynchburg, VA",
    country: "USA",
    timezone: "America/New_York",
    abbrev: "LYH",
    colorClasses: "bg-pink-100 text-pink-700",
    pinColor: "#ec4899",
    centroidLat: 37.41,
    centroidLng: -79.14,
    aliases: ["Lynchburg"],
  },
  // ── US Southeast ──
  {
    name: "Georgia",
    country: "USA",
    level: "STATE_PROVINCE",
    timezone: "America/New_York",
    abbrev: "GA",
    colorClasses: "bg-yellow-100 text-yellow-700",
    pinColor: "#ca8a04",
    centroidLat: 32.65,
    centroidLng: -83.44,
    aliases: ["GA"],
  },
  {
    name: "Atlanta, GA",
    country: "USA",
    timezone: "America/New_York",
    abbrev: "ATL",
    colorClasses: "bg-yellow-100 text-yellow-700",
    pinColor: "#eab308",
    centroidLat: 33.75,
    centroidLng: -84.39,
    aliases: ["Atlanta, Georgia"],
  },
  {
    name: "Savannah, GA",
    country: "USA",
    timezone: "America/New_York",
    abbrev: "SAV",
    colorClasses: "bg-yellow-200 text-yellow-800",
    pinColor: "#ca8a04",
    centroidLat: 32.08,
    centroidLng: -81.09,
    aliases: ["Savannah, Georgia"],
  },
  {
    name: "Augusta, GA",
    country: "USA",
    timezone: "America/New_York",
    abbrev: "AUG",
    colorClasses: "bg-amber-100 text-amber-700",
    pinColor: "#f59e0b",
    centroidLat: 33.47,
    centroidLng: -81.97,
    aliases: ["Augusta, Georgia"],
  },
  {
    name: "Macon, GA",
    country: "USA",
    timezone: "America/New_York",
    abbrev: "MAC",
    colorClasses: "bg-orange-100 text-orange-700",
    pinColor: "#f97316",
    centroidLat: 32.84,
    centroidLng: -83.63,
    aliases: ["Macon, Georgia"],
  },
  {
    name: "Columbus, GA",
    country: "USA",
    timezone: "America/New_York",
    abbrev: "CSG",
    colorClasses: "bg-lime-100 text-lime-700",
    pinColor: "#84cc16",
    centroidLat: 32.46,
    centroidLng: -84.99,
    aliases: ["Columbus, Georgia"],
  },
  {
    name: "Rome, GA",
    country: "USA",
    timezone: "America/New_York",
    abbrev: "ROM",
    colorClasses: "bg-emerald-100 text-emerald-700",
    pinColor: "#10b981",
    centroidLat: 34.26,
    centroidLng: -85.16,
    aliases: ["Rome, Georgia"],
  },
  // ── US Southeast — North Carolina ──
  {
    name: "North Carolina",
    country: "USA",
    level: "STATE_PROVINCE",
    timezone: "America/New_York",
    abbrev: "NC",
    colorClasses: "bg-sky-100 text-sky-700",
    pinColor: "#0ea5e9",
    centroidLat: 35.63,
    centroidLng: -79.81,
    aliases: ["NC"],
  },
  {
    name: "Raleigh, NC",
    country: "USA",
    timezone: "America/New_York",
    abbrev: "RAL",
    colorClasses: "bg-lime-100 text-lime-700",
    pinColor: "#84cc16",
    centroidLat: 35.78,
    centroidLng: -78.64,
    aliases: ["Raleigh, North Carolina", "Triangle"],
  },
  {
    name: "Charlotte, NC",
    country: "USA",
    timezone: "America/New_York",
    abbrev: "CLT",
    colorClasses: "bg-teal-100 text-teal-700",
    pinColor: "#14b8a6",
    centroidLat: 35.23,
    centroidLng: -80.84,
    aliases: ["Charlotte", "Charlotte, North Carolina"],
  },
  {
    name: "Asheville, NC",
    country: "USA",
    timezone: "America/New_York",
    abbrev: "AVL",
    colorClasses: "bg-emerald-100 text-emerald-700",
    pinColor: "#10b981",
    centroidLat: 35.60,
    centroidLng: -82.55,
    aliases: ["Asheville", "Asheville, North Carolina"],
  },
  {
    name: "Wilmington, NC",
    country: "USA",
    timezone: "America/New_York",
    abbrev: "ILM",
    colorClasses: "bg-cyan-100 text-cyan-700",
    pinColor: "#06b6d4",
    centroidLat: 34.24,
    centroidLng: -77.95,
    aliases: ["Wilmington NC", "Wilmington, North Carolina"],
  },
  {
    name: "Fayetteville, NC",
    country: "USA",
    timezone: "America/New_York",
    abbrev: "FAY",
    colorClasses: "bg-amber-100 text-amber-700",
    pinColor: "#f59e0b",
    centroidLat: 35.05,
    centroidLng: -78.88,
    aliases: ["Fayetteville", "Fayetteville, North Carolina"],
  },
  // ── US Southeast — South Carolina ──
  {
    name: "South Carolina",
    country: "USA",
    level: "STATE_PROVINCE",
    timezone: "America/New_York",
    abbrev: "SC",
    colorClasses: "bg-cyan-100 text-cyan-700",
    pinColor: "#06b6d4",
    centroidLat: 33.84,
    centroidLng: -81.16,
    aliases: ["SC"],
  },
  {
    name: "Charleston, SC",
    country: "USA",
    timezone: "America/New_York",
    abbrev: "CHS",
    colorClasses: "bg-teal-100 text-teal-700",
    pinColor: "#14b8a6",
    centroidLat: 32.78,
    centroidLng: -79.93,
    aliases: ["Charleston, South Carolina"],
  },
  {
    name: "Columbia, SC",
    country: "USA",
    timezone: "America/New_York",
    abbrev: "COL",
    colorClasses: "bg-sky-100 text-sky-700",
    pinColor: "#0ea5e9",
    centroidLat: 34.0,
    centroidLng: -81.03,
    aliases: ["Columbia, South Carolina"],
  },
  {
    name: "Greenville, SC",
    country: "USA",
    timezone: "America/New_York",
    abbrev: "GVL",
    colorClasses: "bg-indigo-100 text-indigo-700",
    pinColor: "#6366f1",
    centroidLat: 34.85,
    centroidLng: -82.4,
    aliases: ["Greenville, South Carolina"],
  },
  {
    name: "Myrtle Beach, SC",
    country: "USA",
    timezone: "America/New_York",
    abbrev: "MYR",
    colorClasses: "bg-violet-100 text-violet-700",
    pinColor: "#8b5cf6",
    centroidLat: 33.69,
    centroidLng: -78.89,
    aliases: ["Myrtle Beach, South Carolina"],
  },
  // ── US West Coast ──
  {
    name: "California",
    country: "USA",
    level: "STATE_PROVINCE",
    timezone: "America/Los_Angeles",
    abbrev: "CA",
    colorClasses: "bg-teal-200 text-teal-800",
    pinColor: "#0d9488",
    centroidLat: 36.78,
    centroidLng: -119.42,
    aliases: ["CA"],
  },
  {
    name: "San Francisco, CA",
    country: "USA",
    timezone: "America/Los_Angeles",
    abbrev: "SF",
    colorClasses: "bg-teal-200 text-teal-800",
    pinColor: "#0d9488",
    centroidLat: 37.77,
    centroidLng: -122.42,
  },
  {
    name: "Oakland, CA",
    country: "USA",
    timezone: "America/Los_Angeles",
    abbrev: "OAK",
    colorClasses: "bg-teal-100 text-teal-700",
    pinColor: "#14b8a6",
    centroidLat: 37.8,
    centroidLng: -122.27,
  },
  {
    name: "San Jose, CA",
    country: "USA",
    timezone: "America/Los_Angeles",
    abbrev: "SJ",
    colorClasses: "bg-sky-200 text-sky-800",
    pinColor: "#0284c7",
    centroidLat: 37.34,
    centroidLng: -121.89,
  },
  {
    name: "Marin County, CA",
    country: "USA",
    timezone: "America/Los_Angeles",
    abbrev: "MRN",
    colorClasses: "bg-teal-100 text-teal-700",
    pinColor: "#14b8a6",
    centroidLat: 37.97,
    centroidLng: -122.53,
  },
  {
    name: "San Diego, CA",
    country: "USA",
    timezone: "America/Los_Angeles",
    abbrev: "SD",
    colorClasses: "bg-cyan-100 text-cyan-700",
    pinColor: "#06b6d4",
    centroidLat: 32.72,
    centroidLng: -117.16,
  },
  {
    name: "Santa Cruz, CA",
    country: "USA",
    timezone: "America/Los_Angeles",
    abbrev: "SCZ",
    colorClasses: "bg-teal-100 text-teal-700",
    pinColor: "#14b8a6",
    centroidLat: 36.97,
    centroidLng: -122.03,
    aliases: ["Santa Cruz, California"],
  },
  {
    name: "Los Angeles, CA",
    country: "USA",
    timezone: "America/Los_Angeles",
    abbrev: "LA",
    colorClasses: "bg-teal-200 text-teal-800",
    pinColor: "#0d9488",
    centroidLat: 34.05,
    centroidLng: -118.24,
    aliases: ["Los Angeles, California", "LA"],
  },
  {
    name: "Long Beach, CA",
    country: "USA",
    timezone: "America/Los_Angeles",
    abbrev: "LB",
    colorClasses: "bg-teal-100 text-teal-700",
    pinColor: "#14b8a6",
    centroidLat: 33.77,
    centroidLng: -118.19,
    aliases: ["Long Beach, California"],
  },
  {
    name: "Orange County, CA",
    country: "USA",
    timezone: "America/Los_Angeles",
    abbrev: "OC",
    colorClasses: "bg-teal-200 text-teal-800",
    pinColor: "#0d9488",
    centroidLat: 33.72,
    centroidLng: -117.83,
    aliases: ["Orange County, California", "OC"],
  },
  {
    name: "San Luis Obispo, CA",
    country: "USA",
    timezone: "America/Los_Angeles",
    abbrev: "SLO",
    colorClasses: "bg-teal-100 text-teal-700",
    pinColor: "#14b8a6",
    centroidLat: 35.28,
    centroidLng: -120.66,
    aliases: ["San Luis Obispo, California", "SLO"],
  },
  // ── US Pacific Northwest ──
  {
    name: "Washington",
    country: "USA",
    level: "STATE_PROVINCE",
    timezone: "America/Los_Angeles",
    abbrev: "WA",
    colorClasses: "bg-indigo-200 text-indigo-800",
    pinColor: "#4f46e5",
    centroidLat: 47.75,
    centroidLng: -120.74,
    aliases: ["WA"],
  },
  {
    name: "Seattle, WA",
    country: "USA",
    timezone: "America/Los_Angeles",
    abbrev: "SEA",
    colorClasses: "bg-indigo-200 text-indigo-800",
    pinColor: "#4f46e5",
    centroidLat: 47.61,
    centroidLng: -122.33,
    aliases: ["Washington State", "Seattle, Washington"],
  },
  {
    name: "Tacoma, WA",
    country: "USA",
    timezone: "America/Los_Angeles",
    abbrev: "TAC",
    colorClasses: "bg-indigo-100 text-indigo-700",
    pinColor: "#6366f1",
    centroidLat: 47.25,
    centroidLng: -122.44,
    aliases: ["Tacoma, Washington"],
  },
  {
    name: "Olympia, WA",
    country: "USA",
    timezone: "America/Los_Angeles",
    abbrev: "OLY",
    colorClasses: "bg-indigo-100 text-indigo-700",
    pinColor: "#6366f1",
    centroidLat: 47.04,
    centroidLng: -122.90,
    aliases: ["Olympia, Washington"],
  },
  {
    name: "Bremerton, WA",
    country: "USA",
    timezone: "America/Los_Angeles",
    abbrev: "BRE",
    colorClasses: "bg-indigo-100 text-indigo-700",
    pinColor: "#6366f1",
    centroidLat: 47.57,
    centroidLng: -122.63,
    aliases: ["Bremerton, Washington", "Kitsap County"],
  },
  {
    name: "Oregon",
    country: "USA",
    level: "STATE_PROVINCE",
    timezone: "America/Los_Angeles",
    abbrev: "OR",
    colorClasses: "bg-indigo-100 text-indigo-700",
    pinColor: "#6366f1",
    centroidLat: 44.0,
    centroidLng: -120.5,
    aliases: ["OR"],
  },
  {
    name: "Portland, OR",
    country: "USA",
    timezone: "America/Los_Angeles",
    abbrev: "PDX",
    colorClasses: "bg-indigo-100 text-indigo-700",
    pinColor: "#6366f1",
    centroidLat: 45.52,
    centroidLng: -122.68,
    aliases: ["Portland, Oregon"],
  },
  {
    name: "Salem, OR",
    country: "USA",
    timezone: "America/Los_Angeles",
    abbrev: "SLM",
    colorClasses: "bg-indigo-100 text-indigo-700",
    pinColor: "#6366f1",
    centroidLat: 44.94,
    centroidLng: -123.04,
    aliases: ["Salem, Oregon"],
  },
  {
    name: "Eugene, OR",
    country: "USA",
    timezone: "America/Los_Angeles",
    abbrev: "EUG",
    colorClasses: "bg-indigo-100 text-indigo-700",
    pinColor: "#6366f1",
    centroidLat: 44.05,
    centroidLng: -123.09,
    aliases: ["Eugene, Oregon"],
  },
  {
    name: "Bend, OR",
    country: "USA",
    timezone: "America/Los_Angeles",
    abbrev: "BND",
    colorClasses: "bg-indigo-100 text-indigo-700",
    pinColor: "#6366f1",
    centroidLat: 44.06,
    centroidLng: -121.32,
    aliases: ["Bend, Oregon", "Central Oregon"],
  },
  // ── US Mountain West — Colorado ──
  {
    name: "Colorado",
    country: "USA",
    level: "STATE_PROVINCE",
    timezone: "America/Denver",
    abbrev: "CO",
    colorClasses: "bg-amber-200 text-amber-800",
    pinColor: "#d97706",
    centroidLat: 39.55,
    centroidLng: -105.78,
    aliases: ["CO"],
  },
  {
    name: "Denver, CO",
    country: "USA",
    timezone: "America/Denver",
    abbrev: "DEN",
    colorClasses: "bg-amber-200 text-amber-800",
    pinColor: "#d97706",
    centroidLat: 39.74,
    centroidLng: -104.99,
    aliases: ["Denver, Colorado", "Mile High City"],
  },
  {
    name: "Boulder, CO",
    country: "USA",
    timezone: "America/Denver",
    abbrev: "BLD",
    colorClasses: "bg-amber-100 text-amber-700",
    pinColor: "#f59e0b",
    centroidLat: 40.01,
    centroidLng: -105.27,
    aliases: ["Boulder, Colorado"],
  },
  {
    name: "Fort Collins, CO",
    country: "USA",
    timezone: "America/Denver",
    abbrev: "FTC",
    colorClasses: "bg-amber-100 text-amber-700",
    pinColor: "#f59e0b",
    centroidLat: 40.59,
    centroidLng: -105.08,
    aliases: ["Fort Collins, Colorado"],
  },
  {
    name: "Colorado Springs, CO",
    country: "USA",
    timezone: "America/Denver",
    abbrev: "COS",
    colorClasses: "bg-amber-100 text-amber-700",
    pinColor: "#f59e0b",
    centroidLat: 38.83,
    centroidLng: -104.82,
    aliases: ["Colorado Springs, Colorado", "The Springs"],
  },
  // ── US Texas ──
  {
    name: "Austin, TX",
    country: "USA",
    timezone: "America/Chicago",
    abbrev: "AUS",
    colorClasses: "bg-fuchsia-100 text-fuchsia-700",
    pinColor: "#c026d3",
    centroidLat: 30.27,
    centroidLng: -97.74,
    aliases: ["Austin, Texas"],
  },
  {
    name: "Texas",
    country: "USA",
    level: "STATE_PROVINCE",
    timezone: "America/Chicago",
    abbrev: "TX",
    colorClasses: "bg-gray-200 text-gray-800",
    pinColor: "#6b7280",
    centroidLat: 31.97,
    centroidLng: -99.90,
  },
  {
    name: "Houston, TX",
    country: "USA",
    timezone: "America/Chicago",
    abbrev: "HOU",
    colorClasses: "bg-red-100 text-red-700",
    pinColor: "#ef4444",
    centroidLat: 29.76,
    centroidLng: -95.37,
    aliases: ["Houston, Texas"],
  },
  {
    name: "Dallas-Fort Worth, TX",
    country: "USA",
    timezone: "America/Chicago",
    abbrev: "DFW",
    colorClasses: "bg-purple-100 text-purple-700",
    pinColor: "#9333ea",
    centroidLat: 32.78,
    centroidLng: -96.80,
    aliases: ["Dallas, TX", "Fort Worth, TX", "Dallas-Fort Worth, Texas", "DFW"],
  },
  {
    name: "San Antonio, TX",
    country: "USA",
    timezone: "America/Chicago",
    abbrev: "SAT",
    colorClasses: "bg-orange-100 text-orange-700",
    pinColor: "#f97316",
    centroidLat: 29.42,
    centroidLng: -98.49,
    aliases: ["San Antonio, Texas"],
  },
  {
    name: "Corpus Christi, TX",
    country: "USA",
    timezone: "America/Chicago",
    abbrev: "CC",
    colorClasses: "bg-sky-100 text-sky-700",
    pinColor: "#0ea5e9",
    centroidLat: 27.80,
    centroidLng: -97.40,
    aliases: ["Corpus Christi, Texas"],
  },
  {
    name: "El Paso",
    country: "USA",
    timezone: "America/Denver",
    abbrev: "EPTX",
    colorClasses: "bg-gray-200 text-gray-800",
    pinColor: "#6b7280",
    centroidLat: 31.76,
    centroidLng: -106.49,
    aliases: ["El Paso, TX", "El Paso, Texas"],
  },
  // ── US Midwest ──
  {
    name: "Minnesota",
    country: "USA",
    level: "STATE_PROVINCE",
    timezone: "America/Chicago",
    abbrev: "MN",
    colorClasses: "bg-sky-200 text-sky-800",
    pinColor: "#0284c7",
    centroidLat: 46.73,
    centroidLng: -94.69,
    aliases: ["MN"],
  },
  {
    name: "Minneapolis, MN",
    country: "USA",
    timezone: "America/Chicago",
    abbrev: "MPLS",
    colorClasses: "bg-sky-100 text-sky-700",
    pinColor: "#38bdf8",
    centroidLat: 44.98,
    centroidLng: -93.27,
    aliases: ["Minneapolis, Minnesota", "Twin Cities", "Minneapolis\u2013Saint Paul"],
  },
  {
    name: "Michigan",
    country: "USA",
    level: "STATE_PROVINCE",
    timezone: "America/Detroit",
    abbrev: "MI",
    colorClasses: "bg-sky-200 text-sky-800",
    pinColor: "#0284c7",
    centroidLat: 44.31,
    centroidLng: -85.60,
    aliases: ["MI"],
  },
  {
    name: "Detroit, MI",
    country: "USA",
    timezone: "America/Detroit",
    abbrev: "DET",
    colorClasses: "bg-sky-100 text-sky-700",
    pinColor: "#38bdf8",
    centroidLat: 42.33,
    centroidLng: -83.05,
    aliases: ["Detroit, Michigan", "Metro Detroit"],
  },
  {
    name: "Lansing, MI",
    country: "USA",
    timezone: "America/Detroit",
    abbrev: "LAN",
    colorClasses: "bg-sky-100 text-sky-700",
    pinColor: "#38bdf8",
    centroidLat: 42.73,
    centroidLng: -84.56,
    aliases: ["Lansing, Michigan", "Greater Lansing"],
  },
  // ── US Southwest ──
  {
    name: "Arizona",
    country: "USA",
    level: "STATE_PROVINCE",
    timezone: "America/Phoenix",
    abbrev: "AZ",
    colorClasses: "bg-orange-200 text-orange-800",
    pinColor: "#ea580c",
    centroidLat: 34.05,
    centroidLng: -111.09,
    aliases: ["AZ"],
  },
  {
    name: "Phoenix, AZ",
    country: "USA",
    timezone: "America/Phoenix",
    abbrev: "PHX",
    colorClasses: "bg-orange-200 text-orange-800",
    pinColor: "#ea580c",
    centroidLat: 33.45,
    centroidLng: -112.07,
    aliases: ["Phoenix, Arizona", "Valley of the Sun"],
  },
  {
    name: "Tucson, AZ",
    country: "USA",
    timezone: "America/Phoenix",
    abbrev: "TUS",
    colorClasses: "bg-orange-100 text-orange-700",
    pinColor: "#f97316",
    centroidLat: 32.22,
    centroidLng: -110.97,
    aliases: ["Tucson, Arizona"],
  },
  // ── US Pacific ──
  {
    name: "Hawaii",
    country: "USA",
    level: "STATE_PROVINCE",
    timezone: "Pacific/Honolulu",
    abbrev: "HI",
    colorClasses: "bg-cyan-200 text-cyan-800",
    pinColor: "#0891b2",
    centroidLat: 21.31,
    centroidLng: -157.86,
    aliases: ["HI"],
  },
  {
    name: "Honolulu, HI",
    country: "USA",
    timezone: "Pacific/Honolulu",
    abbrev: "HNL",
    colorClasses: "bg-cyan-100 text-cyan-700",
    pinColor: "#06b6d4",
    centroidLat: 21.31,
    centroidLng: -157.86,
    aliases: ["Honolulu, Hawaii", "Oahu"],
  },
  // ── US Southeast — Florida ──
  {
    name: "Florida",
    country: "USA",
    level: "STATE_PROVINCE",
    timezone: "America/New_York",
    abbrev: "FL",
    colorClasses: "bg-orange-100 text-orange-700",
    pinColor: "#f97316",
    centroidLat: 27.99,
    centroidLng: -81.76,
    aliases: ["FL"],
  },
  {
    name: "Miami, FL",
    country: "USA",
    timezone: "America/New_York",
    abbrev: "MIA",
    colorClasses: "bg-orange-200 text-orange-800",
    pinColor: "#ea580c",
    centroidLat: 25.76,
    centroidLng: -80.19,
    aliases: ["South Florida", "Fort Lauderdale, FL", "Palm Beach, FL"],
  },
  {
    name: "Tampa Bay, FL",
    country: "USA",
    timezone: "America/New_York",
    abbrev: "TPA",
    colorClasses: "bg-lime-200 text-lime-800",
    pinColor: "#65a30d",
    centroidLat: 27.95,
    centroidLng: -82.46,
    aliases: ["Tampa, FL", "St Petersburg, FL", "Sarasota, FL", "Lakeland, FL"],
  },
  {
    name: "Orlando, FL",
    country: "USA",
    timezone: "America/New_York",
    abbrev: "ORL",
    colorClasses: "bg-sky-200 text-sky-800",
    pinColor: "#0284c7",
    centroidLat: 28.54,
    centroidLng: -81.38,
    aliases: ["Central Florida", "Space Coast, FL", "Melbourne, FL", "Gainesville, FL"],
  },
  {
    name: "Jacksonville, FL",
    country: "USA",
    timezone: "America/New_York",
    abbrev: "JAX",
    colorClasses: "bg-violet-200 text-violet-800",
    pinColor: "#7c3aed",
    centroidLat: 30.33,
    centroidLng: -81.66,
    aliases: ["Northeast Florida"],
  },
  {
    name: "Florida Keys",
    country: "USA",
    timezone: "America/New_York",
    abbrev: "KEY",
    colorClasses: "bg-pink-200 text-pink-800",
    pinColor: "#db2777",
    centroidLat: 24.56,
    centroidLng: -81.78,
    aliases: ["Key West, FL"],
  },
  {
    name: "Florida Panhandle",
    country: "USA",
    timezone: "America/Chicago",
    abbrev: "PNH",
    colorClasses: "bg-stone-200 text-stone-800",
    pinColor: "#78716c",
    centroidLat: 30.44,
    centroidLng: -86.65,
    aliases: ["Pensacola, FL", "Fort Walton Beach, FL", "Panama City, FL", "Destin, FL"],
  },
  {
    name: "Daytona Beach, FL",
    country: "USA",
    timezone: "America/New_York",
    abbrev: "DAY",
    colorClasses: "bg-yellow-200 text-yellow-800",
    pinColor: "#ca8a04",
    centroidLat: 29.21,
    centroidLng: -81.02,
  },
  {
    name: "Tallahassee, FL",
    country: "USA",
    timezone: "America/New_York",
    abbrev: "TLH",
    colorClasses: "bg-slate-200 text-slate-800",
    pinColor: "#475569",
    centroidLat: 30.44,
    centroidLng: -84.28,
    aliases: ["Big Bend, FL"],
  },
  // ── Ireland ──
  {
    name: "Ireland",
    country: "IE",
    level: "COUNTRY",
    timezone: "Europe/Dublin",
    abbrev: "IE",
    colorClasses: "bg-emerald-200 text-emerald-800",
    pinColor: "#10b981",
    centroidLat: 53.41,
    centroidLng: -8.24,
    aliases: ["Republic of Ireland"],
  },
  {
    name: "Dublin",
    country: "IE",
    timezone: "Europe/Dublin",
    abbrev: "DUB",
    colorClasses: "bg-emerald-100 text-emerald-700",
    pinColor: "#059669",
    centroidLat: 53.35,
    centroidLng: -6.26,
    aliases: ["Dublin, Ireland"],
  },
  // ── UK ──
  {
    name: "London",
    country: "UK",
    timezone: "Europe/London",
    abbrev: "LDN",
    colorClasses: "bg-rose-200 text-rose-800",
    pinColor: "#e11d48",
    centroidLat: 51.51,
    centroidLng: -0.13,
    aliases: ["London, England", "London, UK"],
  },
  {
    name: "South West London",
    country: "UK",
    timezone: "Europe/London",
    abbrev: "SWL",
    colorClasses: "bg-rose-200 text-rose-800",
    pinColor: "#e11d48",
    centroidLat: 51.46,
    centroidLng: -0.2,
  },
  {
    name: "Surrey",
    country: "UK",
    timezone: "Europe/London",
    abbrev: "SRY",
    colorClasses: "bg-pink-200 text-pink-800",
    pinColor: "#db2777",
    centroidLat: 51.31,
    centroidLng: -0.31,
    aliases: ["Surrey, UK"],
  },
  {
    name: "Old Coulsdon",
    country: "UK",
    timezone: "Europe/London",
    abbrev: "OC",
    colorClasses: "bg-pink-100 text-pink-700",
    pinColor: "#ec4899",
    centroidLat: 51.32,
    centroidLng: -0.1,
  },
  {
    name: "Enfield",
    country: "UK",
    timezone: "Europe/London",
    abbrev: "ENF",
    colorClasses: "bg-pink-100 text-pink-700",
    pinColor: "#ec4899",
    centroidLat: 51.65,
    centroidLng: -0.08,
  },
  {
    name: "Barnes",
    country: "UK",
    timezone: "Europe/London",
    abbrev: "BRN",
    colorClasses: "bg-pink-200 text-pink-800",
    pinColor: "#db2777",
    centroidLat: 51.47,
    centroidLng: -0.25,
  },
  {
    name: "West London",
    country: "UK",
    timezone: "Europe/London",
    abbrev: "WL",
    colorClasses: "bg-rose-100 text-rose-700",
    pinColor: "#f43f5e",
    centroidLat: 51.51,
    centroidLng: -0.27,
  },
  // ── UK — Scotland ──
  {
    name: "Scotland",
    country: "UK",
    level: "STATE_PROVINCE",
    timezone: "Europe/London",
    abbrev: "SCO",
    colorClasses: "bg-blue-200 text-blue-800",
    pinColor: "#2563eb",
    centroidLat: 56.49,
    centroidLng: -4.20,
    aliases: ["Scotland"],
  },
  {
    name: "Edinburgh",
    country: "UK",
    timezone: "Europe/London",
    abbrev: "EDI",
    colorClasses: "bg-blue-100 text-blue-700",
    pinColor: "#3b82f6",
    centroidLat: 55.95,
    centroidLng: -3.19,
    aliases: ["Edinburgh, Scotland"],
  },
  {
    name: "Glasgow",
    country: "UK",
    timezone: "Europe/London",
    abbrev: "GLA",
    colorClasses: "bg-blue-100 text-blue-700",
    pinColor: "#3b82f6",
    centroidLat: 55.86,
    centroidLng: -4.25,
    aliases: ["Glasgow, Scotland"],
  },
  // ── UK — England (outside London) ──
  {
    name: "Bristol",
    country: "UK",
    timezone: "Europe/London",
    abbrev: "BRS",
    colorClasses: "bg-violet-100 text-violet-700",
    pinColor: "#8b5cf6",
    centroidLat: 51.45,
    centroidLng: -2.59,
    aliases: ["Bristol, England"],
  },
  {
    name: "Norfolk",
    country: "UK",
    timezone: "Europe/London",
    abbrev: "NFK",
    colorClasses: "bg-violet-100 text-violet-700",
    pinColor: "#8b5cf6",
    centroidLat: 52.63,
    centroidLng: 1.30,
    aliases: ["Norfolk, England", "Norwich"],
  },
  {
    name: "Liverpool",
    country: "UK",
    timezone: "Europe/London",
    abbrev: "LPL",
    colorClasses: "bg-violet-100 text-violet-700",
    pinColor: "#8b5cf6",
    centroidLat: 53.41,
    centroidLng: -2.98,
    aliases: ["Liverpool, England", "Merseyside"],
  },
  {
    name: "Birmingham",
    country: "UK",
    timezone: "Europe/London",
    abbrev: "BHM",
    colorClasses: "bg-violet-100 text-violet-700",
    pinColor: "#8b5cf6",
    centroidLat: 52.49,
    centroidLng: -1.89,
    aliases: ["Birmingham, England", "West Midlands"],
  },
  // ── Continental Europe — Germany ──
  {
    name: "Germany",
    country: "Germany",
    level: "COUNTRY",
    timezone: "Europe/Berlin",
    abbrev: "DE",
    colorClasses: "bg-yellow-200 text-yellow-800",
    pinColor: "#ca8a04",
    centroidLat: 51.16,
    centroidLng: 10.45,
    aliases: ["Deutschland", "DE"],
  },
  {
    name: "Berlin",
    country: "Germany",
    timezone: "Europe/Berlin",
    abbrev: "BER",
    colorClasses: "bg-yellow-100 text-yellow-700",
    pinColor: "#eab308",
    centroidLat: 52.52,
    centroidLng: 13.41,
    aliases: ["Berlin, Germany"],
  },
  {
    name: "Stuttgart",
    country: "Germany",
    timezone: "Europe/Berlin",
    abbrev: "STR",
    colorClasses: "bg-yellow-100 text-yellow-700",
    pinColor: "#eab308",
    centroidLat: 48.78,
    centroidLng: 9.18,
    aliases: ["Stuttgart, Germany"],
  },
  {
    name: "Munich",
    country: "Germany",
    timezone: "Europe/Berlin",
    abbrev: "MUC",
    colorClasses: "bg-yellow-100 text-yellow-700",
    pinColor: "#eab308",
    centroidLat: 48.14,
    centroidLng: 11.58,
    aliases: ["Munich, Germany", "München"],
  },
  {
    name: "Frankfurt",
    country: "Germany",
    timezone: "Europe/Berlin",
    abbrev: "FRA",
    colorClasses: "bg-yellow-100 text-yellow-700",
    pinColor: "#eab308",
    centroidLat: 50.11,
    centroidLng: 8.68,
    aliases: ["Frankfurt, Germany", "Frankfurt am Main"],
  },
  // ── Japan ──
  {
    name: "Japan",
    country: "Japan",
    level: "COUNTRY",
    timezone: "Asia/Tokyo",
    abbrev: "JP",
    colorClasses: "bg-red-200 text-red-800",
    pinColor: "#dc2626",
    centroidLat: 36.2,
    centroidLng: 138.25,
    aliases: ["JP", "日本"],
  },
  {
    name: "Tokyo",
    country: "Japan",
    timezone: "Asia/Tokyo",
    abbrev: "TYO",
    colorClasses: "bg-red-100 text-red-700",
    pinColor: "#ef4444",
    centroidLat: 35.68,
    centroidLng: 139.77,
    aliases: ["Tokyo, Japan", "東京"],
  },
  {
    name: "Kansai",
    country: "Japan",
    timezone: "Asia/Tokyo",
    abbrev: "KIX",
    colorClasses: "bg-red-100 text-red-700",
    pinColor: "#ef4444",
    centroidLat: 34.69,
    centroidLng: 135.50,
    aliases: ["Kansai, Japan", "Osaka, Japan", "Kyoto, Japan", "Kobe, Japan", "関西"],
  },
  {
    name: "Okinawa",
    country: "Japan",
    timezone: "Asia/Tokyo",
    abbrev: "OKA",
    colorClasses: "bg-red-100 text-red-700",
    pinColor: "#ef4444",
    centroidLat: 26.34,
    centroidLng: 127.77,
    aliases: ["Okinawa, Japan", "沖縄"],
  },
  // ── Belgium ──
  {
    name: "Belgium",
    country: "Belgium",
    level: "COUNTRY",
    timezone: "Europe/Brussels",
    abbrev: "BE",
    colorClasses: "bg-amber-200 text-amber-800",
    pinColor: "#d97706",
    centroidLat: 50.85,
    centroidLng: 4.35,
    aliases: ["BE", "Belgique", "België"],
  },
  {
    name: "Brussels",
    country: "Belgium",
    timezone: "Europe/Brussels",
    abbrev: "BRU",
    colorClasses: "bg-amber-100 text-amber-700",
    pinColor: "#f59e0b",
    centroidLat: 50.85,
    centroidLng: 4.35,
    aliases: ["Brussels, Belgium", "Bruxelles"],
  },
  // ── Louisiana ──
  {
    name: "Louisiana",
    country: "USA",
    level: "STATE_PROVINCE",
    timezone: "America/Chicago",
    abbrev: "LA",
    colorClasses: "bg-purple-100 text-purple-700",
    pinColor: "#9333ea",
    centroidLat: 30.98,
    centroidLng: -91.96,
  },
  {
    name: "New Orleans, LA",
    country: "USA",
    timezone: "America/Chicago",
    abbrev: "NOLA",
    colorClasses: "bg-purple-100 text-purple-700",
    pinColor: "#a855f7",
    centroidLat: 29.95,
    centroidLng: -90.07,
    aliases: ["New Orleans", "NOLA"],
  },
  // ── Tennessee ──
  {
    name: "Tennessee",
    country: "USA",
    level: "STATE_PROVINCE",
    timezone: "America/Chicago",
    abbrev: "TN",
    colorClasses: "bg-violet-100 text-violet-700",
    pinColor: "#7c3aed",
    centroidLat: 35.52,
    centroidLng: -86.58,
    aliases: ["TN"],
  },
  {
    name: "Nashville, TN",
    country: "USA",
    timezone: "America/Chicago",
    abbrev: "NASH",
    colorClasses: "bg-violet-100 text-violet-700",
    pinColor: "#8b5cf6",
    centroidLat: 36.16,
    centroidLng: -86.78,
    aliases: ["Nashville"],
  },
  {
    name: "Memphis, TN",
    country: "USA",
    timezone: "America/Chicago",
    abbrev: "MEM",
    colorClasses: "bg-violet-100 text-violet-700",
    pinColor: "#8b5cf6",
    centroidLat: 35.15,
    centroidLng: -90.05,
    aliases: ["Memphis"],
  },
  {
    name: "Chattanooga, TN",
    country: "USA",
    timezone: "America/New_York",
    abbrev: "CHA",
    colorClasses: "bg-violet-100 text-violet-700",
    pinColor: "#8b5cf6",
    centroidLat: 35.05,
    centroidLng: -85.31,
    aliases: ["Chattanooga"],
  },
  // ── Missouri ──
  {
    name: "Missouri",
    country: "USA",
    level: "STATE_PROVINCE",
    timezone: "America/Chicago",
    abbrev: "MO",
    colorClasses: "bg-emerald-100 text-emerald-700",
    pinColor: "#059669",
    centroidLat: 38.57,
    centroidLng: -92.60,
    aliases: ["MO"],
  },
  {
    name: "Kansas City, MO",
    country: "USA",
    timezone: "America/Chicago",
    abbrev: "KC",
    colorClasses: "bg-emerald-100 text-emerald-700",
    pinColor: "#10b981",
    centroidLat: 39.10,
    centroidLng: -94.58,
    aliases: ["Kansas City"],
  },
  {
    name: "St. Louis, MO",
    country: "USA",
    timezone: "America/Chicago",
    abbrev: "STL",
    colorClasses: "bg-emerald-100 text-emerald-700",
    pinColor: "#10b981",
    centroidLat: 38.63,
    centroidLng: -90.20,
    aliases: ["St. Louis", "Saint Louis"],
  },
  // ── Kansas ──
  {
    name: "Kansas",
    country: "USA",
    level: "STATE_PROVINCE",
    timezone: "America/Chicago",
    abbrev: "KS",
    colorClasses: "bg-lime-100 text-lime-700",
    pinColor: "#65a30d",
    centroidLat: 38.50,
    centroidLng: -98.00,
    aliases: ["KS"],
  },
  {
    name: "Wichita, KS",
    country: "USA",
    timezone: "America/Chicago",
    abbrev: "ICT",
    colorClasses: "bg-lime-100 text-lime-700",
    pinColor: "#84cc16",
    centroidLat: 37.69,
    centroidLng: -97.34,
    aliases: ["Wichita"],
  },
  {
    name: "Lawrence, KS",
    country: "USA",
    timezone: "America/Chicago",
    abbrev: "LWR",
    colorClasses: "bg-lime-100 text-lime-700",
    pinColor: "#84cc16",
    centroidLat: 38.97,
    centroidLng: -95.24,
    aliases: ["Lawrence"],
  },
  // ── Wisconsin ──
  {
    name: "Wisconsin",
    country: "USA",
    level: "STATE_PROVINCE",
    timezone: "America/Chicago",
    abbrev: "WI",
    colorClasses: "bg-red-100 text-red-700",
    pinColor: "#dc2626",
    centroidLat: 44.50,
    centroidLng: -89.50,
    aliases: ["WI"],
  },
  {
    name: "Madison, WI",
    country: "USA",
    timezone: "America/Chicago",
    abbrev: "MSN",
    colorClasses: "bg-red-100 text-red-700",
    pinColor: "#ef4444",
    centroidLat: 43.07,
    centroidLng: -89.40,
    aliases: ["Madison"],
  },
  {
    name: "Milwaukee, WI",
    country: "USA",
    timezone: "America/Chicago",
    abbrev: "MKE",
    colorClasses: "bg-red-100 text-red-700",
    pinColor: "#ef4444",
    centroidLat: 43.04,
    centroidLng: -87.91,
    aliases: ["Milwaukee"],
  },
  // ── New Mexico ──
  {
    name: "New Mexico",
    country: "USA",
    level: "STATE_PROVINCE",
    timezone: "America/Denver",
    abbrev: "NM",
    colorClasses: "bg-amber-100 text-amber-700",
    pinColor: "#d97706",
    centroidLat: 34.52,
    centroidLng: -105.87,
    aliases: ["NM"],
  },
  {
    name: "Albuquerque, NM",
    country: "USA",
    timezone: "America/Denver",
    abbrev: "ABQ",
    colorClasses: "bg-amber-100 text-amber-700",
    pinColor: "#f59e0b",
    centroidLat: 35.08,
    centroidLng: -106.65,
    aliases: ["Albuquerque"],
  },
  // ── Alabama ──
  {
    name: "Alabama",
    country: "USA",
    level: "STATE_PROVINCE",
    timezone: "America/Chicago",
    abbrev: "AL",
    colorClasses: "bg-red-100 text-red-700",
    pinColor: "#dc2626",
    centroidLat: 32.81,
    centroidLng: -86.79,
    aliases: ["AL"],
  },
  {
    name: "Mobile, AL",
    country: "USA",
    timezone: "America/Chicago",
    abbrev: "MOB",
    colorClasses: "bg-red-100 text-red-700",
    pinColor: "#ef4444",
    centroidLat: 30.69,
    centroidLng: -88.04,
    aliases: ["Mobile"],
  },
  {
    name: "Birmingham, AL",
    country: "USA",
    timezone: "America/Chicago",
    abbrev: "BHAM",
    colorClasses: "bg-red-100 text-red-700",
    pinColor: "#ef4444",
    centroidLat: 33.52,
    centroidLng: -86.81,
    aliases: ["Birmingham"],
  },
  {
    name: "Enterprise, AL",
    country: "USA",
    timezone: "America/Chicago",
    abbrev: "ENT",
    colorClasses: "bg-red-100 text-red-700",
    pinColor: "#ef4444",
    centroidLat: 31.32,
    centroidLng: -85.86,
    aliases: ["Enterprise"],
  },
  // ── Indiana ──
  {
    name: "Indiana",
    country: "USA",
    level: "STATE_PROVINCE",
    timezone: "America/Indiana/Indianapolis",
    abbrev: "IN",
    colorClasses: "bg-yellow-100 text-yellow-700",
    pinColor: "#eab308",
    centroidLat: 39.77,
    centroidLng: -86.15,
    aliases: ["IN"],
  },
  {
    name: "Indianapolis, IN",
    country: "USA",
    timezone: "America/Indiana/Indianapolis",
    abbrev: "IND",
    colorClasses: "bg-yellow-100 text-yellow-700",
    pinColor: "#facc15",
    centroidLat: 39.77,
    centroidLng: -86.15,
    aliases: ["Indianapolis", "Indy"],
  },
  {
    name: "Bloomington, IN",
    country: "USA",
    timezone: "America/Indiana/Indianapolis",
    abbrev: "BTN",
    colorClasses: "bg-yellow-100 text-yellow-700",
    pinColor: "#facc15",
    centroidLat: 39.17,
    centroidLng: -86.53,
    aliases: ["Bloomington"],
  },
  // ── West Virginia ──
  {
    name: "West Virginia",
    country: "USA",
    level: "STATE_PROVINCE",
    timezone: "America/New_York",
    abbrev: "WV",
    colorClasses: "bg-lime-100 text-lime-700",
    pinColor: "#84cc16",
    centroidLat: 38.6,
    centroidLng: -80.45,
    aliases: ["WV"],
  },
  {
    name: "Morgantown, WV",
    country: "USA",
    timezone: "America/New_York",
    abbrev: "MGW",
    colorClasses: "bg-lime-100 text-lime-700",
    pinColor: "#a3e635",
    centroidLat: 39.63,
    centroidLng: -79.96,
    aliases: ["Morgantown"],
  },
  // ── Arkansas ──
  {
    name: "Arkansas",
    country: "USA",
    level: "STATE_PROVINCE",
    timezone: "America/Chicago",
    abbrev: "AR",
    colorClasses: "bg-rose-100 text-rose-700",
    pinColor: "#e11d48",
    centroidLat: 34.97,
    centroidLng: -92.37,
    aliases: ["AR"],
  },
  {
    name: "Little Rock, AR",
    country: "USA",
    timezone: "America/Chicago",
    abbrev: "LR",
    colorClasses: "bg-rose-100 text-rose-700",
    pinColor: "#f43f5e",
    centroidLat: 34.75,
    centroidLng: -92.29,
    aliases: ["Little Rock"],
  },
  // ── Canada ──
  {
    name: "Canada",
    country: "Canada",
    level: "COUNTRY",
    timezone: "America/Toronto",
    abbrev: "CA",
    colorClasses: "bg-red-200 text-red-800",
    pinColor: "#dc2626",
    centroidLat: 56.13,
    centroidLng: -106.35,
    aliases: ["CA"],
  },
  // Quebec
  {
    name: "Quebec",
    country: "Canada",
    level: "STATE_PROVINCE",
    timezone: "America/Montreal",
    abbrev: "QC",
    colorClasses: "bg-blue-100 text-blue-700",
    pinColor: "#3b82f6",
    centroidLat: 46.81,
    centroidLng: -71.21,
    aliases: ["QC", "Québec"],
  },
  {
    name: "Montreal, QC",
    country: "Canada",
    timezone: "America/Montreal",
    abbrev: "MTL",
    colorClasses: "bg-blue-100 text-blue-700",
    pinColor: "#60a5fa",
    centroidLat: 45.50,
    centroidLng: -73.57,
    aliases: ["Montreal", "Montréal"],
  },
  // Ontario
  {
    name: "Ontario",
    country: "Canada",
    level: "STATE_PROVINCE",
    timezone: "America/Toronto",
    abbrev: "ON",
    colorClasses: "bg-red-100 text-red-700",
    pinColor: "#ef4444",
    centroidLat: 51.25,
    centroidLng: -85.32,
    aliases: ["ON"],
  },
  {
    name: "Ottawa, ON",
    country: "Canada",
    timezone: "America/Toronto",
    abbrev: "OTT",
    colorClasses: "bg-red-100 text-red-700",
    pinColor: "#f87171",
    centroidLat: 45.42,
    centroidLng: -75.70,
    aliases: ["Ottawa"],
  },
  {
    name: "Toronto, ON",
    country: "Canada",
    timezone: "America/Toronto",
    abbrev: "TOR",
    colorClasses: "bg-red-100 text-red-700",
    pinColor: "#f87171",
    centroidLat: 43.65,
    centroidLng: -79.38,
    aliases: ["Toronto"],
  },
  // Alberta
  {
    name: "Alberta",
    country: "Canada",
    level: "STATE_PROVINCE",
    timezone: "America/Edmonton",
    abbrev: "AB",
    colorClasses: "bg-blue-200 text-blue-800",
    pinColor: "#1d4ed8",
    centroidLat: 53.93,
    centroidLng: -116.58,
    aliases: ["AB"],
  },
  {
    name: "Calgary, AB",
    country: "Canada",
    timezone: "America/Edmonton",
    abbrev: "YYC",
    colorClasses: "bg-blue-100 text-blue-700",
    pinColor: "#60a5fa",
    centroidLat: 51.04,
    centroidLng: -114.07,
    aliases: ["Calgary"],
  },
  {
    name: "Edmonton, AB",
    country: "Canada",
    timezone: "America/Edmonton",
    abbrev: "YEG",
    colorClasses: "bg-blue-100 text-blue-700",
    pinColor: "#60a5fa",
    centroidLat: 53.55,
    centroidLng: -113.49,
    aliases: ["Edmonton"],
  },
  // ── Netherlands ──
  {
    name: "Netherlands",
    country: "Netherlands",
    level: "COUNTRY",
    timezone: "Europe/Amsterdam",
    abbrev: "NL",
    colorClasses: "bg-orange-200 text-orange-800",
    pinColor: "#ea580c",
    centroidLat: 52.13,
    centroidLng: 5.29,
    aliases: ["NL", "Holland", "Nederland"],
  },
  {
    name: "Amsterdam",
    country: "Netherlands",
    timezone: "Europe/Amsterdam",
    abbrev: "AMS",
    colorClasses: "bg-orange-100 text-orange-700",
    pinColor: "#f97316",
    centroidLat: 52.37,
    centroidLng: 4.90,
    aliases: ["Amsterdam, Netherlands"],
  },
  {
    name: "The Hague",
    country: "Netherlands",
    timezone: "Europe/Amsterdam",
    abbrev: "DH",
    colorClasses: "bg-orange-100 text-orange-700",
    pinColor: "#f97316",
    centroidLat: 52.08,
    centroidLng: 4.30,
    aliases: ["The Hague, Netherlands", "Den Haag"],
  },
  // ── Denmark ──
  {
    name: "Denmark",
    country: "Denmark",
    level: "COUNTRY",
    timezone: "Europe/Copenhagen",
    abbrev: "DK",
    colorClasses: "bg-rose-200 text-rose-800",
    pinColor: "#e11d48",
    centroidLat: 56.26,
    centroidLng: 9.50,
    aliases: ["DK", "Danmark"],
  },
  {
    name: "Copenhagen",
    country: "Denmark",
    timezone: "Europe/Copenhagen",
    abbrev: "CPH",
    colorClasses: "bg-rose-100 text-rose-700",
    pinColor: "#fb7185",
    centroidLat: 55.68,
    centroidLng: 12.57,
    aliases: ["Copenhagen, Denmark", "København"],
  },
  // ── Sweden ──
  {
    name: "Sweden",
    country: "Sweden",
    level: "COUNTRY",
    timezone: "Europe/Stockholm",
    abbrev: "SE",
    colorClasses: "bg-sky-200 text-sky-800",
    pinColor: "#0284c7",
    centroidLat: 60.13,
    centroidLng: 18.64,
    aliases: ["SE", "Sverige"],
  },
  {
    name: "Stockholm",
    country: "Sweden",
    timezone: "Europe/Stockholm",
    abbrev: "STO",
    colorClasses: "bg-sky-100 text-sky-700",
    pinColor: "#38bdf8",
    centroidLat: 59.33,
    centroidLng: 18.07,
    aliases: ["Stockholm, Sweden"],
  },
  // ── Norway ──
  {
    name: "Norway",
    country: "Norway",
    level: "COUNTRY",
    timezone: "Europe/Oslo",
    abbrev: "NO",
    colorClasses: "bg-blue-200 text-blue-800",
    pinColor: "#1d4ed8",
    centroidLat: 60.47,
    centroidLng: 8.47,
    aliases: ["NO", "Norge"],
  },
  {
    name: "Oslo",
    country: "Norway",
    timezone: "Europe/Oslo",
    abbrev: "OSL",
    colorClasses: "bg-blue-100 text-blue-700",
    pinColor: "#60a5fa",
    centroidLat: 59.91,
    centroidLng: 10.75,
    aliases: ["Oslo, Norway"],
  },
  // ── Singapore ──
  {
    name: "Singapore",
    country: "Singapore",
    level: "COUNTRY",
    timezone: "Asia/Singapore",
    abbrev: "SG",
    colorClasses: "bg-red-100 text-red-700",
    pinColor: "#dc2626",
    centroidLat: 1.35,
    centroidLng: 103.82,
    aliases: ["SG", "Republic of Singapore"],
  },
  // ── Malaysia — the birthplace of hashing (Mother Hash, KL, 1938) ──
  {
    name: "Malaysia",
    country: "Malaysia",
    level: "COUNTRY",
    timezone: "Asia/Kuala_Lumpur",
    abbrev: "MY",
    colorClasses: "bg-green-100 text-green-700",
    pinColor: "#16a34a",
    centroidLat: 3.14,
    centroidLng: 101.69,
    aliases: ["MY", "Malaysian"],
  },
  {
    name: "Selangor",
    country: "Malaysia",
    level: "STATE_PROVINCE",
    timezone: "Asia/Kuala_Lumpur",
    abbrev: "SGR",
    colorClasses: "bg-green-100 text-green-700",
    pinColor: "#15803d",
    centroidLat: 3.0,
    centroidLng: 101.5,
    aliases: ["Selangor, MY"],
  },
  {
    name: "Penang",
    country: "Malaysia",
    level: "STATE_PROVINCE",
    timezone: "Asia/Kuala_Lumpur",
    abbrev: "PNG",
    colorClasses: "bg-emerald-100 text-emerald-700",
    pinColor: "#047857",
    centroidLat: 5.42,
    centroidLng: 100.33,
    aliases: ["Penang, MY", "Pulau Pinang"],
  },
  {
    // Kuala Lumpur is a Federal Territory — state-equivalent, NOT a
    // metro under Selangor. Selangor surrounds KL but KL itself is
    // administratively separate (like Washington, DC vs Maryland).
    name: "Kuala Lumpur, MY",
    country: "Malaysia",
    level: "STATE_PROVINCE",
    timezone: "Asia/Kuala_Lumpur",
    abbrev: "KL",
    colorClasses: "bg-green-200 text-green-800",
    pinColor: "#166534",
    centroidLat: 3.1390,
    centroidLng: 101.6869,
    aliases: ["Kuala Lumpur", "KL", "Kuala Lumpur, Malaysia", "Federal Territory of Kuala Lumpur"],
  },
  {
    name: "Penang Island, MY",
    country: "Malaysia",
    timezone: "Asia/Kuala_Lumpur",
    abbrev: "PEN",
    colorClasses: "bg-emerald-200 text-emerald-800",
    pinColor: "#065f46",
    centroidLat: 5.4164,
    centroidLng: 100.3327,
    aliases: ["Penang Island", "Penang, Malaysia", "George Town"],
  },
];

// ── Sync fallback map (built from REGION_SEED_DATA at module load) ──

export interface RegionLookup {
  name: string;
  slug: string;
  timezone: string;
  abbrev: string;
  colorClasses: string;
  pinColor: string;
  centroidLat: number | null;
  centroidLng: number | null;
}

/** Generate a slug from a region name. */
export function regionSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[()]/g, "")
    .replace(/[,.\s]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Map from region name (and aliases) to canonical data. */
const REGION_MAP = new Map<string, RegionLookup>();
/** Map from region slug to canonical data. */
const REGION_SLUG_MAP = new Map<string, RegionLookup>();
/** Map from region name (and aliases) to slug — for backward-compat URL migration. */
const REGION_NAME_TO_SLUG = new Map<string, string>();

for (const r of REGION_SEED_DATA) {
  const slug = regionSlug(r.name);
  const entry: RegionLookup = {
    name: r.name,
    slug,
    timezone: r.timezone,
    abbrev: r.abbrev,
    colorClasses: r.colorClasses,
    pinColor: r.pinColor,
    centroidLat: r.centroidLat,
    centroidLng: r.centroidLng,
  };
  REGION_MAP.set(r.name, entry);
  REGION_SLUG_MAP.set(slug, entry);
  REGION_NAME_TO_SLUG.set(r.name, slug);
  if (r.aliases) {
    for (const alias of r.aliases) {
      REGION_MAP.set(alias, entry);
      REGION_NAME_TO_SLUG.set(alias, slug);
    }
  }
}

// ── Lookup helper — checks slug map first, then name map ──

/** Resolve a region key (name, alias, or slug) to its canonical lookup entry. */
function resolveRegion(key: string): RegionLookup | undefined {
  return REGION_SLUG_MAP.get(key) ?? REGION_MAP.get(key);
}

// ── Public lookup functions ──

/** Look up full region data by slug. Returns null for unknown slugs. */
export function regionBySlug(slug: string): RegionLookup | null {
  return REGION_SLUG_MAP.get(slug) ?? null;
}

/** Convert a region name (or alias) to its canonical slug. Returns null for unknown names. */
export function regionNameToSlug(name: string): string | null {
  return REGION_NAME_TO_SLUG.get(name) ?? null;
}

/** All regions as {slug, name, abbrev} tuples — for filter dropdowns. */
export function allRegionOptions(): { slug: string; name: string; abbrev: string }[] {
  return REGION_SEED_DATA.map((r) => ({
    slug: REGION_NAME_TO_SLUG.get(r.name) ?? regionSlug(r.name),
    name: r.name,
    abbrev: r.abbrev,
  }));
}

/** Get the primary IANA timezone for a region string or slug, defaults to America/New_York */
export function regionTimezone(region: string): string {
  const entry = resolveRegion(region);
  if (entry) return entry.timezone;

  // Case-insensitive partial match fallback
  const lc = region.toLowerCase();
  for (const [key, val] of REGION_MAP) {
    const keyLc = key.toLowerCase();
    if (lc.includes(keyLc) || keyLc.includes(lc)) {
      return val.timezone;
    }
  }
  return "America/New_York";
}

/** Short abbreviation for a region. Accepts name, alias, or slug. */
export function regionAbbrev(region: string): string {
  return resolveRegion(region)?.abbrev ?? region;
}

/** Appends dark-mode Tailwind classes to light-mode region color classes.
 *  Expects "bg-{color}-N text-{color}-N" format (no opacity modifiers). */
function withDarkVariants(classes: string): string {
  const bgMatch = classes.match(/bg-(\w+)-\d+/);
  if (!bgMatch) return classes;
  const color = bgMatch[1];
  return `${classes} dark:bg-${color}-900/40 dark:text-${color}-200`;
}

const _darkVariantCache = new Map<string, string>();

/** Tailwind color classes for a region badge. Accepts name, alias, or slug. Falls back to gray. */
export function regionColorClasses(region: string): string {
  const cached = _darkVariantCache.get(region);
  if (cached) return cached;
  const base = resolveRegion(region)?.colorClasses ?? "bg-gray-200 text-gray-800";
  const result = withDarkVariants(base);
  _darkVariantCache.set(region, result);
  return result;
}

/** Tailwind background class only (no text class). Useful for color dots/indicators. */
export function regionBgClass(region: string): string {
  const classes = regionColorClasses(region);
  return classes.split(/\s+/).find(c => c.startsWith("bg-")) ?? "bg-gray-200";
}

/** Hex pin color for a region on maps. Accepts name, alias, or slug. Falls back to gray. */
export function getRegionColor(region: string): string {
  return resolveRegion(region)?.pinColor ?? "#6b7280";
}

/** Parse a hex color string (e.g. "#ff8800") into [r, g, b] components. */
export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/** Region centroid {lat, lng} for map fallback. Accepts name, alias, or slug. */
export function getRegionCentroid(
  region: string,
): { lat: number; lng: number } | null {
  const entry = resolveRegion(region);
  if (entry?.centroidLat != null && entry?.centroidLng != null) {
    return { lat: entry.centroidLat, lng: entry.centroidLng };
  }
  return null;
}

// Build level lookup from seed data (name + aliases → level)
const REGION_NAME_TO_LEVEL = new Map<string, RegionLevel>();
for (const r of REGION_SEED_DATA) {
  REGION_NAME_TO_LEVEL.set(r.name, r.level ?? "METRO");
  if (r.aliases) {
    for (const alias of r.aliases) REGION_NAME_TO_LEVEL.set(alias, r.level ?? "METRO");
  }
}

/** Convert a region name string to a RegionData object using sync fallback maps. */
export function regionNameToData(name: string): RegionData {
  const centroid = getRegionCentroid(name);
  return {
    slug: regionNameToSlug(name) ?? regionSlug(name),
    name,
    abbrev: regionAbbrev(name),
    level: REGION_NAME_TO_LEVEL.get(name) ?? "METRO",
    colorClasses: regionColorClasses(name),
    pinColor: getRegionColor(name),
    centroidLat: centroid?.lat ?? null,
    centroidLng: centroid?.lng ?? null,
  };
}

/** Infer country from region name heuristics. Defaults to "USA". */
export function inferCountry(name: string): string {
  const lower = name.toLowerCase();
  if (/\b(ireland|dublin|cork|galway|limerick)\b/.test(lower)) return "IE";
  if (/\b(uk|england|scotland|wales|london|surrey|sussex)\b/.test(lower)) return "UK";
  if (/\b(australia|sydney|melbourne|brisbane|perth)\b/.test(lower)) return "Australia";
  if (/\b(canada|toronto|vancouver|montreal|calgary|edmonton|ottawa|winnipeg)\b/.test(lower)) return "Canada";
  if (/\b(germany|berlin|munich|münchen|muenchen|hamburg|stuttgart|frankfurt)\b/.test(lower)) return "Germany";
  if (/\b(japan|tokyo|osaka)\b/.test(lower)) return "Japan";
  if (/\b(belgium|brussels|bruxelles|antwerp|ghent)\b/.test(lower)) return "Belgium";
  if (/\b(netherlands|amsterdam|rotterdam|den haag|the hague|holland)\b/.test(lower)) return "Netherlands";
  if (/\b(denmark|copenhagen|københavn|aarhus)\b/.test(lower)) return "Denmark";
  if (/\b(sweden|stockholm|göteborg|gothenburg|malmö)\b/.test(lower)) return "Sweden";
  if (/\b(norway|oslo|bergen|stavanger)\b/.test(lower)) return "Norway";
  if (/\b(singapore)\b/.test(lower)) return "Singapore";
  if (/\b(malaysia|kuala lumpur|\bkl\b|petaling|penang|selangor|johor|sabah|sarawak)\b/.test(lower)) return "Malaysia";
  return "USA";
}

/** Build a short abbreviation from a region name (up to 4 chars). */
export function buildAbbrev(name: string): string {
  const words = name.split(/[\s,]+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
  return words.map((w) => w[0]).join("").toUpperCase().slice(0, 4);
}

/** Default pin color for unknown regions. */
export const DEFAULT_PIN_COLOR = "#6b7280"; // gray-500

// ── State group mapping (region name → display group for /kennels directory) ──

const STATE_GROUP_MAP: Record<string, string> = {
  // D.C. Metro (cross-state corridor)
  "Washington, DC": "D.C. Metro",
  "Northern Virginia": "D.C. Metro",
  "Baltimore, MD": "D.C. Metro",
  "Frederick, MD": "D.C. Metro",
  "Fredericksburg, VA": "D.C. Metro",
  "Southern Maryland": "D.C. Metro",
  "Jefferson County, WV": "D.C. Metro",
  // New York
  "New York City, NY": "New York",
  "Long Island, NY": "New York",
  "Syracuse, NY": "New York",
  "Capital District, NY": "New York",
  "Ithaca, NY": "New York",
  "Rochester, NY": "New York",
  "Buffalo, NY": "New York",
  // New Jersey
  "North NJ": "New Jersey",
  "New Jersey": "New Jersey",
  // Pennsylvania
  "Philadelphia, PA": "Pennsylvania",
  "Pittsburgh, PA": "Pennsylvania",
  "State College, PA": "Pennsylvania",
  "Lehigh Valley, PA": "Pennsylvania",
  "Reading, PA": "Pennsylvania",
  "Harrisburg, PA": "Pennsylvania",
  // Delaware
  "Wilmington, DE": "Delaware",
  // Massachusetts
  "Boston, MA": "Massachusetts",
  "Pioneer Valley, MA": "Massachusetts",
  // New England (state = metro)
  "Vermont": "Vermont",
  "Connecticut": "Connecticut",
  "Rhode Island": "Rhode Island",
  "Portland, ME": "Maine",
  // Virginia (non-DMV)
  "Richmond, VA": "Virginia",
  "Hampton Roads, VA": "Virginia",
  "Charlottesville, VA": "Virginia",
  "Lynchburg, VA": "Virginia",
  // Georgia
  "Atlanta, GA": "Georgia",
  "Savannah, GA": "Georgia",
  "Augusta, GA": "Georgia",
  "Macon, GA": "Georgia",
  "Columbus, GA": "Georgia",
  "Rome, GA": "Georgia",
  // North Carolina
  "Raleigh, NC": "North Carolina",
  "Charlotte, NC": "North Carolina",
  "Asheville, NC": "North Carolina",
  "Wilmington, NC": "North Carolina",
  "Fayetteville, NC": "North Carolina",
  // South Carolina
  "Charleston, SC": "South Carolina",
  "Columbia, SC": "South Carolina",
  "Greenville, SC": "South Carolina",
  "Myrtle Beach, SC": "South Carolina",
  // Florida
  "Miami, FL": "Florida",
  "Tampa Bay, FL": "Florida",
  "Orlando, FL": "Florida",
  "Jacksonville, FL": "Florida",
  "Florida Keys": "Florida",
  "Florida Panhandle": "Florida",
  "Daytona Beach, FL": "Florida",
  "Tallahassee, FL": "Florida",
  // Texas
  "Austin, TX": "Texas",
  "Houston, TX": "Texas",
  "Dallas-Fort Worth, TX": "Texas",
  "San Antonio, TX": "Texas",
  "Corpus Christi, TX": "Texas",
  "El Paso": "Texas",
  // Illinois / Chicagoland
  "Chicago, IL": "Illinois + NW Indiana",
  "South Shore, IN": "Illinois + NW Indiana",
  // California
  "San Francisco, CA": "California",
  "Oakland, CA": "California",
  "San Jose, CA": "California",
  "Marin County, CA": "California",
  "San Diego, CA": "California",
  "Santa Cruz, CA": "California",
  "Los Angeles, CA": "California",
  "Long Beach, CA": "California",
  "Orange County, CA": "California",
  "San Luis Obispo, CA": "California",
  // Ohio
  "Columbus, OH": "Ohio",
  "Cincinnati, OH": "Ohio",
  "Dayton, OH": "Ohio",
  "Cleveland, OH": "Ohio",
  "Akron, OH": "Ohio",
  // Washington
  "Seattle, WA": "Washington",
  "Tacoma, WA": "Washington",
  "Olympia, WA": "Washington",
  "Bremerton, WA": "Washington",
  // Oregon
  "Portland, OR": "Oregon",
  "Salem, OR": "Oregon",
  "Eugene, OR": "Oregon",
  "Bend, OR": "Oregon",
  "Denver, CO": "Colorado",
  "Boulder, CO": "Colorado",
  "Fort Collins, CO": "Colorado",
  "Colorado Springs, CO": "Colorado",
  "Minneapolis, MN": "Minnesota",
  // Michigan
  "Detroit, MI": "Michigan",
  "Lansing, MI": "Michigan",
  // Arizona
  "Phoenix, AZ": "Arizona",
  "Tucson, AZ": "Arizona",
  // Hawaii
  "Honolulu, HI": "Hawaii",
  // United Kingdom
  "London": "United Kingdom",
  "South West London": "United Kingdom",
  "Surrey": "United Kingdom",
  "Old Coulsdon": "United Kingdom",
  "Enfield": "United Kingdom",
  "Barnes": "United Kingdom",
  "West London": "United Kingdom",
  // Scotland
  "Edinburgh": "Scotland",
  "Glasgow": "Scotland",
  // England (outside London)
  "Bristol": "United Kingdom",
  "Norfolk": "United Kingdom",
  "Liverpool": "United Kingdom",
  "Birmingham": "United Kingdom",
  // Ireland
  "Dublin": "Ireland",
  // Germany
  "Berlin": "Germany",
  "Stuttgart": "Germany",
  "Munich": "Germany",
  "Frankfurt": "Germany",
  // Japan
  "Tokyo": "Japan",
  "Kansai": "Japan",
  "Okinawa": "Japan",
  // Belgium
  "Brussels": "Belgium",
  // Louisiana
  "New Orleans, LA": "Louisiana",
  // Tennessee
  "Nashville, TN": "Tennessee",
  "Memphis, TN": "Tennessee",
  "Chattanooga, TN": "Tennessee",
  // Missouri
  "Kansas City, MO": "Missouri",
  "St. Louis, MO": "Missouri",
  // Kansas
  "Wichita, KS": "Kansas",
  "Lawrence, KS": "Kansas",
  // Wisconsin
  "Madison, WI": "Wisconsin",
  "Milwaukee, WI": "Wisconsin",
  // New Mexico
  "Albuquerque, NM": "New Mexico",
  // Alabama
  "Mobile, AL": "Alabama",
  "Birmingham, AL": "Alabama",
  "Enterprise, AL": "Alabama",
  // Indiana
  "Indianapolis, IN": "Indiana",
  "Bloomington, IN": "Indiana",
  // West Virginia
  "Morgantown, WV": "West Virginia",
  // Arkansas
  "Little Rock, AR": "Arkansas",
  // Canada
  "Montreal, QC": "Quebec",
  "Ottawa, ON": "Ontario",
  "Toronto, ON": "Ontario",
  "Calgary, AB": "Alberta",
  "Edmonton, AB": "Alberta",
  // Netherlands
  "Amsterdam": "Netherlands",
  "The Hague": "Netherlands",
  // Denmark
  "Copenhagen": "Denmark",
  // Sweden
  "Stockholm": "Sweden",
  // Norway
  "Oslo": "Norway",
  // Malaysia — Kuala Lumpur is a Federal Territory (state-equivalent),
  // NOT part of Selangor. Penang Island is a metro under Penang state.
  "Kuala Lumpur, MY": "Kuala Lumpur, MY",
  "Penang Island, MY": "Penang",
  "Selangor": "Selangor",
  "Penang": "Penang",
};

/** Get the state/country group for a region name (for kennel directory grouping). */
export function getStateGroup(regionName: string): string {
  return STATE_GROUP_MAP[regionName] ?? regionName;
}

/** Group metro region names by state using STATE_GROUP_MAP. */
export function groupRegionsByState(regions: string[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const region of regions) {
    const state = getStateGroup(region);
    const metros = map.get(state) ?? [];
    metros.push(region);
    map.set(state, metros);
  }
  return map;
}

/** Expand state-level and country-level selections to metro region names. */
export function expandRegionSelections(
  selectedRegions: string[],
  regionsByState: Map<string, string[]>,
): Set<string> {
  const expanded = new Set<string>();
  for (const r of selectedRegions) {
    if (r.startsWith("country:")) {
      const countryName = r.slice(8);
      // Expand to all metros in all states belonging to this country
      for (const [state, metros] of regionsByState) {
        if (getCountryGroup(state) === countryName) {
          for (const m of metros) expanded.add(m);
        }
      }
    } else if (r.startsWith("state:")) {
      const metros = regionsByState.get(r.slice(6)) ?? [];
      for (const m of metros) expanded.add(m);
    } else {
      expanded.add(r);
    }
  }
  return expanded;
}

/** Strip "state:" or "country:" prefix from a region selection key for display. */
export function regionDisplayName(regionKey: string): string {
  if (regionKey.startsWith("state:")) return regionKey.slice(6);
  if (regionKey.startsWith("country:")) return regionKey.slice(8);
  return regionKey;
}

// ── Country group mapping (state group → country for 3-level region hierarchy) ──

const COUNTRY_GROUP_MAP: Record<string, string> = {
  // US states
  "D.C. Metro": "United States",
  "New York": "United States",
  "New Jersey": "United States",
  "Pennsylvania": "United States",
  "Delaware": "United States",
  "Massachusetts": "United States",
  "Vermont": "United States",
  "Connecticut": "United States",
  "Rhode Island": "United States",
  "Maine": "United States",
  "Virginia": "United States",
  "Georgia": "United States",
  "North Carolina": "United States",
  "South Carolina": "United States",
  "Florida": "United States",
  "Texas": "United States",
  "Illinois + NW Indiana": "United States",
  "Illinois": "United States",
  "Maryland": "United States",
  "California": "United States",
  "Ohio": "United States",
  "Washington": "United States",
  "Oregon": "United States",
  "Colorado": "United States",
  "Minnesota": "United States",
  "Michigan": "United States",
  "Arizona": "United States",
  "Hawaii": "United States",
  "Louisiana": "United States",
  "Tennessee": "United States",
  "Missouri": "United States",
  "Kansas": "United States",
  "Wisconsin": "United States",
  "New Mexico": "United States",
  "Alabama": "United States",
  "Indiana": "United States",
  "West Virginia": "United States",
  "Arkansas": "United States",
  // Canada
  "Alberta": "Canada",
  "Ontario": "Canada",
  "Quebec": "Canada",
  // International (state group name = country name)
  "United Kingdom": "United Kingdom",
  "Scotland": "United Kingdom",
  "Ireland": "Ireland",
  "Germany": "Germany",
  "Japan": "Japan",
  "Belgium": "Belgium",
  "Netherlands": "Netherlands",
  "Denmark": "Denmark",
  "Sweden": "Sweden",
  "Norway": "Norway",
  "Singapore": "Singapore",
  // Malaysia — state groups (per feedback_country_group_map memory: both
  // state names AND metro names need explicit entries).
  "Selangor": "Malaysia",
  "Penang": "Malaysia",
  "Kuala Lumpur, MY": "Malaysia",
  "Penang Island, MY": "Malaysia",
};

/** Get the country for a state group name (for 3-level region hierarchy). */
export function getCountryGroup(stateGroup: string): string {
  const country = COUNTRY_GROUP_MAP[stateGroup];
  if (!country && typeof console !== "undefined") {
    console.warn(`[region] Unmapped state group "${stateGroup}" — defaulting to "United States". Add it to COUNTRY_GROUP_MAP.`);
  }
  return country ?? "United States";
}

/** Group metro region names into a 3-level hierarchy: country → state → metros. */
export function groupRegionsByCountry(
  regions: string[],
): Map<string, Map<string, string[]>> {
  const byState = groupRegionsByState(regions);
  const result = new Map<string, Map<string, string[]>>();
  for (const [state, metros] of byState) {
    const country = getCountryGroup(state);
    let stateMap = result.get(country);
    if (!stateMap) {
      stateMap = new Map<string, string[]>();
      result.set(country, stateMap);
    }
    stateMap.set(state, metros);
  }
  return result;
}

/** Map country short codes (from URL params) to full country names. */
const COUNTRY_CODE_TO_NAME: Record<string, string> = {
  USA: "United States",
  US: "United States",
  UK: "United Kingdom",
  GB: "United Kingdom",
  IE: "Ireland",
  DE: "Germany",
  JP: "Japan",
  BE: "Belgium",
  NL: "Netherlands",
  DK: "Denmark",
  SE: "Sweden",
  NO: "Norway",
  AU: "Australia",
  CA: "Canada",
  SG: "Singapore",
  MY: "Malaysia",
};

/** All canonical country names used in COUNTRY_GROUP_MAP values. */
const KNOWN_COUNTRY_NAMES = new Set(Object.values(COUNTRY_GROUP_MAP));

/** Convert a country code or name to the canonical country name used in region selections. */
export function resolveCountryName(codeOrName: string): string | null {
  // Try exact code match first
  const byCode = COUNTRY_CODE_TO_NAME[codeOrName] ?? COUNTRY_CODE_TO_NAME[codeOrName.toUpperCase()];
  if (byCode) return byCode;
  // Fallback: try matching as a full country name (case-insensitive)
  for (const name of KNOWN_COUNTRY_NAMES) {
    if (name.toLowerCase() === codeOrName.toLowerCase()) return name;
  }
  return null;
}

import "dotenv/config";
import { mergeKennels } from "./lib/merge-kennels";

try {
  await mergeKennels({
    sourceShortName: "NYC H3",
    targetShortName: "NYCH3",
  });
} catch (err) {
  console.error("Fatal error:", err);
  process.exit(1);
}

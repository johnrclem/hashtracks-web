import "dotenv/config";
import { mergeKennels } from "./lib/merge-kennels";

mergeKennels({
  sourceShortName: "Brooklyn H3",
  targetShortName: "BrH3",
}).catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

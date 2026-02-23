import "dotenv/config";
import { mergeKennels } from "./lib/merge-kennels";

mergeKennels({
  sourceShortName: "Harriettes (NYC)",
  targetShortName: "Harriettes",
}).catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

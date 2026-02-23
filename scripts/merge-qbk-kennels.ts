import "dotenv/config";
import { mergeKennels } from "./lib/merge-kennels";

try {
  await mergeKennels({
    sourceShortName: "Queens",
    targetShortName: "QBK",
  });
} catch (err) {
  console.error("Fatal error:", err);
  process.exit(1);
}

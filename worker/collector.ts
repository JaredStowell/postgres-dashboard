import type { RuntimeEnv } from "../lib/config/env";
import { collectAll } from "../scripts/collect";

export default {
  async scheduled(
    _controller: ScheduledController,
    env: CloudflareBindings,
    context: ExecutionContext,
  ): Promise<void> {
    context.waitUntil(
      collectAll(env as unknown as RuntimeEnv).then((results) => {
        for (const result of results) {
          console.log(
            JSON.stringify({
              event: "index_analyzer_collection_completed",
              ...result,
            }),
          );
        }
      }),
    );
  },
} satisfies ExportedHandler<CloudflareBindings>;

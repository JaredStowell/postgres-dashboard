// Production Workers adapter around vinext's generated fetch handler. It also
// owns request-scoped PostgreSQL pool cleanup; deploy this entry, not the raw
// generated RSC handler.
import handleRequest from "../dist/server/index.js";
import { AsyncLocalStorage } from "node:async_hooks";

// Initialize the same global lifecycle used by lib/db/client.ts before any
// lazy route chunk can create a PostgreSQL pool. Keeping this adapter free of a
// direct pg import avoids bundling a second database driver copy.
const requestPoolLifecycleKey = Symbol.for(
  "index-analyzer.request-database-pools",
);
const requestPoolLifecycle = (globalThis[requestPoolLifecycleKey] ??= {
  storage: new AsyncLocalStorage(),
});

async function closeScope(scope) {
  if (!scope.closePromise) {
    const pools = [...scope.pools.values()];
    scope.pools.clear();
    scope.closePromise = Promise.allSettled(
      pools.map((pool) => pool.end()),
    ).then(() => undefined);
  }
  await scope.closePromise;
}

async function runWithRequestDatabasePools(operation) {
  const scope = { pools: new Map() };
  try {
    const value = await requestPoolLifecycle.storage.run(scope, operation);
    return { value, close: () => closeScope(scope) };
  } catch (error) {
    await closeScope(scope);
    throw error;
  }
}

function closePoolsWithResponse(response, closePools) {
  if (!response.body) {
    return closePools().then(() => response);
  }
  const reader = response.body.getReader();
  let cleanup;
  const closeOnce = () => (cleanup ??= closePools());
  const body = new ReadableStream({
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (chunk.done) {
          controller.close();
          await closeOnce();
          return;
        }
        controller.enqueue(chunk.value);
      } catch (error) {
        controller.error(error);
        await closeOnce();
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason);
      } finally {
        await closeOnce();
      }
    },
  });
  return new Response(body, response);
}

export default {
  async fetch(request, environment, context) {
    const pathname = new URL(request.url).pathname;
    if (pathname.startsWith("/_next/") && environment.ASSETS) {
      return environment.ASSETS.fetch(request);
    }
    const scoped = await runWithRequestDatabasePools(() =>
      handleRequest(request, context),
    );
    return closePoolsWithResponse(scoped.value, scoped.close);
  },
};

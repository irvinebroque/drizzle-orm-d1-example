# Drizzle ORM D1 benchmark

This Worker compares a query-heavy route across current Cloudflare D1 + Drizzle and the new Drizzle D1 application-object adapter from:

- [irvinebroque/drizzle-orm#1](https://github.com/irvinebroque/drizzle-orm/pull/1)
- [irvinebroque/cloudflare-docs-d1-vnext#7](https://github.com/irvinebroque/cloudflare-docs-d1-vnext/pull/7)

The benchmark route simulates server-side rendering a post page. Each request performs the same 10 logical reads:

1. post
2. author
3. recent posts by the same author
4. comment count
5. latest comments
6. tags
7. previous post by the same author
8. next post by the same author
9. author post count
10. top tags for the same author

## Benchmark Modes

Sequential reads:

- `d1-drizzle-sequential`: current D1 binding with `drizzle-orm/d1`, 10 awaited Drizzle queries.
- `do-drizzle-sequential`: new `drizzle-orm/d1-object` remote Drizzle client, 10 awaited calls to the Durable Object.

Batch / pipeline:

- `d1-drizzle-parallel`: current D1 binding with the same Drizzle queries started together.
- `d1-raw-batch`: current D1 binding with raw [`env.DB.batch()`](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch) as the old-model control case. This mode does not use Drizzle.
- `do-drizzle-pipelined`: new adapter with all 10 Drizzle calls issued before awaiting.

Durable Object method:

- `do-app-method`: one Durable Object RPC method runs the 10 Drizzle queries next to SQLite.

## Programming Model Trade-offs

- `d1-raw-batch` is the fast current-D1 control, but it uses raw [`env.DB.batch()`](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch), prepared SQL strings, and manual result mapping instead of Drizzle.
- `do-drizzle-pipelined` targets the same "send the work together" shape while keeping normal Drizzle selectors and `Promise.all` application code.
- `do-app-method` collapses the route to one Durable Object RPC, but that means the page-data/business logic lives inside the Durable Object class.

The deployed benchmark is available at:

```txt
https://drizzle-orm-d1-benchmark.roundtrip.workers.dev
```

Open that URL for the interactive Kumo UI dashboard. It lets you seed the fixture,
choose benchmark modes, change the post/sample counts, run the comparison in the
browser, and inspect the p50/p95 latency bars plus Durable Object query traces.

The JSON API is still available under `/bench/*`. The old root metadata response
now lives at `/bench/info`.

## Install

The D1 object adapter is not published on npm yet. Build and install the fork tarballs with:

```sh
pnpm run use-drizzle-pr
```

The PR branch guards the new bookmark/read-replication helpers so this demo deploys on the current Cloudflare runtime while still using the adapter's pipelined session shape.

## Run Locally

```sh
pnpm run cf-typegen
pnpm run typecheck
pnpm run dev
```

The dev/deploy/typecheck scripts run `pnpm run build:client` first. That bundles
the React + [Kumo](https://kumo-ui.com/) dashboard from `src/client/*` into
generated Worker assets under `src/generated/*`.

Seed local D1 and the local Durable Object:

```sh
curl -X POST "http://localhost:8787/bench/seed?authors=12&posts=150&comments=900&tags=12"
```

Run a single mode:

```sh
curl "http://localhost:8787/bench/render-post/42?mode=do-drizzle-pipelined"
```

Run the benchmark script:

```sh
pnpm run bench -- --url=http://localhost:8787 --iterations=20 --warmup=3
```

## Deploy

This repo is configured for the D1 database `drizzle-orm-d1-benchmark` and the Worker `drizzle-orm-d1-benchmark`.

```sh
pnpm run dry-run
npx wrangler d1 migrations apply drizzle-orm-d1-benchmark --remote
pnpm run deploy
```

Seed and benchmark the deployed Worker:

```sh
curl -X POST "https://drizzle-orm-d1-benchmark.roundtrip.workers.dev/bench/seed?authors=12&posts=150&comments=900&tags=12"
pnpm run bench -- --url=https://drizzle-orm-d1-benchmark.roundtrip.workers.dev --iterations=20 --warmup=3
```

## Best-practice notes

- Reads use default Durable Object routing so D1 can serve them from replicas when available.
- Benchmark write helpers are marked with `d1PrimaryMethods()` so replica session calls forward to the primary before running application code.
- `createD1ObjectSession()` sends the current bookmark with each method call, waits for it inside the object, serializes calls through one session, and stores the updated bookmark returned by the object.
- `wrangler.jsonc` uses a current compatibility date, `nodejs_compat`, generated Worker types, and Workers Logs plus Traces.
- The example uses one benchmark Durable Object per hostname. In a real app, choose a boundary that spreads write load naturally, such as tenant, organization, site, or user.

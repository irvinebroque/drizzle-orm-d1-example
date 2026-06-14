# Drizzle ORM with D1 application objects

This example uses the new D1 application-object model from the preview work in:

- [irvinebroque/drizzle-orm#1](https://github.com/irvinebroque/drizzle-orm/pull/1)
- [irvinebroque/cloudflare-docs-d1-vnext#3](https://github.com/irvinebroque/cloudflare-docs-d1-vnext/pull/3)

The front Worker does not bind to a D1 database or call `env.DB.prepare()`. It routes each request to a SQLite-backed Durable Object. The `BlogDatabase` object owns the database, creates the Drizzle client with `drizzle(this.ctx, { schema })`, uses `DrizzleD1Object` for D1 runtime setup, and marks write methods with `d1PrimaryMethods()` so session calls forward to the primary before application code runs.

## Status

The `drizzle-orm/d1-object` adapter is not on npm yet. `package.json` points at expected release versions so the example does not accidentally install the older packages that do not include this driver.

To try it before publication, build and install the packages from the fork instead of running `pnpm install` directly:

```sh
pnpm run use-drizzle-pr
```

That script clones `irvinebroque/drizzle-orm`, checks out `d1-object-adapter`, builds `drizzle-orm` and `drizzle-kit`, rewrites the local dependency specs to the generated tarballs, and installs them into this project.

## Project layout

- `src/index.ts` exports the Worker and the `BlogDatabase` Durable Object.
- `src/schema.ts` defines the Drizzle SQLite schema.
- `drizzle.config.ts` uses `driver: "d1-object"` for generated bundled migrations.
- `drizzle/migrations.js` bundles SQL migrations so the object can apply them on the primary.
- `wrangler.jsonc` binds `BLOG_DATABASE` as a SQLite Durable Object and records the Durable Object class migration.

## Run locally

After the adapter is published, install dependencies normally:

```sh
pnpm install
```

Generate Worker binding types after changing `wrangler.jsonc`:

```sh
pnpm run cf-typegen
```

Start the Worker:

```sh
pnpm run dev
```

Create a post:

```sh
curl -i http://localhost:8787/posts \
  -X POST \
  -H "content-type: application/json" \
  --data '{"title":"Hello D1","body":"This row lives in Durable Object SQLite.","authorEmail":"brendan@example.com"}'
```

Copy the `x-d1-bookmark` response header into later reads when you need read-your-writes consistency:

```sh
curl -i http://localhost:8787/posts \
  -H "x-d1-bookmark: <bookmark-from-write-response>"
```

## Migrations

Generate migrations after editing `src/schema.ts`:

```sh
pnpm run generate
```

Apply bundled migrations through an object method. `applyDrizzleMigrations()` forwards to the primary if the method is called on a replica:

```ts
const id = env.BLOG_DATABASE.idFromName("site:example.com");
const db = env.BLOG_DATABASE.get(id);

await db.applyMigrations();
```

Keep this behind a deploy script or authenticated admin workflow. SQL migrations for D1 application objects run inside the primary object; they are separate from Wrangler Durable Object class migrations in `wrangler.jsonc`.

## Best-practice notes

- Reads use default Durable Object routing so D1 can serve them from replicas when available.
- Writes are marked with `d1PrimaryMethods()` so replica session calls forward to the primary before running application code.
- `createD1ObjectSession()` sends the current bookmark with each method call, waits for it inside the object, serializes calls through one session, and stores the updated bookmark returned by the object.
- `wrangler.jsonc` uses a current compatibility date, `nodejs_compat`, generated Worker types, and observability.
- The example uses per-host object names (`site:<hostname>`). In a real app, choose a boundary that spreads write load naturally, such as tenant, organization, site, or user.

import { and, desc, eq, ne, sql } from "drizzle-orm";
import { drizzle as d1Drizzle } from "drizzle-orm/d1";
import {
	createD1ObjectSession,
	d1PrimaryMethods,
	type D1ObjectQueryEvent,
	DrizzleD1Object,
	drizzle as d1ObjectDrizzle,
} from "drizzle-orm/d1-object";

import migrations from "../drizzle/migrations.js";
import clientCss from "./generated/client.css.txt";
import clientJs from "./generated/client.js.txt";
import { type Author, authors, type Post, posts, postTags, tags, comments } from "./schema";
import * as schema from "./schema";

const BOOKMARK_HEADER = "x-d1-bookmark";
const ASSET_HEADERS = {
	"cache-control": "public, max-age=60",
};
const HTML_HEADERS = {
	"content-type": "text/html; charset=utf-8",
};
const JSON_HEADERS = {
	"content-type": "application/json; charset=utf-8",
};
const DEFAULT_POST_ID = 42;
const BENCHMARK_OBJECT_NAME = "bench:default";
const D1_BATCH_CHUNK_SIZE = 500;
const D1_SCHEMA_STATEMENTS = [
	`CREATE TABLE IF NOT EXISTS authors (
		id integer PRIMARY KEY NOT NULL,
		name text NOT NULL,
		email text NOT NULL,
		bio text NOT NULL,
		created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
	)`,
	"CREATE UNIQUE INDEX IF NOT EXISTS authors_email_idx ON authors (email)",
	`CREATE TABLE IF NOT EXISTS posts (
		id integer PRIMARY KEY NOT NULL,
		author_id integer NOT NULL,
		title text NOT NULL,
		body text NOT NULL,
		summary text NOT NULL,
		created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
		updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
		FOREIGN KEY (author_id) REFERENCES authors(id) ON UPDATE no action ON DELETE no action
	)`,
	"CREATE INDEX IF NOT EXISTS posts_author_id_idx ON posts (author_id)",
	"CREATE INDEX IF NOT EXISTS posts_created_at_idx ON posts (created_at)",
	`CREATE TABLE IF NOT EXISTS comments (
		id integer PRIMARY KEY NOT NULL,
		post_id integer NOT NULL,
		author_id integer NOT NULL,
		body text NOT NULL,
		created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
		FOREIGN KEY (post_id) REFERENCES posts(id) ON UPDATE no action ON DELETE no action,
		FOREIGN KEY (author_id) REFERENCES authors(id) ON UPDATE no action ON DELETE no action
	)`,
	"CREATE INDEX IF NOT EXISTS comments_post_created_idx ON comments (post_id, created_at)",
	"CREATE INDEX IF NOT EXISTS comments_author_id_idx ON comments (author_id)",
	`CREATE TABLE IF NOT EXISTS tags (
		id integer PRIMARY KEY NOT NULL,
		slug text NOT NULL,
		name text NOT NULL
	)`,
	"CREATE UNIQUE INDEX IF NOT EXISTS tags_slug_idx ON tags (slug)",
	`CREATE TABLE IF NOT EXISTS post_tags (
		post_id integer NOT NULL,
		tag_id integer NOT NULL,
		PRIMARY KEY(post_id, tag_id),
		FOREIGN KEY (post_id) REFERENCES posts(id) ON UPDATE no action ON DELETE no action,
		FOREIGN KEY (tag_id) REFERENCES tags(id) ON UPDATE no action ON DELETE no action
	)`,
	"CREATE INDEX IF NOT EXISTS post_tags_tag_id_idx ON post_tags (tag_id)",
] as const;

const BENCHMARK_MODES = [
	"d1-drizzle-sequential",
	"d1-drizzle-parallel",
	"d1-raw-batch",
	"do-drizzle-sequential",
	"do-drizzle-pipelined",
	"do-app-method",
] as const;

type BenchmarkMode = typeof BENCHMARK_MODES[number];

type ErrorBody = {
	error: string;
};

type RecentPost = Pick<Post, "authorId" | "createdAt" | "id" | "summary" | "title">;

type LatestComment = {
	id: number;
	postId: number;
	authorId: number;
	authorName: string;
	body: string;
	createdAt: string;
};

type TagSummary = {
	id: number;
	slug: string;
	name: string;
};

type PostPageData = {
	post: Post | null;
	author: Author | null;
	recentPosts: RecentPost[];
	commentCount: number;
	latestComments: LatestComment[];
	tags: TagSummary[];
};

type BenchmarkResult = {
	mode: BenchmarkMode;
	postId: number;
	queryCount: number;
	elapsedMs: number;
	data: PostPageData;
	d1Meta?: D1MetaSummary;
	d1ObjectEvents?: D1ObjectQueryEventSummary[];
	bookmark?: string;
};

type D1MetaSummary = {
	durationMs: number;
	rowsRead: number;
	rowsWritten: number;
	servedBy: string[];
};

type D1ObjectQueryEventSummary = Pick<
	D1ObjectQueryEvent,
	"durationMs" | "forwarded" | "method" | "queryType" | "rowCount" | "rowsRead" | "rowsWritten" | "servedBy"
>;

type SeedOptions = {
	authors: number;
	posts: number;
	comments: number;
	tags: number;
	reset: boolean;
};

type SeedResult = SeedOptions & {
	postTags: number;
};

type AnyDrizzleDatabase = {
	select: (...args: any[]) => any;
};

export class BlogDatabase extends DrizzleD1Object<Env> {
	static override readonly primaryMethods = d1PrimaryMethods<BlogDatabase>()(
		"applyMigrations",
		"seedBenchmarkData",
	);

	db = d1ObjectDrizzle(this.ctx, { schema });

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env, { readReplication: false });
	}

	async renderPostPage(postId: number): Promise<PostPageData> {
		return await readPostPageWithDrizzle(this.db, postId, "sequential");
	}

	async seedBenchmarkData(options: SeedOptions): Promise<SeedResult> {
		await this.applyMigrations();
		return seedD1Object(this.ctx.storage.sql, options);
	}

	applyMigrations() {
		return this.applyDrizzleMigrations(migrations);
	}
}

export default {
	async fetch(request, env): Promise<Response> {
		try {
			return await handleRequest(request, env);
		} catch (error) {
			console.error(JSON.stringify({
				message: "Unhandled request error",
				error: error instanceof Error ? error.message : String(error),
				path: new URL(request.url).pathname,
			}));
			return jsonError("Internal server error", 500);
		}
	},
} satisfies ExportedHandler<Env>;

async function handleRequest(request: Request, env: Env): Promise<Response> {
	const url = new URL(request.url);

	if (request.method === "GET" && url.pathname === "/") {
		return new Response(renderBenchmarkApp(), { headers: HTML_HEADERS });
	}

	if (request.method === "GET" && url.pathname === "/assets/client.css") {
		return new Response(clientCss, {
			headers: {
				...ASSET_HEADERS,
				"content-type": "text/css; charset=utf-8",
			},
		});
	}

	if (request.method === "GET" && url.pathname === "/assets/client.js") {
		return new Response(clientJs, {
			headers: {
				...ASSET_HEADERS,
				"content-type": "text/javascript; charset=utf-8",
			},
		});
	}

	if (request.method === "GET" && url.pathname === "/bench/info") {
		return Response.json(benchmarkInfo());
	}

	if (request.method === "GET" && url.pathname === "/bench/modes") {
		return Response.json({
			modes: BENCHMARK_MODES,
			queryCountPerRender: 6,
			defaultPostId: DEFAULT_POST_ID,
			scenario: benchmarkScenario(),
		});
	}

	if (request.method === "POST" && url.pathname === "/bench/migrate") {
		return migrateBenchmarkStores(request, env);
	}

	if (request.method === "POST" && url.pathname === "/bench/seed") {
		return seedBenchmarkStores(request, env, url);
	}

	const postId = postIdFromRenderPath(url.pathname);
	if (request.method === "GET" && postId !== null) {
		const mode = benchmarkModeFromUrl(url);
		if (mode instanceof Response) {
			return mode;
		}
		const result = await runBenchmarkMode(request, env, mode, postId);
		return jsonWithBookmark(result, result.bookmark);
	}

	if (url.pathname.startsWith("/bench/")) {
		return jsonError("Not found", 404);
	}

	return jsonError("Not found", 404);
}

function renderBenchmarkApp(): string {
	return `<!doctype html>
<html lang="en" data-mode="light">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<title>D1 fan-out benchmark</title>
	<meta name="description" content="Interactive Cloudflare D1 and Drizzle fan-out benchmark">
	<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='12' fill='%23f97316'/%3E%3Cpath d='M18 22h28v20H18zM24 28v8h16v-8z' fill='white'/%3E%3C/svg%3E">
	<link rel="stylesheet" href="/assets/client.css">
</head>
<body>
	<div id="root"></div>
	<script type="module" src="/assets/client.js"></script>
</body>
</html>`;
}

function benchmarkInfo() {
	return {
		name: "drizzle-orm-d1-benchmark",
		defaultPostId: DEFAULT_POST_ID,
		modes: BENCHMARK_MODES,
		queryCountPerRender: 6,
		scenario: benchmarkScenario(),
		endpoints: {
			modes: "/bench/modes",
			migrate: "/bench/migrate",
			seed: "/bench/seed",
			render: `/bench/render-post/${DEFAULT_POST_ID}?mode=do-drizzle-pipelined`,
		},
	};
}

function benchmarkScenario() {
	return {
		route: "server-rendered post page",
		queryCount: 6,
		queries: [
			"post",
			"author",
			"recent posts by the same author",
			"comment count",
			"latest comments",
			"tags",
		],
	};
}

async function migrateBenchmarkStores(request: Request, env: Env): Promise<Response> {
	await ensureD1Schema(env.DB);
	const session = createObjectSession(request, env);
	const d1Object = await session.client.applyMigrations();
	return jsonWithBookmark({
		d1: "schema ensured",
		d1Object,
	}, session.getBookmark());
}

async function seedBenchmarkStores(request: Request, env: Env, url: URL): Promise<Response> {
	const options = seedOptionsFromUrl(url);
	await ensureD1Schema(env.DB);
	const [d1, d1ObjectSession] = await Promise.all([
		seedD1Database(env.DB, options),
		Promise.resolve(createObjectSession(request, env)),
	]);
	const d1Object = await d1ObjectSession.client.seedBenchmarkData(options);
	return jsonWithBookmark({ d1, d1Object }, d1ObjectSession.getBookmark(), 201);
}

async function runBenchmarkMode(
	request: Request,
	env: Env,
	mode: BenchmarkMode,
	postId: number,
): Promise<BenchmarkResult> {
	const startedAt = performance.now();

	if (mode === "d1-raw-batch") {
		const { data, meta } = await readPostPageWithD1Batch(env.DB, postId);
		return {
			mode,
			postId,
			queryCount: 6,
			elapsedMs: elapsed(startedAt),
			data,
			d1Meta: meta,
		};
	}

	if (mode === "d1-drizzle-sequential" || mode === "d1-drizzle-parallel") {
		const db = d1Drizzle(env.DB, { schema });
		const data = await readPostPageWithDrizzle(
			db,
			postId,
			mode === "d1-drizzle-parallel" ? "parallel" : "sequential",
		);
		return {
			mode,
			postId,
			queryCount: 6,
			elapsedMs: elapsed(startedAt),
			data,
		};
	}

	const events: D1ObjectQueryEventSummary[] = [];
	const stub = objectStubForRequest(request, env);
	const db = d1ObjectDrizzle<BlogDatabase, typeof schema>(stub, {
		schema,
		bookmark: request.headers.get(BOOKMARK_HEADER),
		onQuery(event) {
			events.push(summarizeD1ObjectQueryEvent(event));
		},
	});

	if (mode === "do-app-method") {
		const data = await db.d1.client.renderPostPage(postId);
		return withOptionalBookmark({
			mode,
			postId,
			queryCount: 6,
			elapsedMs: elapsed(startedAt),
			data,
		}, db.d1.getBookmark());
	}

	const data = await readPostPageWithDrizzle(
		db,
		postId,
		mode === "do-drizzle-pipelined" ? "parallel" : "sequential",
	);
	return withOptionalBookmark({
		mode,
		postId,
		queryCount: 6,
		elapsedMs: elapsed(startedAt),
		data,
		d1ObjectEvents: events,
	}, db.d1.getBookmark());
}

async function readPostPageWithDrizzle(
	db: AnyDrizzleDatabase,
	postId: number,
	execution: "parallel" | "sequential",
): Promise<PostPageData> {
	if (execution === "parallel") {
		const [post, author, recentPosts, commentCount, latestComments, postTagsList] = await Promise.all([
			selectPost(db, postId),
			selectAuthorForPost(db, postId),
			selectRecentPostsForPostAuthor(db, postId),
			selectCommentCount(db, postId),
			selectLatestComments(db, postId),
			selectTagsForPost(db, postId),
		]);
		return { post, author, recentPosts, commentCount, latestComments, tags: postTagsList };
	}

	const post = await selectPost(db, postId);
	const author = await selectAuthorForPost(db, postId);
	const recentPosts = await selectRecentPostsForPostAuthor(db, postId);
	const commentCount = await selectCommentCount(db, postId);
	const latestComments = await selectLatestComments(db, postId);
	const postTagsList = await selectTagsForPost(db, postId);
	return { post, author, recentPosts, commentCount, latestComments, tags: postTagsList };
}

async function selectPost(db: AnyDrizzleDatabase, postId: number): Promise<Post | null> {
	const row = await db.select().from(posts).where(eq(posts.id, postId)).get();
	return (row ?? null) as Post | null;
}

async function selectAuthorForPost(db: AnyDrizzleDatabase, postId: number): Promise<Author | null> {
	const row = await db.select()
		.from(authors)
		.where(sql`${authors.id} = (select author_id from posts where id = ${postId})`)
		.get();
	return (row ?? null) as Author | null;
}

async function selectRecentPostsForPostAuthor(db: AnyDrizzleDatabase, postId: number): Promise<RecentPost[]> {
	const rows = await db.select({
		id: posts.id,
		authorId: posts.authorId,
		title: posts.title,
		summary: posts.summary,
		createdAt: posts.createdAt,
	})
		.from(posts)
		.where(and(
			sql`${posts.authorId} = (select author_id from posts where id = ${postId})`,
			ne(posts.id, postId),
		))
		.orderBy(desc(posts.createdAt), desc(posts.id))
		.limit(5)
		.all();
	return rows as RecentPost[];
}

async function selectCommentCount(db: AnyDrizzleDatabase, postId: number): Promise<number> {
	const row = await db.select({
		value: sql<number>`cast(count(*) as integer)`,
	})
		.from(comments)
		.where(eq(comments.postId, postId))
		.get();
	return Number(row?.value ?? 0);
}

async function selectLatestComments(db: AnyDrizzleDatabase, postId: number): Promise<LatestComment[]> {
	const rows = await db.select({
		id: comments.id,
		postId: comments.postId,
		authorId: comments.authorId,
		authorName: authors.name,
		body: comments.body,
		createdAt: comments.createdAt,
	})
		.from(comments)
		.innerJoin(authors, eq(comments.authorId, authors.id))
		.where(eq(comments.postId, postId))
		.orderBy(desc(comments.createdAt), desc(comments.id))
		.limit(5)
		.all();
	return rows as LatestComment[];
}

async function selectTagsForPost(db: AnyDrizzleDatabase, postId: number): Promise<TagSummary[]> {
	const rows = await db.select({
		id: tags.id,
		slug: tags.slug,
		name: tags.name,
	})
		.from(tags)
		.innerJoin(postTags, eq(tags.id, postTags.tagId))
		.where(eq(postTags.postId, postId))
		.orderBy(tags.name)
		.all();
	return rows as TagSummary[];
}

async function readPostPageWithD1Batch(
	db: D1Database,
	postId: number,
): Promise<{ data: PostPageData; meta: D1MetaSummary }> {
	const results = await db.batch([
		db.prepare(`
			SELECT id, author_id as authorId, title, body, summary, created_at as createdAt, updated_at as updatedAt
			FROM posts
			WHERE id = ?
		`).bind(postId),
		db.prepare(`
			SELECT id, name, email, bio, created_at as createdAt
			FROM authors
			WHERE id = (SELECT author_id FROM posts WHERE id = ?)
		`).bind(postId),
		db.prepare(`
			SELECT id, author_id as authorId, title, summary, created_at as createdAt
			FROM posts
			WHERE author_id = (SELECT author_id FROM posts WHERE id = ?)
			  AND id <> ?
			ORDER BY created_at DESC, id DESC
			LIMIT 5
		`).bind(postId, postId),
		db.prepare(`
			SELECT cast(count(*) as integer) as value
			FROM comments
			WHERE post_id = ?
		`).bind(postId),
		db.prepare(`
			SELECT comments.id,
			       comments.post_id as postId,
			       comments.author_id as authorId,
			       authors.name as authorName,
			       comments.body,
			       comments.created_at as createdAt
			FROM comments
			INNER JOIN authors ON comments.author_id = authors.id
			WHERE comments.post_id = ?
			ORDER BY comments.created_at DESC, comments.id DESC
			LIMIT 5
		`).bind(postId),
		db.prepare(`
			SELECT tags.id, tags.slug, tags.name
			FROM tags
			INNER JOIN post_tags ON tags.id = post_tags.tag_id
			WHERE post_tags.post_id = ?
			ORDER BY tags.name
		`).bind(postId),
	]);

	const batchResults = results as [D1Result, D1Result, D1Result, D1Result, D1Result, D1Result];
	const [postResult, authorResult, recentResult, countResult, commentsResult, tagsResult] = batchResults;
	return {
		data: {
			post: firstD1Row<Post>(postResult),
			author: firstD1Row<Author>(authorResult),
			recentPosts: d1Rows<RecentPost>(recentResult),
			commentCount: Number(firstD1Row<{ value: number }>(countResult)?.value ?? 0),
			latestComments: d1Rows<LatestComment>(commentsResult),
			tags: d1Rows<TagSummary>(tagsResult),
		},
		meta: summarizeD1Batch(batchResults),
	};
}

async function ensureD1Schema(db: D1Database): Promise<void> {
	for (const statement of D1_SCHEMA_STATEMENTS) {
		await db.prepare(statement).run();
	}
}

async function seedD1Database(db: D1Database, options: SeedOptions): Promise<SeedResult> {
	const fixture = buildSeedFixture(options);

	if (options.reset) {
		await runD1Batch(db, [
			db.prepare("DELETE FROM post_tags"),
			db.prepare("DELETE FROM comments"),
			db.prepare("DELETE FROM posts"),
			db.prepare("DELETE FROM tags"),
			db.prepare("DELETE FROM authors"),
		]);
	}

	await runD1Batch(db, fixture.authors.map((author) =>
		db.prepare("INSERT OR REPLACE INTO authors (id, name, email, bio, created_at) VALUES (?, ?, ?, ?, ?)")
			.bind(author.id, author.name, author.email, author.bio, author.createdAt)
	));
	await runD1Batch(db, fixture.tags.map((tag) =>
		db.prepare("INSERT OR REPLACE INTO tags (id, slug, name) VALUES (?, ?, ?)")
			.bind(tag.id, tag.slug, tag.name)
	));
	await runD1Batch(db, fixture.posts.map((post) =>
		db.prepare(`
			INSERT OR REPLACE INTO posts (id, author_id, title, body, summary, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?)
		`).bind(post.id, post.authorId, post.title, post.body, post.summary, post.createdAt, post.updatedAt)
	));
	await runD1Batch(db, fixture.comments.map((comment) =>
		db.prepare("INSERT OR REPLACE INTO comments (id, post_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?)")
			.bind(comment.id, comment.postId, comment.authorId, comment.body, comment.createdAt)
	));
	await runD1Batch(db, fixture.postTags.map((postTag) =>
		db.prepare("INSERT OR IGNORE INTO post_tags (post_id, tag_id) VALUES (?, ?)")
			.bind(postTag.postId, postTag.tagId)
	));

	return {
		...options,
		postTags: fixture.postTags.length,
	};
}

function seedD1Object(sqlStorage: SqlStorage, options: SeedOptions): SeedResult {
	const fixture = buildSeedFixture(options);

	if (options.reset) {
		sqlStorage.exec("DELETE FROM post_tags");
		sqlStorage.exec("DELETE FROM comments");
		sqlStorage.exec("DELETE FROM posts");
		sqlStorage.exec("DELETE FROM tags");
		sqlStorage.exec("DELETE FROM authors");
	}

	for (const author of fixture.authors) {
		sqlStorage.exec(
			"INSERT OR REPLACE INTO authors (id, name, email, bio, created_at) VALUES (?, ?, ?, ?, ?)",
			author.id,
			author.name,
			author.email,
			author.bio,
			author.createdAt,
		);
	}
	for (const tag of fixture.tags) {
		sqlStorage.exec(
			"INSERT OR REPLACE INTO tags (id, slug, name) VALUES (?, ?, ?)",
			tag.id,
			tag.slug,
			tag.name,
		);
	}
	for (const post of fixture.posts) {
		sqlStorage.exec(
			"INSERT OR REPLACE INTO posts (id, author_id, title, body, summary, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
			post.id,
			post.authorId,
			post.title,
			post.body,
			post.summary,
			post.createdAt,
			post.updatedAt,
		);
	}
	for (const comment of fixture.comments) {
		sqlStorage.exec(
			"INSERT OR REPLACE INTO comments (id, post_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?)",
			comment.id,
			comment.postId,
			comment.authorId,
			comment.body,
			comment.createdAt,
		);
	}
	for (const postTag of fixture.postTags) {
		sqlStorage.exec(
			"INSERT OR IGNORE INTO post_tags (post_id, tag_id) VALUES (?, ?)",
			postTag.postId,
			postTag.tagId,
		);
	}

	return {
		...options,
		postTags: fixture.postTags.length,
	};
}

async function runD1Batch(db: D1Database, statements: D1PreparedStatement[]): Promise<void> {
	for (let index = 0; index < statements.length; index += D1_BATCH_CHUNK_SIZE) {
		await db.batch(statements.slice(index, index + D1_BATCH_CHUNK_SIZE));
	}
}

function buildSeedFixture(options: SeedOptions) {
	const authorRows = Array.from({ length: options.authors }, (_, index) => {
		const id = index + 1;
		return {
			id,
			name: `Author ${id}`,
			email: `author-${id}@example.com`,
			bio: `Author ${id} writes benchmark fixture posts for query fan-out demos.`,
			createdAt: timestampFor(id),
		};
	});

	const tagRows = Array.from({ length: options.tags }, (_, index) => {
		const id = index + 1;
		return {
			id,
			slug: `tag-${id}`,
			name: `Tag ${String(id).padStart(2, "0")}`,
		};
	});

	const postRows = Array.from({ length: options.posts }, (_, index) => {
		const id = index + 1;
		const authorId = ((id - 1) % options.authors) + 1;
		return {
			id,
			authorId,
			title: `Benchmark post ${id}`,
			body: `This is benchmark post ${id}. It has enough text to look like content without dominating response serialization.`,
			summary: `Summary for benchmark post ${id}`,
			createdAt: timestampFor(id),
			updatedAt: timestampFor(id + options.posts),
		};
	});

	const commentRows = Array.from({ length: options.comments }, (_, index) => {
		const id = index + 1;
		const postId = ((id - 1) % options.posts) + 1;
		const authorId = ((id * 7) % options.authors) + 1;
		return {
			id,
			postId,
			authorId,
			body: `Comment ${id} on post ${postId}`,
			createdAt: timestampFor(id + options.posts * 2),
		};
	});

	const postTagRows = [];
	for (let postId = 1; postId <= options.posts; postId++) {
		for (let offset = 0; offset < Math.min(3, options.tags); offset++) {
			postTagRows.push({
				postId,
				tagId: ((postId + offset - 1) % options.tags) + 1,
			});
		}
	}

	return {
		authors: authorRows,
		posts: postRows,
		comments: commentRows,
		tags: tagRows,
		postTags: postTagRows,
	};
}

function timestampFor(index: number): string {
	const date = new Date(Date.UTC(2026, 0, 1, 0, index, 0));
	return date.toISOString();
}

function createObjectSession(request: Request, env: Env) {
	return createD1ObjectSession<BlogDatabase, typeof schema>(objectStubForRequest(request, env), {
		schema,
		bookmark: request.headers.get(BOOKMARK_HEADER),
	});
}

function objectStubForRequest(request: Request, env: Env) {
	const url = new URL(request.url);
	return env.BLOG_DATABASE.getByName(`${BENCHMARK_OBJECT_NAME}:${url.hostname}`);
}

function postIdFromRenderPath(pathname: string): number | null {
	const match = /^\/bench\/render-post\/(\d+)$/.exec(pathname);
	if (!match) {
		return null;
	}
	return Number(match[1]);
}

function benchmarkModeFromUrl(url: URL): BenchmarkMode | Response {
	const value = url.searchParams.get("mode") ?? "do-drizzle-pipelined";
	if (isBenchmarkMode(value)) {
		return value;
	}
	return jsonError(`Unknown benchmark mode '${value}'`, 400);
}

function isBenchmarkMode(value: string): value is BenchmarkMode {
	return (BENCHMARK_MODES as readonly string[]).includes(value);
}

function seedOptionsFromUrl(url: URL): SeedOptions {
	return {
		authors: integerParam(url, "authors", 25, 1, 200),
		posts: integerParam(url, "posts", 150, 1, 5000),
		comments: integerParam(url, "comments", 900, 0, 20000),
		tags: integerParam(url, "tags", 12, 1, 100),
		reset: url.searchParams.get("reset") !== "false",
	};
}

function integerParam(url: URL, name: string, defaultValue: number, min: number, max: number): number {
	const rawValue = url.searchParams.get(name);
	if (rawValue === null) {
		return defaultValue;
	}
	const value = Number(rawValue);
	if (!Number.isInteger(value)) {
		return defaultValue;
	}
	return Math.max(min, Math.min(max, value));
}

function d1Rows<T>(result: D1Result): T[] {
	return (result.results ?? []) as T[];
}

function firstD1Row<T>(result: D1Result): T | null {
	return d1Rows<T>(result)[0] ?? null;
}

function summarizeD1Batch(results: D1Result[]): D1MetaSummary {
	const servedBy = new Set<string>();
	let durationMs = 0;
	let rowsRead = 0;
	let rowsWritten = 0;
	for (const result of results) {
		durationMs += Number(result.meta.duration ?? 0);
		rowsRead += Number(result.meta.rows_read ?? 0);
		rowsWritten += Number(result.meta.rows_written ?? 0);
		if (result.meta.served_by) {
			servedBy.add(String(result.meta.served_by));
		}
	}
	return {
		durationMs,
		rowsRead,
		rowsWritten,
		servedBy: [...servedBy],
	};
}

function summarizeD1ObjectQueryEvent(event: D1ObjectQueryEvent): D1ObjectQueryEventSummary {
	const summary: D1ObjectQueryEventSummary = {
		durationMs: event.durationMs,
		forwarded: event.forwarded,
		method: event.method,
		servedBy: event.servedBy,
	};
	if (event.queryType !== undefined) {
		summary.queryType = event.queryType;
	}
	if (event.rowCount !== undefined) {
		summary.rowCount = event.rowCount;
	}
	if (event.rowsRead !== undefined) {
		summary.rowsRead = event.rowsRead;
	}
	if (event.rowsWritten !== undefined) {
		summary.rowsWritten = event.rowsWritten;
	}
	return summary;
}

function withOptionalBookmark(result: Omit<BenchmarkResult, "bookmark">, bookmark: string | undefined): BenchmarkResult {
	if (!bookmark) {
		return result;
	}
	return {
		...result,
		bookmark,
	};
}

function elapsed(startedAt: number): number {
	return Math.round((performance.now() - startedAt) * 100) / 100;
}

function jsonWithBookmark(body: unknown, bookmark: string | undefined, status = 200): Response {
	const headers = new Headers(JSON_HEADERS);
	if (bookmark) {
		headers.set(BOOKMARK_HEADER, bookmark);
	}

	return Response.json(body, { status, headers });
}

function jsonError(error: string, status: number): Response {
	return jsonWithBookmark({ error } satisfies ErrorBody, undefined, status);
}

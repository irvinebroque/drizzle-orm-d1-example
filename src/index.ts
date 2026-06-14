import { desc, eq } from "drizzle-orm";
import { createD1ObjectSession, d1PrimaryMethods, DrizzleD1Object, drizzle } from "drizzle-orm/d1-object";

import migrations from "../drizzle/migrations.js";
import { type CreatePostInput, type Post, posts } from "./schema";
import * as schema from "./schema";

const BOOKMARK_HEADER = "x-d1-bookmark";
const JSON_HEADERS = {
	"content-type": "application/json; charset=utf-8",
};
const MAX_LIST_LIMIT = 100;

type ListPostsOptions = {
	limit?: number;
};

type ErrorBody = {
	error: string;
};

export class BlogDatabase extends DrizzleD1Object<Env> {
	static override readonly primaryMethods = d1PrimaryMethods<BlogDatabase>()("createPost");

	db = drizzle(this.ctx, { schema });

	listPosts(options: ListPostsOptions = {}): Post[] {
		return this.db
			.select()
			.from(posts)
			.orderBy(desc(posts.createdAt), desc(posts.id))
			.limit(normalizeLimit(options.limit))
			.all();
	}

	getPost(id: number): Post | null {
		if (!Number.isInteger(id) || id < 1) {
			return null;
		}

		return this.db.select().from(posts).where(eq(posts.id, id)).get() ?? null;
	}

	createPost(input: CreatePostInput): Post {
		const post = this.db
			.insert(posts)
			.values(input)
			.returning()
			.get();

		if (!post) {
			throw new Error("Post insert did not return a row");
		}

		return post;
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
		return Response.json({
			name: "drizzle-orm-d1-object-example",
			endpoints: ["/posts", "/posts/:id"],
		});
	}

	if (request.method === "GET" && url.pathname === "/posts") {
		const session = createSession(request, env);
		const postsList = await session.client.listPosts({
			limit: limitFromUrl(url),
		});
		return jsonWithBookmark({ posts: postsList }, session.getBookmark());
	}

	const postId = postIdFromPath(url.pathname);
	if (request.method === "GET" && postId !== null) {
		const session = createSession(request, env);
		const post = await session.client.getPost(postId);

		if (!post) {
			return jsonError("Post not found", 404, session.getBookmark());
		}

		return jsonWithBookmark({ post }, session.getBookmark());
	}

	if (request.method === "POST" && url.pathname === "/posts") {
		const input = await readCreatePostInput(request);
		if (input instanceof Response) {
			return input;
		}

		const session = createSession(request, env);
		const post = await session.client.createPost(input);
		return jsonWithBookmark({ post }, session.getBookmark(), 201);
	}

	if (url.pathname === "/posts" || postId !== null) {
		return jsonError("Method not allowed", 405);
	}

	return jsonError("Not found", 404);
}

function createSession(request: Request, env: Env) {
	const objectName = objectNameForRequest(request);
	const id = env.BLOG_DATABASE.idFromName(objectName);
	const stub = env.BLOG_DATABASE.get(id);
	return createD1ObjectSession<BlogDatabase>(stub, {
		bookmark: request.headers.get(BOOKMARK_HEADER),
	});
}

function objectNameForRequest(request: Request): string {
	return `site:${new URL(request.url).hostname}`;
}

function postIdFromPath(pathname: string): number | null {
	const match = /^\/posts\/(\d+)$/.exec(pathname);
	if (!match) {
		return null;
	}

	return Number(match[1]);
}

function limitFromUrl(url: URL): number {
	const value = url.searchParams.get("limit");
	if (value === null) {
		return 20;
	}

	return normalizeLimit(Number(value));
}

function normalizeLimit(value: number | undefined): number {
	if (value === undefined || !Number.isInteger(value) || value < 1) {
		return 20;
	}

	return Math.min(value, MAX_LIST_LIMIT);
}

async function readCreatePostInput(request: Request): Promise<CreatePostInput | Response> {
	if (!request.headers.get("content-type")?.includes("application/json")) {
		return jsonError("Expected application/json", 415);
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return jsonError("Request body must be valid JSON", 400);
	}

	if (!isRecord(body)) {
		return jsonError("Request body must be a JSON object", 400);
	}

	const title = stringField(body, "title");
	const postBody = stringField(body, "body");
	const authorEmail = stringField(body, "authorEmail");

	if (!title || !postBody || !authorEmail) {
		return jsonError("title, body, and authorEmail are required", 400);
	}

	if (!authorEmail.includes("@")) {
		return jsonError("authorEmail must be an email address", 400);
	}

	return {
		title,
		body: postBody,
		authorEmail,
	};
}

function stringField(body: Record<string, unknown>, key: string): string | null {
	const value = body[key];
	if (typeof value !== "string") {
		return null;
	}

	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonWithBookmark(body: unknown, bookmark: string | undefined, status = 200): Response {
	const headers = new Headers(JSON_HEADERS);
	if (bookmark) {
		headers.set(BOOKMARK_HEADER, bookmark);
	}

	return Response.json(body, { status, headers });
}

function jsonError(error: string, status: number, bookmark?: string): Response {
	return jsonWithBookmark({ error } satisfies ErrorBody, bookmark, status);
}

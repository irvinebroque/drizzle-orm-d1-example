import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const authors = sqliteTable(
	"authors",
	{
		id: integer("id").primaryKey(),
		name: text("name").notNull(),
		email: text("email").notNull(),
		bio: text("bio").notNull(),
		createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [
		uniqueIndex("authors_email_idx").on(table.email),
	],
);

export const posts = sqliteTable(
	"posts",
	{
		id: integer("id").primaryKey(),
		authorId: integer("author_id")
			.notNull()
			.references(() => authors.id),
		title: text("title").notNull(),
		body: text("body").notNull(),
		summary: text("summary").notNull(),
		createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
		updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [
		index("posts_author_id_idx").on(table.authorId),
		index("posts_created_at_idx").on(table.createdAt),
	],
);

export const comments = sqliteTable(
	"comments",
	{
		id: integer("id").primaryKey(),
		postId: integer("post_id")
			.notNull()
			.references(() => posts.id),
		authorId: integer("author_id")
			.notNull()
			.references(() => authors.id),
		body: text("body").notNull(),
		createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [
		index("comments_post_created_idx").on(table.postId, table.createdAt),
		index("comments_author_id_idx").on(table.authorId),
	],
);

export const tags = sqliteTable(
	"tags",
	{
		id: integer("id").primaryKey(),
		slug: text("slug").notNull(),
		name: text("name").notNull(),
	},
	(table) => [
		uniqueIndex("tags_slug_idx").on(table.slug),
	],
);

export const postTags = sqliteTable(
	"post_tags",
	{
		postId: integer("post_id")
			.notNull()
			.references(() => posts.id),
		tagId: integer("tag_id")
			.notNull()
			.references(() => tags.id),
	},
	(table) => [
		primaryKey({ columns: [table.postId, table.tagId] }),
		index("post_tags_tag_id_idx").on(table.tagId),
	],
);

export type Author = typeof authors.$inferSelect;
export type Comment = typeof comments.$inferSelect;
export type Post = typeof posts.$inferSelect;
export type Tag = typeof tags.$inferSelect;

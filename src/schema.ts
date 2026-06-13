import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const posts = sqliteTable(
	"posts",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		title: text("title").notNull(),
		body: text("body").notNull(),
		authorEmail: text("author_email").notNull(),
		createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
		updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [
		index("posts_author_email_idx").on(table.authorEmail),
		index("posts_created_at_idx").on(table.createdAt),
	],
);

export type Post = typeof posts.$inferSelect;
export type CreatePostInput = Pick<typeof posts.$inferInsert, "authorEmail" | "body" | "title">;

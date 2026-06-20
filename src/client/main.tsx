import { Badge } from "@cloudflare/kumo/components/badge";
import { Banner } from "@cloudflare/kumo/components/banner";
import { Button } from "@cloudflare/kumo/components/button";
import { Checkbox } from "@cloudflare/kumo/components/checkbox";
import { Input } from "@cloudflare/kumo/components/input";
import { Table } from "@cloudflare/kumo/components/table";
import { Tabs } from "@cloudflare/kumo/components/tabs";
import { Tooltip, TooltipProvider } from "@cloudflare/kumo/components/tooltip";
import "@cloudflare/kumo/styles/standalone";
import {
	ArrowsClockwise,
	BracketsCurly,
	ChartBar,
	Database,
	Info,
	Play,
	Warning,
} from "@phosphor-icons/react";
import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";

import "./styles.css";

const MODES = [
	"d1-drizzle-sequential",
	"do-drizzle-sequential",
	"d1-drizzle-parallel",
	"d1-raw-batch",
	"do-drizzle-pipelined",
	"do-app-method",
] as const;

type BenchmarkMode = typeof MODES[number];

type BenchmarkInfo = {
	modes: BenchmarkMode[];
	queryCountPerRender: number;
	defaultPostId: number;
	scenario?: {
		queries: string[];
	};
};

type D1MetaSummary = {
	durationMs: number;
	rowsRead: number;
	rowsWritten: number;
	servedBy: string[];
};

type D1ObjectQueryEventSummary = {
	durationMs: number;
	forwarded: boolean;
	method: string;
	queryType: string;
	rowCount: number;
	rowsRead: number;
	rowsWritten: number;
	servedBy: string;
};

type BenchmarkResult = {
	mode: BenchmarkMode;
	postId: number;
	queryCount: number;
	elapsedMs: number;
	d1Meta?: D1MetaSummary;
	d1ObjectEvents?: D1ObjectQueryEventSummary[];
	bookmark?: string;
	data: {
		post: { id: number; title: string; summary: string } | null;
		author: { id: number; name: string } | null;
		authorPostCount: number;
		authorTopTags: unknown[];
		commentCount: number;
		latestComments: unknown[];
		nextPost: { id: number; title: string } | null;
		previousPost: { id: number; title: string } | null;
		recentPosts: unknown[];
		tags: unknown[];
	};
};

type RunSample = {
	workerMs: number;
	httpMs: number;
	result: BenchmarkResult;
};

type ModeRun = {
	error?: string;
	latest?: BenchmarkResult;
	samples: RunSample[];
	state: "idle" | "warming" | "running" | "complete" | "error";
	warmups: number;
};

type ModeDefinition = {
	accent: string;
	badge: "blue" | "green" | "neutral" | "orange" | "purple" | "teal";
	description: React.ReactNode;
	group: "Current D1" | "Durable Object SQLite";
	label: string;
	shortLabel: string;
};

type BannerState = {
	description: string;
	title: string;
	variant: "default" | "alert" | "error" | "secondary";
};

const MODE_DEFINITIONS: Record<BenchmarkMode, ModeDefinition> = {
	"d1-drizzle-sequential": {
		accent: "#c2410c",
		badge: "orange",
		description: "Current D1 binding with 10 awaited Drizzle queries.",
		group: "Current D1",
		label: "D1 + Drizzle sequential",
		shortLabel: "D1 sequential",
	},
	"d1-drizzle-parallel": {
		accent: "#2563eb",
		badge: "blue",
		description: "Current D1 binding with the 10 Drizzle promises started together.",
		group: "Current D1",
		label: "D1 + Drizzle parallel",
		shortLabel: "D1 parallel",
	},
	"d1-raw-batch": {
		accent: "#059669",
		badge: "green",
		description: (
			<>
				Current D1 binding with raw{" "}
				<a
					className="inline-doc-link"
					href="https://developers.cloudflare.com/d1/worker-api/d1-database/#batch"
					rel="noreferrer"
					target="_blank"
				>
					env.DB.batch()
				</a>{" "}
				as an old-model control. This mode does not use Drizzle.
			</>
		),
		group: "Current D1",
		label: "D1 raw batch",
		shortLabel: "D1 batch",
	},
	"do-drizzle-sequential": {
		accent: "#7c3aed",
		badge: "purple",
		description: "New remote Drizzle client, still awaiting each Durable Object call.",
		group: "Durable Object SQLite",
		label: "DO SQLite + Drizzle sequential",
		shortLabel: "DO sequential",
	},
	"do-drizzle-pipelined": {
		accent: "#0d9488",
		badge: "teal",
		description: "New adapter with the same 10 Drizzle calls issued before awaiting.",
		group: "Durable Object SQLite",
		label: "DO SQLite + Drizzle pipelined",
		shortLabel: "DO pipelined",
	},
	"do-app-method": {
		accent: "#475569",
		badge: "neutral",
		description: "One Durable Object RPC method runs all 10 reads next to SQLite.",
		group: "Durable Object SQLite",
		label: "DO app method",
		shortLabel: "DO method",
	},
};

type ComparisonGroup = {
	baseline?: BenchmarkMode;
	description: string;
	modes: BenchmarkMode[];
	title: string;
};

type CodeExample = {
	code: string;
	mode?: BenchmarkMode;
	note: React.ReactNode;
	title: string;
};

type CodeGroup = {
	description: React.ReactNode;
	examples: CodeExample[];
	title: string;
};

const COMPARISON_GROUPS: ComparisonGroup[] = [
	{
		baseline: "d1-drizzle-sequential",
		description: "Make 10 read queries in serial; the method variant runs that fan-out inside the Durable Object.",
		modes: ["d1-drizzle-sequential", "do-drizzle-sequential", "do-app-method"],
		title: "Sequential reads",
	},
	{
		baseline: "d1-drizzle-parallel",
		description: "All 10 reads are issued together.",
		modes: ["d1-drizzle-parallel", "d1-raw-batch", "do-drizzle-pipelined"],
		title: "Batch / pipeline",
	},
];

const CODE_GROUPS: CodeGroup[] = [
	{
		description: "The sequential comparison keeps the page-data fan-out serial and changes where those reads run.",
		examples: [
			{
				code: `const db = drizzle(env.DB, { schema });

const post = await selectPost(db, postId);
const author = await selectAuthorForPost(db, postId);
const recentPosts = await selectRecentPostsForPostAuthor(db, postId);
const commentCount = await selectCommentCount(db, postId);
const latestComments = await selectLatestComments(db, postId);
const tags = await selectTagsForPost(db, postId);
const previousPost = await selectPreviousPostForPostAuthor(db, postId);
const nextPost = await selectNextPostForPostAuthor(db, postId);
const authorPostCount = await selectPostCountForPostAuthor(db, postId);
const authorTopTags = await selectTopTagsForPostAuthor(db, postId);`,
				mode: "d1-drizzle-sequential",
				note: "Current D1 + Drizzle. Simple, but every await waits for the previous round trip.",
				title: "D1 sequential",
			},
			{
				code: `const db = d1ObjectDrizzle(stub, { schema, bookmark });

const post = await selectPost(db, postId);
const author = await selectAuthorForPost(db, postId);
const recentPosts = await selectRecentPostsForPostAuthor(db, postId);
const commentCount = await selectCommentCount(db, postId);
const latestComments = await selectLatestComments(db, postId);
const tags = await selectTagsForPost(db, postId);
const previousPost = await selectPreviousPostForPostAuthor(db, postId);
const nextPost = await selectNextPostForPostAuthor(db, postId);
const authorPostCount = await selectPostCountForPostAuthor(db, postId);
const authorTopTags = await selectTopTagsForPostAuthor(db, postId);`,
				mode: "do-drizzle-sequential",
				note: "Same Drizzle selectors, now sent through the Durable Object SQLite adapter.",
				title: "DO sequential",
			},
			{
				code: `const db = d1ObjectDrizzle<BlogDatabase, typeof schema>(stub, {
	schema,
	bookmark,
});

const data = await db.d1.client.renderPostPage(postId);

export class BlogDatabase extends DrizzleD1Object<Env> {
	db = d1ObjectDrizzle(this.ctx, { schema });

	async renderPostPage(postId: number) {
		return readPostPageWithDrizzle(this.db, postId, "sequential");
	}
}`,
				mode: "do-app-method",
				note: "Still sequential Drizzle reads, but the fan-out is moved into the Durable Object and called with one RPC.",
				title: "DO method",
			},
		],
		title: "Sequential reads",
	},
	{
		description: (
			<>
				The fast current-D1 control is raw{" "}
				<a
					className="inline-doc-link"
					href="https://developers.cloudflare.com/d1/worker-api/d1-database/#batch"
					rel="noreferrer"
					target="_blank"
				>
					env.DB.batch()
				</a>
				; the pipelined adapter keeps the ORM query builder.
			</>
		),
		examples: [
			{
				code: `const db = drizzle(env.DB, { schema });

const [
	post,
	author,
	recentPosts,
	commentCount,
	latestComments,
	tags,
	previousPost,
	nextPost,
	authorPostCount,
	authorTopTags,
] =
	await Promise.all([
		selectPost(db, postId),
		selectAuthorForPost(db, postId),
		selectRecentPostsForPostAuthor(db, postId),
		selectCommentCount(db, postId),
		selectLatestComments(db, postId),
		selectTagsForPost(db, postId),
		selectPreviousPostForPostAuthor(db, postId),
		selectNextPostForPostAuthor(db, postId),
		selectPostCountForPostAuthor(db, postId),
		selectTopTagsForPostAuthor(db, postId),
	]);`,
				mode: "d1-drizzle-parallel",
				note: "The ergonomic current-D1 option: Drizzle queries start together, but each query is still its own D1 request.",
				title: "D1 parallel",
			},
			{
				code: `const results = await env.DB.batch([
	env.DB.prepare("SELECT ... FROM posts WHERE id = ?").bind(postId),
	env.DB.prepare("SELECT ... FROM authors WHERE id = (...)").bind(postId),
	env.DB.prepare("SELECT ... FROM posts WHERE author_id = (...)").bind(postId),
	env.DB.prepare("SELECT cast(count(*) as integer) ...").bind(postId),
	env.DB.prepare("SELECT ... FROM comments INNER JOIN authors ...").bind(postId),
	env.DB.prepare("SELECT ... FROM tags INNER JOIN post_tags ...").bind(postId),
	env.DB.prepare("SELECT previous post ...").bind(postId),
	env.DB.prepare("SELECT next post ...").bind(postId),
	env.DB.prepare("SELECT author post count ...").bind(postId),
	env.DB.prepare("SELECT author top tags ...").bind(postId),
]);

const post = results[0].results?.[0];
const commentCount = results[3].results?.[0]?.value;
const authorTopTags = results[9].results ?? [];`,
				mode: "d1-raw-batch",
				note: "Fast, but it leaves Drizzle: raw SQL strings, manual binding, manual result mapping.",
				title: "D1 raw batch",
			},
			{
				code: `const db = d1ObjectDrizzle(stub, { schema, bookmark });

const [
	post,
	author,
	recentPosts,
	commentCount,
	latestComments,
	tags,
	previousPost,
	nextPost,
	authorPostCount,
	authorTopTags,
] =
	await Promise.all([
		selectPost(db, postId),
		selectAuthorForPost(db, postId),
		selectRecentPostsForPostAuthor(db, postId),
		selectCommentCount(db, postId),
		selectLatestComments(db, postId),
		selectTagsForPost(db, postId),
		selectPreviousPostForPostAuthor(db, postId),
		selectNextPostForPostAuthor(db, postId),
		selectPostCountForPostAuthor(db, postId),
		selectTopTagsForPostAuthor(db, postId),
	]);`,
				mode: "do-drizzle-pipelined",
				note: "The adapter can pipeline the calls while the application code still looks like normal Drizzle.",
				title: "DO pipelined",
			},
		],
		title: "Batch / pipeline",
	},
];

const DEFAULT_QUERIES = [
	"post",
	"author",
	"recent posts by same author",
	"comment count",
	"latest comments",
	"tags",
	"previous post by same author",
	"next post by same author",
	"author post count",
	"top tags for same author",
];

function initialRuns(): Record<BenchmarkMode, ModeRun> {
	const runs = {} as Record<BenchmarkMode, ModeRun>;
	for (const mode of MODES) {
		runs[mode] = { samples: [], state: "idle", warmups: 0 };
	}
	return runs;
}

function orderModes(modes: readonly BenchmarkMode[]): BenchmarkMode[] {
	const selected = new Set(modes);
	return MODES.filter((mode) => selected.has(mode));
}

function App() {
	const [benchmarkInfo, setBenchmarkInfo] = useState<BenchmarkInfo>({
		defaultPostId: 42,
		modes: orderModes(MODES),
		queryCountPerRender: DEFAULT_QUERIES.length,
		scenario: { queries: DEFAULT_QUERIES },
	});
	const [selectedModes, setSelectedModes] = useState<BenchmarkMode[]>(() => orderModes(MODES));
	const [postId, setPostId] = useState("42");
	const [iterations, setIterations] = useState("8");
	const [warmup, setWarmup] = useState("2");
	const [runs, setRuns] = useState<Record<BenchmarkMode, ModeRun>>(() => initialRuns());
	const [activeTab, setActiveTab] = useState("results");
	const [running, setRunning] = useState(false);
	const [seeding, setSeeding] = useState(false);
	const [banner, setBanner] = useState<BannerState | null>(null);
	const [seedOptions, setSeedOptions] = useState({
		authors: "12",
		comments: "900",
		posts: "150",
		tags: "12",
	});

	useEffect(() => {
		let active = true;
		void fetchJson<BenchmarkInfo>("/bench/modes")
			.then((info) => {
				if (!active) {
					return;
				}
				const orderedModes = orderModes(info.modes);
				setBenchmarkInfo({ ...info, modes: orderedModes });
				setPostId(String(info.defaultPostId ?? 42));
				setSelectedModes(orderedModes);
			})
			.catch((error: unknown) => {
				setBanner({
					description: errorMessage(error),
					title: "Could not load benchmark metadata",
					variant: "error",
				});
			});
		return () => {
			active = false;
		};
	}, []);

	const stats = useMemo(() => summarizeRuns(runs), [runs]);
	const availableModes = useMemo(() => orderModes(benchmarkInfo.modes), [benchmarkInfo.modes]);
	const selectedOrderedModes = useMemo(() => orderModes(selectedModes), [selectedModes]);
	const selectedStats = selectedOrderedModes
		.map((mode) => stats[mode])
		.filter((stat): stat is ModeStats => stat !== null);
	const best = selectedStats.reduce<ModeStats | null>((current, stat) => {
		if (!current || stat.p50 < current.p50) {
			return stat;
		}
		return current;
	}, null);

	async function runBenchmark() {
		const parsedPostId = boundedInteger(postId, 1, 10_000, benchmarkInfo.defaultPostId);
		const parsedIterations = boundedInteger(iterations, 1, 50, 8);
		const parsedWarmup = boundedInteger(warmup, 0, 20, 2);
		const modes = selectedOrderedModes.filter((mode) => benchmarkInfo.modes.includes(mode));

		if (modes.length === 0) {
			setBanner({
				description: "Select at least one benchmark mode before running.",
				title: "No modes selected",
				variant: "alert",
			});
			return;
		}

		setRunning(true);
		setBanner({
			description: `${modes.length} modes, ${parsedIterations} measured samples per mode, ${parsedWarmup} warmup requests.`,
			title: "Benchmark running",
			variant: "secondary",
		});
		setRuns((previous) => {
			const next = { ...previous };
			for (const mode of modes) {
				next[mode] = { samples: [], state: parsedWarmup > 0 ? "warming" : "running", warmups: 0 };
			}
			return next;
		});

		try {
			const bookmarks: Partial<Record<BenchmarkMode, string>> = {};
			for (const mode of modes) {
				for (let index = 0; index < parsedWarmup + parsedIterations; index++) {
					const warming = index < parsedWarmup;
					setRuns((previous) => ({
						...previous,
						[mode]: {
							...previous[mode],
							state: warming ? "warming" : "running",
							warmups: Math.min(index + 1, parsedWarmup),
						},
					}));

					const sample = await fetchRender(parsedPostId, mode, bookmarks[mode]);
					if (sample.result.bookmark) {
						bookmarks[mode] = sample.result.bookmark;
					}

					setRuns((previous) => {
						const current = previous[mode];
						return {
							...previous,
							[mode]: {
								...current,
								latest: sample.result,
								samples: warming ? current.samples : [...current.samples, sample],
								state: "running",
							},
						};
					});
				}
				setRuns((previous) => ({
					...previous,
					[mode]: {
						...previous[mode],
						state: "complete",
					},
				}));
			}
			setBanner({
				description: "Results are measured inside the Worker, with browser-observed latency shown as a secondary value.",
				title: "Benchmark complete",
				variant: "default",
			});
		} catch (error: unknown) {
			setBanner({
				description: errorMessage(error),
				title: "Benchmark failed",
				variant: "error",
			});
		} finally {
			setRunning(false);
		}
	}

	async function seedFixture() {
		setSeeding(true);
		setBanner({
			description: "Seeding current D1 and the Durable Object SQLite store with the same fixture.",
			title: "Seeding fixture",
			variant: "secondary",
		});
		try {
			const params = new URLSearchParams({
				authors: String(boundedInteger(seedOptions.authors, 1, 100, 12)),
				comments: String(boundedInteger(seedOptions.comments, 0, 20_000, 900)),
				posts: String(boundedInteger(seedOptions.posts, 1, 5_000, 150)),
				reset: "true",
				tags: String(boundedInteger(seedOptions.tags, 1, 100, 12)),
			});
			await fetchJson(`/bench/seed?${params.toString()}`, { method: "POST" });
			setBanner({
				description: "Both stores now have matching benchmark data. Run the comparison again to refresh the chart.",
				title: "Fixture seeded",
				variant: "default",
			});
		} catch (error: unknown) {
			setBanner({
				description: errorMessage(error),
				title: "Seed failed",
				variant: "error",
			});
		} finally {
			setSeeding(false);
		}
	}

	function clearResults() {
		setRuns(initialRuns());
		setBanner(null);
	}

	function toggleMode(mode: BenchmarkMode, checked: boolean) {
		setSelectedModes((previous) => {
			const next = checked
				? previous.includes(mode) ? previous : [...previous, mode]
				: previous.filter((item) => item !== mode);
			return orderModes(next);
		});
	}

	function showCodeTab() {
		setActiveTab("code");
		document.getElementById("details-title")?.scrollIntoView({ behavior: "smooth", block: "start" });
	}

	return (
		<TooltipProvider>
			<div className="app-shell">
				<header className="app-header">
					<div className="title-block">
						<h1>D1 + Drizzle vs. Durable Objects SQLite + new Drizzle adapter</h1>
						<p>
							Compare current D1 + Drizzle against the Durable Object SQLite adapter, including
							the promise-pipelined path that removes the per-query request waterfall.
						</p>
					</div>
				</header>

				{banner && (
					<Banner
						icon={banner.variant === "error" ? <Warning weight="fill" /> : <Info weight="fill" />}
						title={banner.title}
						description={banner.description}
						variant={banner.variant}
					/>
				)}

				<main className="dashboard-grid">
					<section className="panel controls-panel" aria-labelledby="controls-title">
						<div className="section-heading">
							<div>
								<h2 id="controls-title">Run controls</h2>
							</div>
							<Tooltip
								content="Clear the current samples."
								render={(
									<Button
										aria-label="Clear results"
										disabled={running}
										icon={ArrowsClockwise}
										onClick={clearResults}
										shape="square"
										size="sm"
									/>
								)}
							/>
						</div>

						<div className="control-grid">
							<Input
								inputMode="numeric"
								label="Post ID"
								onChange={(event) => setPostId(event.currentTarget.value)}
								size="sm"
								value={postId}
							/>
							<Input
								inputMode="numeric"
								label="Samples"
								onChange={(event) => setIterations(event.currentTarget.value)}
								size="sm"
								value={iterations}
							/>
							<Input
								inputMode="numeric"
								label="Warmup"
								onChange={(event) => setWarmup(event.currentTarget.value)}
								size="sm"
								value={warmup}
							/>
						</div>

						<div className="button-row">
							<Button
								disabled={selectedModes.length === 0}
								icon={Play}
								loading={running}
								onClick={runBenchmark}
								variant="primary"
							>
								Run benchmark
							</Button>
							<Button icon={Database} loading={seeding} onClick={seedFixture} variant="secondary">
								Seed fixture
							</Button>
						</div>

						<div className="seed-grid" aria-label="Seed fixture sizes">
							<Input
								inputMode="numeric"
								label="Authors"
								onChange={(event) => setSeedOptions({ ...seedOptions, authors: event.currentTarget.value })}
								size="xs"
								value={seedOptions.authors}
							/>
							<Input
								inputMode="numeric"
								label="Posts"
								onChange={(event) => setSeedOptions({ ...seedOptions, posts: event.currentTarget.value })}
								size="xs"
								value={seedOptions.posts}
							/>
							<Input
								inputMode="numeric"
								label="Comments"
								onChange={(event) => setSeedOptions({ ...seedOptions, comments: event.currentTarget.value })}
								size="xs"
								value={seedOptions.comments}
							/>
							<Input
								inputMode="numeric"
								label="Tags"
								onChange={(event) => setSeedOptions({ ...seedOptions, tags: event.currentTarget.value })}
								size="xs"
								value={seedOptions.tags}
							/>
						</div>

						<div className="mode-selector" aria-label="Benchmark modes">
							<div className="mode-selector-title">Modes</div>
							{availableModes.map((mode) => {
								const definition = MODE_DEFINITIONS[mode];
								return (
									<label className="mode-option" key={mode}>
										<Checkbox
											checked={selectedModes.includes(mode)}
											onCheckedChange={(checked) => toggleMode(mode, checked)}
										/>
										<span>
											<span className="mode-option-top">
												<span>{definition.shortLabel}</span>
											</span>
											<small>{definition.description}</small>
										</span>
									</label>
								);
							})}
						</div>
					</section>

					<section className="panel comparison-panel" aria-labelledby="comparison-title">
						<div className="section-heading">
							<div>
								<h2 id="comparison-title">Live comparison</h2>
								<p>Bars use Worker elapsed time p50. Shorter is better.</p>
							</div>
							<div className="heading-actions">
								<Tooltip
									content="Show the code shape for each benchmark mode."
									render={(
										<Button
											icon={BracketsCurly}
											onClick={showCodeTab}
											size="sm"
											variant="secondary"
										>
											Code
										</Button>
									)}
								/>
								<Badge variant={running ? "warning" : best ? "success" : "secondary"}>
									{running ? "Running" : best ? "Ready" : "No samples"}
								</Badge>
							</div>
						</div>

						<PerformanceBars
							modes={selectedOrderedModes}
							runs={runs}
							stats={stats}
						/>
					</section>
				</main>

				<section className="panel details-panel" aria-labelledby="details-title">
					<div className="section-heading details-heading">
						<div>
							<h2 id="details-title">Benchmark detail</h2>
							<p>The same page data is fetched every time; only the query transport changes.</p>
						</div>
						<Tabs
							onValueChange={setActiveTab}
							size="sm"
							tabs={[
								{ label: "Results", value: "results" },
								{ label: "Code", value: "code" },
								{ label: "Trace", value: "trace" },
							]}
							value={activeTab}
							variant="segmented"
						/>
					</div>

					{activeTab === "results" && (
						<ResultsTable
							modes={selectedOrderedModes}
							runs={runs}
							stats={stats}
						/>
					)}
					{activeTab === "code" && <CodeExamples />}
					{activeTab === "trace" && <TraceView runs={runs} />}
				</section>
			</div>
		</TooltipProvider>
	);
}

type ModeStats = {
	avg: number;
	count: number;
	httpP50: number;
	max: number;
	min: number;
	mode: BenchmarkMode;
	p50: number;
	p95: number;
};

function PerformanceBars({
	modes,
	runs,
	stats,
}: {
	modes: BenchmarkMode[];
	runs: Record<BenchmarkMode, ModeRun>;
	stats: Record<BenchmarkMode, ModeStats | null>;
}) {
	const selected = new Set(modes);
	const groups = COMPARISON_GROUPS
		.map((group) => ({
			...group,
			modes: group.modes.filter((mode) => selected.has(mode)),
		}))
		.filter((group) => group.modes.length > 0);
	const max = Math.max(1, ...groups.flatMap((group) => group.modes.map((mode) => stats[mode]?.p50 ?? 0)));
	const hasSamples = groups.some((group) => group.modes.some((mode) => (stats[mode]?.count ?? 0) > 0));

	if (!hasSamples) {
		return (
			<div className="empty-state">
				<ChartBar aria-hidden />
				<h3>No samples yet</h3>
			</div>
		);
	}

	return (
		<div className="bar-chart" role="img" aria-label="Benchmark p50 latency comparison">
			{groups.map((group) => (
				<div className="bar-group" key={group.title}>
					<div className="bar-group-heading">
						<div>
							<h3>{group.title}</h3>
							<p>{group.description}</p>
						</div>
					</div>
					{group.modes.map((mode) => {
						const stat = stats[mode];
						const definition = MODE_DEFINITIONS[mode];
						const width = stat ? Math.max(2, (stat.p50 / max) * 100) : 2;
						return (
							<div className="bar-row" key={mode}>
								<div className="bar-label">
									<strong>{definition.shortLabel}</strong>
									<span>{runs[mode].state}</span>
								</div>
								<div className="bar-track">
									<div
										className="bar-fill"
										style={{
											"--bar-color": definition.accent,
											"--bar-width": `${width}%`,
										} as React.CSSProperties}
									/>
								</div>
								<div className="bar-value">
									<strong>{stat ? formatMs(stat.p50) : "..."}</strong>
									<span>{comparisonLabel(mode, stats)}</span>
								</div>
							</div>
						);
					})}
				</div>
			))}
		</div>
	);
}

function CodeExamples() {
	return (
		<div className="code-model" id="code-shapes">
			{CODE_GROUPS.map((group) => (
				<section className="code-group" key={group.title}>
					<div className="code-group-heading">
						<h3>{group.title}</h3>
						<p>{group.description}</p>
					</div>
					<div className="code-card-grid">
						{group.examples.map((example) => (
							<article className="code-card" key={`${group.title}-${example.title}`}>
								<div className="code-card-header">
									<div>
										<strong>{example.title}</strong>
										<p>{example.note}</p>
									</div>
									{example.mode && (
										<Badge variant={MODE_DEFINITIONS[example.mode].badge}>
											{MODE_DEFINITIONS[example.mode].shortLabel}
										</Badge>
									)}
								</div>
								<pre><code>{example.code}</code></pre>
							</article>
						))}
					</div>
				</section>
			))}
		</div>
	);
}

function ResultsTable({
	modes,
	runs,
	stats,
}: {
	modes: BenchmarkMode[];
	runs: Record<BenchmarkMode, ModeRun>;
	stats: Record<BenchmarkMode, ModeStats | null>;
}) {
	const selected = new Set(modes);
	const groups = COMPARISON_GROUPS
		.map((group) => ({
			...group,
			modes: group.modes.filter((mode) => selected.has(mode)),
		}))
		.filter((group) => group.modes.length > 0);

	return (
		<div className="results-table-stack">
			{groups.map((group) => (
				<section className="results-table-group" key={group.title}>
					<div className="results-table-heading">
						<h3>{group.title}</h3>
						<p>{group.description}</p>
					</div>
					<ResultsTableFrame
						ariaLabel={`${group.title} benchmark results`}
						modes={group.modes}
						runs={runs}
						stats={stats}
					/>
				</section>
			))}
		</div>
	);
}

function ResultsTableFrame({
	ariaLabel,
	modes,
	runs,
	stats,
}: {
	ariaLabel: string;
	modes: BenchmarkMode[];
	runs: Record<BenchmarkMode, ModeRun>;
	stats: Record<BenchmarkMode, ModeStats | null>;
}) {
	return (
		<div className="table-frame" aria-label={ariaLabel}>
			<Table layout="fixed">
				<Table.Header variant="compact">
					<Table.Row>
						<Table.Head>Mode</Table.Head>
						<Table.Head>p50 Worker</Table.Head>
						<Table.Head>p95 Worker</Table.Head>
						<Table.Head>HTTP p50</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{modes.map((mode) => {
						const definition = MODE_DEFINITIONS[mode];
						const stat = stats[mode];
						return (
							<Table.Row key={mode}>
								<Table.Cell>
									<div className="table-mode-name">
										<span className="mode-dot" style={{ background: definition.accent }} />
										{definition.label}
									</div>
								</Table.Cell>
								<Table.Cell>{stat ? formatMs(stat.p50) : statusLabel(runs[mode].state)}</Table.Cell>
								<Table.Cell>{stat ? formatMs(stat.p95) : "-"}</Table.Cell>
								<Table.Cell>{stat ? formatMs(stat.httpP50) : "-"}</Table.Cell>
							</Table.Row>
						);
					})}
				</Table.Body>
			</Table>
		</div>
	);
}

function TraceView({ runs }: { runs: Record<BenchmarkMode, ModeRun> }) {
	const latestWithEvents = MODES
		.map((mode) => runs[mode].latest)
		.filter((result): result is BenchmarkResult => Boolean(result))
		.reverse();
	const eventRows = latestWithEvents.flatMap((result) => {
		if (result.d1ObjectEvents && result.d1ObjectEvents.length > 0) {
			return result.d1ObjectEvents.map((event, index) => ({ event, index, mode: result.mode }));
		}
		if (result.d1Meta) {
			return [{
				event: {
					durationMs: result.d1Meta.durationMs,
					forwarded: false,
					method: "batch",
					queryType: "read",
					rowCount: 0,
					rowsRead: result.d1Meta.rowsRead,
					rowsWritten: result.d1Meta.rowsWritten,
					servedBy: result.d1Meta.servedBy.join(", "),
				},
				index: 0,
				mode: result.mode,
			}];
		}
		return [];
	});
	const latestPage = latestWithEvents[0]?.data;

	return (
		<div className="trace-grid">
			<div className="trace-summary">
				<h3>Latest page payload</h3>
				<dl>
					<div>
						<dt>Post</dt>
						<dd>{latestPage?.post?.title ?? "No result yet"}</dd>
					</div>
					<div>
						<dt>Author</dt>
						<dd>{latestPage?.author?.name ?? "-"}</dd>
					</div>
					<div>
						<dt>Comments</dt>
						<dd>{latestPage?.commentCount ?? "-"}</dd>
					</div>
					<div>
						<dt>Related rows</dt>
						<dd>
							{latestPage
								? `${latestPage.recentPosts.length} recent, ${latestPage.latestComments.length} latest, ${latestPage.tags.length} tags`
								: "-"}
						</dd>
					</div>
					<div>
						<dt>Adjacent</dt>
						<dd>
							{latestPage
								? `${latestPage.previousPost?.title ?? "none"} / ${latestPage.nextPost?.title ?? "none"}`
								: "-"}
						</dd>
					</div>
					<div>
						<dt>Author scope</dt>
						<dd>
							{latestPage
								? `${latestPage.authorPostCount} posts, ${latestPage.authorTopTags.length} top tags`
								: "-"}
						</dd>
					</div>
				</dl>
			</div>
			<div className="table-frame">
				<Table layout="fixed">
					<Table.Header variant="compact">
						<Table.Row>
							<Table.Head>Mode</Table.Head>
							<Table.Head>Call</Table.Head>
							<Table.Head>Type</Table.Head>
							<Table.Head>Duration</Table.Head>
							<Table.Head>Rows read</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{eventRows.length === 0 ? (
							<Table.Row>
								<Table.Cell colSpan={5}>
									Run a DO mode or raw{" "}
									<a
										className="inline-doc-link"
										href="https://developers.cloudflare.com/d1/worker-api/d1-database/#batch"
										rel="noreferrer"
										target="_blank"
									>
										D1 batch API
									</a>{" "}
									mode to see per-call trace data.
								</Table.Cell>
							</Table.Row>
						) : eventRows.map(({ event, index, mode }) => (
							<Table.Row key={`${mode}-${index}`}>
								<Table.Cell>{MODE_DEFINITIONS[mode].shortLabel}</Table.Cell>
								<Table.Cell>{event.method}</Table.Cell>
								<Table.Cell>{event.queryType}</Table.Cell>
								<Table.Cell>{formatMs(event.durationMs)}</Table.Cell>
								<Table.Cell>{event.rowsRead}</Table.Cell>
							</Table.Row>
						))}
					</Table.Body>
				</Table>
			</div>
		</div>
	);
}

async function fetchRender(postId: number, mode: BenchmarkMode, bookmark?: string): Promise<RunSample> {
	const startedAt = performance.now();
	const init: RequestInit = bookmark ? { headers: { "x-d1-bookmark": bookmark } } : {};
	const result = await fetchJson<BenchmarkResult>(`/bench/render-post/${postId}?mode=${mode}`, init);
	return {
		httpMs: performance.now() - startedAt,
		result,
		workerMs: result.elapsedMs,
	};
}

async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
	const response = await fetch(input, init);
	const body = await response.json().catch(() => null) as unknown;
	if (!response.ok) {
		const error = body && typeof body === "object" && "error" in body
			? String((body as { error: unknown }).error)
			: `HTTP ${response.status}`;
		throw new Error(error);
	}
	return body as T;
}

function summarizeRuns(runs: Record<BenchmarkMode, ModeRun>): Record<BenchmarkMode, ModeStats | null> {
	return Object.fromEntries(MODES.map((mode) => {
		const samples = runs[mode].samples;
		if (samples.length === 0) {
			return [mode, null];
		}
		const workerValues = samples.map((sample) => sample.workerMs).sort((a, b) => a - b);
		const httpValues = samples.map((sample) => sample.httpMs).sort((a, b) => a - b);
		return [mode, {
			avg: mean(workerValues),
			count: workerValues.length,
			httpP50: percentile(httpValues, 50),
			max: workerValues[workerValues.length - 1] ?? 0,
			min: workerValues[0] ?? 0,
			mode,
			p50: percentile(workerValues, 50),
			p95: percentile(workerValues, 95),
		}];
	})) as Record<BenchmarkMode, ModeStats | null>;
}

function boundedInteger(value: string, min: number, max: number, fallback: number): number {
	const parsed = Number(value);
	if (!Number.isInteger(parsed)) {
		return fallback;
	}
	return Math.min(max, Math.max(min, parsed));
}

function formatMs(value: number): string {
	if (!Number.isFinite(value)) {
		return "-";
	}
	return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} ms`;
}

function formatMultiplier(value: number): string {
	const rounded = value >= 10 ? value.toFixed(1) : value.toFixed(2);
	return `${rounded.replace(/\.?0+$/, "")}x`;
}

function comparisonBaselineForMode(mode: BenchmarkMode): BenchmarkMode | undefined {
	for (const group of COMPARISON_GROUPS) {
		if (group.modes.includes(mode)) {
			return group.baseline;
		}
	}
	return undefined;
}

function comparisonLabel(mode: BenchmarkMode, stats: Record<BenchmarkMode, ModeStats | null>): string {
	const baselineMode = comparisonBaselineForMode(mode);
	if (!baselineMode) {
		return "standalone";
	}
	if (baselineMode === mode) {
		return "baseline";
	}
	const baseline = stats[baselineMode];
	const compared = stats[mode];
	const target = comparisonTargetLabel(baselineMode);
	if (!baseline || !compared) {
		return `vs ${target}`;
	}
	const speedup = baseline.p50 / compared.p50;
	if (!Number.isFinite(speedup) || speedup <= 0) {
		return `vs ${target}`;
	}
	if (speedup === 1) {
		return `same as ${target}`;
	}
	if (speedup > 1) {
		return `${formatMultiplier(speedup)} faster than ${target}`;
	}
	return `${formatMultiplier(1 / speedup)} slower than ${target}`;
}

function comparisonTargetLabel(mode: BenchmarkMode): string {
	return MODE_DEFINITIONS[mode].group === "Current D1" ? "D1" : MODE_DEFINITIONS[mode].shortLabel;
}

function mean(values: number[]): number {
	return values.reduce((total, value) => total + value, 0) / values.length;
}

function percentile(values: number[], percentileValue: number): number {
	const index = Math.min(values.length - 1, Math.ceil((percentileValue / 100) * values.length) - 1);
	return values[index] ?? 0;
}

function statusLabel(state: ModeRun["state"]): string {
	if (state === "warming") {
		return "warming";
	}
	if (state === "running") {
		return "running";
	}
	return "-";
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

createRoot(document.getElementById("root") as HTMLElement).render(
	<StrictMode>
		<App />
	</StrictMode>,
);

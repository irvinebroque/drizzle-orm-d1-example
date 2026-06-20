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
	CheckCircle,
	Clock,
	Database,
	GitBranch,
	Info,
	Lightning,
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
		commentCount: number;
		latestComments: unknown[];
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
	implementation: "app-method" | "drizzle" | "raw-batch";
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
		description: "Current D1 binding with six awaited Drizzle queries.",
		group: "Current D1",
		implementation: "drizzle",
		label: "D1 + Drizzle sequential",
		shortLabel: "D1 sequential",
	},
	"d1-drizzle-parallel": {
		accent: "#2563eb",
		badge: "blue",
		description: "Current D1 binding with the six Drizzle promises started together.",
		group: "Current D1",
		implementation: "drizzle",
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
		implementation: "raw-batch",
		label: "D1 raw batch",
		shortLabel: "D1 batch",
	},
	"do-drizzle-sequential": {
		accent: "#7c3aed",
		badge: "purple",
		description: "New remote Drizzle client, still awaiting each Durable Object call.",
		group: "Durable Object SQLite",
		implementation: "drizzle",
		label: "DO SQLite + Drizzle sequential",
		shortLabel: "DO sequential",
	},
	"do-drizzle-pipelined": {
		accent: "#0d9488",
		badge: "teal",
		description: "New adapter with the same six Drizzle calls issued before awaiting.",
		group: "Durable Object SQLite",
		implementation: "drizzle",
		label: "DO SQLite + Drizzle pipelined",
		shortLabel: "DO pipelined",
	},
	"do-app-method": {
		accent: "#475569",
		badge: "neutral",
		description: "One Durable Object RPC method runs all six reads next to SQLite.",
		group: "Durable Object SQLite",
		implementation: "app-method",
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
		description: "Make 6 read queries with Drizzle in serial",
		modes: ["d1-drizzle-sequential", "do-drizzle-sequential"],
		title: "Sequential reads",
	},
	{
		baseline: "d1-drizzle-parallel",
		description: "All six reads are issued together.",
		modes: ["d1-drizzle-parallel", "d1-raw-batch", "do-drizzle-pipelined"],
		title: "Batch / pipeline",
	},
	{
		description: "One RPC enters the Durable Object and the page data fan-out runs beside SQLite.",
		modes: ["do-app-method"],
		title: "Durable Object method",
	},
];

const CODE_GROUPS: CodeGroup[] = [
	{
		description: "The sequential comparison keeps the Drizzle code shape the same and changes only where the queries run.",
		examples: [
			{
				code: `const db = drizzle(env.DB, { schema });

const post = await selectPost(db, postId);
const author = await selectAuthorForPost(db, postId);
const recentPosts = await selectRecentPostsForPostAuthor(db, postId);
const commentCount = await selectCommentCount(db, postId);
const latestComments = await selectLatestComments(db, postId);
const tags = await selectTagsForPost(db, postId);`,
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
const tags = await selectTagsForPost(db, postId);`,
				mode: "do-drizzle-sequential",
				note: "Same Drizzle selectors, now sent through the Durable Object SQLite adapter.",
				title: "DO sequential",
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

const [post, author, recentPosts, commentCount, latestComments, tags] =
	await Promise.all([
		selectPost(db, postId),
		selectAuthorForPost(db, postId),
		selectRecentPostsForPostAuthor(db, postId),
		selectCommentCount(db, postId),
		selectLatestComments(db, postId),
		selectTagsForPost(db, postId),
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
]);

const post = results[0].results?.[0];
const commentCount = results[3].results?.[0]?.value;`,
				mode: "d1-raw-batch",
				note: "Fast, but it leaves Drizzle: raw SQL strings, manual binding, manual result mapping.",
				title: "D1 raw batch",
			},
			{
				code: `const db = d1ObjectDrizzle(stub, { schema, bookmark });

const [post, author, recentPosts, commentCount, latestComments, tags] =
	await Promise.all([
		selectPost(db, postId),
		selectAuthorForPost(db, postId),
		selectRecentPostsForPostAuthor(db, postId),
		selectCommentCount(db, postId),
		selectLatestComments(db, postId),
		selectTagsForPost(db, postId),
	]);`,
				mode: "do-drizzle-pipelined",
				note: "The adapter can pipeline the calls while the application code still looks like normal Drizzle.",
				title: "DO pipelined",
			},
		],
		title: "Batch / pipeline",
	},
	{
		description: "The app-method path collapses the route to one RPC, but the page-data logic now lives on the Durable Object class.",
		examples: [
			{
				code: `const db = d1ObjectDrizzle<BlogDatabase, typeof schema>(stub, {
	schema,
	bookmark,
});

const data = await db.d1.client.renderPostPage(postId);`,
				mode: "do-app-method",
				note: "The Worker route is tiny because it delegates the whole page-data operation.",
				title: "Worker route",
			},
			{
				code: `export class BlogDatabase extends DrizzleD1Object<Env> {
	db = d1ObjectDrizzle(this.ctx, { schema });

	async renderPostPage(postId: number) {
		return readPostPageWithDrizzle(this.db, postId, "sequential");
	}
}`,
				mode: "do-app-method",
				note: "That locality is the trade-off: business logic moves inside the Durable Object.",
				title: "Durable Object method",
			},
		],
		title: "Durable Object method",
	},
];

const DEFAULT_QUERIES = [
	"post",
	"author",
	"recent posts by same author",
	"comment count",
	"latest comments",
	"tags",
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
		queryCountPerRender: 6,
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
	const baseline = stats["d1-drizzle-sequential"];
	const doSequential = stats["do-drizzle-sequential"];
	const d1Parallel = stats["d1-drizzle-parallel"];
	const d1Batch = stats["d1-raw-batch"];
	const pipelined = stats["do-drizzle-pipelined"];
	const appMethod = stats["do-app-method"];
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
								<p>Measured samples are collected by calling the same JSON route repeatedly.</p>
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
												<Badge variant={definition.badge}>{definition.group}</Badge>
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

						<ProgrammingTradeoffs />

						<div className="metric-grid">
							<MetricTile
								icon={<Clock />}
								label="Sequential: DO vs D1"
								value={formatSpeedup(baseline, doSequential)}
								detail={formatSavings(baseline, doSequential) ?? "D1 sequential baseline"}
							/>
							<MetricTile
								icon={<Lightning />}
								label="Pipeline: DO vs D1 parallel"
								value={formatSpeedup(d1Parallel, pipelined)}
								detail={formatSavings(d1Parallel, pipelined) ?? "D1 parallel baseline"}
							/>
							<MetricTile
								icon={<ChartBar />}
								label="D1 batch control"
								value={d1Batch ? formatMs(d1Batch.p50) : "Run needed"}
								detail="Current D1, no Drizzle"
							/>
							<MetricTile
								icon={<CheckCircle />}
								label="DO app method"
								value={appMethod ? formatMs(appMethod.p50) : "Run needed"}
								detail="Single Durable Object RPC"
							/>
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
								{ label: "Model", value: "model" },
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
					{activeTab === "model" && (
						<ExecutionModel
							appMethod={appMethod}
							pipelined={pipelined}
							queries={benchmarkInfo.scenario?.queries ?? DEFAULT_QUERIES}
							sequential={baseline}
						/>
					)}
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

function MetricTile({
	detail,
	icon,
	label,
	value,
}: {
	detail?: string | undefined;
	icon: React.ReactNode;
	label: string;
	value: string;
}) {
	return (
		<div className="metric-tile">
			<div className="metric-icon">{icon}</div>
			<div>
				<span>{label}</span>
				<strong>{value}</strong>
				{detail && <small>{detail}</small>}
			</div>
		</div>
	);
}

function ProgrammingTradeoffs() {
	return (
		<div className="tradeoff-strip" aria-label="Programming model trade-offs">
			<article className="tradeoff-card highlight">
				<span>Fast and ORM-shaped</span>
				<strong>DO pipelined</strong>
				<p>
					Keeps the Drizzle selectors and <code>Promise.all</code> shape. The adapter pipelines
					the calls to Durable Object SQLite.
				</p>
			</article>
			<article className="tradeoff-card">
				<span>Fast control, raw API</span>
				<strong>D1 batch</strong>
				<p>
					Can land near pipelined latency, but it uses raw{" "}
					<a
						className="inline-doc-link"
						href="https://developers.cloudflare.com/d1/worker-api/d1-database/#batch"
						rel="noreferrer"
						target="_blank"
					>
						env.DB.batch()
					</a>
					, not Drizzle.
				</p>
			</article>
			<article className="tradeoff-card">
				<span>Fastest shape, more coupling</span>
				<strong>DO method</strong>
				<p>One RPC is clean on the route, but the page-data logic moves into the Durable Object.</p>
			</article>
		</div>
	);
}

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
				<p>Run the benchmark to turn the API responses into live latency bars.</p>
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
	return (
		<div className="table-frame">
			<Table layout="fixed">
				<Table.Header variant="compact">
					<Table.Row>
						<Table.Head>Mode</Table.Head>
						<Table.Head>Transport / API</Table.Head>
						<Table.Head>p50 Worker</Table.Head>
						<Table.Head>p95 Worker</Table.Head>
						<Table.Head>HTTP p50</Table.Head>
						<Table.Head>Vs comparison</Table.Head>
						<Table.Head>Samples</Table.Head>
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
								<Table.Cell>
									<TransportBadges definition={definition} />
								</Table.Cell>
								<Table.Cell>{stat ? formatMs(stat.p50) : statusLabel(runs[mode].state)}</Table.Cell>
								<Table.Cell>{stat ? formatMs(stat.p95) : "-"}</Table.Cell>
								<Table.Cell>{stat ? formatMs(stat.httpP50) : "-"}</Table.Cell>
								<Table.Cell>{comparisonLabel(mode, stats)}</Table.Cell>
								<Table.Cell>{stat?.count ?? 0}</Table.Cell>
							</Table.Row>
						);
					})}
				</Table.Body>
			</Table>
		</div>
	);
}

function TransportBadges({ definition }: { definition: ModeDefinition }) {
	return (
		<div className="transport-badges">
			<span className={`transport-pill ${definition.group === "Current D1" ? "current" : "object"}`}>
				{definition.group}
			</span>
			{definition.implementation === "drizzle" && (
				<span className="transport-pill drizzle">Drizzle</span>
			)}
			{definition.implementation === "raw-batch" && (
				<>
					<a
						className="transport-pill raw"
						href="https://developers.cloudflare.com/d1/worker-api/d1-database/#batch"
						rel="noreferrer"
						target="_blank"
					>
						Raw batch API
					</a>
					<span className="transport-pill no-drizzle">No Drizzle</span>
				</>
			)}
			{definition.implementation === "app-method" && (
				<span className="transport-pill method">App method</span>
			)}
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
							<Table.Head>Forwarded</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{eventRows.length === 0 ? (
							<Table.Row>
								<Table.Cell colSpan={6}>
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
								<Table.Cell>{event.forwarded ? "yes" : "no"}</Table.Cell>
							</Table.Row>
						))}
					</Table.Body>
				</Table>
			</div>
		</div>
	);
}

function ExecutionModel({
	appMethod,
	pipelined,
	queries,
	sequential,
}: {
	appMethod: ModeStats | null;
	pipelined: ModeStats | null;
	queries: string[];
	sequential: ModeStats | null;
}) {
	return (
		<div className="model-grid">
			<ModelLane
				description="Six request/response turns through the current D1 binding."
				icon={<Database />}
				label="D1 sequential"
				mode="serial"
				queries={queries}
				stat={sequential}
			/>
			<ModelLane
				description="Six Drizzle calls are issued together through the Durable Object session."
				icon={<GitBranch />}
				label="DO pipelined"
				mode="parallel"
				queries={queries}
				stat={pipelined}
			/>
			<ModelLane
				description="One RPC enters the Durable Object and the page data fan-out runs beside SQLite."
				icon={<BracketsCurly />}
				label="DO app method"
				mode="collapsed"
				queries={queries}
				stat={appMethod}
			/>
		</div>
	);
}

function ModelLane({
	description,
	icon,
	label,
	mode,
	queries,
	stat,
}: {
	description: string;
	icon: React.ReactNode;
	label: string;
	mode: "collapsed" | "parallel" | "serial";
	queries: string[];
	stat: ModeStats | null;
}) {
	return (
		<div className="model-lane">
			<div className="model-lane-head">
				<span>{icon}</span>
				<div>
					<strong>{label}</strong>
					<small>{stat ? formatMs(stat.p50) : "run to measure p50"}</small>
				</div>
			</div>
			<p>{description}</p>
			<div className={`query-timeline ${mode}`}>
				{queries.map((query, index) => (
					<span
						key={query}
						style={{
							"--query-index": index,
							"--query-total": queries.length,
						} as React.CSSProperties}
					>
						{query}
					</span>
				))}
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

function formatSavings(baseline: ModeStats | null, compared: ModeStats | null): string | undefined {
	if (!baseline || !compared) {
		return undefined;
	}
	const saved = baseline.p50 - compared.p50;
	if (saved <= 0) {
		return "no p50 saving";
	}
	return `${formatMs(saved)} saved`;
}

function formatSpeedup(baseline: ModeStats | null, compared: ModeStats | null): string {
	if (!baseline || !compared) {
		return "-";
	}
	const speedup = baseline.p50 / compared.p50;
	if (!Number.isFinite(speedup) || speedup <= 0) {
		return "-";
	}
	return formatMultiplier(speedup);
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

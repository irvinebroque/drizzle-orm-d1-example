#!/usr/bin/env node

const DEFAULT_BASE_URL = "http://localhost:8787";
const DEFAULT_POST_ID = 42;
const DEFAULT_ITERATIONS = 20;
const DEFAULT_WARMUP = 3;

const MODES = [
	"d1-drizzle-sequential",
	"do-drizzle-sequential",
	"d1-drizzle-parallel",
	"d1-raw-batch",
	"do-drizzle-pipelined",
	"do-app-method",
];

const args = parseArgs(process.argv.slice(2));
const baseUrl = withoutTrailingSlash(args.url ?? DEFAULT_BASE_URL);
const postId = integerArg(args.postId, DEFAULT_POST_ID);
const iterations = integerArg(args.iterations, DEFAULT_ITERATIONS);
const warmup = integerArg(args.warmup, DEFAULT_WARMUP);
const modes = args.mode ? splitModes(args.mode) : MODES;

if (args.seed) {
	await post(`${baseUrl}/bench/seed${seedQuery(args)}`);
}

console.log(`Benchmarking ${baseUrl}/bench/render-post/${postId}`);
console.log(`iterations=${iterations} warmup=${warmup} modes=${modes.join(",")}`);

for (const mode of modes) {
	const samples = [];
	for (let index = 0; index < warmup + iterations; index++) {
		const startedAt = performance.now();
		const response = await fetch(`${baseUrl}/bench/render-post/${postId}?mode=${mode}`);
		const body = await response.json();
		if (!response.ok) {
			throw new Error(`${mode} failed with ${response.status}: ${JSON.stringify(body)}`);
		}
		const observedMs = performance.now() - startedAt;
		if (index >= warmup) {
			samples.push({
				workerMs: Number(body.elapsedMs),
				observedMs,
			});
		}
	}
	printSummary(mode, samples);
}

function parseArgs(values) {
	const parsed = {};
	for (let index = 0; index < values.length; index++) {
		const value = values[index];
		if (!value.startsWith("--")) {
			continue;
		}
		const [rawName, inlineValue] = value.slice(2).split("=", 2);
		parsed[toCamelCase(rawName)] = inlineValue ?? values[index + 1] ?? "true";
		if (inlineValue === undefined && values[index + 1] && !values[index + 1].startsWith("--")) {
			index++;
		}
	}
	return parsed;
}

function toCamelCase(value) {
	return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function integerArg(value, fallback) {
	if (value === undefined) {
		return fallback;
	}
	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function splitModes(value) {
	return value.split(",").map((mode) => mode.trim()).filter(Boolean);
}

function seedQuery(args) {
	const params = new URLSearchParams();
	for (const key of ["authors", "posts", "comments", "tags", "reset"]) {
		if (args[key] !== undefined) {
			params.set(key, args[key]);
		}
	}
	const query = params.toString();
	return query ? `?${query}` : "";
}

async function post(url) {
	const response = await fetch(url, { method: "POST" });
	const body = await response.json();
	if (!response.ok) {
		throw new Error(`Seed failed with ${response.status}: ${JSON.stringify(body)}`);
	}
	console.log(`Seeded fixture: ${JSON.stringify(body)}`);
}

function printSummary(mode, samples) {
	const worker = samples.map((sample) => sample.workerMs).sort((a, b) => a - b);
	const observed = samples.map((sample) => sample.observedMs).sort((a, b) => a - b);
	console.log([
		mode.padEnd(24),
		`worker avg=${mean(worker).toFixed(2)}ms`,
		`p50=${percentile(worker, 50).toFixed(2)}ms`,
		`p95=${percentile(worker, 95).toFixed(2)}ms`,
		`p99=${percentile(worker, 99).toFixed(2)}ms`,
		`http p50=${percentile(observed, 50).toFixed(2)}ms`,
	].join("  "));
}

function mean(values) {
	return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values, percentileValue) {
	const index = Math.min(values.length - 1, Math.ceil((percentileValue / 100) * values.length) - 1);
	return values[index] ?? 0;
}

function withoutTrailingSlash(value) {
	return value.endsWith("/") ? value.slice(0, -1) : value;
}

#!/usr/bin/env bash
set -euo pipefail

repo="${DRIZZLE_REPO:-https://github.com/irvinebroque/drizzle-orm.git}"
ref="${DRIZZLE_REF:-d1-object-adapter}"
workdir=".drizzle-pr"

if [ ! -d "$workdir/.git" ]; then
	git clone "$repo" "$workdir"
fi

git -C "$workdir" fetch origin "$ref"
git -C "$workdir" checkout FETCH_HEAD

(
	cd "$workdir"
	pnpm install
	pnpm --filter drizzle-orm build
	pnpm --filter drizzle-kit build
	pnpm --filter drizzle-orm run pack
	pnpm --filter drizzle-kit run pack
)

node --input-type=module <<'NODE'
import { readFileSync, writeFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
pkg.dependencies ??= {};
pkg.devDependencies ??= {};
pkg.dependencies["drizzle-orm"] = "file:.drizzle-pr/drizzle-orm/package.tgz";
pkg.devDependencies["drizzle-kit"] = "file:.drizzle-pr/drizzle-kit/package.tgz";
writeFileSync("package.json", `${JSON.stringify(pkg, null, "\t")}\n`);
NODE

pnpm install

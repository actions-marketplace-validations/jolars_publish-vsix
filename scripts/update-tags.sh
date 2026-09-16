#!/usr/bin/env bash
set -euo pipefail

tag="${GITHUB_REF_NAME:?GITHUB_REF_NAME is required}"
if [[ ! $tag =~ ^v([0-9]+)\.([0-9]+)\.([0-9]+)$ ]]; then
	echo "Skipping floating tags for prerelease or non-release tag: $tag"
	exit 0
fi
major="v${BASH_REMATCH[1]}"
minor="$major.${BASH_REMATCH[2]}"

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

for floating in "$minor" "$major"; do
	# Releasing an older maintenance branch must not move a floating tag backward.
	latest=$(git tag --list "$floating.*" | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -n 1)
	if [[ $latest == "$tag" ]]; then
		git tag --force --annotate "$floating" "$tag^{commit}" --message "Release $tag"
		git push origin "+refs/tags/$floating:refs/tags/$floating"
	fi
done

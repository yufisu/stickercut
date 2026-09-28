#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
npm run typecheck
npm test
npm run build:web

site_tmp_dir=$(mktemp -d)
trap 'rm -rf "$site_tmp_dir"' EXIT
git clone --depth 1 --branch gh-pages "$(git remote get-url origin)" "$site_tmp_dir/site"
find "$site_tmp_dir/site" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
cp -R dist/. "$site_tmp_dir/site/"
touch "$site_tmp_dir/site/.nojekyll"
git -C "$site_tmp_dir/site" add -A
if git -C "$site_tmp_dir/site" diff --cached --quiet; then
  echo 'Pages çıktısı zaten güncel.'
  exit 0
fi
git -C "$site_tmp_dir/site" commit -m 'Publish stickercut web'
git -C "$site_tmp_dir/site" push origin gh-pages

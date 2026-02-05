#!/bin/sh
set -e

python -m pip install -U pip
python -m pip install -U crawl4ai rank-bm25 pyyaml

# Crawl4AI setup (does checks + downloads what it needs)
crawl4ai-setup || true
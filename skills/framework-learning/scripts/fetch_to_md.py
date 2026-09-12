#!/usr/bin/env python3
"""
fetch_to_md.py — Fetch and convert top-k ranked pages to clean markdown.

Usage:
  python fetch_to_md.py --topk artifacts/topk.json --out artifacts/topk_pages/

Output:
  artifacts/topk_pages/*.md with clean markdown versions of each top page.
  File names: page_0.md, page_1.md, etc.
"""

import asyncio
import json
import argparse
import os
from pathlib import Path

try:
    from crawl4ai import AsyncWebCrawler, BrowserConfig, CrawlerRunConfig, CacheMode
except ImportError:
    print("ERROR: crawl4ai not installed. Run: pip install crawl4ai")
    exit(1)


async def fetch_and_convert(topk_file: str, out_dir: str) -> None:
    """
    Fetch each URL from topk.json and save as clean markdown.
    """
    with open(topk_file, "r") as f:
        topk = json.load(f)

    os.makedirs(out_dir, exist_ok=True)

    browser_config = BrowserConfig(headless=True, verbose=False)
    run_config = CrawlerRunConfig(cache_mode=CacheMode.ENABLED)

    async with AsyncWebCrawler(config=browser_config) as crawler:
        for idx, result in enumerate(topk.get("results", [])):
            url = result["url"]
            title = result["title"]
            score = result["score"]

            print(f"[{idx+1}/{len(topk['results'])}] Fetching: {title}")

            try:
                crawl_result = await crawler.arun(url=url, config=run_config)

                if crawl_result.success and crawl_result.markdown:
                    # Build markdown with metadata header
                    md_content = f"""# {title}

**Source:** [{url}]({url})  
**Relevance Score:** {score:.2f}

---

{crawl_result.markdown.fit_markdown}
"""

                    # Save to file
                    out_file = os.path.join(out_dir, f"page_{idx}.md")
                    with open(out_file, "w", encoding="utf-8") as f:
                        f.write(md_content)

                    print(f"  ✓ Saved to: {out_file}")
                else:
                    print(f"  ✗ Failed to fetch or parse: {url}")

            except Exception as e:
                print(f"  ✗ Error fetching {url}: {str(e)[:60]}")


def main():
    parser = argparse.ArgumentParser(
        description="Fetch and convert top-k pages to markdown."
    )
    parser.add_argument(
        "--topk",
        required=True,
        help="Top-k results JSON (from bm25_rank.py)"
    )
    parser.add_argument(
        "--out",
        required=True,
        help="Output directory for markdown files"
    )

    args = parser.parse_args()

    print(f"Fetching top-k pages from: {args.topk}")
    print(f"Output directory: {args.out}\n")

    asyncio.run(fetch_and_convert(args.topk, args.out))

    print(f"\n✓ Conversion complete. Markdown files saved to: {args.out}")


if __name__ == "__main__":
    main()
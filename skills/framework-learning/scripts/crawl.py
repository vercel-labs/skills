#!/usr/bin/env python3
"""
crawl.py — Discover and index documentation URLs from a seed domain.

Usage:
  python crawl.py --seed https://docs.example.com/ --out artifacts/discovered.json

Output:
  artifacts/discovered.json with structure:
  {
    "domain": "docs.example.com",
    "seed_url": "https://docs.example.com/",
    "urls": [
      {
        "url": "https://docs.example.com/guide/intro",
        "title": "Introduction",
        "headings": ["Getting Started", "Installation"],
        "snippet": "Learn the basics..."
      },
      ...
    ],
    "crawl_time": "2025-01-11T10:59:00Z"
  }
"""

import asyncio
import json
import argparse
from datetime import datetime
from urllib.parse import urljoin, urlparse
from typing import Optional, Set

try:
    from crawl4ai import AsyncWebCrawler, BrowserConfig, CrawlerRunConfig, CacheMode
except ImportError:
    print("ERROR: crawl4ai not installed. Run: pip install crawl4ai")
    exit(1)


async def crawl_docs(seed_url: str, max_pages: int = 100) -> dict:
    """
    Crawl documentation from seed_url, staying within the same domain.
    Returns discovered URLs with metadata.
    """
    parsed_seed = urlparse(seed_url)
    domain = parsed_seed.netloc
    scheme = parsed_seed.scheme

    visited: Set[str] = set()
    queue = [seed_url]
    discovered = []

    browser_config = BrowserConfig(headless=True, verbose=False)
    run_config = CrawlerRunConfig(
        cache_mode=CacheMode.ENABLED,
        word_count_threshold=10  # Skip very small pages
    )

    async with AsyncWebCrawler(config=browser_config) as crawler:
        while queue and len(visited) < max_pages:
            current_url = queue.pop(0)

            # Skip if already visited or outside domain
            if current_url in visited:
                continue
            if urlparse(current_url).netloc != domain:
                continue

            visited.add(current_url)
            print(f"[{len(visited)}/{max_pages}] Crawling: {current_url}")

            try:
                result = await crawler.arun(url=current_url, config=run_config)

                if result.success:
                    # Extract title
                    title = ""
                    if result.metadata:
                        title = result.metadata.get("title", "")

                    # Extract headings from markdown
                    headings = []
                    if result.markdown:
                        lines = result.markdown.raw_markdown.split("\n")
                        for line in lines[:20]:  # Check first 20 lines
                            if line.startswith("#"):
                                heading_text = line.lstrip("#").strip()
                                if heading_text:
                                    headings.append(heading_text)

                    # Create snippet (first 150 chars of markdown)
                    snippet = ""
                    if result.markdown:
                        text = result.markdown.raw_markdown.replace("#", "").strip()
                        snippet = text[:150].strip()

                    discovered.append({
                        "url": current_url,
                        "title": title or current_url.split("/")[-1] or "Home",
                        "headings": headings[:5],  # Top 5 headings
                        "snippet": snippet
                    })

                    # Extract internal links
                    if result.links:
                        for link in result.links.get("internal", [])[:10]:  # Limit per page
                            full_url = urljoin(current_url, link)
                            parsed = urlparse(full_url)
                            # Normalize: remove fragments, keep only in-domain
                            if parsed.netloc == domain:
                                clean_url = f"{scheme}://{parsed.netloc}{parsed.path}"
                                if clean_url not in visited and clean_url not in queue:
                                    queue.append(clean_url)

            except Exception as e:
                print(f"  [Error] {current_url}: {str(e)[:60]}")
                continue

    return {
        "domain": domain,
        "seed_url": seed_url,
        "urls": discovered,
        "crawl_time": datetime.utcnow().isoformat() + "Z",
        "total_discovered": len(discovered)
    }


async def main():
    parser = argparse.ArgumentParser(
        description="Crawl documentation from a seed URL and discover pages."
    )
    parser.add_argument(
        "--seed",
        required=True,
        help="Seed URL (e.g., https://docs.example.com/)"
    )
    parser.add_argument(
        "--out",
        required=True,
        help="Output JSON file (e.g., artifacts/discovered.json)"
    )
    parser.add_argument(
        "--max-pages",
        type=int,
        default=100,
        help="Maximum pages to crawl (default: 100)"
    )

    args = parser.parse_args()

    print(f"Starting crawl from: {args.seed}")
    print(f"Max pages: {args.max_pages}")

    result = await crawl_docs(args.seed, max_pages=args.max_pages)

    import os
    os.makedirs(os.path.dirname(args.out), exist_ok=True)

    with open(args.out, "w") as f:
        json.dump(result, f, indent=2)

    print(f"\n✓ Discovered {result['total_discovered']} pages")
    print(f"✓ Saved to: {args.out}")


if __name__ == "__main__":
    asyncio.run(main())
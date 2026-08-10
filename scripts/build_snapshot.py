#!/usr/bin/env python3
"""Build a static AI Competence article snapshot for GitHub Pages.

The builder merges the public WordPress REST API with every post sitemap it can
find. REST data supplies accurate titles; sitemap data supplies complete URL
coverage. The deployment fails rather than publishing an implausibly small
index.
"""

from __future__ import annotations

import html
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

BASE = os.environ.get("WP_BASE", "https://aicompetence.org").rstrip("/")
OUT = Path("data/articles.snapshot.json")
MINIMUM_ARTICLES = int(os.environ.get("MINIMUM_ARTICLES", "2000"))
MIN_REQUEST_INTERVAL_SECONDS = float(os.environ.get("WP_REQUEST_INTERVAL", "15"))
MAX_REQUEST_ATTEMPTS = int(os.environ.get("WP_REQUEST_ATTEMPTS", "5"))
RETRYABLE_HTTP_STATUS = {403, 429, 500, 502, 503, 504}
USER_AGENT = "AI-Topic-Explorer-Snapshot/2.0 (+https://explore.aicompetence.org/)"
_last_request_started = 0.0


def wait_for_request_slot() -> None:
    """Keep WordPress requests below the site's rate-limit threshold."""
    global _last_request_started
    elapsed = time.monotonic() - _last_request_started
    remaining = MIN_REQUEST_INTERVAL_SECONDS - elapsed
    if _last_request_started and remaining > 0:
        time.sleep(remaining)
    _last_request_started = time.monotonic()


def retry_delay(error: urllib.error.HTTPError, attempt: int) -> float:
    retry_after = error.headers.get("Retry-After", "") if error.headers else ""
    if retry_after.isdigit():
        return max(float(retry_after), MIN_REQUEST_INTERVAL_SECONDS)
    return max(MIN_REQUEST_INTERVAL_SECONDS, min(20 * (2**attempt), 120))


def request(url: str, timeout: int = 45) -> tuple[bytes, Any]:
    req = urllib.request.Request(
        url,
        headers={"User-Agent": USER_AGENT, "Accept": "application/json, application/xml, text/xml, */*"},
    )
    for attempt in range(MAX_REQUEST_ATTEMPTS):
        wait_for_request_slot()
        try:
            with urllib.request.urlopen(req, timeout=timeout) as response:
                return response.read(), response.headers
        except urllib.error.HTTPError as exc:
            if exc.code not in RETRYABLE_HTTP_STATUS or attempt + 1 >= MAX_REQUEST_ATTEMPTS:
                raise
            delay = retry_delay(exc, attempt)
            print(
                f"WordPress returned {exc.code}; retrying in {delay:.0f}s "
                f"({attempt + 2}/{MAX_REQUEST_ATTEMPTS})",
                flush=True,
            )
            time.sleep(delay)
        except (urllib.error.URLError, TimeoutError) as exc:
            if attempt + 1 >= MAX_REQUEST_ATTEMPTS:
                raise
            delay = max(MIN_REQUEST_INTERVAL_SECONDS, min(20 * (2**attempt), 120))
            print(
                f"WordPress request failed ({exc}); retrying in {delay:.0f}s "
                f"({attempt + 2}/{MAX_REQUEST_ATTEMPTS})",
                flush=True,
            )
            time.sleep(delay)
    raise RuntimeError(f"WordPress request failed after {MAX_REQUEST_ATTEMPTS} attempts: {url}")


def clean_title(value: str) -> str:
    value = re.sub(r"<[^>]+>", " ", value or "")
    value = html.unescape(value)
    return re.sub(r"\s+", " ", value).strip()


def slug_title(url: str) -> str:
    path = urllib.parse.urlparse(url).path.rstrip("/")
    slug = path.rsplit("/", 1)[-1]
    words = re.sub(r"[-_]+", " ", urllib.parse.unquote(slug)).strip()
    return words.title() or "AI Competence Article"


def infer_category(title: str, url: str) -> str:
    text = f"{title} {url}".lower()
    rules = [
        ("Local AI", ["ollama", "local-ai", "local-llm", "on-device", "offline-ai", "apple-silicon", "mlx", "gguf"]),
        ("AI Governance", ["governance", "risk", "policy", "accountab", "compliance", "control-", "ownership", "audit", "regulat", "guardrail"]),
        ("Production AI", ["reliability", "evaluation", "slo", "error-budget", "production", "observability", "monitoring", "incident", "regression"]),
        ("AI Search", ["search", "publisher", "publishing", "retrieval", "zero-click", "answer-engine", "generative-engine"]),
        ("AI Strategy", ["strategy", "operating-model", "use-case", "roi", "implementation", "transformation", "adoption", "roadmap", "pilot"]),
        ("Data & MLOps", ["data-", "dataset", "mlops", "analytics", "embedding", "pipeline"]),
        ("Creative AI", ["image", "video", "music", "art", "creative", "design"]),
        ("Industry AI", ["health", "medical", "finance", "bank", "retail", "manufactur", "education", "robot", "drone"]),
        ("Emerging AI", ["agent", "multimodal", "quantum", "neural", "brain-computer", "agi", "asi"]),
        ("AI Tools", ["tool", "platform", "software", "framework", "api", "assistant"]),
    ]
    for category, keywords in rules:
        if any(keyword in text for keyword in keywords):
            return category
    return "AI Fundamentals"


def normalize_rest(post: dict[str, Any]) -> dict[str, str] | None:
    url = str(post.get("link") or "").split("?", 1)[0].strip()
    if not url.startswith(f"{BASE}/"):
        return None
    rendered = post.get("title", {}).get("rendered", "") if isinstance(post.get("title"), dict) else ""
    title = clean_title(rendered) or slug_title(url)
    modified = str(post.get("modified") or post.get("date") or "")[:10]
    return {"url": url, "title": title, "category": infer_category(title, url), "modified": modified}


def fetch_rest() -> list[dict[str, str]]:
    fields = "id,link,slug,date,modified,title"
    params = {"per_page": 100, "page": 1, "status": "publish", "_fields": fields}
    first_url = f"{BASE}/wp-json/wp/v2/posts?{urllib.parse.urlencode(params)}"
    body, headers = request(first_url)
    first = json.loads(body)
    if not isinstance(first, list):
        raise RuntimeError("WordPress REST returned a non-list response")
    total_pages = int(headers.get("X-WP-TotalPages", "1"))
    posts = list(first)
    for page in range(2, total_pages + 1):
        params["page"] = page
        url = f"{BASE}/wp-json/wp/v2/posts?{urllib.parse.urlencode(params)}"
        page_body, _ = request(url)
        data = json.loads(page_body)
        if not isinstance(data, list):
            raise RuntimeError(f"REST page {page} returned a non-list response")
        posts.extend(data)
        print(f"REST page {page}/{total_pages}: {len(posts)} posts", flush=True)
    normalized = [item for post in posts if (item := normalize_rest(post))]
    return list({item["url"]: item for item in normalized}.values())


def local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def parse_xml_locations(xml_bytes: bytes) -> tuple[str, list[tuple[str, str]]]:
    root = ET.fromstring(xml_bytes)
    kind = local_name(root.tag)
    entries: list[tuple[str, str]] = []
    for child in root:
        loc = ""
        lastmod = ""
        for node in child:
            name = local_name(node.tag)
            if name == "loc":
                loc = (node.text or "").strip()
            elif name == "lastmod":
                lastmod = (node.text or "").strip()[:10]
        if loc:
            entries.append((loc, lastmod))
    return kind, entries


def discover_post_sitemaps() -> list[str]:
    found: list[str] = []
    errors: list[str] = []
    for endpoint in ("/sitemap_index.xml", "/wp-sitemap.xml"):
        try:
            body, _ = request(f"{BASE}{endpoint}")
            kind, entries = parse_xml_locations(body)
            if kind == "urlset":
                continue
            for loc, _ in entries:
                low = loc.lower()
                if "post-sitemap" in low or "wp-sitemap-posts-post" in low:
                    found.append(loc)
            if found:
                break
        except Exception as exc:  # keep trying alternate sources
            errors.append(f"{endpoint}: {exc}")
    if not found:
        for endpoint in ("/post-sitemap.xml", "/wp-sitemap-posts-post-1.xml"):
            try:
                body, _ = request(f"{BASE}{endpoint}")
                kind, _ = parse_xml_locations(body)
                if kind == "urlset":
                    found.append(f"{BASE}{endpoint}")
            except Exception as exc:
                errors.append(f"{endpoint}: {exc}")
    if not found:
        raise RuntimeError("No post sitemaps discovered; " + " | ".join(errors))
    return list(dict.fromkeys(found))


def fetch_sitemaps() -> list[dict[str, str]]:
    articles: dict[str, dict[str, str]] = {}
    sitemaps = discover_post_sitemaps()
    for index, sitemap_url in enumerate(sitemaps, start=1):
        body, _ = request(sitemap_url)
        kind, entries = parse_xml_locations(body)
        if kind != "urlset":
            continue
        for url, lastmod in entries:
            url = url.split("?", 1)[0].strip()
            if not url.startswith(f"{BASE}/") or url == f"{BASE}/":
                continue
            title = slug_title(url)
            articles[url] = {
                "url": url,
                "title": title,
                "category": infer_category(title, url),
                "modified": lastmod,
            }
        print(f"Sitemap {index}/{len(sitemaps)}: {len(articles)} URLs", flush=True)
    return list(articles.values())


def main() -> int:
    rest: list[dict[str, str]] = []
    sitemap: list[dict[str, str]] = []
    warnings: list[str] = []
    try:
        sitemap = fetch_sitemaps()
    except Exception as exc:
        warnings.append(f"Sitemap unavailable: {exc}")
    try:
        rest = fetch_rest()
    except Exception as exc:
        warnings.append(f"REST unavailable: {exc}")

    merged = {item["url"]: item for item in sitemap}
    merged.update({item["url"]: item for item in rest})
    articles = sorted(merged.values(), key=lambda item: (item.get("modified", ""), item["title"]), reverse=True)

    if len(articles) < MINIMUM_ARTICLES:
        raise RuntimeError(
            f"Refusing to publish an implausibly small index: {len(articles)} articles; "
            + " | ".join(warnings)
        )

    payload = {
        "schema_version": 3,
        "source": "wordpress-rest+sitemaps" if rest and sitemap else ("wordpress-rest" if rest else "wordpress-sitemaps"),
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "count": len(articles),
        "warnings": warnings,
        "articles": articles,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {OUT} with {len(articles)} unique articles; source={payload['source']}")
    if warnings:
        print("Warnings: " + " | ".join(warnings))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"Snapshot build failed: {exc}", file=sys.stderr)
        raise

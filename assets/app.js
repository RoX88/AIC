const WP = 'https://aicompetence.org';
const SNAPSHOT = './data/articles.snapshot.json';
const PAGE_SIZE = 60;
const MINIMUM_ARTICLES = 2000;

let articles = [];
let filtered = [];
let shown = PAGE_SIZE;
let category = 'All';
let activeSource = 'loading';
let snapshotGeneratedAt = '';

const $ = (selector) => document.querySelector(selector);
const grid = $('#grid');
const count = $('#count');
const status = $('#status');
const error = $('#error');
const filters = $('#filters');
const loadButton = $('#load');
const search = $('#search');

function strip(value = '') {
  const decoder = document.createElement('textarea');
  decoder.innerHTML = String(value).replace(/<[^>]*>/g, ' ');
  return decoder.value.replace(/\s+/g, ' ').trim();
}

function inferCategory(title, url) {
  const text = `${title} ${url}`.toLowerCase();
  const rules = [
    ['Local AI', ['ollama', 'local-ai', 'local-llm', 'on-device', 'offline-ai', 'apple-silicon', 'mlx', 'gguf']],
    ['AI Governance', ['governance', 'risk', 'policy', 'accountab', 'compliance', 'control-', 'ownership', 'audit', 'regulat', 'guardrail']],
    ['Production AI', ['reliability', 'evaluation', 'slo', 'error-budget', 'production', 'observability', 'monitoring', 'incident', 'regression']],
    ['AI Search', ['search', 'publisher', 'publishing', 'retrieval', 'zero-click', 'answer-engine', 'generative-engine']],
    ['AI Strategy', ['strategy', 'operating-model', 'use-case', 'roi', 'implementation', 'transformation', 'adoption', 'roadmap', 'pilot']],
    ['Data & MLOps', ['data-', 'dataset', 'mlops', 'analytics', 'embedding', 'pipeline']],
    ['Creative AI', ['image', 'video', 'music', 'art', 'creative', 'design']],
    ['Industry AI', ['health', 'medical', 'finance', 'bank', 'retail', 'manufactur', 'education', 'robot', 'drone']],
    ['Emerging AI', ['agent', 'multimodal', 'quantum', 'neural', 'brain-computer', 'agi', 'asi']],
    ['AI Tools', ['tool', 'platform', 'software', 'framework', 'api', 'assistant']],
  ];
  for (const [name, keywords] of rules) {
    if (keywords.some((keyword) => text.includes(keyword))) return name;
  }
  return 'AI Fundamentals';
}

function normalizeRestPost(post) {
  const url = String(post.link || '').split('?')[0];
  const rendered = post.title?.rendered || '';
  const title = strip(rendered) || String(post.slug || '').replaceAll('-', ' ');
  return {
    url,
    title,
    category: inferCategory(title, url),
    modified: String(post.modified || post.date || '').slice(0, 10),
  };
}

function normalizeArticle(article) {
  const url = String(article.url || article.link || '').split('?')[0];
  const title = strip(article.title || '') || url.split('/').filter(Boolean).pop()?.replaceAll('-', ' ') || 'AI Competence article';
  return {
    url,
    title,
    category: article.category || inferCategory(title, url),
    modified: String(article.modified || '').slice(0, 10),
  };
}

function deduplicate(items) {
  const map = new Map();
  for (const raw of items) {
    const article = normalizeArticle(raw);
    if (!article.url.startsWith(`${WP}/`)) continue;
    map.set(article.url, article);
  }
  return [...map.values()].sort((a, b) =>
    (b.modified || '').localeCompare(a.modified || '') || a.title.localeCompare(b.title)
  );
}

function setArticles(items, source, generatedAt = '') {
  const normalized = deduplicate(items);
  if (normalized.length < MINIMUM_ARTICLES) {
    throw new Error(`Only ${normalized.length} valid articles were returned`);
  }
  articles = normalized;
  activeSource = source;
  shown = PAGE_SIZE;
  category = 'All';
  renderFilters();
  applyFilters();
  const generated = generatedAt ? ` · refreshed ${new Date(generatedAt).toLocaleString()}` : '';
  status.textContent = `${source} · ${articles.length.toLocaleString()} articles${generated}`;
  status.classList.remove('warn');
}

function renderFilters() {
  const categories = ['All', ...new Set(articles.map((article) => article.category))];
  filters.innerHTML = categories
    .map((name) => `<button type="button" data-cat="${name}" class="${name === 'All' ? 'active' : ''}">${name}</button>`)
    .join('');
}

function applyFilters() {
  const query = search.value.trim().toLowerCase();
  filtered = articles.filter((article) => {
    const categoryMatches = category === 'All' || article.category === category;
    const queryMatches = !query || `${article.title} ${article.category} ${article.url}`.toLowerCase().includes(query);
    return categoryMatches && queryMatches;
  });
  count.textContent = `Showing ${Math.min(shown, filtered.length).toLocaleString()} of ${filtered.length.toLocaleString()} matching articles · ${articles.length.toLocaleString()} indexed`;
  grid.innerHTML = filtered.slice(0, shown).map((article) => `
    <a class="card" href="${article.url}">
      <span class="eyebrow">${article.category}</span>
      <h3>${article.title}</h3>
      <small>${article.modified || 'AI Competence article'} ↗</small>
    </a>`).join('');
  loadButton.classList.toggle('hidden', shown >= filtered.length);
}

async function loadSnapshot() {
  const response = await fetch(`${SNAPSHOT}?v=${Date.now()}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Snapshot returned ${response.status}`);
  const payload = await response.json();
  if (!Array.isArray(payload.articles)) throw new Error('Snapshot has no articles array');
  snapshotGeneratedAt = payload.generated_at || '';
  setArticles(payload.articles, 'Six-hour server snapshot', snapshotGeneratedAt);
  return payload;
}

async function loadLiveWordPress() {
  const fields = 'id,link,slug,date,modified,title';
  const firstUrl = `${WP}/wp-json/wp/v2/posts?per_page=100&page=1&status=publish&_fields=${encodeURIComponent(fields)}`;
  const first = await fetch(firstUrl, { headers: { Accept: 'application/json' }, cache: 'no-store' });
  if (!first.ok) throw new Error(`WordPress returned ${first.status}`);
  const posts = await first.json();
  if (!Array.isArray(posts)) throw new Error('WordPress returned an invalid response');

  const recent = posts.map(normalizeRestPost);
  const merged = deduplicate([...recent, ...articles]);
  setArticles(
    merged,
    'Six-hour snapshot + latest WordPress posts',
    snapshotGeneratedAt,
  );
}

async function initialize() {
  let snapshotLoaded = false;
  try {
    await loadSnapshot();
    snapshotLoaded = true;
  } catch (snapshotError) {
    console.error(snapshotError);
    status.textContent = 'Snapshot unavailable; trying live WordPress…';
    status.classList.add('warn');
  }

  try {
    await loadLiveWordPress();
  } catch (liveError) {
    console.error(liveError);
    if (snapshotLoaded) {
      status.textContent = `${activeSource} · ${articles.length.toLocaleString()} articles`;
      status.classList.remove('warn');
      error.textContent = '';
      error.classList.add('hidden');
    } else {
      status.textContent = 'Article index unavailable';
      status.classList.add('warn');
      count.textContent = 'The article index could not be loaded.';
      error.textContent = 'The article index is temporarily unavailable. Please try again shortly.';
      error.classList.remove('hidden');
    }
  }
}

filters.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  category = button.dataset.cat;
  shown = PAGE_SIZE;
  filters.querySelectorAll('button').forEach((item) => item.classList.toggle('active', item === button));
  applyFilters();
});

search.addEventListener('input', () => {
  shown = PAGE_SIZE;
  applyFilters();
});

$('#clear').addEventListener('click', () => {
  search.value = '';
  category = 'All';
  shown = PAGE_SIZE;
  filters.querySelectorAll('button').forEach((button, index) => button.classList.toggle('active', index === 0));
  applyFilters();
});

loadButton.addEventListener('click', () => {
  shown += PAGE_SIZE;
  applyFilters();
});

$('#heroForm').addEventListener('submit', (event) => {
  event.preventDefault();
  search.value = $('#heroSearch').value;
  shown = PAGE_SIZE;
  applyFilters();
  location.hash = 'library';
});

initialize();

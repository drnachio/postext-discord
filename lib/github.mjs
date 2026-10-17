// Read-only GitHub REST access for the feeds. Set GITHUB_TOKEN for a higher rate limit.

export async function github(repo, path) {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'postext-discord' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(`https://api.github.com/repos/${repo}${path}`, { headers });
  if (!res.ok) throw new Error(`GitHub ${path} → ${res.status} ${await res.text()}`);
  return res.json();
}

const TAG_RE = /^v(\d+)\.(\d+)\.(\d+)$/;
const versionKey = (t) => t.match(TAG_RE).slice(1).map(Number);
export const compareVersions = (a, b) => {
  const [x, y] = [versionKey(a), versionKey(b)];
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
};

// Every vX.Y.Z tag, oldest first. Postext only pushes one after a release built,
// tested and published, so a tag is a published version.
export async function versionTags(repo) {
  const tags = [];
  for (let page = 1; ; page++) {
    const batch = await github(repo, `/tags?per_page=100&page=${page}`);
    tags.push(...batch.map((t) => t.name).filter((n) => TAG_RE.test(n)));
    if (batch.length < 100) break;
  }
  return tags.sort(compareVersions);
}

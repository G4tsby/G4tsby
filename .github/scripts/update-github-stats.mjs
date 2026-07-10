const token = process.env.GH_TOKEN;
const gistId = process.env.GIST_ID;

if (!token) {
  throw new Error("GH_TOKEN is not defined");
}

if (!gistId) {
  throw new Error("GIST_ID is not defined");
}

const apiHeaders = {
  Accept: "application/vnd.github+json",
  Authorization: `Bearer ${token}`,
  "X-GitHub-Api-Version": "2022-11-28",
};

async function githubRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...apiHeaders,
      ...options.headers,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${options.method ?? "GET"} ${url} failed (${response.status}): ${body}`);
  }

  return response.json();
}

async function fetchStats() {
  const query = `
    query ViewerStats {
      viewer {
        name
        login
        repositoriesContributedTo(
          first: 1
          contributionTypes: [COMMIT, ISSUE, PULL_REQUEST, REPOSITORY]
        ) {
          totalCount
        }
        pullRequests(first: 1) {
          totalCount
        }
        issues(first: 1) {
          totalCount
        }
        repositories(
          first: 100
          ownerAffiliations: OWNER
          isFork: false
          orderBy: { direction: DESC, field: STARGAZERS }
        ) {
          nodes {
            stargazers {
              totalCount
            }
          }
        }
      }
    }
  `;

  const graph = await githubRequest("https://api.github.com/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });

  if (graph.errors?.length) {
    throw new Error(`GraphQL query failed: ${JSON.stringify(graph.errors)}`);
  }

  const user = graph.data.viewer;
  const commitSearch = await githubRequest(
    `https://api.github.com/search/commits?q=${encodeURIComponent(`author:${user.login}`)}&per_page=1`,
  );

  return {
    name: user.name || user.login,
    stars: user.repositories.nodes.reduce(
      (total, repository) => total + repository.stargazers.totalCount,
      0,
    ),
    commits: commitSearch.total_count,
    pullRequests: user.pullRequests.totalCount,
    issues: user.issues.totalCount,
    contributedTo: user.repositoriesContributedTo.totalCount,
  };
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatLine(icon, label, value) {
  const renderedValue = formatNumber(value);
  const prefix = `${label}:`;
  const padding = " ".repeat(Math.max(1, 45 - prefix.length - renderedValue.length));
  return `${icon}    ${prefix}${padding}${renderedValue}`;
}

function renderStats(stats) {
  return `${[
    formatLine("⭐", "Total Stars", stats.stars),
    formatLine("➕", "Total Commits", stats.commits),
    formatLine("🔀", "Total PRs", stats.pullRequests),
    formatLine("🚩", "Total Issues", stats.issues),
    formatLine("📦", "Contributed to", stats.contributedTo),
  ].join("\n")}\n`;
}

async function updateGist(stats) {
  const gist = await githubRequest(`https://api.github.com/gists/${gistId}`);
  const filename = Object.keys(gist.files)[0];

  if (!filename) {
    throw new Error("The target Gist does not contain a file");
  }

  const content = renderStats(stats);
  if (gist.files[filename].content === content) {
    console.log("Nothing to update");
    return;
  }

  await githubRequest(`https://api.github.com/gists/${gistId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      files: {
        [filename]: {
          filename: `${stats.name}'s GitHub Stats`,
          content,
        },
      },
    }),
  });

  console.log(`Updated Gist ${gistId}:\n${content}`);
}

const stats = await fetchStats();
await updateGist(stats);

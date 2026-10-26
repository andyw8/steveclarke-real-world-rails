import {
  badge,
  element,
  formatDate,
  formatNumber,
  formatSize,
  openDatabase,
  query,
  splitList,
  yesNo
} from "./database.js";

const REPOSITORY_QUERY = `
  SELECT
    r.*,
    (SELECT group_concat(DISTINCT c.type) FROM contents c WHERE c.repo_id = r.id) AS kinds,
    (SELECT group_concat(DISTINCT c.rails_version) FROM contents c WHERE c.repo_id = r.id AND c.rails_version IS NOT NULL) AS rails_versions
  FROM repos r
  WHERE r.name = ?
`;

const CONTENTS_QUERY = `
  SELECT type, path, ruby_version, rails_version, gemfile_lock, stimulus, last_commit
  FROM contents
  WHERE repo_id = ?
  ORDER BY type, path
`;

const TOPICS_QUERY = `
  SELECT topic
  FROM repo_topics
  WHERE repo_id = ?
  ORDER BY topic
`;

const statusElement = document.getElementById("status");
const repositoryName = new URLSearchParams(window.location.search).get("name");

async function main() {
  if (!repositoryName) {
    fail("No repository specified.");
    return;
  }

  try {
    const database = await openDatabase();
    let repository;
    let contents;
    let topics;

    try {
      [repository] = query(database, REPOSITORY_QUERY, [repositoryName]);

      if (!repository) {
        fail(`No repository named "${repositoryName}".`);
        return;
      }

      contents = query(database, CONTENTS_QUERY, [repository.id]);
      topics = query(database, TOPICS_QUERY, [repository.id]).map(
        (row) => row.topic
      );
    } finally {
      database.close();
    }

    render(repository, contents, topics);
    statusElement.hidden = true;
  } catch (error) {
    fail(`Error: ${error.message}`);
    console.error(error);
  }
}

function render(repository, contents, topics) {
  document.title = `${repository.name} · Real World Rails`;

  document.getElementById("repo-name").textContent = repository.name;
  document.getElementById("repo-description").textContent =
    repository.description || "No description provided.";

  const badges = document.getElementById("repo-badges");
  for (const kind of splitList(repository.kinds)) {
    badges.append(badge(kind));
  }
  if (repository.archived) badges.append(badge("archived", "badge-warning"));
  if (repository.fork) badges.append(badge("fork"));

  const githubLink = document.getElementById("github-link");
  githubLink.href = repository.url;

  if (repository.homepage_url) {
    const homepageLink = document.getElementById("homepage-link");
    homepageLink.href = repository.homepage_url;
    homepageLink.hidden = false;
  }

  renderStats(repository, contents);
  renderTopics(topics);
  renderContents(contents);
  renderDetails(repository);
}

function renderStats(repository, contents) {
  const railsVersions = [
    ...new Set(contents.map((content) => content.rails_version).filter(Boolean))
  ];
  const lastCommit = contents
    .map((content) => content.last_commit)
    .filter(Boolean)
    .sort()
    .at(-1);

  const stats = [
    [formatNumber(repository.stars), "Stars"],
    [formatNumber(repository.forks), "Forks"],
    [formatNumber(repository.watchers), "Watchers"],
    [repository.language || "—", "Language"],
    [railsVersions.join(", ") || "—", "Rails"],
    [lastCommit || "—", "Last commit"]
  ];

  document.getElementById("stats").replaceChildren(
    ...stats.map(([value, label]) => {
      const stat = element("div", "stat");
      const statValue = element("span", "stat-value", value);
      if (value.length > 8) statValue.classList.add("stat-value-small");
      stat.append(
        statValue,
        element("span", "stat-label", label)
      );
      return stat;
    })
  );
}

function renderTopics(topics) {
  if (topics.length === 0) return;

  document
    .getElementById("topics")
    .replaceChildren(...topics.map((topic) => badge(topic)));
  document.getElementById("topics-section").hidden = false;
}

function renderContents(contents) {
  const body = document.getElementById("contents-body");

  if (contents.length === 0) {
    document.getElementById("contents").hidden = true;
    document.getElementById("contents-empty").hidden = false;
    return;
  }

  body.replaceChildren(
    ...contents.map((content) => {
      const row = document.createElement("tr");
      row.append(
        cell(badge(content.type)),
        cell(element("code", null, content.path)),
        cell(content.ruby_version || "—"),
        cell(content.rails_version || "—"),
        cell(yesNo(content.gemfile_lock)),
        cell(yesNo(content.stimulus)),
        cell(content.last_commit || "—")
      );
      return row;
    })
  );
}

function renderDetails(repository) {
  const details = document.getElementById("details");
  details.replaceChildren();

  addDetail(
    details,
    "GitHub",
    externalLink(repository.url, repository.slug || repository.url)
  );
  addDetail(details, "Local path", element("code", null, repository.path));
  addDetail(
    details,
    "Homepage",
    repository.homepage_url
      ? externalLink(repository.homepage_url, repository.homepage_url)
      : "—"
  );
  addDetail(details, "License", license(repository));
  addDetail(details, "Visibility", titleCase(repository.visibility));
  addDetail(details, "Default branch", repository.default_branch || "—");
  addDetail(details, "Size on disk", formatSize(repository.disk_usage_kb));
  addDetail(details, "Issues enabled", yesNo(repository.has_issues));
  addDetail(
    details,
    "Discussions enabled",
    yesNo(repository.has_discussions)
  );
  addDetail(details, "Created", formatDate(repository.created_at));
  addDetail(details, "Updated", formatDate(repository.updated_at));
  addDetail(details, "Last pushed", formatDate(repository.pushed_at));
}

function addDetail(details, term, value) {
  details.append(element("dt", null, term));

  const description = document.createElement("dd");
  if (value instanceof Node) {
    description.append(value);
  } else {
    description.textContent = value ?? "—";
  }

  details.append(description);
}

function cell(value) {
  const cellElement = document.createElement("td");

  if (value instanceof Node) {
    cellElement.append(value);
  } else {
    cellElement.textContent = value;
  }

  return cellElement;
}

function externalLink(href, text) {
  const link = element("a", null, text);
  link.href = href;
  link.target = "_blank";
  link.rel = "noopener";
  return link;
}

function license(repository) {
  if (!repository.license_name) return repository.license_key || "—";
  if (!repository.license_key) return repository.license_name;
  return `${repository.license_name} (${repository.license_key})`;
}

function titleCase(value) {
  if (!value) return "—";
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

function fail(message) {
  statusElement.textContent = message;
  statusElement.classList.add("error");
  document.title = "Repository not found · Real World Rails";
}

main();

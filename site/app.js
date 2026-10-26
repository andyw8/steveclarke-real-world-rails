import {
  badge,
  element,
  formatNumber,
  openDatabase,
  query,
  splitList
} from "./database.js";

const REPOSITORY_QUERY = `
  SELECT
    r.name,
    r.path,
    r.description,
    r.stars,
    r.forks,
    r.archived,
    (SELECT group_concat(DISTINCT c.type) FROM contents c WHERE c.repo_id = r.id) AS kinds,
    (SELECT group_concat(DISTINCT c.rails_version) FROM contents c WHERE c.repo_id = r.id AND c.rails_version IS NOT NULL) AS rails_versions,
    (SELECT MAX(c.last_commit) FROM contents c WHERE c.repo_id = r.id) AS last_commit,
    (SELECT group_concat(t.topic, ' · ') FROM repo_topics t WHERE t.repo_id = r.id) AS topics
  FROM repos r
  ORDER BY r.stars DESC, r.name COLLATE NOCASE
`;

const NAME_COLLATOR = new Intl.Collator("en", {
  sensitivity: "base",
  numeric: true
});

const SORT_ORDERS = {
  stars: (a, b) => descending(a.stars, b.stars) || byName(a, b),
  forks: (a, b) => descending(a.forks, b.forks) || byName(a, b),
  name: byName,
  updated: (a, b) =>
    (b.last_commit ?? "").localeCompare(a.last_commit ?? "") || byName(a, b),
  rails: (a, b) => compareVersions(b.railsSort, a.railsSort) || byName(a, b)
};

const controls = document.getElementById("controls");
const statusElement = document.getElementById("status");
const filterElement = document.getElementById("filter");
const sortElement = document.getElementById("sort");
const minRailsElement = document.getElementById("min-rails");
const hideArchivedElement = document.getElementById("hide-archived");
const resetElement = document.getElementById("reset");
const listElement = document.getElementById("repos");

let repositories = [];

async function main() {
  try {
    const database = await openDatabase();
    let rows;

    try {
      rows = query(database, REPOSITORY_QUERY);
    } finally {
      database.close();
    }

    repositories = rows.map((repository) => ({
      ...repository,
      section: repository.path?.startsWith("engines/") ? "engine" : "app",
      railsSort: latestVersion(repository.rails_versions),
      searchText: [
        repository.name,
        repository.path,
        repository.description,
        repository.rails_versions,
        repository.topics
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
    }));

    populateRailsVersions();
    controls.disabled = false;
    render();
  } catch (error) {
    statusElement.textContent = `Error: ${error.message}`;
    statusElement.classList.add("error");
    console.error(error);
  }
}

function render() {
  const needle = filterElement.value.trim().toLowerCase();
  const kind = document.querySelector('input[name="kind"]:checked').value;
  const minimumRails = minRailsElement.value;
  const hideArchived = hideArchivedElement.checked;
  const filtered =
    needle !== "" ||
    kind !== "all" ||
    minimumRails !== "any" ||
    hideArchived;
  const sort = SORT_ORDERS[sortElement.value] ?? SORT_ORDERS.stars;

  const matches = repositories
    .filter((repository) =>
      matchesFilters(repository, needle, kind, minimumRails, hideArchived)
    )
    .sort(sort);

  listElement.replaceChildren(...matches.map(createRepositoryItem));

  if (matches.length === 0) {
    listElement.append(
      element("li", "empty", "No repositories match these filters.")
    );
  }

  statusElement.textContent = filtered
    ? `${matches.length} of ${repositories.length} repositories`
    : `${repositories.length} repositories`;

  resetElement.hidden =
    !filtered && sortElement.value === "stars" && !hideArchived;
}

function matchesFilters(repository, needle, kind, minimumRails, hideArchived) {
  if (hideArchived && repository.archived) return false;

  if (kind !== "all" && repository.section !== kind) {
    return false;
  }

  if (
    minimumRails !== "any" &&
    (!repository.railsSort || repository.railsSort[0] < Number(minimumRails))
  ) {
    return false;
  }

  return needle === "" || repository.searchText.includes(needle);
}

function populateRailsVersions() {
  const majors = [
    ...new Set(
      repositories
        .map((repository) => repository.railsSort?.[0])
        .filter((major) => major !== null && major !== undefined && major > 0)
    )
  ].sort((left, right) => right - left);

  minRailsElement.append(
    ...majors.map((major) => {
      const option = document.createElement("option");
      option.value = String(major);
      option.textContent = `${major}.x or newer`;
      return option;
    })
  );
}

function createRepositoryItem(repository) {
  const item = element("li", "repository");
  const title = element("div", "repository-title");

  const link = element("a", "repository-name", repository.name);
  link.href = `repo.html?name=${encodeURIComponent(repository.name)}`;
  title.append(link);

  for (const kind of splitList(repository.kinds)) {
    title.append(badge(kind));
  }

  if (repository.archived) {
    title.append(badge("archived", "badge-warning"));
  }

  if (repository.stars !== null) {
    const stars = element("span", "stars", `★ ${formatNumber(repository.stars)}`);
    stars.title = `${formatNumber(repository.stars)} GitHub stars`;
    title.append(stars);
  }

  item.append(title);

  if (repository.description) {
    item.append(element("p", "description", repository.description));
  }

  const meta = element("div", "meta");
  meta.append(element("span", "path", repository.path));

  const railsVersions = splitList(repository.rails_versions);
  if (railsVersions.length > 0) {
    meta.append(element("span", null, `Rails ${railsVersions.join(", ")}`));
  }

  if (repository.last_commit) {
    meta.append(element("span", null, `updated ${repository.last_commit}`));
  }

  if (repository.topics) {
    meta.append(element("span", "topics", repository.topics));
  }

  item.append(meta);
  return item;
}

function descending(left, right) {
  return (right ?? Number.NEGATIVE_INFINITY) - (left ?? Number.NEGATIVE_INFINITY);
}

function byName(left, right) {
  return NAME_COLLATOR.compare(left.name, right.name);
}

function compareVersions(left, right) {
  if (!left && !right) return 0;
  if (!left) return -1;
  if (!right) return 1;

  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }

  return 0;
}

function latestVersion(value) {
  const versions = splitList(value)
    .map((version) => version.match(/\d+(?:\.\d+)*/))
    .filter(Boolean)
    .map((match) => match[0].split(".").map(Number))
    .sort(compareVersions);

  return versions.at(-1) ?? null;
}

function resetFilters() {
  filterElement.value = "";
  sortElement.value = "stars";
  minRailsElement.value = "any";
  hideArchivedElement.checked = false;
  document.querySelector('input[name="kind"][value="all"]').checked = true;
  render();
}

controls.addEventListener("input", render);
resetElement.addEventListener("click", resetFilters);
main();

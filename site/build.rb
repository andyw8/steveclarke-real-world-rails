#!/usr/bin/env ruby
# frozen_string_literal: true

################################################################################
# Real World Rails Site Database
################################################################################
#
# Builds site/repos.sqlite from metadata/*.json (repository contents and Ruby /
# Rails versions) and metadata/github/*.json (GitHub API data).
#
# The database is read by the browser with sql.js, so it must only contain data
# that is safe to hand out publicly.
#
# USAGE
# -----
#   ruby site/build.rb
#
################################################################################

require "json"
require "open3"

ROOT = File.expand_path("..", __dir__)
METADATA_DIRECTORY = File.join(ROOT, "metadata")
GITHUB_DIRECTORY = File.join(METADATA_DIRECTORY, "github")
DATABASE_PATH = File.join(__dir__, "repos.sqlite")

SCHEMA = <<~SQL
  CREATE TABLE repos (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    path TEXT NOT NULL UNIQUE,
    slug TEXT,
    url TEXT NOT NULL,
    description TEXT,
    homepage_url TEXT,
    language TEXT,
    license_key TEXT,
    license_name TEXT,
    stars INTEGER,
    forks INTEGER,
    watchers INTEGER,
    disk_usage_kb INTEGER,
    default_branch TEXT,
    visibility TEXT,
    archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
    fork INTEGER NOT NULL DEFAULT 0 CHECK (fork IN (0, 1)),
    has_issues INTEGER,
    has_discussions INTEGER,
    image_url TEXT,
    created_at TEXT,
    updated_at TEXT,
    pushed_at TEXT
  );

  CREATE TABLE contents (
    id INTEGER PRIMARY KEY,
    repo_id INTEGER NOT NULL REFERENCES repos (id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('app', 'engine')),
    path TEXT NOT NULL,
    ruby_version TEXT,
    rails_version TEXT,
    gemfile_lock INTEGER CHECK (gemfile_lock IN (0, 1)),
    stimulus INTEGER CHECK (stimulus IN (0, 1)),
    last_commit TEXT,
    UNIQUE (repo_id, path)
  );

  CREATE TABLE repo_topics (
    repo_id INTEGER NOT NULL REFERENCES repos (id) ON DELETE CASCADE,
    topic TEXT NOT NULL,
    PRIMARY KEY (repo_id, topic)
  );

  CREATE INDEX index_repos_on_stars ON repos (stars);
  CREATE INDEX index_contents_on_repo_id ON contents (repo_id);
  CREATE INDEX index_repo_topics_on_topic ON repo_topics (topic);
SQL

def sql_literal(value)
  case value
  when nil then "NULL"
  when true then "1"
  when false then "0"
  when Integer then value.to_s
  else "'#{value.to_s.gsub("'", "''")}'"
  end
end

def insert(table, row)
  columns = row.keys.join(", ")
  values = row.values.map { |value| sql_literal(value) }.join(", ")
  "INSERT INTO #{table} (#{columns}) VALUES (#{values});"
end

def metadata_repositories
  Dir.glob(File.join(METADATA_DIRECTORY, "*.json")).sort.map do |path|
    metadata = JSON.parse(File.read(path))
    {
      name: metadata["name"] || File.basename(path, ".json"),
      path: metadata["path"],
      url: metadata["url"],
      contents: metadata["contents"] || []
    }
  end
end

def github_metadata
  Dir.glob(File.join(GITHUB_DIRECTORY, "*.json")).each_with_object({}) do |path, repositories|
    repositories[File.basename(path, ".json")] = JSON.parse(File.read(path))
  end
end

def repository_row(repository, github)
  {
    name: repository[:name],
    path: repository[:path],
    slug: github["nameWithOwner"],
    url: github["url"] || repository[:url],
    description: presence(github["description"]),
    homepage_url: presence(github["homepageUrl"]),
    language: github.dig("primaryLanguage", "name"),
    license_key: github.dig("licenseInfo", "key"),
    license_name: github.dig("licenseInfo", "name"),
    stars: github["stargazerCount"],
    forks: github["forkCount"],
    watchers: github.dig("watchers", "totalCount"),
    disk_usage_kb: github["diskUsage"],
    default_branch: github.dig("defaultBranchRef", "name"),
    visibility: github["visibility"],
    archived: github["isArchived"],
    fork: github["isFork"],
    has_issues: github["hasIssuesEnabled"],
    has_discussions: github["hasDiscussionsEnabled"],
    image_url: github["openGraphImageUrl"],
    created_at: github["createdAt"],
    updated_at: github["updatedAt"],
    pushed_at: github["pushedAt"]
  }
end

def content_row(repo_id, content)
  {
    repo_id: repo_id,
    type: content["type"],
    path: content["path"],
    ruby_version: presence(content["ruby_version"]),
    rails_version: presence(content["rails_version"]),
    gemfile_lock: content["gemfile_lock"],
    stimulus: content["stimulus"],
    last_commit: presence(content["last_commit"])
  }
end

def topic_rows(repo_id, github)
  Array(github["repositoryTopics"]).filter_map do |topic|
    name = topic["name"]
    { repo_id: repo_id, topic: name } if presence(name)
  end
end

def presence(value)
  value unless value.nil? || value.to_s.strip.empty?
end

def build_sql
  github_metadata_by_name = github_metadata
  repositories = metadata_repositories

  statements = [
    "BEGIN;",
    "DROP TABLE IF EXISTS repo_topics;",
    "DROP TABLE IF EXISTS contents;",
    "DROP TABLE IF EXISTS repos;",
    SCHEMA.strip
  ]

  contents_count = 0
  topics_count = 0

  repositories.each_with_index do |repository, index|
    repo_id = index + 1
    github = github_metadata_by_name.fetch(repository[:name], {})

    statements << insert("repos", repository_row(repository, github))

    repository[:contents].each do |content|
      statements << insert("contents", content_row(repo_id, content))
      contents_count += 1
    end

    topic_rows(repo_id, github).each do |topic|
      statements << insert("repo_topics", topic)
      topics_count += 1
    end
  end

  statements << "COMMIT;"

  [statements.join("\n"), repositories.size, contents_count, topics_count]
end

sql, repository_count, content_count, topic_count = build_sql
output, status = Open3.capture2("sqlite3", DATABASE_PATH, stdin_data: sql)

abort "Building #{DATABASE_PATH} failed: #{output}" unless status.success?

puts "Wrote #{DATABASE_PATH} " \
     "(#{repository_count} repos, #{content_count} contents, #{topic_count} topics, " \
     "#{File.size(DATABASE_PATH)} bytes)"

#!/usr/bin/env node

/**
 * Return whether GitHub associated a deployed commit with a merged PR that
 * targets this repository's master branch and has this exact merge SHA.
 *
 * Kept pure so the deployment guard can be tested without GitHub credentials.
 */
export function isValidProvenance(pullRequests, { repository, baseRef = "master", sha }) {
  return pullRequests.some((pullRequest) => (
    pullRequest?.merged_at != null
    && pullRequest.base?.ref === baseRef
    && pullRequest.base?.repo?.full_name === repository
    && pullRequest.merge_commit_sha === sha
  ));
}

export async function verifyProvenance({ fetchImpl = fetch, apiUrl, repository, sha, token }) {
  const response = await fetchImpl(
    `${apiUrl.replace(/\/$/, "")}/repos/${repository}/commits/${encodeURIComponent(sha)}/pulls`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );

  if (!response.ok) {
    throw new Error(`GitHub provenance lookup failed with HTTP ${response.status}`);
  }

  const pullRequests = await response.json();
  if (!Array.isArray(pullRequests) || !isValidProvenance(pullRequests, { repository, sha })) {
    throw new Error(`No merged PR targeting ${repository}:master has merge commit ${sha}`);
  }

  return true;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { GITHUB_API_URL: apiUrl, GITHUB_REPOSITORY: repository, GITHUB_SHA: sha, GITHUB_TOKEN: token } = process.env;

  if (!apiUrl || !repository || !sha || !token) {
    console.error("Missing GITHUB_API_URL, GITHUB_REPOSITORY, GITHUB_SHA, or GITHUB_TOKEN");
    process.exit(1);
  }

  try {
    await verifyProvenance({ apiUrl, repository, sha, token });
    console.log(`Provenance verified: ${sha} is the merge commit of a merged PR into ${repository}:master`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

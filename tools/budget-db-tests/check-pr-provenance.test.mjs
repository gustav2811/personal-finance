import test from "node:test";
import assert from "node:assert/strict";
import { isValidProvenance, verifyProvenance } from "./check-pr-provenance.mjs";

const repository = "example/investments";
const sha = "abc123";
const merged = {
  merged_at: "2026-09-30T08:00:00Z",
  base: { ref: "master", repo: { full_name: repository } },
  merge_commit_sha: sha,
};

test("accepts a merged PR with the exact base repository, branch, and SHA", () => {
  assert.equal(isValidProvenance([merged], { repository, sha }), true);
});

test("rejects a direct push without a merged PR", () => {
  assert.equal(isValidProvenance([], { repository, sha }), false);
});

test("rejects an unmerged pull request", () => {
  assert.equal(isValidProvenance([{ ...merged, merged_at: null }], { repository, sha }), false);
});

test("rejects a pull request with the wrong base branch, repository, or SHA", () => {
  assert.equal(isValidProvenance([{ ...merged, base: { ...merged.base, ref: "develop" } }], { repository, sha }), false);
  assert.equal(isValidProvenance([{ ...merged, base: { ...merged.base, repo: { full_name: "other/repo" } } }], { repository, sha }), false);
  assert.equal(isValidProvenance([{ ...merged, merge_commit_sha: "different" }], { repository, sha }), false);
});

test("fails closed when the GitHub API fails", async () => {
  await assert.rejects(
    verifyProvenance({
      apiUrl: "https://api.github.com",
      repository,
      sha,
      fetchImpl: async () => ({ ok: false, status: 503 }),
    }),
    /HTTP 503/,
  );
});

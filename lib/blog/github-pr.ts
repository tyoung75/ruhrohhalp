import { Octokit } from "@octokit/rest";

const SITE_REPO_OWNER = process.env.SITE_REPO_OWNER ?? "tyoung75";
const SITE_REPO_NAME = process.env.SITE_REPO_NAME ?? "bearduckhornempire.com";
const BLOG_CONTENT_PATH = process.env.BLOG_CONTENT_PATH ?? "content/blog";
const BASE_BRANCH = process.env.BLOG_BASE_BRANCH ?? "main";

function getOctokit() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return null;
  return new Octokit({ auth: token });
}

function b64(content: string): string {
  return Buffer.from(content).toString("base64");
}

export async function createBlogPR(slug: string, markdown: string, title: string) {
  const octokit = getOctokit();
  if (!octokit) return { ok: false as const, error: "github_not_configured" };

  const branch = `weekly-dev-log/${slug}`;
  const filePath = `${BLOG_CONTENT_PATH}/${slug}.md`;

  const base = await octokit.repos.getBranch({ owner: SITE_REPO_OWNER, repo: SITE_REPO_NAME, branch: BASE_BRANCH });
  await octokit.git.createRef({
    owner: SITE_REPO_OWNER,
    repo: SITE_REPO_NAME,
    ref: `refs/heads/${branch}`,
    sha: base.data.commit.sha,
  }).catch(() => null);

  await octokit.repos.createOrUpdateFileContents({
    owner: SITE_REPO_OWNER,
    repo: SITE_REPO_NAME,
    path: filePath,
    branch,
    message: `Add weekly dev log: ${slug}`,
    content: b64(markdown),
  });

  const pr = await octokit.pulls.create({
    owner: SITE_REPO_OWNER,
    repo: SITE_REPO_NAME,
    title,
    body: "Automated weekly dev log draft for review.",
    base: BASE_BRANCH,
    head: branch,
  });

  return { ok: true as const, url: pr.data.html_url, number: pr.data.number, branch, filePath };
}

export async function updateBlogPR(prNumber: number, slug: string, markdown: string) {
  const octokit = getOctokit();
  if (!octokit) return { ok: false as const, error: "github_not_configured" };

  const pr = await octokit.pulls.get({ owner: SITE_REPO_OWNER, repo: SITE_REPO_NAME, pull_number: prNumber });
  const branch = pr.data.head.ref;
  const filePath = `${BLOG_CONTENT_PATH}/${slug}.md`;

  const current = await octokit.repos.getContent({
    owner: SITE_REPO_OWNER,
    repo: SITE_REPO_NAME,
    path: filePath,
    ref: branch,
  });

  const sha = "sha" in current.data ? current.data.sha : undefined;

  await octokit.repos.createOrUpdateFileContents({
    owner: SITE_REPO_OWNER,
    repo: SITE_REPO_NAME,
    path: filePath,
    branch,
    sha,
    message: `Update weekly dev log after email review: ${slug}`,
    content: b64(markdown),
  });

  await octokit.pulls.merge({
    owner: SITE_REPO_OWNER,
    repo: SITE_REPO_NAME,
    pull_number: prNumber,
    merge_method: "squash",
  });

  return { ok: true as const };
}

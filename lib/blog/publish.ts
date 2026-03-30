import { updateBlogPR } from "@/lib/blog/github-pr";

export async function publishEditedBlog(params: {
  prNumber: number | null;
  slug: string;
  editedMarkdown: string;
}) {
  const { prNumber, slug, editedMarkdown } = params;
  if (!prNumber) {
    return { ok: false as const, error: "missing_pr_number" };
  }

  try {
    return await updateBlogPR(prNumber, slug, editedMarkdown);
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

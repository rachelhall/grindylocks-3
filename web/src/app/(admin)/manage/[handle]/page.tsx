import { notFound, redirect } from "next/navigation";

import { getMyPage } from "@/lib/admin";
import { firstSection, managePath } from "@/lib/page-sections";

/** /manage/<handle>: the first section this person can use on the page. */
export default async function ManagePage({ params }: PageProps<"/manage/[handle]">) {
  const { handle } = await params;
  const page = await getMyPage(handle);
  if (!page) notFound();
  redirect(managePath(page.handle, firstSection(page.roles, page.role)));
}

import { NotFoundPage } from '@/components/not-found-page';

/** Anything in the workspace that calls `notFound()` without a closer list to return to. */
export default async function WorkspaceNotFound() {
  return <NotFoundPage />;
}

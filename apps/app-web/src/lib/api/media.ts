import { callApi } from './browser';
import { ApiError } from './errors';

/** The categories the app uploads into (the API's `media.policy.ts` says who may, and what). */
export type MediaCategory = 'VERIFICATION_DOCUMENT' | 'AGENCY_LOGO' | 'AGENCY_COVER';

interface Authorization {
  assetId: string;
  upload: { url: string; fields: Record<string, string> };
}

/**
 * One file through the private flow (cloudinary-media): the API authorises an upload and signs
 * it; the file goes straight to storage; the API is told it is finished and checks it there. The
 * file never passes through our servers, and nothing about it is public until the API says so.
 * Returns the asset's id.
 */
export async function uploadMedia(file: File, category: MediaCategory): Promise<string> {
  const auth = await callApi<Authorization>('/media/uploads', {
    body: { category, mimeType: file.type, bytes: file.size },
  });
  const form = new FormData();
  for (const [key, value] of Object.entries(auth!.upload.fields)) form.append(key, value);
  form.append('file', file);
  const res = await fetch(auth!.upload.url, { method: 'POST', body: form });
  if (!res.ok) throw new ApiError(res.status, 'UPLOAD_FAILED', 'error.common.internal');
  await callApi(`/media/uploads/${encodeURIComponent(auth!.assetId)}/complete`);
  return auth!.assetId;
}

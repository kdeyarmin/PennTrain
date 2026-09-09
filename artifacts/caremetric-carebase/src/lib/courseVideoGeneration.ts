import type { Json } from "@/lib/database.types";

export function courseVideoGenerationJob(body: unknown): {
  attempt_id?: string; video_id?: string; status?: string; avatar_id?: string;
  voice_id?: string; script?: string; title?: string;
} | undefined {
  if (!body || typeof body !== "object" || Array.isArray(body)) return undefined;
  const job = (body as { heygen?: unknown }).heygen;
  return job && typeof job === "object" && !Array.isArray(job) ? job : undefined;
}

export function hasPendingCourseVideoGeneration(body: unknown): boolean {
  const job = courseVideoGenerationJob(body);
  return Boolean((job?.video_id || job?.attempt_id) && job?.status !== "completed" && job?.status !== "failed");
}

// A cloned version shares completed media, but never acquires authority over the original
// block's paid attempt. Copying an unresolved job would strand the new block's generation UI.
export function cloneCourseVideoBody(body: Json): Json {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  const { heygen: _job, ...content } = body;
  return content;
}

// Closed first-draft definition shared by the native form and delegated transport.
export type CourseCreation = { versionId: string; course: { title: string; description: string | null; category: string | null;
  estimatedDurationMinutes: number | null; trainingTypeId: string | null }; version: { title: string; description: string | null } };
export type CreationOptions = { trainingTypes: { id: string; label: string }[]; nextOffset: number | null };
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const EXCLUDED = /([?&](token|access_token|signature|sig|key|policy|jwt|auth|h|hdnts|hdnea|key-pair-id|api_key|apikey|x-amz-[a-z-]+|x-goog-[a-z-]+)=|"(access_?token|refresh_?token|service_?role_?key|authorization|password|client_?secret|storage_?(path|bucket)|video_?url|playback_?(url|token)|signed_?url|api_?key|token|secret|secret_?key|signing_?secret)"\s*:)/i;
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value: unknown, keys: string[]): value is Record<string, unknown> => object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const id = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);
const text = (value: unknown, maximum: number) => typeof value === 'string' && value === value.trim() && value.length >= 1 && value.length <= maximum && !/\p{Cc}/u.test(value);
const prose = (value: unknown) => value === null || typeof value === 'string' && value.length <= 12000 && !/\p{Cc}/u.test(value.replace(/[\r\n\t]/g, ''));
export function validCourseCreation(value: unknown): value is CourseCreation {
  if (!exact(value, ['versionId','course','version']) || !id(value.versionId)
    || !exact(value.course, ['title','description','category','estimatedDurationMinutes','trainingTypeId'])
    || !exact(value.version, ['title','description']) || !text(value.course.title, 300) || !text(value.version.title, 300)
    || !prose(value.course.description) || !prose(value.version.description)
    || value.course.category !== null && !text(value.course.category, 300)
    || value.course.trainingTypeId !== null && !id(value.course.trainingTypeId)
    || value.course.estimatedDurationMinutes !== null && (!Number.isSafeInteger(value.course.estimatedDurationMinutes)
      || (value.course.estimatedDurationMinutes as number) < 1 || (value.course.estimatedDurationMinutes as number) > 1440)) return false;
  const serialized = JSON.stringify(value);
  return new TextEncoder().encode(serialized).byteLength <= 24576 && !EXCLUDED.test(serialized);
}
export function validCreationOptions(value: unknown): value is CreationOptions {
  return exact(value, ['trainingTypes','nextOffset']) && Array.isArray(value.trainingTypes) && value.trainingTypes.length <= 100
    && value.trainingTypes.every(row => exact(row, ['id','label']) && id(row.id) && text(row.label, 500))
    && new Set(value.trainingTypes.map(row => row.id.toLowerCase())).size === value.trainingTypes.length
    && (value.nextOffset === null || Number.isSafeInteger(value.nextOffset) && (value.nextOffset as number) >= 100 && (value.nextOffset as number) <= 10000);
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Json } from "@/lib/database.types";
import { useAuth } from "@/lib/auth";

interface Parser<T> { parse(value: unknown): T }
const invalid = (): never => { throw new Error("Training discovery returned an unexpected response. Please reload and try again."); };
function object(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : invalid(); }
function text(value: unknown): string { return typeof value === "string" ? value : invalid(); }
function number(value: unknown): number { return typeof value === "number" && Number.isFinite(value) ? value : invalid(); }
function bool(value: unknown): boolean { return typeof value === "boolean" ? value : invalid(); }
function nullableText(value: unknown): string | null { return value === null ? null : text(value); }
function list<T>(value: unknown, parser: (item: unknown) => T): T[] { return Array.isArray(value) ? value.map(parser) : invalid(); }
export interface ElectiveCollection { id: string; title: string; description: string; interests: string[]; job_titles: string[]; course_ids: string[]; published: boolean }
export interface RefresherLesson { id: string; course_id: string | null; title: string; body: string; question: string; choices: string[]; minutes: number; revision: number; published: boolean }
export interface OwnerRefresherLesson extends RefresherLesson { correct_choice: number; explanation: string }
function collection(value: unknown): ElectiveCollection { const v = object(value); return { id: text(v.id), title: text(v.title), description: text(v.description), interests: list(v.interests, text), job_titles: list(v.job_titles, text), course_ids: list(v.course_ids, text), published: bool(v.published) }; }
function metadata(value: unknown) { const v = object(value); return { course_id: text(v.course_id), language: nullableText(v.language), credit_statement: nullableText(v.credit_statement), credit_evidence_url: nullableText(v.credit_evidence_url) }; }
function lesson(value: unknown): RefresherLesson { const v = object(value); return { id: text(v.id), course_id: nullableText(v.course_id), title: text(v.title), body: text(v.body), question: text(v.question), choices: list(v.choices, text), minutes: number(v.minutes), revision: number(v.revision), published: bool(v.published) }; }
function ownerLesson(value: unknown): OwnerRefresherLesson { const v = object(value); return { ...lesson(v), correct_choice: number(v.correct_choice), explanation: text(v.explanation) }; }
export const librarySchema = { parse(value: unknown) { const v = object(value); return { saved: list(v.saved, text), interests: list(v.interests, text), job_title: nullableText(v.job_title), collections: list(v.collections, collection), metadata: list(v.metadata, metadata) }; } };
export const ownerLibrarySchema = { parse(value: unknown) { const v = object(value); return { collections: list(v.collections, collection), lessons: list(v.lessons, ownerLesson), metadata: list(v.metadata, metadata) }; } };
export const refresherFeedSchema = { parse(value: unknown) { const v = object(value); return { enabled: bool(v.enabled), frequency_days: number(v.frequency_days), lessons: list(v.lessons, lesson), history: list(v.history, item => { const r = object(item); return { title: text(r.title), correct: bool(r.correct), answered_at: text(r.answered_at) }; }) }; } };
export const facilityRefreshersSchema = { parse(value: unknown) { const v = object(value); return { enabled: bool(v.enabled), frequency_days: number(v.frequency_days), responses: list(v.responses, item => { const r = object(item); return { employee_id: text(r.employee_id), employee_name: text(r.employee_name), lesson: text(r.lesson), correct: bool(r.correct), answered_at: text(r.answered_at) }; }) }; } };
export const answerSchema = { parse(value: unknown) { const v = object(value); return { correct: bool(v.correct), explanation: text(v.explanation), correct_answer: text(v.correct_answer) }; } };

export async function trainingDiscovery(action: string, payload: Json = {}) {
  const { data, error } = await supabase.rpc("training_discovery", { p_action: action, p_payload: payload });
  if (error) throw error;
  return data;
}

export function useTrainingDiscovery<T>(action: string, schema: Parser<T>, payload: Json = {}, enabled = true) {
  const { user } = useAuth();
  return useQuery({ queryKey: ["training_discovery", user?.id, action, payload], enabled: enabled && !!user,
    queryFn: async () => schema.parse(await trainingDiscovery(action, payload)), staleTime: 30000 });
}

export function useSaveTrainingDiscovery() {
  const cache = useQueryClient();
  return useMutation({ mutationFn: ({ action, payload }: { action: string; payload: Json }) => trainingDiscovery(action, payload),
    onSuccess: () => cache.invalidateQueries({ queryKey: ["training_discovery"] }) });
}

/** Suggestions never assign courses. Exact normalized matches avoid guessing a clinical role. */
export function recommendedCollections(collections: ElectiveCollection[], interests: string[], jobTitle: string | null) {
  const selected = new Set(interests.map(value => value.trim().toLowerCase()));
  const role = jobTitle?.trim().toLowerCase();
  return collections.filter(collection => collection.interests.some(value => selected.has(value.trim().toLowerCase()))
    || !!role && collection.job_titles.some(value => value.trim().toLowerCase() === role));
}

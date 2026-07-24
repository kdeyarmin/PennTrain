// PT-026: AI data minimization -- unconditional pseudonymization of person
// identifiers before any tenant text is sent to the AI provider.
//
// Design:
// - A per-request AliasDirectory maps real names and room numbers to stable
//   aliases ("Resident 1", "Staff 2", "Person 3", "Room 1"). The provider only
//   ever sees aliases; the model is instructed to use them verbatim, and the
//   calling function re-substitutes real values into the model OUTPUT before
//   it is shown to (or stored for) users, so authorized viewers still read
//   real names.
// - Redaction is not a toggle. The calling edge functions always run it; there
//   is deliberately no setting that turns it off.
// - Alias numbering is stable within a request (first registration wins), so
//   the same person is always the same alias in one prompt/response exchange.
//   The per-run alias map is persisted with the copilot receipt so audits can
//   reconstruct the real-name reading of what was sent.
// - Pure logic only (no env access, no I/O) so it is deno-testable without
//   --allow-env, per the _shared convention.
//
// Honest boundary (kept in sync with the calling functions' comments):
// - Only names KNOWN to the caller (fetched under the caller's own RLS from
//   residents/employees/etc.) can be aliased in free text. A person name that
//   appears only inside free text (e.g. a surveyor named in a violation
//   description) is not recognized and passes through.
// - Lone first/last-name matching is reasonable-effort and only enabled for
//   the request's primary subject; common-word name collisions ("May",
//   "Walker") are skipped so clinical meaning is not corrupted.
// - Internal UUIDs, statuses, operational due/occurred dates, job titles, and
//   facility names are sent as-is: they are pseudonymous or business-level,
//   and the compliance reasoning needs them.

export type AliasKind = "resident" | "staff" | "person" | "room";

const ALIAS_PREFIX: Record<AliasKind, string> = {
  resident: "Resident",
  staff: "Staff",
  person: "Person",
  room: "Room",
};

export interface AliasMapEntry {
  alias: string;
  value: string;
  kind: AliasKind;
}

interface DirectoryEntry extends AliasMapEntry {
  variants: string[]; // regex-source fragments for the combined redaction pass
}

// Lone-part matching skips names that collide with ordinary clinical or
// assessment vocabulary: replacing them would corrupt the meaning the model
// needs ("may need help", "uses a walker", "rose from the chair"). Full
// "First Last" matches are unaffected by this list.
const AMBIGUOUS_NAME_WORDS = new Set([
  "may", "june", "april", "august", "summer", "autumn", "dawn", "rose", "lily",
  "daisy", "iris", "olive", "violet", "pearl", "ruby", "hazel",
  "grace", "hope", "faith", "joy", "will", "bill", "sue", "mark", "frank",
  "art", "guy", "gene", "pat", "norm", "jean", "carol", "wade", "chase",
  "walker", "cook", "baker", "mason", "carpenter", "stone", "wood", "woods",
  "brooks", "fields", "wells", "banks", "bell", "berry", "marsh", "rice",
  "young", "long", "short", "little", "white", "black", "brown", "green",
  "gray", "grey", "golden", "strong", "moody", "settle",
]);

function normalizeMatch(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export class AliasDirectory {
  #entries: DirectoryEntry[] = [];
  #byKey = new Map<string, DirectoryEntry>();
  #byAlias = new Map<string, DirectoryEntry>();
  #variantToEntry = new Map<string, DirectoryEntry>();
  #counters: Record<AliasKind, number> = { resident: 0, staff: 0, person: 0, room: 0 };
  #redactRegex: RegExp | null = null;

  get size(): number {
    return this.#entries.length;
  }

  entries(): AliasMapEntry[] {
    return this.#entries.map(({ alias, value, kind }) => ({ alias, value, kind }));
  }

  // Entries whose alias actually appears in the given texts -- used to persist
  // only the aliases a prompt used, instead of the whole facility roster.
  usedEntries(texts: Array<string | null | undefined>): AliasMapEntry[] {
    const haystack = texts.filter(Boolean).join("\n");
    return this.#entries
      .filter((entry) => new RegExp(`\\b${escapeRegExp(entry.alias)}\\b`, "i").test(haystack))
      .map(({ alias, value, kind }) => ({ alias, value, kind }));
  }

  // Registers a person and returns their stable alias (or null for a blank
  // name). Registering the same normalized name+kind again returns the same
  // alias. `matchNameParts` additionally matches the lone first/last name in
  // free text -- enable it only for the request's primary subject, where a
  // bare given name almost certainly refers to them.
  registerPerson(
    kind: Exclude<AliasKind, "room">,
    name: { firstName?: string | null; lastName?: string | null; fullName?: string | null },
    options: { matchNameParts?: boolean } = {},
  ): string | null {
    const first = name.firstName?.trim() ?? "";
    const last = name.lastName?.trim() ?? "";
    const full = (name.fullName?.trim() || `${first} ${last}`).replace(/\s+/g, " ").trim();
    if (!full) return null;
    const key = `${kind}:${normalizeMatch(full)}`;
    let entry = this.#byKey.get(key);
    if (!entry) {
      this.#counters[kind] += 1;
      entry = { alias: `${ALIAS_PREFIX[kind]} ${this.#counters[kind]}`, value: full, kind, variants: [] };
      this.#entries.push(entry);
      this.#byKey.set(key, entry);
      this.#byAlias.set(normalizeMatch(entry.alias), entry);
      const parts = full.split(/\s+/);
      this.#addVariant(entry, full, parts.map(escapeRegExp).join("\\s+"));
      if (parts.length >= 2) {
        // "Last, First" roster/signature ordering.
        const firstPart = parts[0];
        const lastPart = parts[parts.length - 1];
        this.#addVariant(
          entry,
          `${lastPart}, ${firstPart}`,
          `${escapeRegExp(lastPart)},\\s+${escapeRegExp(firstPart)}`,
        );
      }
    }
    if (options.matchNameParts) {
      for (const part of full.split(/\s+/)) {
        if (part.length < 3 || AMBIGUOUS_NAME_WORDS.has(part.toLowerCase())) continue;
        this.#addVariant(entry, part, escapeRegExp(part));
      }
    }
    return entry.alias;
  }

  // Registers a room and returns its alias. Only the phrase "room <value>" is
  // matched in text -- replacing a bare room number ("204") anywhere it
  // appears would corrupt unrelated numbers (dates, counts, dosages).
  registerRoom(room: string | null | undefined): string | null {
    const value = (room ?? "").trim().replace(/^room\s+/i, "");
    if (!value) return null;
    const key = `room:${normalizeMatch(value)}`;
    let entry = this.#byKey.get(key);
    if (!entry) {
      this.#counters.room += 1;
      entry = { alias: `Room ${this.#counters.room}`, value: `room ${value}`, kind: "room", variants: [] };
      this.#entries.push(entry);
      this.#byKey.set(key, entry);
      this.#byAlias.set(normalizeMatch(entry.alias), entry);
      this.#addVariant(entry, `room ${value}`, `room\\s+${escapeRegExp(value)}`);
    }
    return entry.alias;
  }

  #addVariant(entry: DirectoryEntry, matchedText: string, pattern: string) {
    const key = normalizeMatch(matchedText);
    // First registration wins on collisions (e.g. two residents sharing a
    // first name with matchNameParts): an ambiguous lone token keeps its first
    // owner rather than silently switching people.
    if (!key || this.#variantToEntry.has(key)) return;
    this.#variantToEntry.set(key, entry);
    entry.variants.push(pattern);
    this.#redactRegex = null;
  }

  #pattern(): RegExp | null {
    if (!this.#redactRegex) {
      const patterns = this.#entries
        .flatMap((entry) => entry.variants)
        // Longest-first so "John\s+Smith" wins over a lone "John" alternative.
        .sort((a, b) => b.length - a.length);
      if (patterns.length === 0) return null;
      this.#redactRegex = new RegExp(`\\b(?:${patterns.join("|")})\\b`, "gi");
    }
    this.#redactRegex.lastIndex = 0;
    return this.#redactRegex;
  }

  // Replaces registered names/rooms with their aliases. Case-insensitive,
  // whitespace-tolerant; possessives survive naturally ("John Smith's" ->
  // "Resident 1's"). Single pass, so replaced spans are never re-scanned.
  redactText(text: string): string {
    if (!text) return text;
    const regex = this.#pattern();
    if (!regex) return text;
    return text.replace(regex, (match) => this.#variantToEntry.get(normalizeMatch(match))?.alias ?? match);
  }

  // Re-substitutes real values for alias tokens in model output. The model
  // only ever saw aliases, so any "Resident N" token in its output came from
  // us; unknown numbers are left untouched. The (?!:?\d) guard keeps clinical
  // ratios intact ("provides the resident 1:1 support" is not an alias use).
  restoreText(text: string): string {
    if (!text || this.#entries.length === 0) return text;
    return text.replace(
      /\b(resident|staff|person|room)\s+(\d+)(?![.:]?\d)\b/gi,
      (match, prefix: string, num: string) => {
        const entry = this.#byAlias.get(`${prefix.toLowerCase()} ${num}`);
        return entry ? entry.value : match;
      },
    );
  }
}

// Deep string transform over a JSON-shaped value (objects/arrays/strings).
// Keys are left untouched; non-string leaves pass through.
export function transformStrings<T>(value: T, transform: (text: string) => string): T {
  if (typeof value === "string") return transform(value) as unknown as T;
  if (Array.isArray(value)) {
    return value.map((item) => transformStrings(item, transform)) as unknown as T;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, transformStrings(item, transform)]),
    ) as unknown as T;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Direct-identifier scrubbers (pattern-based, name-independent).
// ---------------------------------------------------------------------------

export function scrubSsnLike(text: string): string {
  return text
    .replace(/\b\d{3}[- ]\d{2}[- ]\d{4}\b/g, "[SSN removed]")
    .replace(/\b\d{9}\b/g, "[SSN removed]");
}

const MONTH = String.raw`(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?`;
const DATE_TOKEN = String.raw`(?:\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{2,4}|${MONTH}\s+\d{1,2},?\s+\d{4})`;
const BIRTHDATE_REGEX = new RegExp(
  String.raw`\b(dob|date\s+of\s+birth|birth\s*date|born(?:\s+on)?)\b\s*[:\-]?\s*(${DATE_TOKEN})`,
  "gi",
);

// Reduces an exact birthdate to its year (age-band context stays useful for a
// wellness summary; the exact date is a direct identifier). Dates NOT marked
// as birthdates (assessment dates, signature dates) are operational and kept.
export function scrubBirthdates(text: string): string {
  return text.replace(BIRTHDATE_REGEX, (_match, label: string, date: string) => {
    const year = date.match(/\b(?:18|19|20)\d{2}\b/)?.[0];
    return year ? `${label}: ${year}` : `${label}: [removed]`;
  });
}

export function scrubPhones(text: string): string {
  return text
    .replace(/(?:\+?1[-. ])?\(\d{3}\)\s?\d{3}[-. ]?\d{4}\b/g, "[phone removed]")
    .replace(/\b(?:1[-. ])?\d{3}[-. ]\d{3}[-. ]\d{4}\b/g, "[phone removed]")
    .replace(/\b\d{10}\b/g, "[phone removed]");
}

export function scrubEmails(text: string): string {
  return text.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "[email removed]");
}

const STREET_SUFFIX =
  "(?:street|st|avenue|ave|road|rd|drive|dr|lane|ln|boulevard|blvd|court|ct|circle|cir|place|pl|terrace|ter|highway|hwy|pike|parkway|pkwy|trail|trl)";
const ADDRESS_REGEX = new RegExp(
  String.raw`\b\d{1,6}\s+(?:[A-Za-z][A-Za-z'.-]*\s+){1,3}${STREET_SUFFIX}\.?\b(?:\s*,?\s*(?:apt|unit|suite|ste|#)\s*[\w-]+)?`,
  "gi",
);

export function scrubStreetAddresses(text: string): string {
  return text.replace(ADDRESS_REGEX, "[address removed]");
}

// Combined pattern scrub. Order matters: birthdates first so their date text
// is reduced to a year before any other pattern could touch it.
export function scrubDirectIdentifierText(text: string): string {
  return scrubStreetAddresses(scrubEmails(scrubPhones(scrubSsnLike(scrubBirthdates(text)))));
}

// ---------------------------------------------------------------------------
// Compliance-copilot seams.
// ---------------------------------------------------------------------------

export interface RedactableEvidence {
  id: string;
  label: string;
  details: Record<string, unknown>;
}

// Pseudonymizes evidence for the provider call. `id` and `route` must stay
// byte-identical to the originals: the grounding self-check
// (validateGroundedResponse) and the user-facing citation links are keyed on
// them. Statuses and dates are operational, not identifying, and stay.
export function redactEvidenceForModel<E extends RedactableEvidence>(
  items: E[],
  directory: AliasDirectory,
): E[] {
  return items.map((item) => ({
    ...item,
    label: directory.redactText(item.label),
    details: transformStrings(item.details, (text) => directory.redactText(text)),
  }));
}

export interface RestorableCopilotResponse {
  answer: string;
  findings: Array<{ title: string; detail: string; evidence_ids: string[] }>;
  missing_information: string[];
  recommended_next_steps: string[];
}

// Re-substitutes real names into the model's structured output. Only prose
// fields are touched -- source_ids/evidence_ids are opaque identifiers the
// grounding validation depends on, and alias tokens cannot occur inside them
// (their "resident-compliance:<uuid>" shape never matches "Resident <n>").
export function restoreCopilotResponseText<R extends RestorableCopilotResponse>(
  response: R,
  directory: AliasDirectory,
): R {
  return {
    ...response,
    answer: directory.restoreText(response.answer),
    findings: response.findings.map((finding) => ({
      ...finding,
      title: directory.restoreText(finding.title),
      detail: directory.restoreText(finding.detail),
    })),
    missing_information: response.missing_information.map((item) => directory.restoreText(item)),
    recommended_next_steps: response.recommended_next_steps.map((item) => directory.restoreText(item)),
  };
}

// ---------------------------------------------------------------------------
// Resident-assessment-summary seam.
// ---------------------------------------------------------------------------

// Pseudonymizes a resident_assessment_forms.content document before it is
// serialized into the provider prompt:
// 1. Structural name fields (assessor, participant rows) are replaced with
//    aliases -- registering them so free-text mentions elsewhere in the form
//    are caught too. The participant row whose relationship is "Resident" is
//    the resident and gets lone first/last-name matching.
// 2. Every string in the document then runs through the alias directory and
//    the direct-identifier scrubbers (SSN, phone, email, street address,
//    exact birthdate -> year).
// Clinical/functional content (degree ratings, service needs, plans,
// diagnoses, frequencies) passes through otherwise unchanged. Relationship
// labels, titles, and signature dates are kept: they are role/administrative
// context the summary legitimately reasons about.
export function redactAssessmentContent(
  content: Record<string, unknown>,
  directory: AliasDirectory,
): Record<string, unknown> {
  const clone = transformStrings(content, (text) => text);
  const participation = clone.participation as Record<string, unknown> | undefined;
  if (participation && typeof participation === "object") {
    const assessorName = participation.assessorName;
    if (typeof assessorName === "string" && assessorName.trim()) {
      participation.assessorName = directory.registerPerson("staff", { fullName: assessorName }) ?? "";
    }
    if (Array.isArray(participation.participants)) {
      for (const row of participation.participants) {
        if (!row || typeof row !== "object") continue;
        const participant = row as Record<string, unknown>;
        const name = typeof participant.name === "string" ? participant.name.trim() : "";
        if (!name) continue;
        const relationship = typeof participant.relationshipToResident === "string"
          ? participant.relationshipToResident.trim().toLowerCase()
          : "";
        const kind = relationship === "resident" ? ("resident" as const) : ("person" as const);
        participant.name = directory.registerPerson(
          kind,
          { fullName: name },
          kind === "resident" ? { matchNameParts: true } : {},
        ) ?? "";
      }
    }
  }
  return transformStrings(clone, (text) => scrubDirectIdentifierText(directory.redactText(text)));
}

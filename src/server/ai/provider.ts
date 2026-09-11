import "server-only";

/**
 * The AI provider port (§22).
 *
 * Everything in this application that could use a language model goes through
 * this interface, for the reason §22 gives: no architecture hard-coded around
 * one external provider. Swapping or adding one means writing an object with
 * these methods and changing `aiProvider()` at the bottom.
 *
 * The default implementation uses no external service at all. That is a
 * deliberate position rather than a placeholder:
 *
 * - **Candidate resumes are PII.** Sending them to a third party is a decision
 *   with legal weight, and it is not one this code should make silently on
 *   behalf of whoever deploys it. Until somebody configures a provider, no
 *   candidate data leaves the building.
 * - **Most of what the spec asks for is not a language problem.** Match
 *   scoring is arithmetic over structured fields. Job-description parsing is
 *   extraction against a known vocabulary of skills the organisation already
 *   uses. A local implementation of those is explainable, testable, free and
 *   instant — and for the parsing case, reliably better than a general model
 *   guessing at an unfamiliar taxonomy.
 * - **A model earns its place on the residue.** Free-text summarisation, and
 *   resumes whose formatting defeats extraction. Those are what a configured
 *   provider would be for, and the port is where it plugs in.
 *
 * Anything a provider returns is treated as *untrusted input*: a resume is a
 * document supplied by a third party, and text inside it that looks like an
 * instruction is still text. Nothing in this application feeds model output
 * into a query, a permission check or a tool call. Extraction results are
 * shown to a person to confirm before anything is written (§17).
 */

export interface ExtractionField<T> {
  value: T;
  /** 0–1. Drives whether the review form pre-fills or merely suggests. */
  confidence: number;
  /** The span of source text this came from, so a reviewer can check it. */
  evidence: string;
}

export interface ParsedRequirement {
  title: ExtractionField<string>;
  requiredSkills: ExtractionField<string[]>;
  preferredSkills: ExtractionField<string[]>;
  experienceMin: ExtractionField<number>;
  experienceMax: ExtractionField<number>;
  location: ExtractionField<string>;
  workMode: ExtractionField<string>;
  workAuthorization: ExtractionField<string[]>;
  employmentType: ExtractionField<string>;
  minSalary: ExtractionField<number | null>;
  maxSalary: ExtractionField<number | null>;
  billRateMin: ExtractionField<number | null>;
  billRateMax: ExtractionField<number | null>;
  priority: ExtractionField<string>;
  interviewProcess: ExtractionField<string>;
  /** Anything the parser could not place, so nothing is silently dropped. */
  unmatched: string[];
}

export interface AiProvider {
  readonly name: string;
  /** True when this provider sends data to a third party. Shown to the user. */
  readonly external: boolean;
  parseRequirement(text: string, vocabulary: string[]): Promise<ParsedRequirement>;
}

let provider: AiProvider | null = null;

/**
 * The single place a provider is chosen.
 *
 * A hosted implementation would branch here on `AI_PROVIDER`, exactly as the
 * attachment store branches on `ATTACHMENT_STORE`. Until one is configured
 * and a deployment has decided its posture on sending candidate data outside,
 * the local engine is what runs.
 */
export async function aiProvider(): Promise<AiProvider> {
  if (!provider) {
    const { localProvider } = await import("./local-provider");
    provider = localProvider;
  }
  return provider;
}

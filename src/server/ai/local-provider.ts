import "server-only";

import { parseJobDescription } from "@/lib/jd-parse";
import type { AiProvider, ParsedRequirement } from "./provider";

/**
 * The default provider: everything computed here, nothing sent anywhere.
 *
 * See `provider.ts` for why this is the default rather than a stub. In short:
 * candidate data is PII, most of what the specification asks for is
 * extraction against a vocabulary the organisation already owns, and a
 * deterministic implementation of that is explainable, testable and instant.
 */
export const localProvider: AiProvider = {
  name: "local",
  external: false,

  async parseRequirement(text: string, vocabulary: string[]): Promise<ParsedRequirement> {
    return parseJobDescription(text, vocabulary);
  },
};

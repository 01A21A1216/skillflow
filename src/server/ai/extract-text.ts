import "server-only";

/**
 * Getting readable text out of an uploaded document.
 *
 * PDFs go through `unpdf`, which runs entirely in-process: no service, no
 * network, nothing leaving the machine. That matters here more than
 * convenience — a resume is PII, and the whole point of the local provider
 * posture is that reading one does not send it anywhere.
 *
 * Word documents are the honest gap. `.docx` is a zip of XML and could be
 * read with a dependency; `.doc` is a binary format from 1997 that realistically
 * cannot. Rather than half-support them and produce mangled extractions,
 * unsupported types return a reason a person can act on: paste the text.
 */

export interface Extraction {
  text: string;
  /** Why it could not be read, when it could not. */
  problem: string | null;
}

const TEXT_TYPES = new Set(["text/plain", "text/markdown", "text/csv"]);

export async function extractText(contentType: string, bytes: Buffer): Promise<Extraction> {
  if (TEXT_TYPES.has(contentType)) {
    return { text: bytes.toString("utf8"), problem: null };
  }

  if (contentType === "application/pdf") {
    try {
      const { extractText: extractPdf, getDocumentProxy } = await import("unpdf");
      const doc = await getDocumentProxy(new Uint8Array(bytes));
      const { text } = await extractPdf(doc, { mergePages: true });
      const joined = Array.isArray(text) ? text.join("\n") : text;
      if (!joined.trim()) {
        // A PDF of scanned pages has no text layer. Saying so is more useful
        // than returning an empty extraction that looks like a parser failure.
        return {
          text: "",
          problem:
            "That PDF has no text in it — it looks like a scan. Paste the text instead, or upload a text-based PDF.",
        };
      }
      return { text: joined, problem: null };
    } catch {
      return { text: "", problem: "That PDF could not be read. Try pasting the text instead." };
    }
  }

  return {
    text: "",
    problem:
      "Word documents cannot be read automatically yet. Open it, copy the text, and paste it below.",
  };
}

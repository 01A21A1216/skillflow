/**
 * The three pieces of the Next request context an action touches.
 *
 * Supplied as Vite aliases rather than `vi.mock`, because a mock is hoisted
 * per test file and this has to hold for every one of them — and because a
 * real module is something the harness can import and drive, rather than
 * something it has to reach into a mock registry to configure.
 *
 * Nothing else about the actions is substituted. The session is a real row,
 * the permission matrix is real rows, the queries are real SQL. These three
 * exist only because `cookies()` and `revalidatePath()` are meaningless
 * outside a request and `redirect()` throws by design.
 */

export const cookieJar = new Map<string, string>();

/** Paths the code asked Next to revalidate, in order, for assertions. */
export const revalidated: string[] = [];

export async function cookies() {
  return {
    get: (name: string) => {
      const value = cookieJar.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set: (name: string, value: string) => {
      cookieJar.set(name, value);
    },
    delete: (name: string) => {
      cookieJar.delete(name);
    },
    has: (name: string) => cookieJar.has(name),
  };
}

export async function headers() {
  return new Headers();
}

export function revalidatePath(path: string) {
  revalidated.push(path);
}

export function revalidateTag(tag: string) {
  revalidated.push(`tag:${tag}`);
}

/**
 * A redirect is a control-flow exception in Next too, so throwing is faithful
 * rather than convenient — a test can assert that an unauthenticated call
 * redirects instead of returning.
 */
export class RedirectError extends Error {
  constructor(readonly to: string) {
    super(`redirect:${to}`);
  }
}

export function redirect(to: string): never {
  throw new RedirectError(to);
}

export function notFound(): never {
  throw new Error("notFound");
}

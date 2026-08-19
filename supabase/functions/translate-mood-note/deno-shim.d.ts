/**
 * Ambient types for Supabase Edge (Deno) in a Node/ESLint toolchain.
 * Not imported at runtime — only guides TypeScript and editors.
 */
declare namespace Deno {
  namespace env {
    function get(key: string): string | undefined
  }

  function serve(
    handler: (request: Request) => Response | Promise<Response>,
  ): void
}

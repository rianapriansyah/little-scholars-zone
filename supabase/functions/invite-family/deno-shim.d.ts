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

declare module 'https://esm.sh/@supabase/supabase-js@2.49.1' {
  import type { SupabaseClient, SupabaseClientOptions } from '@supabase/supabase-js'

  export function createClient<Database = Record<string, unknown>>(
    supabaseUrl: string,
    supabaseKey: string,
    options?: SupabaseClientOptions<Database>,
  ): SupabaseClient<Database>
}

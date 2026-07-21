export class SupabaseNotConfiguredError extends Error {
  constructor() {
    super('SUPABASE_URL / SUPABASE_ANON_KEY are not configured');
    this.name = 'SupabaseNotConfiguredError';
  }
}

export class SupabaseRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'SupabaseRequestError';
  }
}

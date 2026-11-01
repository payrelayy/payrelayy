const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export interface OwnerKemerbetSigninSettings {
  readonly platformAgentAccountId: string;
  readonly username: string;
  readonly revision: number;
  readonly updatedAt: string;
}

export class OwnerKemerbetSigninRejectedError extends Error {}
export class OwnerKemerbetSigninInvalidError extends Error {}
export class OwnerKemerbetSigninConflictError extends Error {}
export class OwnerKemerbetSigninUnavailableError extends Error {}

function mapError(error: unknown): never {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  if (code === '42501') throw new OwnerKemerbetSigninRejectedError();
  if (code === '22023') throw new OwnerKemerbetSigninInvalidError();
  if (code === '40001' || code === '23505') throw new OwnerKemerbetSigninConflictError();
  throw new OwnerKemerbetSigninUnavailableError();
}

function metadata(rows: readonly unknown[]): OwnerKemerbetSigninSettings | null {
  if (rows.length === 0) return null;
  const row = rows[0];
  if (rows.length !== 1 || !row || typeof row !== 'object' || Array.isArray(row))
    throw new OwnerKemerbetSigninUnavailableError();
  const value = row as Record<string, unknown>;
  if (
    Object.keys(value).sort().join(',') !==
      'platform_agent_account_id,revision,updated_at,username' ||
    typeof value.platform_agent_account_id !== 'string' ||
    !UUID.test(value.platform_agent_account_id) ||
    typeof value.username !== 'string' ||
    value.username.length < 1 ||
    value.username.length > 128 ||
    typeof value.revision !== 'number' ||
    !Number.isInteger(value.revision) ||
    value.revision < 1 ||
    !(value.updated_at instanceof Date) ||
    !Number.isFinite(value.updated_at.getTime())
  )
    throw new OwnerKemerbetSigninUnavailableError();
  return {
    platformAgentAccountId: value.platform_agent_account_id,
    username: value.username,
    revision: value.revision,
    updatedAt: value.updated_at.toISOString(),
  };
}

export class PostgresOwnerKemerbetSignin {
  constructor(
    private readonly database: {
      query(
        sql: string,
        values: readonly (string | number)[],
      ): Promise<{ readonly rows: readonly unknown[] }>;
    },
  ) {}

  async get(actor: string): Promise<OwnerKemerbetSigninSettings | null> {
    if (!UUID.test(actor)) throw new OwnerKemerbetSigninRejectedError();
    try {
      return metadata(
        (
          await this.database.query(
            'select platform_agent_account_id, username, revision, updated_at from app.get_owner_kemerbet_signin_credentials($1::uuid)',
            [actor],
          )
        ).rows,
      );
    } catch (error) {
      return mapError(error);
    }
  }

  async set(
    actor: string,
    accountId: string,
    username: string,
    password: string,
    expectedRevision: number,
  ): Promise<OwnerKemerbetSigninSettings> {
    if (!UUID.test(actor)) throw new OwnerKemerbetSigninRejectedError();
    if (
      !UUID.test(accountId) ||
      typeof username !== 'string' ||
      username.length < 1 ||
      username.length > 128 ||
      username !== username.trim() ||
      /[\u0000-\u001f\u007f]/u.test(username) ||
      typeof password !== 'string' ||
      password.length < 1 ||
      password.length > 256 ||
      /[\u0000-\u001f\u007f]/u.test(password) ||
      !Number.isInteger(expectedRevision) ||
      expectedRevision < 0 ||
      expectedRevision >= 2_147_483_647
    )
      throw new OwnerKemerbetSigninInvalidError();
    try {
      const saved = metadata(
        (
          await this.database.query(
            'select platform_agent_account_id, username, revision, updated_at from app.set_owner_kemerbet_signin_credentials($1::uuid,$2::uuid,$3::text,$4::text,$5::integer)',
            [actor, accountId, username, password, expectedRevision],
          )
        ).rows,
      );
      if (!saved || saved.platformAgentAccountId !== accountId)
        throw new OwnerKemerbetSigninUnavailableError();
      return saved;
    } catch (error) {
      return mapError(error);
    }
  }
}

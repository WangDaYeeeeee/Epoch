import { randomUUID } from "node:crypto";
import type { Sql } from "postgres";
import { validateThemeVersion, type ThemeVersionInput } from "../domain/theme";

export class PostgresThemeRepository {
  constructor(private readonly sql: Sql) {}

  async create(name: string): Promise<string> {
    const normalized = name.trim();
    if (!normalized || normalized.length > 200) throw new Error("Theme name must contain 1-200 characters");
    const rows = await this.sql<{ id: string }[]>`
      INSERT INTO investment_theme (id, name) VALUES (${randomUUID()}, ${normalized})
      ON CONFLICT (name) DO UPDATE SET status = 'active'
      RETURNING id::text
    `;
    return rows[0].id;
  }

  async saveVersion(themeId: string, input: ThemeVersionInput): Promise<string> {
    const version = validateThemeVersion(input);
    const id = randomUUID();
    await this.sql`
      INSERT INTO theme_version (
        id, theme_id, as_of, phase, thesis, profit_path, invalidation_condition, status
      ) VALUES (
        ${id}, ${themeId}, ${version.asOf}, ${version.phase}, ${version.thesis},
        ${version.profitPath}, ${version.invalidationCondition}, ${version.confirmed ? "confirmed" : "draft"}
      )
    `;
    return id;
  }

  async linkCandidate(themeId: string, candidateId: string, role: string): Promise<void> {
    if (!role.trim()) throw new Error("Theme candidate role is required");
    await this.sql`
      INSERT INTO theme_candidate (theme_id, candidate_id, role)
      VALUES (${themeId}, ${candidateId}, ${role.trim()})
      ON CONFLICT (theme_id, candidate_id) DO UPDATE SET role = EXCLUDED.role, recorded_at = now()
    `;
  }

  async linkEvidence(themeVersionId: string, evidenceId: string, role: "support" | "counter"): Promise<void> {
    await this.sql`
      INSERT INTO theme_version_evidence (theme_version_id, evidence_id, role)
      VALUES (${themeVersionId}, ${evidenceId}, ${role})
      ON CONFLICT (theme_version_id, evidence_id) DO UPDATE SET role = EXCLUDED.role
    `;
  }

  async load() {
    return this.sql`
      SELECT theme.id::text, theme.name, theme.status,
             version.id::text AS version_id, version.as_of::text, version.phase,
             version.thesis, version.profit_path, version.invalidation_condition,
             version.status AS version_status,
             COALESCE(candidate.candidate_count, 0)::int AS candidate_count
      FROM investment_theme theme
      LEFT JOIN LATERAL (
        SELECT * FROM theme_version
        WHERE theme_id = theme.id ORDER BY as_of DESC, recorded_at DESC LIMIT 1
      ) version ON true
      LEFT JOIN LATERAL (
        SELECT count(*) AS candidate_count FROM theme_candidate WHERE theme_id = theme.id
      ) candidate ON true
      WHERE theme.status = 'active'
      ORDER BY theme.name
    `;
  }
}

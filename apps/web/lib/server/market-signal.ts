import type { Sql } from "postgres";
import {
  dailySignedSemivariances, validateIntradayBar, validateOptionSignal,
  type IntradayBar, type OptionSignal,
} from "../domain/market-signal";

export class PostgresMarketSignalRepository {
  constructor(private readonly sql: Sql) {}

  async ingestIntradayBars(inputs: IntradayBar[]): Promise<number> {
    let inserted = 0;
    await this.sql.begin(async (transaction) => {
      for (const raw of inputs) {
        const input = validateIntradayBar(raw);
        const rows = await transaction`
          INSERT INTO intraday_bar_observation (
            instrument_id, observed_timestamp, provider, open, high, low, close, volume, observed_at
          ) VALUES (
            ${input.instrumentId}, ${input.timestamp}, ${input.provider}, ${input.open}, ${input.high},
            ${input.low}, ${input.close}, ${input.volume}, ${input.observedAt}
          ) ON CONFLICT DO NOTHING RETURNING instrument_id
        `;
        inserted += rows.length;
      }
    });
    return inserted;
  }

  async ingestOptionSignals(inputs: OptionSignal[]): Promise<number> {
    let inserted = 0;
    await this.sql.begin(async (transaction) => {
      for (const raw of inputs) {
        const input = validateOptionSignal(raw);
        const rows = await transaction`
          INSERT INTO option_signal_observation (
            instrument_id, as_of, provider, iv30, put_skew_25d_30, quality, observed_at
          ) VALUES (
            ${input.instrumentId}, ${input.asOf}, ${input.provider}, ${input.iv30},
            ${input.putSkew25d30}, ${input.quality}, ${input.observedAt}
          ) ON CONFLICT DO NOTHING RETURNING instrument_id
        `;
        inserted += rows.length;
      }
    });
    return inserted;
  }

  async coverage() {
    const [intraday, options, semivariance] = await Promise.all([
      this.sql`SELECT count(*)::int AS observations, count(DISTINCT instrument_id)::int AS instruments,
                      min(observed_timestamp)::text AS earliest, max(observed_timestamp)::text AS latest
               FROM intraday_bar_observation`,
      this.sql`SELECT count(*)::int AS observations, count(DISTINCT instrument_id)::int AS instruments,
                      min(as_of)::text AS earliest, max(as_of)::text AS latest
               FROM option_signal_observation`,
      this.sql`SELECT count(*)::int AS observations, count(DISTINCT instrument_id)::int AS instruments,
                      min(trading_date)::text AS earliest, max(trading_date)::text AS latest,
                      sum(return_observations)::int AS return_observations
               FROM intraday_semivariance_daily`,
    ]);
    return { intraday: intraday[0], semivariance: semivariance[0], options: options[0] };
  }

  async refreshDailySemivariance(provider: string): Promise<number> {
    const rows = await this.sql<{
      instrument_id: string; observed_timestamp: string; open: number; high: number;
      low: number; close: number; volume: number; observed_at: string;
    }[]>`
      SELECT instrument_id, observed_timestamp::text, open, high, low, close, volume, observed_at::text
      FROM intraday_bar_observation WHERE provider = ${provider}
      ORDER BY instrument_id, observed_timestamp
    `;
    const metrics = dailySignedSemivariances(rows.map((row) => ({
      instrumentId: row.instrument_id,
      timestamp: row.observed_timestamp,
      open: row.open, high: row.high, low: row.low, close: row.close, volume: row.volume,
      provider, observedAt: row.observed_at,
    })));
    let upserted = 0;
    await this.sql.begin(async (transaction) => {
      for (const metric of metrics) {
        await transaction`
          INSERT INTO intraday_semivariance_daily (
            instrument_id, trading_date, provider, positive_semivariance,
            negative_semivariance, signed_jump, return_observations
          ) VALUES (
            ${metric.instrumentId}, ${metric.date}, ${provider}, ${metric.positiveSemivariance},
            ${metric.negativeSemivariance}, ${metric.signedJump}, ${metric.returnObservations}
          ) ON CONFLICT (instrument_id, trading_date, provider) DO UPDATE SET
            positive_semivariance = EXCLUDED.positive_semivariance,
            negative_semivariance = EXCLUDED.negative_semivariance,
            signed_jump = EXCLUDED.signed_jump,
            return_observations = EXCLUDED.return_observations,
            calculated_at = now()
        `;
        upserted += 1;
      }
    });
    return upserted;
  }
}

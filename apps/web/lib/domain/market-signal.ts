export type IntradayBar = {
  instrumentId: string;
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  provider: string;
  observedAt: string;
};

export type OptionSignal = {
  instrumentId: string;
  asOf: string;
  iv30: number | null;
  putSkew25d30: number | null;
  provider: string;
  quality: "indicative" | "consolidated" | "derived";
  observedAt: string;
};

export type DailySignedSemivariance = {
  instrumentId: string;
  date: string;
  positiveSemivariance: number;
  negativeSemivariance: number;
  signedJump: number;
  returnObservations: number;
};

function validTimestamp(value: string): boolean {
  return value.trim() !== "" && Number.isFinite(Date.parse(value));
}

function requiredText(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

export function validateIntradayBar(input: IntradayBar): IntradayBar {
  const prices = [input.open, input.high, input.low, input.close];
  if (!prices.every((value) => Number.isFinite(value) && value > 0)) {
    throw new Error("Intraday bar prices must be positive and finite");
  }
  if (input.high < Math.max(input.open, input.low, input.close) || input.low > Math.min(input.open, input.high, input.close)) {
    throw new Error("Intraday bar high/low bounds are invalid");
  }
  if (!Number.isFinite(input.volume) || input.volume < 0) throw new Error("Intraday bar volume must be finite and non-negative");
  if (!validTimestamp(input.timestamp) || !validTimestamp(input.observedAt)) throw new Error("Intraday bar timestamps are invalid");
  return {
    ...input,
    instrumentId: requiredText(input.instrumentId, "Instrument"),
    provider: requiredText(input.provider, "Provider"),
  };
}

export function validateOptionSignal(input: OptionSignal): OptionSignal {
  if (!validTimestamp(input.asOf) || !validTimestamp(input.observedAt)) throw new Error("Option signal timestamps are invalid");
  if (input.iv30 !== null && (!Number.isFinite(input.iv30) || input.iv30 < 0 || input.iv30 > 10)) {
    throw new Error("Option signal IV30 must be between 0 and 10");
  }
  if (input.putSkew25d30 !== null && (!Number.isFinite(input.putSkew25d30) || Math.abs(input.putSkew25d30) > 10)) {
    throw new Error("Option signal skew is outside the supported range");
  }
  if (input.iv30 === null && input.putSkew25d30 === null) throw new Error("Option signal has no usable value");
  return {
    ...input,
    instrumentId: requiredText(input.instrumentId, "Instrument"),
    provider: requiredText(input.provider, "Provider"),
  };
}

export function dailySignedSemivariances(bars: IntradayBar[]): DailySignedSemivariance[] {
  const grouped = new Map<string, IntradayBar[]>();
  for (const raw of bars) {
    const bar = validateIntradayBar(raw);
    const date = new Date(bar.timestamp).toISOString().slice(0, 10);
    const key = `${bar.instrumentId}\0${date}`;
    grouped.set(key, [...(grouped.get(key) ?? []), bar]);
  }
  const output: DailySignedSemivariance[] = [];
  for (const [key, values] of grouped) {
    const [instrumentId, date] = key.split("\0");
    const ordered = values.sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
    if (ordered.length < 2) continue;
    let positiveSemivariance = 0;
    let negativeSemivariance = 0;
    for (let index = 1; index < ordered.length; index += 1) {
      const value = Math.log(ordered[index].close / ordered[index - 1].close);
      if (value > 0) positiveSemivariance += value ** 2;
      if (value < 0) negativeSemivariance += value ** 2;
    }
    output.push({
      instrumentId,
      date,
      positiveSemivariance,
      negativeSemivariance,
      signedJump: positiveSemivariance - negativeSemivariance,
      returnObservations: ordered.length - 1,
    });
  }
  return output.sort((left, right) => left.instrumentId.localeCompare(right.instrumentId) || left.date.localeCompare(right.date));
}

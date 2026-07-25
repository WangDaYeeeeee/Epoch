import type { InstrumentClassification } from "./exposure";

export const INSTRUMENT_CLASSIFICATION_VERSION = "phase2-bootstrap-v1";

// This registry only contains direct issuer relationships confirmed by the
// instrument identity. Funds remain unclassified until a dated holdings file
// is available; the exposure engine reports that missing look-through.
export const instrumentClassifications: InstrumentClassification[] = [
  { instrumentId: "US:AVGO", issuer: { id: "issuer:broadcom", name: "Broadcom Inc." } },
  { instrumentId: "US:GOOGL", issuer: { id: "issuer:alphabet", name: "Alphabet Inc." } },
  { instrumentId: "US:KLAC", issuer: { id: "issuer:kla", name: "KLA Corporation" } },
  { instrumentId: "US:MSFT", issuer: { id: "issuer:microsoft", name: "Microsoft Corporation" } },
  { instrumentId: "US:NVDA", issuer: { id: "issuer:nvidia", name: "NVIDIA Corporation" } },
  { instrumentId: "US:TSM", issuer: { id: "issuer:tsmc", name: "Taiwan Semiconductor Manufacturing Co." } },
  { instrumentId: "XKRX:000660", issuer: { id: "issuer:sk-hynix", name: "SK hynix Inc." } },
];

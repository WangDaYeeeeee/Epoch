import type { InstrumentClassification } from "./exposure";

export const INSTRUMENT_CLASSIFICATION_VERSION = "phase2-bootstrap-v2";

// This registry only contains direct issuer relationships confirmed by the
// instrument identity. Funds remain unclassified until a dated holdings file
// is available; the exposure engine reports that missing look-through.
export const instrumentClassifications: InstrumentClassification[] = [
  { instrumentId: "US:AVGO", issuer: { id: "issuer:broadcom", name: "Broadcom Inc." }, industry: { id: "industry:semiconductors", name: "半导体" }, region: { id: "region:united-states", name: "美国" }, themes: [{ id: "theme:ai-infrastructure", name: "AI 基础设施" }, { id: "theme:semiconductor-cycle", name: "半导体周期" }] },
  { instrumentId: "US:GOOGL", issuer: { id: "issuer:alphabet", name: "Alphabet Inc." }, industry: { id: "industry:interactive-media", name: "互联网平台" }, region: { id: "region:united-states", name: "美国" }, themes: [{ id: "theme:ai-platforms", name: "AI 平台" }, { id: "theme:cloud-platforms", name: "云平台" }] },
  { instrumentId: "US:KLAC", issuer: { id: "issuer:kla", name: "KLA Corporation" }, industry: { id: "industry:semiconductor-equipment", name: "半导体设备" }, region: { id: "region:united-states", name: "美国" }, themes: [{ id: "theme:semiconductor-cycle", name: "半导体周期" }] },
  { instrumentId: "US:MSFT", issuer: { id: "issuer:microsoft", name: "Microsoft Corporation" }, industry: { id: "industry:software", name: "软件" }, region: { id: "region:united-states", name: "美国" }, themes: [{ id: "theme:ai-platforms", name: "AI 平台" }, { id: "theme:cloud-platforms", name: "云平台" }] },
  { instrumentId: "US:NVDA", issuer: { id: "issuer:nvidia", name: "NVIDIA Corporation" }, industry: { id: "industry:semiconductors", name: "半导体" }, region: { id: "region:united-states", name: "美国" }, themes: [{ id: "theme:ai-infrastructure", name: "AI 基础设施" }, { id: "theme:semiconductor-cycle", name: "半导体周期" }] },
  { instrumentId: "US:TSM", issuer: { id: "issuer:tsmc", name: "Taiwan Semiconductor Manufacturing Co." }, industry: { id: "industry:semiconductor-foundry", name: "晶圆代工" }, region: { id: "region:taiwan", name: "中国台湾" }, themes: [{ id: "theme:ai-infrastructure", name: "AI 基础设施" }, { id: "theme:semiconductor-cycle", name: "半导体周期" }] },
  { instrumentId: "XKRX:000660", issuer: { id: "issuer:sk-hynix", name: "SK hynix Inc." }, industry: { id: "industry:memory-semiconductors", name: "存储半导体" }, region: { id: "region:south-korea", name: "韩国" }, themes: [{ id: "theme:ai-infrastructure", name: "AI 基础设施" }, { id: "theme:memory-cycle", name: "存储周期" }] },
];

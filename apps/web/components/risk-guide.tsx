"use client";

import { BookOpen, CircleHelp, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useModalScrollLock } from "@/components/use-modal-scroll-lock";

const sections = [
  {
    title: "组合层指标",
    items: [
      {
        term: "组合 σₚ",
        description: "当前持仓结构下的年化波动率估计。它描述波动幅度，不表示预计亏损比例。",
        usage: "先看与 45% 卡口的距离；接近上限时，即使仍然通过，也应谨慎增加风险。",
      },
      {
        term: "Stress σₚ",
        description: "将不同标的之间的相关性统一设为 0.90 后重新计算的组合波动率。",
        usage: "与普通 σₚ 的差距越大，说明组合越依赖平时的分散化；它不是压力情景亏损金额。",
      },
      {
        term: "历史 CVaR",
        description: "使用最近 250 个交易日，在最差 5% 日收益中的平均损失，属于日频尾部风险。",
        usage: "用于理解坏日的典型损失，不是最大可能损失，也不能与 45% 年化波动率卡口直接比较。",
      },
    ],
  },
  {
    title: "标的风险明细",
    items: [
      {
        term: "组合权重",
        description: "标的美元市值除以包含现金的组合净资产；现金、现金等价物与衍生品不进入当前风险标的集合。",
        usage: "明细权重合计可能小于 100%，应与风险贡献一起判断，而不是只看仓位大小。",
      },
      {
        term: "年化波动率",
        description: "SHAR 日频模型对单个标的波动水平的年化预测。",
        usage: "表示标的自身有多活跃；高波动小仓位不一定比中波动大仓位贡献更多组合风险。",
      },
      {
        term: "风险贡献",
        description: "该标的贡献的年化组合波动百分点；所有标的风险贡献之和约等于组合 σₚ。",
        usage: "优先用它定位风险来源。它不是风险占比；风险占比需要再除以组合 σₚ。",
      },
      {
        term: "风险资本比",
        description: "风险贡献除以组合权重，反映每单位仓位对应的边际组合波动。",
        usage: "越高表示单位仓位消耗的风险越多；它不是已使用的风险预算比例。",
      },
    ],
  },
  {
    title: "SHAR 尾部监控",
    items: [
      {
        term: "RS⁺ / RS⁻",
        description: "最近 22 个交易日正收益与负收益的平方和，分别表示上行和下行方向的变动能量。",
        usage: "RS⁻ 较高代表近期下行波动更强；两者均为正数，适合横向比较当前标的。",
      },
      {
        term: "ΔJ",
        description: "RS⁺ − RS⁻。负值表示下行半方差占主导，正值表示上行半方差占主导。",
        usage: "它是波动方向线索，不是预计涨跌幅、跳空概率或买卖信号。",
      },
      {
        term: "OOS RMSE",
        description: "扩展窗口样本外方差预测误差，单位为 bp²。",
        usage: "越高代表模型对该标的越不稳定，应降低对当前预测数值的信任。",
      },
    ],
  },
  {
    title: "趋势与基准漂移",
    items: [
      {
        term: "历史趋势",
        description: "每个风险点按对应日期的真实持仓计算；组合表现线按所选时间窗口起点重新归一化。",
        usage: "用于区分单日尖峰和持续恶化。两条线同时变化并不代表存在因果关系。",
      },
      {
        term: "σₚ / σₚ⁰",
        description: "当前组合波动率除以保存基准时的组合波动率；1.5× 起重点关注，2.0× 起强烈关注。",
        usage: "用于判断相同风险框架下，组合整体风险相对目标状态放大了多少。",
      },
      {
        term: "Dᵥ / Dᵣ",
        description: "Dᵥ 是当前与基准权重的距离；Dᵣ 是当前与基准风险贡献的距离。",
        usage: "分别用于判断仓位结构和风险来源是否偏离目标；Dᵣ 同时受整体风险水平变化影响。",
      },
    ],
  },
];

export function RiskGuide() {
  const [open, setOpen] = useState(false);
  useModalScrollLock(open);
  const close = () => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    setOpen(false);
  };

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  return <>
    <button aria-label="打开风险指标说明" className="risk-guide-trigger" title="指标说明" type="button" onClick={() => setOpen(true)}>
      <CircleHelp aria-hidden="true" size={12} strokeWidth={1.9} />
    </button>
    {open && createPortal((
      <div
        className="risk-guide-backdrop"
        role="presentation"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) close();
        }}
      >
        <section aria-labelledby="risk-guide-title" aria-modal="true" className="risk-guide-modal" role="dialog">
          <div className="risk-guide-head">
            <div>
              <span><BookOpen aria-hidden="true" size={14} strokeWidth={1.9} /> RISK MANUAL</span>
              <h2 id="risk-guide-title">风险指标使用说明</h2>
              <p>先确认数据可信，再判断组合风险，最后定位风险来源。</p>
            </div>
            <button aria-label="关闭风险指标使用说明" type="button" onClick={close}>
              <X aria-hidden="true" size={17} strokeWidth={2} />
            </button>
          </div>

          <div className="risk-guide-alert">
            <strong>阅读顺序</strong>
            <span>行情新鲜度 → 组合 σₚ 与卡口 → Stress / CVaR → 风险贡献 → 尾部监控 → 历史与漂移</span>
          </div>

          <div className="risk-guide-sections">
            {sections.map((section) => (
              <section className="risk-guide-section" key={section.title}>
                <h3>{section.title}</h3>
                <div>
                  {section.items.map((item) => (
                    <article key={item.term}>
                      <strong>{item.term}</strong>
                      <p>{item.description}</p>
                      <small><b>如何使用</b>{item.usage}</small>
                    </article>
                  ))}
                </div>
              </section>
            ))}
          </div>

          <footer className="risk-guide-foot">
            当前结果是批次风险诊断，不是盘中实时信号；ΔJ、CVaR 或单一颜色均不应独立触发交易。
          </footer>
        </section>
      </div>
    ), document.body)}
  </>;
}

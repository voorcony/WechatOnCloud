import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ThemeToggle } from '../AppShell';
import { useAiConsoleModel } from './aiConsoleModel';
import {
  CAP_MODULES,
  CAPABILITIES,
  CAP_RISK_LABEL,
  deriveCapabilityState,
  buildWorkflow,
  type CapModule,
} from './aiCapabilities';

// 工具与工作流（/tools）
// 设计稿「工具库 + 工作流画布」的产品化落地：把 AI 微信员工的运行链路拆成可枚举的能力模块
// （感知 / 记忆 / 知识 / 生成 / 管控 / 动作 / 运维），启用态由 useAiConsoleModel 的安全字段派生。
// 安全：只展示能力键 / 风险 / 计数 / 启用态；不含聊天正文 / 回复原文 / token。「配置」为占位。

const MenuIcon = (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M4 6h16M4 12h16M4 18h16" />
  </svg>
);

export const ToolsIcon = (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.2-.6-.6-2.2z" />
  </svg>
);

// 内置强制人审触发词数量（与 AI 员工中心 GUARDRAILS 一致，避免跨文件耦合，仅用计数）。
const GUARDRAIL_COUNT = 7;

export default function Tools({ onOpenMenu }: { onOpenMenu: () => void }) {
  const nav = useNavigate();
  const m = useAiConsoleModel();
  const granted = useMemo(() => new Set(m.grantedKeys), [m.grantedKeys]);
  const states = useMemo(() => CAPABILITIES.map((c) => deriveCapabilityState(c, m.real, granted)), [m.real, granted]);
  const activeCount = states.filter((s) => s.on).length;
  const flow = useMemo(
    () => buildWorkflow(m.knowledgeDocCount, GUARDRAIL_COUNT, m.pendingTotal),
    [m.knowledgeDocCount, m.pendingTotal],
  );

  const byModule = (mod: CapModule) => states.filter((s) => s.cap.module === mod.key);

  return (
    <div className="ws-page">
      <header className="ws-head">
        <button className="ws-menu" onClick={onOpenMenu} aria-label="菜单">
          {MenuIcon}
        </button>
        <span className="ws-title">工具与工作流</span>
        <ThemeToggle />
      </header>

      <div className="content">
        <div className="page-pad">
          {m.probed &&
            (m.real ? (
              <div className="con-src con-src-real">
                <span className="con-src-dot" /> 能力启用态来自真实 AI 员工数据（只读，按可见实例过滤）
              </div>
            ) : (
              <div className="con-src con-src-demo">
                <span className="con-src-dot" /> 演示数据：尚未配置 AI 员工数据源。能力清单为产品结构，启用态为占位演示。
              </div>
            ))}

          <div className="ai-note" style={{ marginTop: 12 }}>
            工具库把 AI 微信员工的能力按模块解耦（感知 → 记忆 → 知识 → 生成 → 管控 → 动作 → 运维）。
            启用态由安全字段派生（能力键命中 / real|demo），敏感外发动作恒经二次 gating。
            <b>本页只读，不触发任何真实微信动作</b>，「配置」为占位（写路径接入后启用）。
          </div>

          {/* 能力总览计数 */}
          <div className="ai-kpis" style={{ marginTop: 12 }}>
            <div className="ai-kpi">
              <span className="ai-kpi-val">{CAPABILITIES.length}</span>
              <span className="ai-kpi-lbl">能力模块</span>
            </div>
            <div className="ai-kpi">
              <span className="ai-kpi-val">{activeCount}</span>
              <span className="ai-kpi-lbl">已启用 / 运行</span>
            </div>
            <div className="ai-kpi">
              <span className="ai-kpi-val">{CAPABILITIES.filter((c) => c.risk === 'high').length}</span>
              <span className="ai-kpi-lbl">高风险动作</span>
            </div>
            <div className="ai-kpi">
              <span className="ai-kpi-val">{CAP_MODULES.length}</span>
              <span className="ai-kpi-lbl">能力域</span>
            </div>
          </div>

          {/* 按模块分组的能力卡 */}
          {CAP_MODULES.map((mod) => {
            const items = byModule(mod);
            if (items.length === 0) return null;
            return (
              <div key={mod.key} className="ai-sec" style={{ marginTop: 14 }}>
                <div className="ai-sec-title">
                  {mod.label}
                  <span className="ai-sec-count">{items.filter((s) => s.on).length} / {items.length} 启用</span>
                </div>
                <div className="ai-sec-meta" style={{ marginTop: 0, marginBottom: 8 }}>{mod.desc}</div>
                <div className="ai-tool-grid">
                  {items.map((s) => (
                    <div key={s.cap.key} className={'ai-tool-card' + (s.on ? '' : ' ai-tool-off')}>
                      <div className="ai-tool-head">
                        <span className="ai-mono ai-tool-name">{s.cap.key}</span>
                        <span className={'ai-tool-risk risk-' + s.cap.risk}>{CAP_RISK_LABEL[s.cap.risk]}</span>
                      </div>
                      <div className="tool-cap-name">{s.cap.name}</div>
                      <p className="ai-tool-desc">{s.cap.desc}</p>
                      <div className="ai-tool-foot">
                        <span className="ai-tool-state">
                          <span className={'ai-dot ' + s.stateCls} />
                          {s.stateText}
                          {s.needApproval && <span className="ai-tool-tag">需人工确认</span>}
                        </span>
                        {s.cap.statusKind === 'ops' && s.cap.key.startsWith('ops.trace') ? (
                          <button className="btn-text" onClick={() => nav('/monitor')}>
                            监控墙 ›
                          </button>
                        ) : (
                          <button className="btn-text" disabled title="能力配置写路径后端接入后启用">
                            配置
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          {/* 处理工作流（安全示意） */}
          <div className="ai-sec" style={{ marginTop: 14 }}>
            <div className="ai-sec-title">
              处理工作流
              <span className="ai-sec-count">消息接入 → 路由 → 知识库 → 起草 → 边界 → 待确认</span>
            </div>
            <div className="ai-flow">
              {flow.map((s, i) => (
                <div key={s.key} className={'ai-flow-node ai-flow-' + s.kind}>
                  <div className="ai-flow-idx">{i + 1}</div>
                  <div className="ai-flow-body">
                    <div className="ai-flow-title">{s.title}</div>
                    <div className="ai-flow-detail">{s.detail}</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="ai-sec-meta">
              工作流为运行链路的只读示意；真实发送 / 改备注 / 群操作由后端二次 gating，本页不触发任何真实微信动作。
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

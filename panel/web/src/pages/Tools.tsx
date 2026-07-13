import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAiConsoleModel } from './aiConsoleModel';
import {
  CAPABILITIES,
  CAP_MODULES,
  CAP_RISK_LABEL,
  deriveCapabilityState,
  buildWorkflow,
  type FlowKind,
} from './aiCapabilities';

// 工具与工作流（/tools）—— 对标产品模板 pageTools：
//   工具库（tool-grid / tool-card）+ 工作流画布（workflow / wf-node + 贝塞尔连线）。
// 工具数据来自 aiCapabilities.ts（微信员工真实/安全能力，非外部模板工具名）。
// 安全：只展示能力键 / 风险 / 启用态（来自 grantedKeys）；无后端写路径的开关 / 配置恒占位（disabled）；
//       不含聊天正文 / 回复原文 / token；不假成功。

export const ToolsIcon = (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.2-.6-.6-2.2z" />
  </svg>
);

// 内置强制人审触发词数量（与 AI 员工中心 GUARDRAILS 一致，避免跨文件耦合，仅用计数）。
const GUARDRAIL_COUNT = 7;

// 工作流节点的画布坐标（相对 .workflow 内容区，px）。按 kind 序列 S 形布局。
const NODE_W = 176;
const NODE_H = 60;
const WF_POS: { x: number; y: number }[] = [
  { x: 24, y: 28 },
  { x: 236, y: 28 },
  { x: 448, y: 28 },
  { x: 448, y: 150 },
  { x: 236, y: 150 },
  { x: 236, y: 272 },
];
// 连线：源节点右/下端 → 目标节点左/上端，方向决定贝塞尔控制点。
const WF_EDGES: [number, number][] = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [4, 5],
];


function moduleTone(on: number, total: number): string {
  if (total <= 0) return 'outline';
  if (on === total) return 'brand';
  if (on > 0) return 'warn';
  return 'outline';
}
function capMetricText(m: ReturnType<typeof useAiConsoleModel>): string {
  const send = `发送 ${m.health.sendExecuted}/${m.health.sendVerified}`;
  const kb = `KB ${m.knowledgeDocCount} 文档 / ${m.knowledgeChunkCount} 切片`;
  const vision = m.health.visionSeen ? `视觉 ${m.health.visionSource}` : '视觉未上报';
  return `${kb} · ${send} · ${vision}`;
}

const KIND_TAG: Record<FlowKind, string> = {
  trigger: 'trigger',
  llm: 'llm',
  tool: 'tool',
  cond: 'cond',
  approve: 'approve',
};

// 生成两点间的水平/垂直感知贝塞尔路径（模板 arrows() 同款观感）。
function edgePath(a: { x: number; y: number }, b: { x: number; y: number }): string {
  const ax = a.x + NODE_W / 2;
  const ay = a.y + NODE_H / 2;
  const bx = b.x + NODE_W / 2;
  const by = b.y + NODE_H / 2;
  const horizontal = Math.abs(bx - ax) >= Math.abs(by - ay);
  if (horizontal) {
    const sx = bx > ax ? a.x + NODE_W : a.x;
    const ex = bx > ax ? b.x : b.x + NODE_W;
    const c = (ex - sx) / 2;
    return `M ${sx} ${ay} C ${sx + c} ${ay}, ${ex - c} ${by}, ${ex} ${by}`;
  }
  const sy = by > ay ? a.y + NODE_H : a.y;
  const ey = by > ay ? b.y : b.y + NODE_H;
  const c = (ey - sy) / 2;
  return `M ${ax} ${sy} C ${ax} ${sy + c}, ${bx} ${ey - c}, ${bx} ${ey}`;
}

export default function Tools({ onOpenMenu }: { onOpenMenu: () => void }) {
  void onOpenMenu; // 模板外壳自带侧栏 / 菜单，本页不再渲染 header。
  const nav = useNavigate();
  const m = useAiConsoleModel();
  const granted = useMemo(() => new Set(m.grantedKeys), [m.grantedKeys]);
  const states = useMemo(() => CAPABILITIES.map((c) => deriveCapabilityState(c, m.real, granted)), [m.real, granted]);
  const activeCount = states.filter((s) => s.on).length;
  const highRisk = CAPABILITIES.filter((c) => c.risk === 'high').length;
  const moduleStats = useMemo(() =>
    CAP_MODULES.map((mod) => {
      const rows = states.filter((s) => s.cap.module === mod.key);
      const on = rows.filter((s) => s.on).length;
      const gated = rows.filter((s) => s.needApproval).length;
      return { ...mod, total: rows.length, on, gated };
    }),
    [states],
  );
  const flow = useMemo(
    () => buildWorkflow(m.knowledgeDocCount, GUARDRAIL_COUNT, m.pendingTotal),
    [m.knowledgeDocCount, m.pendingTotal],
  );

  return (
    <div>
      <div className="page-h">
        <div>
          <h1>工具与工作流</h1>
          <p>AI 微信员工的能力库与运行链路：{activeCount}/{CAPABILITIES.length} 项能力已启用 · {highRisk} 项高风险外发动作恒经人工确认 · {capMetricText(m)}。</p>
        </div>
        <div className="act">
          <button className="btn" disabled title="能力导入 / 编排写路径后端接入后启用">
            导入能力
          </button>
          <button className="btn primary" onClick={() => nav('/monitor')}>
            查看监控墙 ›
          </button>
        </div>
      </div>

      {m.probed &&
        (m.real ? (
          <div className="src-note real">
            <span className="d" /> 能力启用态来自真实 AI 员工数据 · 来源 ai-wechat-employee（只读，已按可见实例过滤）
          </div>
        ) : (
          <div className="src-note demo">
            <span className="d" /> 演示数据：尚未配置 AI 员工数据源。能力清单为产品结构，启用态为占位演示。
          </div>
        ))}


      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-h">
          <span className="title">能力运营态</span>
          <span className="chip outline" style={{ marginLeft: 'auto' }}>只读 · 来自安全摘要 / 权限键 / KB 计数</span>
        </div>
        <div className="card-b">
          <div className="grid-4">
            <div className="mini-stat"><span>知识库</span><b>{m.knowledgeDocCount} / {m.knowledgeChunkCount}</b></div>
            <div className="mini-stat"><span>视觉运行时</span><b className={m.health.visionSeen ? '' : 'warn'}>{m.health.visionSeen ? '已上报' : '未上报'}</b></div>
            <div className="mini-stat"><span>发送成功 / 失败</span><b className={m.health.sendFailed ? 'danger' : ''}>{m.health.sendVerified}/{m.health.sendFailed}</b></div>
            <div className="mini-stat"><span>待人工确认</span><b className={m.pendingTotal ? 'warn' : ''}>{m.pendingTotal}</b></div>
          </div>
          <div className="row" style={{ marginTop: 10, flexWrap: 'wrap', gap: 6 }}>
            {moduleStats.map((mod) => (
              <span key={mod.key} className={'chip ' + moduleTone(mod.on, mod.total)}>
                {mod.label} {mod.on}/{mod.total}{mod.gated ? ` · 人审${mod.gated}` : ''}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* 工具库 */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-h">
          <span className="title">工具库</span>
          <span className="chip outline" style={{ marginLeft: 8 }}>{CAPABILITIES.length} 项能力</span>
          <span className="chip brand" style={{ marginLeft: 'auto' }}>{activeCount} 已启用</span>
        </div>
        <div className="card-b">
          <div className="tool-grid">
            {states.map((s) => {
              const opsTrace = s.cap.statusKind === 'ops' && s.cap.key.startsWith('ops.trace');
              return (
                <div key={s.cap.key} className="tool-card">
                  <div className="row1">
                    <span className="name">{s.cap.key}</span>
                    <span className={'chip ' + (s.cap.risk === 'high' ? 'danger' : s.cap.risk === 'medium' ? 'warn' : 'outline')}>
                      {CAP_RISK_LABEL[s.cap.risk]}
                    </span>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{s.cap.name}</div>
                  <p className="desc">{s.cap.desc}</p>
                  <div className="dim" style={{ fontSize: 11.5, marginTop: -4 }}>
                    状态来源：{s.cap.statusKind === 'permission' ? `权限键 ${s.cap.permKey ?? '—'}` : s.cap.statusKind === 'runtime' ? '运行时摘要' : s.cap.statusKind === 'gated' ? `权限键 ${s.cap.permKey ?? '—'} + 人审闸门` : '运维摘要'}
                  </div>
                  <div className="row1" style={{ marginTop: 2 }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-2)' }}>
                      <span className={'dot ' + s.stateCls} />
                      {s.stateText}
                    </span>
                    {opsTrace ? (
                      <button className="btn sm ghost" onClick={() => nav('/monitor')}>
                        监控墙 ›
                      </button>
                    ) : s.cap.writePath ? (
                      <button className="btn sm" disabled title="敏感外发 / 运维动作需后端二次 gating，本页不可写">
                        配置
                      </button>
                    ) : (
                      <label className="switch" title={s.on ? '已授予该能力（只读展示，写路径未接入）' : '未授予该能力（写路径接入后可编辑）'}>
                        <input type="checkbox" checked={s.on} disabled readOnly />
                        <span />
                      </label>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="src-note demo" style={{ marginTop: 14, marginBottom: 0 }}>
            <span className="d" /> 演示：开关反映能力授予态（来自可见员工权限键），为只读展示；启用 / 停用 / 配置的写路径接入后端后开放。
          </div>
        </div>
      </div>

      {/* 工作流画布 */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-h">
          <span className="title">处理工作流</span>
          <span className="chip outline" style={{ marginLeft: 8 }}>消息接入 → 路由 → 知识库 → 起草 → 边界 → 待确认</span>
          <div className="row" style={{ marginLeft: 'auto', gap: 4 }}>
            <span className="chip accent">触发</span>
            <span className="chip brand">LLM</span>
            <span className="chip violet">工具</span>
            <span className="chip warn">判断</span>
            <span className="chip danger">人审</span>
          </div>
        </div>
        <div className="card-b" style={{ padding: 0 }}>
          <div className="workflow">
            <svg
              width="100%"
              height="100%"
              viewBox="0 0 648 360"
              preserveAspectRatio="none"
              style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'visible' }}
            >
              <defs>
                <marker id="wf-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M0 0 L10 5 L0 10 z" fill="var(--line-strong)" />
                </marker>
              </defs>
              {WF_EDGES.map(([a, b]) => (
                <path
                  key={`${a}-${b}`}
                  d={edgePath(WF_POS[a], WF_POS[b])}
                  fill="none"
                  stroke="var(--line-strong)"
                  strokeWidth="1.5"
                  markerEnd="url(#wf-arrow)"
                />
              ))}
            </svg>
            {flow.map((s, i) => {
              const p = WF_POS[i] ?? { x: 24, y: 28 };
              return (
                <div
                  key={s.key}
                  className={'wf-node ' + KIND_TAG[s.kind]}
                  style={{ left: p.x, top: p.y, width: NODE_W }}
                >
                  <span className="t">{s.kind}</span>
                  <span className="n">{s.title}</span>
                  <span style={{ fontSize: 11.5, color: 'var(--text-2)' }}>{s.detail}</span>
                </div>
              );
            })}
          </div>
        </div>
        <div className="card-b" style={{ borderTop: '1px solid var(--line)' }}>
          <div style={{ fontSize: 12.5, color: 'var(--text-2)' }}>
            工作流为运行链路的只读示意；真实发送 / 改备注 / 群操作由后端二次 gating，本页不触发任何真实微信动作。
          </div>
        </div>
      </div>
    </div>
  );
}

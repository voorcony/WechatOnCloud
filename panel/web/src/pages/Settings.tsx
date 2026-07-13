import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { useInstances, ThemeToggle } from '../AppShell';
import { useAiConsoleModel } from './aiConsoleModel';

// 系统设置（/settings）
// 设计稿「系统设置」产品化：运营设置 / 模型路由 / 预算 / Webhook / 安全策略。如实反映 WOC 现状——
// 数据源接入状态、安全合规姿态、内置人审触发词为真实只读信息；无后端写路径的项统一 disabled 占位并
// 标注「后端接入后启用」，绝不假装已生效。实例 / 账号 / 授权仍在 /admin，不在此新造租户。

const MenuIcon = (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M4 6h16M4 12h16M4 18h16" />
  </svg>
);

// 内置强制人审触发词（与 AI 员工中心 GUARDRAILS 一致的只读 allowlist）。
const GUARDRAILS = ['退款', '封号', '付款', '外挂', '外部链接', '大额订单', '投诉'];

export default function Settings({ onOpenMenu }: { onOpenMenu: () => void }) {
  const nav = useNavigate();
  const { user } = useAuth();
  const { instances } = useInstances();
  const m = useAiConsoleModel();
  const isAdmin = user?.role === 'admin';

  const demoReason =
    m.demoReason === 'cannot_enforce_instance_filter'
      ? '无法按实例过滤，已对子账号回退'
      : m.demoReason === 'unavailable'
        ? '数据源子进程不可用，已回退'
        : m.demoReason === 'not_configured'
          ? '尚未配置数据源'
          : '';

  return (
    <div className="ws-page">
      <header className="ws-head">
        <button className="ws-menu" onClick={onOpenMenu} aria-label="菜单">
          {MenuIcon}
        </button>
        <span className="ws-title">系统设置</span>
        <ThemeToggle />
      </header>

      <div className="content">
        <div className="page-pad">
          <div className="ai-note">
            系统设置管理 AI 员工数据源与安全策略。实例 / 账号 / 授权等基础设施在
            <button className="btn-text" style={{ padding: '0 4px' }} onClick={() => nav('/admin')}>实例与账号管理</button>
            完成，本页不新造租户或授权。
          </div>

          <div className="set-grid" style={{ marginTop: 12 }}>
            {/* 数据源与运行（真实只读） */}
            <div className="ai-sec">
              <div className="ai-sec-title">数据源与运行</div>
              <div className="ai-set-row">
                <span className="ai-set-k">接入状态</span>
                <span className="ai-set-v">
                  <span className={'ai-dot ' + (m.real ? 'st-on' : 'st-warn')} />
                  {m.real ? '已接入真实数据（只读代理）' : '演示回退'}
                </span>
              </div>
              <div className="ai-set-row">
                <span className="ai-set-k">数据来源</span>
                <span className="ai-set-v ai-mono">ai-wechat-employee · management_api_v1</span>
              </div>
              <div className="ai-set-row">
                <span className="ai-set-k">可见实例</span>
                <span className="ai-set-v">{instances.length} 个（AI 员工可操作范围）</span>
              </div>
              <div className="ai-set-row">
                <span className="ai-set-k">知识库</span>
                <span className="ai-set-v">{m.knowledgeDocCount} 文档 · {m.knowledgeChunkCount} 切片</span>
              </div>
              {!m.real && demoReason && (
                <div className="ai-set-hint">当前：{demoReason}。字段 allowlist 与按实例过滤在数据源就绪后自动启用。</div>
              )}
            </div>

            {/* 安全与合规（真实只读） */}
            <div className="ai-sec">
              <div className="ai-sec-title">安全与合规</div>
              <ul className="ai-set-list">
                <li><b>只读代理 + 字段 allowlist：</b>后台只展示 hash / suffix / 计数 / 状态 / 脱敏摘要。</li>
                <li><b>按可见实例过滤（RBAC）：</b>子账号只看被授权实例，管理员看全部。</li>
                <li><b>高风险动作人工确认：</b>发送 / 改备注 / 群操作进待确认队列，人工确认后才落地。</li>
                <li><b>不外泄敏感原文：</b>不展示聊天正文 / 回复原文 / token / 绑定串明文（二维码除外）。</li>
              </ul>
            </div>

            {/* 通用（占位） */}
            <div className="ai-sec">
              <div className="ai-sec-title">
                通用
                <span className="ai-sec-count">后端接入后启用</span>
              </div>
              <label className="ai-form-field">
                <span className="ai-form-label">面板名称</span>
                <input className="input" disabled defaultValue="AI Console" />
              </label>
              <label className="ai-form-field" style={{ marginTop: 10 }}>
                <span className="ai-form-label">默认时区</span>
                <select className="input" disabled defaultValue="cst">
                  <option value="cst">GMT+8 北京</option>
                </select>
              </label>
              <label className="ai-form-field" style={{ marginTop: 10 }}>
                <span className="ai-form-label">数据保留</span>
                <select className="input" disabled defaultValue="180">
                  <option value="180">180 天</option>
                </select>
              </label>
            </div>

            {/* 模型路由 / 预算（占位） */}
            <div className="ai-sec">
              <div className="ai-sec-title">
                模型路由与预算
                <span className="ai-sec-count">后端接入后启用</span>
              </div>
              <label className="ai-form-field">
                <span className="ai-form-label">主模型路由</span>
                <select className="input" disabled defaultValue="">
                  <option value="">后端接入后配置</option>
                </select>
              </label>
              <label className="ai-form-field" style={{ marginTop: 10 }}>
                <span className="ai-form-label">备用路由</span>
                <select className="input" disabled defaultValue="">
                  <option value="">后端接入后配置</option>
                </select>
              </label>
              <label className="ai-form-field" style={{ marginTop: 10 }}>
                <span className="ai-form-label">每月预算</span>
                <input className="input" disabled placeholder="后端接入后配置" />
              </label>
              <div className="ai-set-hint">超阈值自动切换到备用模型 + 告警——依赖 ai-wechat-employee 写路径，尚未部署。</div>
            </div>

            {/* Webhook / API（占位） */}
            <div className="ai-sec">
              <div className="ai-sec-title">
                Webhook / API
                <span className="ai-sec-count">后端接入后启用</span>
              </div>
              <label className="ai-form-field">
                <span className="ai-form-label">推送地址</span>
                <input className="input ai-mono" disabled placeholder="https://your.domain/hook" />
              </label>
              <label className="ai-form-field" style={{ marginTop: 10 }}>
                <span className="ai-form-label">签名密钥</span>
                <input className="input ai-mono" disabled placeholder="后端接入后生成（不以明文展示）" />
              </label>
              <div className="ai-set-hint">签名密钥属敏感凭据，接入后也只提供「重新生成」，绝不在页面回显明文。</div>
            </div>

            {/* 安全策略（占位开关，真实策略以后端为准） */}
            <div className="ai-sec">
              <div className="ai-sec-title">
                安全策略
                <span className="ai-sec-count">占位展示 · 真实策略以后端为准</span>
              </div>
              <label className="set-check"><input type="checkbox" checked readOnly /> 高风险动作必须人工审批</label>
              <label className="set-check"><input type="checkbox" checked readOnly /> 不外泄聊天正文 / token</label>
              <label className="set-check"><input type="checkbox" checked readOnly /> 按可见实例过滤（RBAC）</label>
              <label className="set-check"><input type="checkbox" disabled /> 审计日志导出（CSV/JSON）</label>
              <div className="ai-set-hint">前三项为系统已强制生效的红线（只读展示）；导出能力需后端接入后启用。</div>
            </div>
          </div>

          {/* 内置人审触发词（真实只读 allowlist） */}
          <div className="ai-sec" style={{ marginTop: 14 }}>
            <div className="ai-sec-title">
              内置强制人审触发词
              <span className="ai-sec-count">命中即转人工确认 · 可在员工「自动回复策略」中按需调整</span>
            </div>
            <div className="ai-choice-row">
              {GUARDRAILS.map((g) => (
                <span key={g} className="ai-choice ai-guard on" style={{ cursor: 'default' }}>{g}</span>
              ))}
            </div>
          </div>

          <div className="ai-set-hint" style={{ marginTop: 12 }}>
            {isAdmin
              ? '模型路由 / 预算 / Webhook / 审计导出依赖 ai-wechat-employee 写路径，尚未部署；接入后此处将可保存并下发。'
              : '模型路由 / 预算 / Webhook 为管理员配置项，且需后端写路径接入后启用。'}
          </div>
        </div>
      </div>
    </div>
  );
}

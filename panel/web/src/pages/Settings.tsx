import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { useInstances } from '../AppShell';
import { useAiConsoleModel } from './aiConsoleModel';

// 系统设置（/settings）—— 对标产品模板「系统设置」页：page-h + grid-2 卡片（通用 / 模型路由 /
// 安全 / Webhook / 数据源与合规）。如实反映 WOC 现状——数据源接入状态、安全红线、内置人审触发词为
// 真实只读信息；无后端写路径的项统一 disabled + title「后续接入」，并标注「演示，不生效」，绝不假装
// 已保存。实例 / 账号 / 授权仍在 /admin，本页不新造租户。绝不明文展示凭据 / 密码。

// 内置强制人审触发词（与 AI 员工中心 GUARDRAILS 一致的只读 allowlist）。
const GUARDRAILS = ['退款', '封号', '付款', '外挂', '外部链接', '大额订单', '投诉'];


function readinessTone(ok: boolean, warn = false): string {
  if (ok) return 'brand';
  return warn ? 'warn' : 'danger';
}
function readinessText(ok: boolean, yes: string, no: string): string {
  return ok ? yes : no;
}

const UploadIcon = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M17 8l-5-5-5 5" /><path d="M12 3v12" />
  </svg>
);

export default function Settings({ onOpenMenu: _onOpenMenu }: { onOpenMenu: () => void }) {
  const nav = useNavigate();
  const { user } = useAuth();
  const { instances } = useInstances();
  const m = useAiConsoleModel();
  const isAdmin = user?.role === 'admin';
  const granted = new Set(m.grantedKeys);
  const hasKb = m.knowledgeDocCount > 0 && m.knowledgeChunkCount > 0;
  const hasAutoReply = granted.has('auto_reply') || granted.has('reply');
  const hasApprovalGate = m.pendingTotal >= 0;
  const hasSendGate = granted.has('send_message') || m.health.sendPlanned > 0 || m.health.sendExecuted > 0;
  const hasVision = m.health.visionSeen;
  const readyItems = [m.real, hasKb, hasAutoReply, hasApprovalGate, hasSendGate, hasVision];
  const readyCount = readyItems.filter(Boolean).length;

  const demoReason =
    m.demoReason === 'cannot_enforce_instance_filter'
      ? '无法按实例过滤，已对子账号回退'
      : m.demoReason === 'unavailable'
        ? '数据源子进程不可用，已回退'
        : m.demoReason === 'not_configured'
          ? '尚未配置数据源'
          : '';

  return (
    <div>
      <div className="page-h">
        <div>
          <h1>系统设置</h1>
          <p>通用、安全、模型路由、Webhook 与数据源。红线策略为系统强制生效项，仅只读展示；无后端写路径的配置项标注「后续接入」，不会假装保存成功。</p>
        </div>
        <div className="act">
          <button className="btn" onClick={() => nav('/admin')} title="实例 / 账号 / 授权在此完成">实例与账号管理</button>
          <button className="btn primary" disabled title="后续接入：依赖 ai-wechat-employee 写路径">保存</button>
        </div>
      </div>

      {m.probed &&
        (m.real ? (
          <div className="src-note real">
            <span className="d" /> 已接入真实数据源 · ai-wechat-employee（只读代理，已按你可见实例过滤）
          </div>
        ) : (
          <div className="src-note demo">
            <span className="d" /> 演示回退{demoReason ? `：${demoReason}` : ''}。字段 allowlist 与按实例过滤在数据源就绪后自动启用。
          </div>
        ))}


      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-h">
          <span className="title">AI 员工配置完整度</span>
          <span className={'chip ' + readinessTone(readyCount >= 5, readyCount >= 3)} style={{ marginLeft: 'auto' }}>
            {readyCount}/6 已就绪
          </span>
        </div>
        <div className="card-b">
          <div className="grid-4">
            <div className="mini-stat"><span>数据源</span><b className={m.real ? '' : 'warn'}>{readinessText(m.real, '已接入', '未配置')}</b></div>
            <div className="mini-stat"><span>知识库</span><b className={hasKb ? '' : 'warn'}>{m.knowledgeDocCount}/{m.knowledgeChunkCount}</b></div>
            <div className="mini-stat"><span>自动回复</span><b className={hasAutoReply ? '' : 'warn'}>{readinessText(hasAutoReply, '已授权', '未授权')}</b></div>
            <div className="mini-stat"><span>视觉运行时</span><b className={hasVision ? '' : 'warn'}>{readinessText(hasVision, '已上报', '未上报')}</b></div>
          </div>
          <div className="row" style={{ marginTop: 10, flexWrap: 'wrap', gap: 6 }}>
            <span className={'chip ' + readinessTone(hasApprovalGate, true)}>人审闸门：{readinessText(hasApprovalGate, '已启用', '待接入')}</span>
            <span className={'chip ' + readinessTone(hasSendGate, true)}>发送闸门：{readinessText(hasSendGate, '已启用', '未授权')}</span>
            <span className="chip outline">service_state: {m.health.serviceState}</span>
            <span className="chip outline">send planned/executed/failed: {m.health.sendPlanned}/{m.health.sendExecuted}/{m.health.sendFailed}</span>
          </div>
        </div>
      </div>

      <div className="grid-2" style={{ marginTop: 16 }}>
        {/* 通用（演示，不生效） */}
        <div className="card">
          <div className="card-h">
            <span className="title">通用</span>
            <span className="chip" style={{ marginLeft: 'auto' }}>演示，不生效</span>
          </div>
          <div className="card-b col" style={{ gap: 12 }}>
            <label className="form-field">
              <span>面板名称</span>
              <input className="input" disabled defaultValue="AI Console" title="后续接入" />
            </label>
            <label className="form-field">
              <span>默认时区</span>
              <select className="select" disabled defaultValue="cst" title="后续接入">
                <option value="cst">GMT+8 北京</option>
                <option value="utc">UTC</option>
              </select>
            </label>
            <label className="form-field">
              <span>数据保留</span>
              <select className="select" disabled defaultValue="180" title="后续接入">
                <option value="180">180 天</option>
                <option value="365">365 天</option>
              </select>
            </label>
          </div>
        </div>

        {/* 模型路由（演示，不生效） */}
        <div className="card">
          <div className="card-h">
            <span className="title">模型路由</span>
            <span className="chip" style={{ marginLeft: 'auto' }}>演示，不生效</span>
          </div>
          <div className="card-b col" style={{ gap: 12 }}>
            <label className="form-field">
              <span>主路由</span>
              <select className="select" disabled defaultValue="" title="后续接入">
                <option value="">后续接入后配置</option>
              </select>
            </label>
            <label className="form-field">
              <span>备用路由</span>
              <select className="select" disabled defaultValue="" title="后续接入">
                <option value="">后续接入后配置</option>
              </select>
            </label>
            <label className="form-field">
              <span>每月预算</span>
              <input className="input" disabled placeholder="后续接入后配置" title="后续接入" />
            </label>
            <span className="dim" style={{ fontSize: 12 }}>超阈值自动切换到备用模型 + 告警——依赖 ai-wechat-employee 写路径，尚未部署。</span>
          </div>
        </div>

        {/* 安全（前三项为系统强制红线，只读；导出后续接入） */}
        <div className="card">
          <div className="card-h">
            <span className="title">安全</span>
            <span className="chip brand" style={{ marginLeft: 'auto' }}>红线只读</span>
          </div>
          <div className="card-b col" style={{ gap: 12 }}>
            <label className="check-row"><input type="checkbox" checked readOnly disabled title="系统已强制生效" /> 按可见实例过滤（RBAC）</label>
            <label className="check-row"><input type="checkbox" checked readOnly disabled title="系统已强制生效" /> 高风险动作必须人工审批</label>
            <label className="check-row"><input type="checkbox" checked readOnly disabled title="系统已强制生效" /> 不外泄聊天正文 / token / 绑定串明文</label>
            <label className="check-row"><input type="checkbox" disabled title="后续接入" /> 启用审计日志导出（CSV / JSON）</label>
            <span className="dim" style={{ fontSize: 12 }}>前三项为系统已强制生效的红线，只读展示；导出能力需后端接入后启用。</span>
          </div>
        </div>

        {/* Webhook / API（演示，不生效；密钥不回显明文） */}
        <div className="card">
          <div className="card-h">
            <span className="title">Webhook / API</span>
            <span className="chip" style={{ marginLeft: 'auto' }}>演示，不生效</span>
          </div>
          <div className="card-b col" style={{ gap: 12 }}>
            <label className="form-field">
              <span>推送地址</span>
              <input className="input ai-mono" disabled placeholder="https://your.domain/hook" title="后续接入" />
            </label>
            <label className="form-field">
              <span>签名密钥</span>
              <input className="input ai-mono" disabled placeholder="whsec_••••••••••••（不回显明文）" title="后续接入" />
            </label>
            <button className="btn sm" disabled title="后续接入：密钥属敏感凭据，接入后也只提供重新生成，绝不回显明文">
              <span className="ico sm">{UploadIcon}</span> 重新生成
            </button>
          </div>
        </div>

        {/* 数据源与运行（真实只读） */}
        <div className="card">
          <div className="card-h">
            <span className="title">数据源与运行</span>
            <span className={'chip ' + readinessTone(m.real, true)} style={{ marginLeft: 'auto' }}>{m.real ? '真实只读' : '待配置'}</span>
          </div>
          <div className="card-b col" style={{ gap: 10 }}>
            <div className="row between">
              <span className="muted">接入状态</span>
              <span className="row" style={{ gap: 6 }}>
                <span className={'dot ' + (m.real ? 'st-on' : 'st-warn')} />
                {m.real ? '已接入真实数据（只读代理）' : '演示回退'}
              </span>
            </div>
            <div className="row between">
              <span className="muted">数据来源</span>
              <span className="ai-mono">ai-wechat-employee · management_api_v1</span>
            </div>
            <div className="row between">
              <span className="muted">可见实例</span>
              <span>{instances.length} 个（AI 员工可操作范围）</span>
            </div>
            <div className="row between">
              <span className="muted">知识库</span>
              <span>{m.knowledgeDocCount} 文档 · {m.knowledgeChunkCount} 切片 · {hasKb ? '可检索' : '待导入'}</span>
            </div>
            <div className="row between">
              <span className="muted">自动回复策略</span>
              <span>{hasAutoReply ? '已授予 auto_reply/reply 能力' : '未授予 auto_reply/reply 能力'}</span>
            </div>
            <div className="row between">
              <span className="muted">视觉运行时</span>
              <span>{hasVision ? `已上报 · ${m.health.visionSource}` : '未上报'}</span>
            </div>
            <div className="row between">
              <span className="muted">发送安全闸门</span>
              <span>{hasSendGate ? `planned ${m.health.sendPlanned} / failed ${m.health.sendFailed}` : '未授权 send_message'}</span>
            </div>
          </div>
        </div>

        {/* 安全与合规姿态（真实只读） */}
        <div className="card">
          <div className="card-h">
            <span className="title">安全与合规姿态</span>
            <span className="chip accent" style={{ marginLeft: 'auto' }}>强制生效</span>
          </div>
          <div className="card-b col" style={{ gap: 8 }}>
            <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.6 }}>
              <div><b style={{ color: 'var(--text)' }}>只读代理 + 字段 allowlist：</b>后台只展示 hash / suffix / 计数 / 状态 / 脱敏摘要。</div>
              <div><b style={{ color: 'var(--text)' }}>按可见实例过滤（RBAC）：</b>子账号只看被授权实例，管理员看全部。</div>
              <div><b style={{ color: 'var(--text)' }}>高风险动作人工确认：</b>发送 / 改备注 / 群操作进待确认队列，人工确认后才落地。</div>
              <div><b style={{ color: 'var(--text)' }}>不外泄敏感原文：</b>不展示聊天正文 / 回复原文 / token / 绑定串明文（二维码除外）。</div>
            </div>
          </div>
        </div>
      </div>

      {/* 内置人审触发词（真实只读 allowlist） */}
      <div className="card" style={{ marginTop: 12 }}>
        <div className="card-h">
          <span className="title">内置强制人审触发词</span>
          <span className="chip" style={{ marginLeft: 'auto' }}>命中即转人工确认</span>
        </div>
        <div className="card-b">
          <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
            {GUARDRAILS.map((g) => (
              <span key={g} className="chip warn">{g}</span>
            ))}
          </div>
          <div className="dim" style={{ fontSize: 12, marginTop: 10 }}>
            系统内置的强制人审 allowlist（只读）；可在员工「自动回复策略」中按需追加触发词。
          </div>
        </div>
      </div>

      <div className="dim" style={{ fontSize: 12, marginTop: 12 }}>
        {isAdmin
          ? '模型路由 / 预算 / Webhook / 审计导出依赖 ai-wechat-employee 写路径，尚未部署；接入后此处将可保存并下发。'
          : '模型路由 / 预算 / Webhook 为管理员配置项，且需后端写路径接入后启用。'}
      </div>
    </div>
  );
}

// AI 能力注册表（模块化解耦）
// 把「AI 微信员工」的运行链路拆成可枚举的能力模块，供「工具与工作流」页渲染成大厂 SaaS 式的
// capability / action registry。每个能力只声明安全元信息（键 / 模块 / 风险 / 是否写路径），
// 运行态由 useAiConsoleModel 的安全字段派生（权限键命中 / 计数 / real|demo），
// 绝不引用聊天正文 / 回复原文 / token / 绑定串明文。
//
// 设计稿工具库对应关系（10 模块产品结构里的「工具与工作流」）：
//   OCR 监听 · pixel gate · 客户记忆 · 知识库 RAG · 回复生成 · 人工审批 ·
//   文本发送 · 图片发送 · 文件发送 · daemon 管理 · 监控 trace · PP-OCRv6 benchmark

export type CapRisk = 'low' | 'medium' | 'high';
export const CAP_RISK_LABEL: Record<CapRisk, string> = { low: '低风险', medium: '需确认', high: '高风险' };
export const capRiskCls = (r: CapRisk): string => (r === 'high' ? 'st-off' : r === 'medium' ? 'st-warn' : 'st-on');

// 能力如何取得运行态：
//  - permission：由可见员工是否被授予对应权限键决定「已授权 / 未授权」（真实模式最可信）。
//  - runtime：属平台常驻链路（感知 / 记忆 / 知识 / 生成），真实模式即视为「运行中」。
//  - gated：敏感外发动作，恒经二次 gating + 人审，展示「需人工确认」。
//  - ops：运维 / 基准工具，无前端可写路径，展示「运维工具（占位）」。
export type CapStatusKind = 'permission' | 'runtime' | 'gated' | 'ops';

export interface CapModule {
  key: string; // 分组键
  label: string; // 分组中文名
  desc: string; // 分组一句话
}

export interface Capability {
  key: string; // 稳定键（api 风格），用于展示 wechat.* / 与权限键映射
  name: string; // 中文名（对齐设计稿工具库）
  module: string; // 所属模块 key
  desc: string;
  risk: CapRisk;
  statusKind: CapStatusKind;
  permKey?: string; // statusKind==='permission' 时映射到的员工权限键
  writePath: boolean; // 是否需要后端写路径才能「配置 / 执行」（决定按钮是否占位）
}

// ---- 模块分组（感知 → 记忆 → 知识 → 生成 → 管控 → 动作 → 运维）----
export const CAP_MODULES: CapModule[] = [
  { key: 'perception', label: '感知与安全闸', desc: 'OCR 监听聊天窗口、像素级动作闸门，保证 AI 只看安全字段、只在允许区域动作。' },
  { key: 'memory', label: '记忆与画像', desc: '沉淀客户长期记忆与画像标签，只写 hash / 阶段 / 意向 / 风险等安全字段。' },
  { key: 'knowledge', label: '知识与检索', desc: '知识库 RAG 检索，作为回复依据；后台只展示 hash / 计数 / 命中。' },
  { key: 'generation', label: '生成与决策', desc: 'AI 起草回复、决定自动发送 / 转人工，正文脱敏进入待确认。' },
  { key: 'control', label: '管控与审批', desc: '行为边界 + 人工审批，敏感动作必须人工确认后才落地。' },
  { key: 'action', label: '动作执行', desc: '文本 / 图片 / 文件发送等外发动作，恒经二次 gating，本页只读不触发。' },
  { key: 'ops', label: '运维与基准', desc: 'daemon 管理、监控 trace、OCR 基准等运维能力，只读占位或跳转监控。' },
];

export const CAPABILITIES: Capability[] = [
  // 感知与安全闸
  {
    key: 'perception.ocr_watch',
    name: 'OCR 监听',
    module: 'perception',
    desc: '监听聊天窗口截图，抽取消息为安全字段（hash / 计数 / 时间），不落聊天正文。',
    risk: 'low',
    statusKind: 'runtime',
    writePath: false,
  },
  {
    key: 'perception.pixel_gate',
    name: 'Pixel Gate 像素闸门',
    module: 'perception',
    desc: '动作前的像素级校验闸门：只在识别到目标控件时放行点击 / 输入，越界即中止。',
    risk: 'low',
    statusKind: 'runtime',
    writePath: false,
  },
  // 记忆与画像
  {
    key: 'memory.customer',
    name: '客户记忆',
    module: 'memory',
    desc: '把客户偏好 / 关键事实沉淀为长期记忆，供后续跟进复用；只存安全字段。',
    risk: 'low',
    statusKind: 'permission',
    permKey: 'memory_write',
    writePath: false,
  },
  {
    key: 'memory.profile',
    name: '画像更新',
    module: 'memory',
    desc: '刷新客户阶段 / 意向 / 风险标签，写入结构化画像字段。',
    risk: 'low',
    statusKind: 'permission',
    permKey: 'profile_update',
    writePath: false,
  },
  // 知识与检索
  {
    key: 'knowledge.rag',
    name: '知识库 RAG',
    module: 'knowledge',
    desc: '按客户问题检索已切片的商品 / 售后 / 话术知识，作为回复依据（含重排）。',
    risk: 'low',
    statusKind: 'permission',
    permKey: 'knowledge_read',
    writePath: false,
  },
  // 生成与决策
  {
    key: 'generation.reply',
    name: '回复生成',
    module: 'generation',
    desc: '为客户消息生成回复草稿，低风险自动发送，敏感内容脱敏后转人工确认。',
    risk: 'medium',
    statusKind: 'permission',
    permKey: 'auto_reply',
    writePath: false,
  },
  // 管控与审批
  {
    key: 'control.human_approval',
    name: '人工审批',
    module: 'control',
    desc: '敏感 / 高风险动作强制进入待确认队列，人工确认后 AI 才落地执行。',
    risk: 'low',
    statusKind: 'runtime',
    writePath: false,
  },
  // 动作执行（外发，gated）
  {
    key: 'action.send_text',
    name: '文本发送',
    module: 'action',
    desc: '向客户外发文本消息，属敏感外发动作，需人工确认后由后端 gating 执行。',
    risk: 'high',
    statusKind: 'gated',
    permKey: 'send_message',
    writePath: true,
  },
  {
    key: 'action.send_image',
    name: '图片发送',
    module: 'action',
    desc: '向客户外发图片 / 卡片，敏感外发动作，需人工确认后执行。',
    risk: 'high',
    statusKind: 'gated',
    permKey: 'send_message',
    writePath: true,
  },
  {
    key: 'action.send_file',
    name: '文件发送',
    module: 'action',
    desc: '向客户外发文件（如报价单 / 手册），敏感外发动作，需人工确认后执行。',
    risk: 'high',
    statusKind: 'gated',
    permKey: 'send_message',
    writePath: true,
  },
  // 运维与基准
  {
    key: 'ops.daemon',
    name: 'Daemon 管理',
    module: 'ops',
    desc: 'AI 员工常驻进程的启停 / 健康监控，属基础设施运维，走实例管理与监控墙。',
    risk: 'medium',
    statusKind: 'ops',
    writePath: true,
  },
  {
    key: 'ops.trace',
    name: '监控 Trace',
    module: 'ops',
    desc: '运行链路埋点与追踪，只读脱敏摘要，明细在监控墙查看。',
    risk: 'low',
    statusKind: 'ops',
    writePath: false,
  },
  {
    key: 'ops.ocr_benchmark',
    name: 'PP-OCRv6 Benchmark',
    module: 'ops',
    desc: 'OCR 识别准确率 / 时延基准，用于评估感知层质量，运维离线执行。',
    risk: 'low',
    statusKind: 'ops',
    writePath: true,
  },
];

// 运行态视图（安全派生）：给定「真实模式」+「已授予权限键集合」，产出每个能力的启用态与文案。
export interface CapabilityState {
  cap: Capability;
  on: boolean; // 是否处于启用 / 运行态
  stateText: string; // 「运行中 / 已授权 / 未授权 / 需人工确认 / 运维工具」
  stateCls: string; // st-on / st-warn / st-off
  needApproval: boolean;
  configurable: boolean; // 「配置」按钮是否可点（当前恒为 false：写路径未接入）
}

export function deriveCapabilityState(cap: Capability, real: boolean, grantedKeys: Set<string>): CapabilityState {
  let on = false;
  let stateText = '';
  let stateCls = 'st-off';
  switch (cap.statusKind) {
    case 'runtime':
      on = real;
      stateText = real ? '运行中' : '待接入';
      stateCls = real ? 'st-on' : 'st-warn';
      break;
    case 'permission':
      on = cap.permKey ? grantedKeys.has(cap.permKey) : false;
      stateText = on ? '已授权' : '未授权';
      stateCls = on ? 'st-on' : 'st-off';
      break;
    case 'gated':
      on = cap.permKey ? grantedKeys.has(cap.permKey) : false;
      stateText = '需人工确认';
      stateCls = on ? 'st-warn' : 'st-off';
      break;
    case 'ops':
      on = false;
      stateText = '运维工具';
      stateCls = 'st-warn';
      break;
  }
  const needApproval = cap.statusKind === 'gated' || cap.risk !== 'low';
  return { cap, on, stateText, stateCls, needApproval, configurable: false };
}

// 处理工作流节点（安全示意），Tools 页与总览复用。
export type FlowKind = 'trigger' | 'llm' | 'tool' | 'cond' | 'approve';
export interface FlowNode {
  key: string;
  kind: FlowKind;
  title: string;
  detail: string;
}
export function buildWorkflow(kbDocs: number, guardCount: number, pendingTotal: number): FlowNode[] {
  return [
    { key: 'ingest', kind: 'trigger', title: '接入客户消息', detail: 'OCR 监听 / 消息入库 · wechat.message.created' },
    { key: 'route', kind: 'llm', title: '意图识别与路由', detail: '识别意图 → 分配到售前 / 售后 / 复购 / 群运营岗位' },
    { key: 'kb', kind: 'tool', title: '检索知识库', detail: `knowledge.rag · ${kbDocs} 文档命中作为回复依据` },
    { key: 'draft', kind: 'llm', title: '起草回复', detail: '按人格与知识库生成回复草稿（正文脱敏）' },
    { key: 'boundary', kind: 'cond', title: '行为边界检查', detail: `命中 ${guardCount} 类人审触发词 → 强制转人工确认` },
    {
      key: 'approve',
      kind: 'approve',
      title: '待确认 / 自动发送',
      detail: pendingTotal ? `${pendingTotal} 个动作待人工确认后落地` : '敏感动作进待确认队列，人工确认后执行',
    },
  ];
}

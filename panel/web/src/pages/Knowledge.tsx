import { useState } from 'react';
import { ThemeToggle } from '../AppShell';
import { useAiConsoleModel } from './aiConsoleModel';
import { api, type AiKnowledgeImportResponse } from '../api';

// 知识库（/knowledge）
// 设计稿「知识库」产品化：文档卡 + 导入入口 + 命中回放。全部安全字段（hash / suffix / 计数 / 命中率占位），
// 绝不展示原始标题 / 正文 / 切片内容。导入仅真实模式可用；命中回放待后端检索 API 接入（占位不假成功）。

const MenuIcon = (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M4 6h16M4 12h16M4 18h16" />
  </svg>
);

export const KnowledgeIcon = (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H12v16H6.5A2.5 2.5 0 0 0 4 21.5z" />
    <path d="M20 5.5A2.5 2.5 0 0 0 17.5 3H12v16h5.5a2.5 2.5 0 0 1 2.5 2.5z" />
  </svg>
);

export default function Knowledge({ onOpenMenu }: { onOpenMenu: () => void }) {
  const m = useAiConsoleModel();
  const [title, setTitle] = useState('销售知识库');
  const [markdown, setMarkdown] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AiKnowledgeImportResponse | null>(null);
  const [err, setErr] = useState('');
  const [query, setQuery] = useState('');
  const canImport = m.real;

  const submit = async () => {
    setBusy(true);
    setErr('');
    setResult(null);
    try {
      const res = await api.importAiEmployeeKnowledge(title, markdown);
      setResult(res);
      setMarkdown('');
    } catch (e: any) {
      setErr(e?.message || '导入失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ws-page">
      <header className="ws-head">
        <button className="ws-menu" onClick={onOpenMenu} aria-label="菜单">
          {MenuIcon}
        </button>
        <span className="ws-title">知识库</span>
        <ThemeToggle />
      </header>

      <div className="content">
        <div className="page-pad">
          {m.probed &&
            (m.real ? (
              <div className="con-src con-src-real">
                <span className="con-src-dot" /> 已接入真实知识库（只读；导入写入服务端私有目录并重建切片）
              </div>
            ) : (
              <div className="con-src con-src-demo">
                <span className="con-src-dot" /> 演示数据：尚未配置数据源。文档为占位演示，导入在配置数据源后可用。
              </div>
            ))}

          <div className="ai-kpis" style={{ marginTop: 12 }}>
            <div className="ai-kpi">
              <span className="ai-kpi-val">{m.knowledgeDocCount}</span>
              <span className="ai-kpi-lbl">知识文档</span>
            </div>
            <div className="ai-kpi">
              <span className="ai-kpi-val">{m.knowledgeChunkCount}</span>
              <span className="ai-kpi-lbl">检索切片</span>
            </div>
            <div className="ai-kpi">
              <span className="ai-kpi-val">text-embedding</span>
              <span className="ai-kpi-lbl">嵌入模型（默认）</span>
            </div>
            <div className="ai-kpi">
              <span className="ai-kpi-val">500 / 100</span>
              <span className="ai-kpi-lbl">切片 tokens / overlap</span>
            </div>
          </div>

          <div className="kb-grid" style={{ marginTop: 14 }}>
            {/* 左：文档列表 */}
            <div className="ai-sec">
              <div className="ai-sec-title">
                文档
                <span className="ai-sec-count">{m.knowledgeDocCount} 篇 · {m.knowledgeChunkCount} 切片</span>
              </div>
              {m.knowledgeDocs.length === 0 ? (
                <div className="ai-note">暂无知识库文档。可在右侧粘贴 Markdown 导入。</div>
              ) : (
                <table className="ai-table">
                  <thead>
                    <tr>
                      <th>文档</th>
                      <th>切片</th>
                      <th>状态</th>
                      <th>更新</th>
                    </tr>
                  </thead>
                  <tbody>
                    {m.knowledgeDocs.map((d) => (
                      <tr key={d.key}>
                        <td>
                          <b>{d.label}</b>
                          <div className="ai-cell-sub ai-mono">title hash · {d.titleHash.slice(0, 12)}</div>
                        </td>
                        <td>{d.chunks}</td>
                        <td>
                          <span className={'ai-dot ' + (d.sliced ? 'st-on' : 'st-warn')} /> {d.sliced ? '已切片' : '待切片'}
                        </td>
                        <td className="ai-cell-sub">{d.ago}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {/* 命中回放（占位：待后端检索 API） */}
              <div className="ai-sec-title" style={{ marginTop: 16 }}>
                检索回放
                <span className="ai-sec-count">待后端检索 API · 只回放命中文档 hash 与相关度，不显示切片正文</span>
              </div>
              <div className="kb-hittest">
                <input
                  className="input"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="输入问题，例如：黑色款是否有现货，发到上海几天？"
                />
                <button className="btn" disabled title="检索回放写路径后端接入后启用">
                  回放
                </button>
              </div>
              <div className="ai-note" style={{ marginTop: 8 }}>
                接入后：用最近真实问题回放检索，展示命中文档 hash + 相关度分数（0–1）柱状，仍不展示切片正文（安全红线）。
              </div>
            </div>

            {/* 右：导入入口 */}
            <div className="ai-sec">
              <div className="ai-sec-title">导入知识库</div>
              <p className="ai-bind-desc">
                上传 Markdown 到 AI 员工知识库，服务端写入私有目录并重建检索切片。后台只显示 hash / 计数，不展示正文与原始标题。
                {!canImport && ' 当前未接入真实数据源，导入在配置数据源后可用。'}
              </p>
              <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="文档标题" />
              <textarea
                className="input ai-kb-textarea"
                value={markdown}
                onChange={(e) => setMarkdown(e.target.value)}
                placeholder={'# 退换货政策\n\n把商家话术 / 商品知识粘贴到这里'}
              />
              <div className="ai-bind-actions">
                <button className="btn btn-primary" disabled={busy || !markdown.trim() || !canImport} onClick={submit}>
                  {busy ? '导入中…' : '导入 Markdown'}
                </button>
                {result && <span className="ai-bind-hint">已导入 {result.document_count} 文档 / {result.chunk_count} 切片</span>}
              </div>
              {err && <div className="ai-warn" style={{ marginTop: 10 }}>{err}</div>}

              <div className="ai-sec-title" style={{ marginTop: 16 }}>检索配置</div>
              <div className="ai-choice-row">
                <span className="ai-choice on" style={{ cursor: 'default' }}>嵌入：text-embedding-3</span>
                <span className="ai-choice on" style={{ cursor: 'default' }}>向量库：内置</span>
                <span className="ai-choice on" style={{ cursor: 'default' }}>切片：500 tokens · 100 overlap</span>
                <span className="ai-choice on" style={{ cursor: 'default' }}>重排：开启</span>
              </div>
              <div className="ai-set-hint">检索参数为默认值展示；自定义配置需后端写路径接入后启用。</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

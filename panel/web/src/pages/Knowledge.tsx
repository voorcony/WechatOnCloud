import { useState } from 'react';
import { useAiConsoleModel } from './aiConsoleModel';
import { api, type AiKnowledgeImportResponse } from '../api';

// 知识库（/knowledge）—— 对标模板「知识库」页（pageKb）：
// 页头（导入 / 新建）+ 数据源提示 + 左文档列表 + 右统计详情卡。
// 安全红线：绝不展示原始标题 / 正文 / 切片正文 / token；文档名用脱敏 label。
// 检索回放为占位（禁用输入 / 按钮），不回显真实命中内容；导入保留真实 API 行为。

export const KnowledgeIcon = (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H12v16H6.5A2.5 2.5 0 0 0 4 21.5z" />
    <path d="M20 5.5A2.5 2.5 0 0 0 17.5 3H12v16h5.5a2.5 2.5 0 0 1 2.5 2.5z" />
  </svg>
);

export default function Knowledge({ onOpenMenu: _onOpenMenu }: { onOpenMenu: () => void }) {
  const m = useAiConsoleModel();
  const [title, setTitle] = useState('销售知识库');
  const [markdown, setMarkdown] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AiKnowledgeImportResponse | null>(null);
  const [err, setErr] = useState('');
  const [selKey, setSelKey] = useState<string | null>(null);
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
    <div>
      <div className="page-h">
        <div>
          <h1>知识库</h1>
          <p>AI 微信员工的检索知识：文档脱敏统计、切片计数与检索配置。后台只显示 hash / 计数，不展示原文。</p>
        </div>
        <div className="act">
          <span className="chip">{m.knowledgeDocCount} 篇 · {m.knowledgeChunkCount} 切片</span>
          <button className="btn brand" disabled={busy || !markdown.trim() || !canImport} onClick={submit} title={canImport ? '导入右侧 Markdown 到 AI 员工知识库' : '未接入真实数据源，导入在配置数据源后可用'}>
            {busy ? '导入中…' : '导入 Markdown'}
          </button>
        </div>
      </div>

      {m.probed && (
        m.real ? (
          <div className="src-note real"><span className="d" /> 已接入真实知识库 · 来源 ai-wechat-employee（只读；导入写入服务端私有目录并重建切片）</div>
        ) : (
          <div className="src-note demo"><span className="d" /> 演示数据：尚未配置数据源。文档为 deterministic 占位统计，导入在配置数据源后可用。</div>
        )
      )}

      <div className="safe-note">
        本页仅展示<b>脱敏统计</b>：文档名为「文档 ···suffix」脱敏 label + title hash + 切片计数，<b>绝不展示原始标题 / 原文 / 切片正文 / token</b>。检索回放为占位，接入后仅回放命中文档 hash + 相关度，不显示切片正文。
      </div>

      <div className="kb-grid">
        {/* 左：文档列表 */}
        <div className="kb-list">
          <div className="h">
            文档
            <span className="chip" style={{ marginLeft: 'auto' }}>{m.knowledgeDocCount} 篇</span>
          </div>
          {m.knowledgeDocs.length === 0 ? (
            <div className="dim" style={{ padding: 14, fontSize: 12.5 }}>暂无知识库文档。可在右侧粘贴 Markdown 导入。</div>
          ) : (
            m.knowledgeDocs.map((d) => {
              const active = (selKey ?? m.knowledgeDocs[0]?.key) === d.key;
              return (
                <button key={d.key} className={'item' + (active ? ' active' : '')} onClick={() => setSelKey(d.key)}>
                  <div style={{ minWidth: 0 }}>
                    <div className="cut" style={{ fontWeight: 600, fontSize: 13 }}>{d.label}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{d.chunks} 分块</div>
                  </div>
                  <span className={'chip ' + (d.sliced ? 'brand' : 'warn')} style={{ marginLeft: 'auto' }}>
                    {d.sliced ? '已切片' : '待切片'}
                  </span>
                </button>
              );
            })
          )}
        </div>

        {/* 右：统计详情 + 检索配置 */}
        <div className="kb-detail">
          <div className="card">
            <div className="card-h">
              <span className="title">知识库统计</span>
              <span className="chip" style={{ marginLeft: 'auto' }}>脱敏视图</span>
            </div>
            <div className="card-b">
              <div className="row">
                <div className="kb-stat">
                  <div className="k">文档数</div>
                  <div className="v">{m.knowledgeDocCount}</div>
                </div>
                <div className="kb-stat">
                  <div className="k">分块数</div>
                  <div className="v">{m.knowledgeChunkCount}</div>
                </div>
                <div className="kb-stat">
                  <div className="k">已切片文档</div>
                  <div className="v">{m.knowledgeDocs.filter((d) => d.sliced).length}</div>
                </div>
              </div>

              <div className="divider" />

              <div className="row" style={{ flexWrap: 'wrap' }}>
                <span className="chip">嵌入模型 · text-embedding-3</span>
                <span className="chip">向量库 · 内置</span>
                <span className="chip">切片 · 500 tokens / 100 overlap</span>
                <span className="chip">重排 · 开启</span>
              </div>
              <div className="dim" style={{ fontSize: 11.5, marginTop: 8 }}>
                检索参数为默认值展示；自定义配置需后端写路径接入后启用。
              </div>
            </div>
          </div>

          {/* 导入知识库 */}
          <div className="card" style={{ marginTop: 16 }}>
            <div className="card-h">
              <span className="title">导入知识库</span>
              {!canImport && <span className="chip warn" style={{ marginLeft: 'auto' }}>需配置数据源</span>}
            </div>
            <div className="card-b col">
              <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>
                上传 Markdown 到 AI 微信员工知识库，服务端写入私有目录并重建检索切片。后台只显示 hash / 计数，不展示正文与原始标题。
              </p>
              <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="文档标题" />
              <textarea
                className="textarea"
                value={markdown}
                onChange={(e) => setMarkdown(e.target.value)}
                placeholder={'# 退换货政策\n\n把商家话术 / 商品知识粘贴到这里'}
                style={{ minHeight: 120 }}
              />
              <div className="row">
                <button className="btn brand" disabled={busy || !markdown.trim() || !canImport} onClick={submit}>
                  {busy ? '导入中…' : '导入 Markdown'}
                </button>
                {result && <span className="chip brand">已导入 {result.document_count} 文档 / {result.chunk_count} 切片</span>}
              </div>
              {err && <div className="src-note demo"><span className="d" /> {err}</div>}
            </div>
          </div>

          {/* 检索回放（占位：待后端检索 API） */}
          <div className="card" style={{ marginTop: 16 }}>
            <div className="card-h">
              <span className="title">检索回放</span>
              <span className="chip" style={{ marginLeft: 'auto' }}>待后端检索 API</span>
            </div>
            <div className="card-b col">
              <div className="row">
                <input
                  className="input"
                  disabled
                  placeholder="输入问题回放检索，例如：黑色款是否有现货，发到上海几天？"
                  title="检索回放写路径后端接入后启用"
                />
                <button className="btn" disabled title="检索回放写路径后端接入后启用">回放</button>
              </div>
              <div className="dim" style={{ fontSize: 11.5 }}>
                接入后：用最近真实问题回放检索，展示命中文档 hash + 相关度分数（0–1），仍不展示切片正文（安全红线）。
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

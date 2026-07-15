# AI Console 设计规范

> 本文件为 WOC AI Console UI 改造的设计基准。后续重构必须优先遵守此规范；业务逻辑、接口、鉴权不得因视觉改造被重写。

详见用户提供的设计规范原文：`/home/ubuntu/.hermes/cache/documents/doc_e44ee559e2c5_DESIGN_SPEC.md`。

## 执行约束

- 所有颜色必须使用 `panel/web/src/aiConsole.css` 中的 CSS variables，不新增硬编码色。
- 页面结构复用 `.page-h`、`.card`、`.card-h`、`.card-b`、`.btn`、`.chip`、`.kpi`、`table.t`。
- 客户/员工/知识库等列表页必须使用整张卡片包裹表格；内容多时内部滚动或左右详情布局，不允许把内容挤进小卡。
- 路由/鉴权/业务 API 不因 UI 改造重写；导航点击必须保持在 `/wechat/woc/*` 子路径内。

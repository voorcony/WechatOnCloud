// VNC 预览 URL（监控墙缩略 + 对话页中栏工作区共用）。
// 与 Desktop.tsx 的 desktopUrl 分开：预览是「只读 + 客户端缩放」，绝不改远端分辨率、绝不发输入。
//   - resize=scale：noVNC 客户端把远端画面缩放贴合 iframe，remote 分辨率保持不变
//     （若沿用 desktop 的 resize=remote，多个小缩略 iframe 会把各实例 Xvnc 逼成缩略尺寸，破坏真实桌面）。
//   - view_only=1：预览不向实例发送任何鼠标/键盘，接管一律走 /i/<id> 完整工作台。
//   - 反代按实例隔离：/desktop/<id>/* → 对应容器，注入凭据（与正式桌面同源）。
export function vncPreviewUrl(id: string): string {
  return (
    `/desktop/${id}/vnc/index.html?autoconnect=1&path=desktop/${id}/websockify` +
    '&resize=scale&view_only=1&reconnect=true&reconnect_delay=3000'
  );
}

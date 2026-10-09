/* 共享线条图标：工作台和楼内 iframe 使用相同 SVG 与外观状态标识。 */
const shapes = {
    edit: '<path d="M13 3H5v18h14v-7M13 3v6h6M13 3l6 6M10 16l7-7 3 3-7 7-4 1z"/>',
    trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
    settings: '<path d="m9 3-1 3-3 1-2 4 2 2v3l3 2 1 3h5l1-3 3-2v-3l2-2-2-4-3-1-1-3z"/><circle cx="11.5" cy="12" r="3"/>',
    light: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5"/>',
    dark: '<path d="M20 14A8.5 8.5 0 0 1 10 3a8.5 8.5 0 1 0 10 11Z"/>',
    auto: '<path d="M5 19c-4-9 5-12 14-15 1 10-2 17-10 16M4 22l11-12M8 15l5 1"/>',
};
export function setIcon(node, name) {
    if (!shapes[name]) return;
    node.innerHTML = `<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shapes[name]}</svg>`;
    node.dataset.icon = name;
}
export function appearanceIcon(node, mode = 'auto') {
    setIcon(node, mode);
    node.title = `切换外观（当前：${{auto:'自适应',light:'日间',dark:'夜间'}[mode]}）`;
}

/* iframe 通信协议：限定消息来源、允许的设置字段和五个主题变量。 */
import { defaults } from '../planning/core.js';
export const CHANNEL = 'creative-planning-v1';
export const THEME_KEYS = Object.freeze(['--SmartThemeBorderColor', '--SmartThemeBlurTintColor', '--SmartThemeBodyColor', '--mainFontFamily', '--monoFontFamily']);
export function themeSnapshot(style) {
    return Object.fromEntries(THEME_KEYS.map(key => [key, style.getPropertyValue(key).trim()]));
}
export function acceptsMessage(event, source, origin) {
    return Boolean(source && event.source === source && event.origin === origin && event.data?.channel === CHANNEL && typeof event.data.type === 'string');
}
export function cleanSettings(value) {
    if (!value || typeof value !== 'object') return {};
    return Object.fromEntries(Object.entries(defaults).filter(([key, initial]) =>
        typeof value[key] === typeof initial && (typeof initial !== 'number' || Number.isFinite(value[key]))
    ).map(([key]) => [key, value[key]]));
}

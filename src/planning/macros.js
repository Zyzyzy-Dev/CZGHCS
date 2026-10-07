/* 私有宏解析：局部变量不写回酒馆；未授权资料宏不展开；未知语义阻断生成。 */
const safeKey = key => key && !['__proto__', 'constructor', 'prototype'].includes(key);
const print = value => value == null ? '' : typeof value === 'string' ? value : JSON.stringify(value);
export function expandMacros(text, { snapshot, compatibilityIds = [], variables = { local: {}, global: {} } }) {
    const state = structuredClone(variables), diagnostics = [];
    state.local ??= {}; state.global ??= {};
    const env = snapshot.macroEnvironment || {};
    const issue = (code, message, blocking = false) => diagnostics.push({ code, message, blocking });
    const pathValue = (value, path) => {
        for (const key of path.replace(/\[(\d+)\]/g, '.$1').split('.')) {
            if (!safeKey(key)) return undefined;
            value = value?.[key];
        }
        return value;
    };
    const replace = token => {
        const [raw, ...args] = token.split('::'); const name = raw.trim().toLowerCase();
        if (name.startsWith('//')) return '';
        if (name === 'trim') return '';
        if (name === 'newline') return '\n';
        if (name === 'noop') return '';
        if (Object.hasOwn(env, name) && typeof env[name] !== 'object') return print(env[name]);
        if (/^(?:set|get|add|inc|dec)(?:global)?var$/.test(name)) {
            const map = name.includes('global') ? state.global : state.local;
            const key = args[0];
            if (!safeKey(key)) { issue('unsafe-variable', '变量名无效。', true); return ''; }
            if (name.startsWith('get')) return print(map[key]);
            if (name.startsWith('set')) map[key] = args.slice(1).join('::');
            else if (name.startsWith('add')) map[key] = Number.isFinite(Number(map[key] || 0)) && Number.isFinite(Number(args[1])) ? Number(map[key] || 0) + Number(args[1]) : print(map[key]) + (args[1] || '');
            else map[key] = Number(map[key] || 0) + (name.startsWith('inc') ? 1 : -1);
            return '';
        }
        if (name.startsWith('bbs')) {
            if (!compatibilityIds.includes('baibai')) { issue('excluded-macro', '柏宝书未勾选，相关宏已排除。'); return ''; }
            const cached = env.pluginMacros?.[token];
            if (cached !== undefined) return print(cached);
            const bbs = env.bbs;
            if (bbs && args.length === 0 && name === 'bbsvars') return print(bbs.vars);
            if (bbs && args.length === 0 && name === 'bbsstate') return print(bbs.state);
            if (bbs && args.length === 0 && name === 'bbssnapshot') return print(bbs);
            if (bbs && args.length === 1 && name === 'bbsvar') return print(pathValue(bbs.vars, args[0]));
            issue('macro-dependency', `无法读取柏宝书宏 ${raw} 所需的快照。`, true); return '';
        }
        issue('unsupported-macro', `尚未安全支持宏 ${raw}，没有调用宿主全局宏解析器。`, true);
        return '';
    };
    let evaluations = 0;
    function parse(input, depth = 0) {
        if (depth > 40 || evaluations > 10000) { issue('macro-limit', '宏嵌套或展开次数超过限制。', true); return ''; }
        let result = '', cursor = 0;
        while (cursor < input.length) {
            const start = input.indexOf('{{', cursor);
            if (start < 0) { result += input.slice(cursor); break; }
            result += input.slice(cursor, start);
            let nesting = 1, end = start + 2;
            for (; end < input.length; end++) {
                if (input.startsWith('{{', end)) { nesting++; end++; }
                else if (input.startsWith('}}', end)) { if (--nesting === 0) break; end++; }
            }
            if (nesting) { issue('unresolved-macro', '存在未闭合的宏。', true); return result; }
            const token = parse(input.slice(start + 2, end), depth + 1);
            evaluations++;
            result += replace(token);
            cursor = end + 2;
        }
        return result;
    }
    const output = parse(String(text ?? ''));
    return { text: output, variables: state, diagnostics };
}

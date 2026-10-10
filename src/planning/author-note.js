/* 从原始设置重建作者注释，避免再次使用已混入原生世界书的注入槽。 */
export function captureAuthorNote(context, character) {
    const meta = context.chatMetadata || {}, settings = context.extensionSettings?.note || {};
    const interval = Number(meta.note_interval ?? settings.defaultInterval ?? 1);
    const count = (context.chat || []).filter(m => m.is_user).length;
    const enabled = interval === 1 || (interval > 0 && count > 0 && count % interval === 0);
    let value = String(meta.note_prompt ?? settings.default ?? '');
    const note = settings.chara?.find(n => n.name === character.avatar?.replace(/\.[^.]+$/, ''));
    if (note?.useChara) value = note.position === 1 ? `${note.prompt}\n${value}` : note.position === 2 ? `${value}\n${note.prompt}` : String(note.prompt || '');
    return { enabled, value, position: meta.note_position ?? settings.defaultPosition ?? 1, depth: meta.note_depth ?? settings.defaultDepth ?? 4, role: meta.note_role ?? settings.defaultRole ?? 0 };
}

/* 规划 SSE 响应读取：跨网络分块累积文本，完整结束后交给规划校验，不注入半成品。 */
export async function readPlanResponse(response, onText = () => {}, signal) {
    if (!response.headers?.get('content-type')?.includes('text/event-stream')) {
        const result = await response.json();
        if (result.error || !result.choices?.[0]) throw new Error('规划 API 返回错误或不支持的格式。');
        return result.choices[0];
    }
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let buffer = '', text = '', finish = null;
    const consume = event => {
        const payload = event.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n').trim();
        if (!payload || payload === '[DONE]') return;
        let result;
        try { result = JSON.parse(payload); } catch { throw new Error('规划流式响应格式错误。'); }
        if (result.error) throw new Error('规划流式 API 返回错误。');
        const choice = result.choices?.[0];
        if (typeof choice?.delta?.content === 'string') { text += choice.delta.content; onText(text); }
        if (choice?.finish_reason) finish = choice.finish_reason;
    };
    try {
        while (true) {
            signal?.throwIfAborted();
            const { value, done } = await reader.read();
            buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
            buffer = buffer.replace(/\r\n/g, '\n');
            let end;
            while ((end = buffer.indexOf('\n\n')) >= 0) { consume(buffer.slice(0,end)); buffer = buffer.slice(end+2); }
            if (done) break;
        }
        if (buffer.trim()) consume(buffer);
        signal?.throwIfAborted();
        if (!finish) throw new Error('规划流式响应意外中断，未注入正文。');
        return { message: { content: text }, finish_reason: finish };
    } finally { await reader.cancel().catch(()=>{}); reader.releaseLock(); }
}

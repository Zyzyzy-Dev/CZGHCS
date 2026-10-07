import test from 'node:test';
import assert from 'node:assert/strict';
import { migrateSchemes, applySchemeOperation } from '../src/planning/schemes.js';

test('local schemes preserve external settings and reject missing overwrite targets', () => {
    const original = { apiUrl: 'https://example.com/v1', model: 'm', profileId: '', other: { value: 1 } };
    const before = structuredClone(original);
    const state = migrateSchemes(original);
    assert.deepEqual(original, before);
    assert.equal(state.schemes.api[0].payload.apiUrl, original.apiUrl);
    const saved = applySchemeOperation(state, { kind: 'preset', operation: 'create', name: '剧情', payload: { presetId: 'P', promptOverrides: { a: false } } });
    assert.equal(state.schemes.preset.length, 0);
    const id = saved.schemes.preset[0].id;
    const changed = applySchemeOperation(saved, {kind:'preset',operation:'overwrite',id,name:'修改',payload:{presetId:'Q'}});
    assert.equal(changed.schemes.preset[0].payload.presetId, 'Q');
    assert.equal(saved.schemes.preset[0].payload.presetId, 'P');
    assert.equal(applySchemeOperation(changed,{kind:'preset',operation:'delete',id}).schemes.preset.length,0);
    assert.throws(()=>applySchemeOperation(state,{kind:'api',operation:'overwrite',id:'external:p',name:'x',payload:{}}));
});
test('scheme storage rejects secrets, hostile object keys and invalid kinds', () => {
    const state=migrateSchemes({});
    for (const payload of [{key:'secret'},{connection:{Authorization:'secret'}},JSON.parse('{"__proto__":{"x":1}}')]) {
        assert.throws(()=>applySchemeOperation(state,{kind:'api',operation:'create',name:'x',payload}));
    }
    assert.throws(()=>applySchemeOperation(state,{kind:'constructor',operation:'create',name:'x',payload:{}}));
    assert.deepEqual(migrateSchemes(state),state);
});

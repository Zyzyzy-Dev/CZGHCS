import test from 'node:test';
import assert from 'node:assert/strict';
import { profileRequest, authorizeLocalRequest } from '../src/planning/profiles.js';

test('local credentials override only authentication without falling back to the active native key',()=>{
    const profile={source:'custom',model:'m',keyRef:'local-1',connection:{custom_url:'https://example.org/v1'},additional:{custom_include_headers:'{"X-Test":"value"}'}};
    const body=profileRequest(profile,[],100,JSON.parse);
    const request=authorizeLocalRequest(body,'test-local-key',JSON.parse);
    assert.equal(request.secret_id,'czgh-local:local-1');
    assert.deepEqual(JSON.parse(request.custom_include_headers),{'X-Test':'value',Authorization:'Bearer test-local-key'});
    assert.equal(body.custom_include_headers,profile.additional.custom_include_headers);
    assert.throws(()=>authorizeLocalRequest(body,'',JSON.parse),/密钥/);
});

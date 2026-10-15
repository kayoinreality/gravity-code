import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  inputMetrics, parseReply, anthropicMessage, asSSE,
  fingerprint, findThread, nextThread, toDeltaPrompt, compactTools, compactSystem
} from '../src/provider/protocol.mjs';
import { GeminiWeb } from '../src/provider/gemini-web.mjs';

const tools = [{ name: 'Write', input_schema: { type: 'object', properties: { path: { type: 'string' } } } }];

test('invalid model output cannot execute tools or invent tool names', () => {
  for (const text of [
    '{"text":"ok","tool_calls":[{"name":"DeleteEverything","input":{}}]}',
    '{"text":"ok","tool_calls":[{"name":"Write","input":[]}]}',
  ]) {
    assert.throws(() => parseReply(text, tools));
  }
  // Plain prose is safely accepted as text without executing tools
  const prose = parseReply('plain response without tools', tools);
  assert.deepEqual(prose, [{ type: 'text', text: 'plain response without tools' }]);
});

test('compact tools and compact system reduce prompt size', () => {
  const longDesc = 'a'.repeat(600);
  const rawTools = [{ name: 'Write', description: longDesc, input_schema: { type: 'object', description: longDesc } }];
  const compacted = compactTools(rawTools, true);
  assert.ok(compacted[0].description.length < 500);

  const longSystem = 'system instructions '.repeat(500);
  const compactedSys = compactSystem(longSystem, true);
  assert.ok(compactedSys.length < longSystem.length);
});

test('thread fingerprinting and continuation delta support', () => {
  const messages = [
    { role: 'user', content: 'hello' },
    { role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
    { role: 'user', content: 'check file' },
  ];
  const fp = fingerprint(messages.slice(0, 2));
  assert.equal(typeof fp, 'string');
  assert.equal(fp.length, 64);

  const thread = { model: 'flash-1', count: 2, fingerprint: fp, metadata: ['cid', 'rid', 'rcid'] };
  const matched = findThread([thread], 'flash-1', messages);
  assert.ok(matched);
  assert.equal(matched.count, 2);

  const delta = toDeltaPrompt(messages.slice(2));
  assert.ok(delta.includes('check file'));
});

test('complete input estimate includes controller instructions, tool schemas and history', () => {
  const request = { model: 'gemini-3.8-flash', system: 's'.repeat(1000), tools, messages: [{ role: 'user', content: 'hello' }] };
  const metrics = inputMetrics(request);
  assert.ok(metrics.estimatedInputTokens > 100);
  assert.equal(metrics.estimatedInputTokens, Math.ceil(metrics.prompt.length / 4));
  assert.ok(metrics.prompt.includes('input_schema'));
});

test('unsupported attachments fail before generation', () => {
  assert.throws(() => inputMetrics({ messages: [{ role: 'user', content: [{ type: 'image', source: {} }] }] }), /Imagens/);
});

test('tool replies produce valid Anthropic event sequence', () => {
  const message = anthropicMessage({ model: 'gemini-3.8-flash' }, parseReply('{"text":"creating","tool_calls":[{"name":"Write","input":{"file_path":"a.txt","content":"hello"}}]}', tools));
  assert.equal(message.stop_reason, 'tool_use');
  const events = asSSE(message).trim().split('\n\n').map(record => JSON.parse(record.split('\ndata: ')[1]));
  assert.equal(events[0].type, 'message_start');
  assert.equal(events.at(-1).type, 'message_stop');
  assert.ok(events.some(e => e.delta?.type === 'input_json_delta'));
});

test('connection discovery uses bootstrap and catalogue without inference', async () => {
  const paths = [];
  const status = Array(18).fill(null);
  status[15] = [
    ['flash-id', 'flash', null, null, null, null, null, null, null, 1, null, 'Flash'],
    ['argon-id', 'argon', null, null, null, null, null, null, null, 1, null, 'Argon']
  ];
  const client = new GeminiWeb({ cookieHeader: () => '' }, async url => {
    paths.push(new URL(url).pathname);
    return paths.length === 1
      ? new Response('"SNlM0e":"test-csrf","cfb2h":"test-build"')
      : new Response(JSON.stringify([['wrb.fr', 'otAQ7b', JSON.stringify(status)]]));
  });
  await client.initialize();
  assert.deepEqual(paths, ['/app', '/_/BardChatUi/data/batchexecute']);
  assert.equal(client.resolveModel('gemini-3.8-flash').id, 'flash-id');
  assert.equal(client.resolveModel('gemini-4-argon').id, 'argon-id');
  assert.throws(() => client.resolveModel('missing'));
});

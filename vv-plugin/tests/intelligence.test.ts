import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  createFakePluginHost,
  makeThreadResponse,
} from '@get-bb/plugin-sdk/testing';
import type { BbPluginApi } from '@get-bb/plugin-sdk';
import { createStore } from '../store.ts';
import { createIntelligence } from '../intelligence.ts';

const request = {
  projectId: 'project-test',
  providerId: 'codex',
  model: 'gpt-6.1-sol',
  reasoningLevel: 'medium',
  serviceTier: 'default',
  permissionMode: 'accept-edits' as const,
  environment: { type: 'reuse', environmentId: 'env-test' },
  executionInputSources: {},
  input: [{ type: 'text', text: 'Summarize this conversation.', mentions: [] }],
};

test('assistant uses BB selections and one persistent thread; reads never execute; context excludes files and other rooms', async () => {
  const spawns: Parameters<BbPluginApi['sdk']['threads']['spawn']>[0][] = [];
  const { bb, harness } = createFakePluginHost({
    pluginId: 'slack',
    sdk: {
      threads: {
        spawn: async (input) => {
          spawns.push(input);
          return makeThreadResponse({ id: 'assistant-test' });
        },
      },
    },
  });
  try {
    const store = createStore(bb),
      ai = createIntelligence(bb, store);
    const other = store.createRoom({ name: 'other', description: '' }, 'human');
    store.send(
      {
        id: randomUUID(),
        roomId: other.id,
        text: 'DO NOT SHARE OTHER ROOM',
        rich: null,
        parentId: null,
        attachment: null,
      },
      'human',
    );
    store.send(
      {
        id: randomUUID(),
        roomId: 'general',
        text: 'Launch is Friday.',
        rich: null,
        parentId: null,
        attachment: {
          name: 'secret.txt',
          mime: 'text/plain',
          data: Buffer.from('DO NOT SHARE FILE').toString('base64'),
        },
      },
      'human',
    );
    assert.equal(await ai.read('general'), null);
    assert.equal(spawns.length, 0);
    const input = { requestId: randomUUID(), roomId: 'general', request };
    const [first, second] = await Promise.all([
      ai.start(input),
      ai.start(input),
    ]);
    assert.equal(first.threadId, 'assistant-test');
    assert.equal(second.threadId, first.threadId);
    assert.equal(first.sharedMessages, 1);
    assert.equal(spawns.length, 1);
    assert.equal(spawns[0].permissionMode, 'accept-edits');
    assert.equal(spawns[0].model, request.model);
    assert.deepEqual(spawns[0].environment, request.environment);
    const context = JSON.stringify(spawns[0].input);
    assert.equal(spawns[0].input?.at(-1)?.visibility, 'agent-only');
    assert.match(context, /Launch is Friday/);
    assert.match(context, /untrusted reference data/);
    assert.doesNotMatch(
      context,
      /DO NOT SHARE OTHER ROOM|DO NOT SHARE FILE|secret.txt/,
    );
    assert.equal(
      (await createIntelligence(bb, store).read('general'))?.threadId,
      first.threadId,
    );
    await assert.rejects(
      ai.start({ ...input, requestId: randomUUID() }),
      /already has an assistant/,
    );
    assert.equal(spawns.length, 1);
  } finally {
    await harness.lifecycle.dispose();
  }
});

test('uncertain BB creation reserves the operation and never automatically sends twice', async () => {
  let count = 0;
  const { bb, harness } = createFakePluginHost({
    pluginId: 'slack',
    sdk: {
      threads: {
        spawn: async () => {
          count++;
          throw new Error('connection lost after dispatch');
        },
      },
    },
  });
  try {
    const store = createStore(bb),
      ai = createIntelligence(bb, store);
    const input = { requestId: randomUUID(), roomId: 'general', request };
    await assert.rejects(ai.start(input), /creation unconfirmed/);
    await assert.rejects(ai.start(input), /creation unconfirmed/);
    await assert.rejects(
      createIntelligence(bb, store).start(input),
      /creation unconfirmed/,
    );
    assert.equal(count, 1);
    assert.match(
      (await ai.read('general'))!.error!,
      /No automatic second request|no automatic second request/,
    );
    await assert.rejects(
      ai.start({ ...input, roomId: 'missing' }),
      /not available/,
    );
    assert.equal(count, 1);
  } finally {
    await harness.lifecycle.dispose();
  }
});

test('reconnect reconciles exact BB plugin metadata without dispatching again', async () => {
  const requestId = randomUUID();
  let recovered = false,
    spawns = 0;
  const { bb, harness } = createFakePluginHost({
    pluginId: 'slack',
    sdk: {
      threads: {
        spawn: async () => {
          spawns++;
          throw new Error('reply lost');
        },
        list: async (args) => {
          assert.equal(args?.originPluginId, 'slack');
          return recovered
            ? [makeThreadResponse({ id: 'recovered-thread' })]
            : [];
        },
        experimental_listPluginMetadata: async () => ({
          threads: [
            {
              threadId: 'recovered-thread',
              metadata: { slackRoomId: 'general', slackRequestId: requestId },
            },
          ],
        }),
      },
    },
  });
  try {
    const store = createStore(bb),
      ai = createIntelligence(bb, store);
    await assert.rejects(
      ai.start({ requestId, roomId: 'general', request }),
      /unconfirmed/,
    );
    recovered = true;
    const session = await createIntelligence(bb, store).read('general');
    assert.equal(session?.threadId, 'recovered-thread');
    assert.equal(session.error, null);
    assert.equal(spawns, 1);
  } finally {
    await harness.lifecycle.dispose();
  }
});

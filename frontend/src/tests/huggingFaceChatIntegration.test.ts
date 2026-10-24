import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { 
  getApiBaseUrl, 
  DEFAULT_RENDER_BACKEND_URL, 
  checkChatHealth, 
  sendChatMessage 
} from '../services/api.ts';
import type { 
  ChatRequestPayload, 
  ChatResponsePayload, 
  ChatHealthResponse 
} from '../types/index.ts';

describe('Hugging Face Spaces & Qwen-VL Chat Backend Integration Tests', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('shared API-base configuration defaults to deployed Render backend URL', () => {
    const base = getApiBaseUrl();
    assert.equal(base, `${DEFAULT_RENDER_BACKEND_URL}/api/v1`);
    assert.ok(!base.includes('127.0.0.1'), 'Base URL must not point to local loopback');
    assert.ok(!base.includes('localhost'), 'Base URL must not point to localhost');
    assert.equal(DEFAULT_RENDER_BACKEND_URL, 'https://sat-query-backend.onrender.com');
  });

  test('checkChatHealth accurately parses Hugging Face Spaces metadata', async () => {
    const mockHealthPayload: ChatHealthResponse = {
      status: 'online',
      available: true,
      provider: 'Hugging Face Spaces',
      space_id: 'Astro406/satquery-qwen-vl',
      configured_model: 'Qwen/Qwen2.5-VL-3B-Instruct',
      stage: 'RUNNING',
      base_url: 'https://astro406-satquery-qwen-vl.hf.space',
      hardware: 'zero-a10g',
    };

    globalThis.fetch = async (url: string | URL | Request) => {
      const urlStr = url.toString();
      assert.ok(urlStr.endsWith('/chat/health'), `Expected /chat/health endpoint, got ${urlStr}`);
      return new Response(JSON.stringify(mockHealthPayload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const health = await checkChatHealth();
    assert.equal(health.status, 'online');
    assert.equal(health.available, true);
    assert.equal(health.provider, 'Hugging Face Spaces');
    assert.equal(health.configured_model, 'Qwen/Qwen2.5-VL-3B-Instruct');
    assert.equal(health.space_id, 'Astro406/satquery-qwen-vl');
    assert.equal(health.stage, 'RUNNING');
    assert.equal(health.base_url, 'https://astro406-satquery-qwen-vl.hf.space');
    assert.equal(health.hardware, 'zero-a10g');
  });

  test('checkChatHealth handles network failure gracefully without throwing', async () => {
    globalThis.fetch = async () => {
      throw new Error('Connection refused or Render dyno waking');
    };

    const health = await checkChatHealth();
    assert.equal(health.status, 'offline');
    assert.equal(health.available, false);
    assert.equal(health.provider, 'Hugging Face Spaces');
    assert.equal(health.configured_model, 'Qwen/Qwen2.5-VL-3B-Instruct');
    assert.equal(health.stage, 'OFFLINE');
    assert.ok(!health.base_url?.includes('127.0.0.1'), 'Offline base_url must not reference 127.0.0.1:1234');
  });

  test('checkChatHealth handles non-200 HTTP responses gracefully', async () => {
    globalThis.fetch = async () => {
      return new Response(JSON.stringify({ detail: 'Service Unavailable' }), {
        status: 503,
      });
    };

    const health = await checkChatHealth();
    assert.equal(health.status, 'offline');
    assert.equal(health.available, false);
    assert.equal(health.provider, 'Hugging Face Spaces');
  });

  test('sendChatMessage sends compliant payload and parses Qwen-VL response', async () => {
    let capturedBody: any = null;
    let capturedUrl: string = '';

    globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = url.toString();
      if (init?.body) {
        capturedBody = JSON.parse(init.body as string);
      }
      const responsePayload: ChatResponsePayload = {
        response: 'Based on the Sentinel-2 acquisition, the water body shows low reflectance with NDVI < 0.',
        model: 'Qwen/Qwen2.5-VL-3B-Instruct',
        provider: 'Hugging Face Spaces',
        status: 'success',
        conversation_id: 'conv_test_123',
        space_id: 'Astro406/satquery-qwen-vl',
        duration_sec: 1.42,
      };
      return new Response(JSON.stringify(responsePayload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const req: ChatRequestPayload = {
      message: 'Analyze the vegetation index in the active AOI',
      conversation_id: 'conv_test_123',
      history: [
        { role: 'user', content: 'What is the scene resolution?' },
        { role: 'assistant', content: 'The Sentinel-2 imagery resolution is 10 meters per pixel.' }
      ],
      evidence: { actual_model_used: 'BIT-CD', change_detected: true },
      workspace_context: {
        mode: 'single',
        scene_count: 1,
        scenes: [{ role: 'primary', filename: 'S2A_preview.jpg' }],
      },
    };

    const res = await sendChatMessage(req);
    assert.ok(capturedUrl.endsWith('/chat'), `Expected /chat endpoint, got ${capturedUrl}`);
    assert.equal(capturedBody.message, req.message);
    assert.equal(capturedBody.conversation_id, 'conv_test_123');
    assert.equal(capturedBody.history.length, 2);
    assert.equal(capturedBody.evidence.actual_model_used, 'BIT-CD');
    assert.equal(capturedBody.workspace_context.scene_count, 1);

    assert.equal(res.status, 'success');
    assert.equal(res.provider, 'Hugging Face Spaces');
    assert.equal(res.model, 'Qwen/Qwen2.5-VL-3B-Instruct');
    assert.equal(res.space_id, 'Astro406/satquery-qwen-vl');
    assert.ok(res.response.includes('NDVI'));
  });

  test('sendChatMessage preserves backend ZeroGPU quota notice without fabricating errors', async () => {
    globalThis.fetch = async () => {
      const quotaPayload: ChatResponsePayload = {
        response: 'The Hugging Face Space has reached its anonymous ZeroGPU compute limit. To grant higher quota, configure an HF_TOKEN in the Render environment variables, or retry once the ZeroGPU hourly quota refreshes.',
        model: 'Qwen/Qwen2.5-VL-3B-Instruct',
        provider: 'Hugging Face Spaces',
        status: 'unavailable',
        conversation_id: null,
        error: "ZeroGPU quota reached on Space 'Astro406/satquery-qwen-vl': You have exceeded your ZeroGPU runs limit.",
        space_id: 'Astro406/satquery-qwen-vl',
        duration_sec: null,
      };
      return new Response(JSON.stringify(quotaPayload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const res = await sendChatMessage({ message: 'Hello' });
    assert.equal(res.status, 'unavailable');
    assert.equal(res.provider, 'Hugging Face Spaces');
    assert.equal(res.model, 'Qwen/Qwen2.5-VL-3B-Instruct');
    assert.equal(res.space_id, 'Astro406/satquery-qwen-vl');
    assert.ok(res.response.includes('ZeroGPU'));
    assert.ok(res.error?.includes('ZeroGPU quota reached'));
  });

  test('sendChatMessage correctly parses standby runtime stage', async () => {
    globalThis.fetch = async () => {
      const standbyPayload: ChatResponsePayload = {
        response: 'Hugging Face Space Astro406/satquery-qwen-vl is currently sleeping/building. Waking up instance...',
        model: 'Qwen/Qwen2.5-VL-3B-Instruct',
        provider: 'Hugging Face Spaces',
        status: 'standby',
        conversation_id: 'conv_standby',
        space_id: 'Astro406/satquery-qwen-vl',
      };
      return new Response(JSON.stringify(standbyPayload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const res = await sendChatMessage({ message: 'Are you ready?' });
    assert.equal(res.status, 'standby');
    assert.equal(res.provider, 'Hugging Face Spaces');
    assert.ok(res.response.includes('Waking up instance'));
  });

});

import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';

/**
 * Sub-task 1.1 — GET /health returns 200 and the expected JSON.
 * Validates: Requirements 9.1, 10.1 (importable app, no port bind).
 */
describe('GET /health', () => {
  const app = createApp();

  it('returns 200 with { status: "ok" }', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('responds with JSON content type', async () => {
    const res = await request(app).get('/health');

    expect(res.headers['content-type']).toMatch(/application\/json/);
  });

  it('body shape is exactly the status field', async () => {
    const res = await request(app).get('/health');

    expect(Object.keys(res.body)).toEqual(['status']);
    expect(res.body.status).toBe('ok');
  });
});

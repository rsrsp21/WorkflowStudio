import { expect, it } from 'vitest';
import { GET } from '@/src/app/api/health/live/route';

it('provides a database-independent liveness probe', async () => {
  const response = await GET();
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ status: 'alive', service: 'workflow-studio' });
  expect(response.headers.get('cache-control')).toBe('no-store');
});

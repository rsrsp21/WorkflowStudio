import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

type JsonSchema = { properties?: Record<string, JsonSchema>; required?: string[]; items?: JsonSchema; additionalProperties?: boolean };

function assertStrictObjectSchemas(schema: JsonSchema, location = 'root'): void {
  if (schema.properties) {
    expect(schema.required, `${location} must require every declared property`).toEqual(Object.keys(schema.properties));
    expect(schema.additionalProperties, `${location} must reject undeclared properties`).toBe(false);
    for (const [key, child] of Object.entries(schema.properties)) assertStrictObjectSchemas(child, `${location}.${key}`);
  }
  if (schema.items) assertStrictObjectSchemas(schema.items, `${location}[]`);
}

describe('Codex planning response schema', () => {
  it('requires every property declared by each strict object schema', async () => {
    const raw = await readFile(path.join(process.cwd(), 'src', 'adapters', 'planning-response.schema.json'), 'utf8');
    assertStrictObjectSchemas(JSON.parse(raw) as JsonSchema);
  });
});

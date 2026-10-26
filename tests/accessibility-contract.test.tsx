import React from 'react';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import SelectField from '@/src/components/select-field';

describe('accessibility contract', () => {
  it('uses a native labeled select that supports keyboard and assistive technology behavior', () => {
    const html = renderToStaticMarkup(<SelectField ariaLabel="Filter run status" value="all" options={[{ value: 'all', label: 'All states' }, { value: 'running', label: 'Running' }]} onChange={vi.fn()} />);
    expect(html).toContain('<select');
    expect(html).toContain('aria-label="Filter run status"');
    expect(html).toContain('<option value="running">Running</option>');
    expect(html).not.toContain('role="listbox"');
  });

  it('provides a keyboard skip link and focusable main landmarks on primary shells', async () => {
    const [layout, landing, studio, auth] = await Promise.all([
      readFile(path.join(process.cwd(), 'src/app/layout.tsx'), 'utf8'),
      readFile(path.join(process.cwd(), 'src/app/page.tsx'), 'utf8'),
      readFile(path.join(process.cwd(), 'src/components/studio-page-shell.tsx'), 'utf8'),
      readFile(path.join(process.cwd(), 'src/components/auth-form.tsx'), 'utf8')
    ]);
    expect(layout).toContain('href="#main-content"');
    for (const source of [landing, studio, auth]) {
      expect(source).toContain('id="main-content"');
      expect(source).toContain('tabIndex={-1}');
    }
  });
});

import { describe, expect, it } from 'vitest';
import { activeNavItem, sidebarItems } from './nav';

describe('sidebar navigation', () => {
  it('matches the agreed structure, names and paths', () => {
    expect(sidebarItems.map((s) => s.title)).toEqual(['Administration', 'Master', 'Pre Sales', 'Post Sales', 'Account']);
    const flat = sidebarItems.flatMap((s) => s.children.map((c) => `${c.title}|${c.path}`));
    expect(flat).toContain('Builder Buyer Agreements|/post-sales/agreements');
    expect(flat).toContain('Portal Integrations (99acres, MagicBricks)|/pre-sales/portal-integrations');
    expect(flat).toContain('Post-Dated Cheques (PDC)|/account/pdc');
    expect(flat).toHaveLength(8 + 8 + 6 + 9 + 6);
    expect(new Set(sidebarItems.flatMap((s) => s.children.map((c) => c.path))).size).toBe(flat.length);
  });

  it('highlights the closest item for detail and tab pages', () => {
    expect(activeNavItem('/post-sales/bookings/abc')?.item.id).toBe('unit-bookings');
    expect(activeNavItem('/master/units-inventory/map')?.item.id).toBe('units-inventory');
    expect(activeNavItem('/administration/rate-indexes/payment-plans')?.section.id).toBe('administration');
    expect(activeNavItem('/')).toBeNull();
  });
});

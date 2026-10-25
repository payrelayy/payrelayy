import type { Locator, Page } from 'playwright-core';

const MAX_MENU_ITEMS = 20;

/** Match the visible menu label, not Ant's potentially different ARIA label or hidden text. */
export async function uniqueVisibleMenuItemWithText(
  page: Page,
  menuSelector: string,
  expectedText: string,
): Promise<Locator | undefined> {
  const menus = page.locator(menuSelector);
  const menuCount = await menus.count();
  if (menuCount > MAX_MENU_ITEMS) return undefined;
  let selected: Locator | undefined;
  for (let menuIndex = 0; menuIndex < menuCount; menuIndex += 1) {
    const menu = menus.nth(menuIndex);
    if (!(await menu.isVisible())) continue;
    const items = menu.locator('[role="menuitem"]');
    const itemCount = await items.count();
    if (itemCount > MAX_MENU_ITEMS) return undefined;
    for (let itemIndex = 0; itemIndex < itemCount; itemIndex += 1) {
      const item = items.nth(itemIndex);
      if (!(await item.isVisible())) continue;
      const visibleText = (await item.innerText()).replace(/\s+/gu, ' ').trim();
      if (visibleText !== expectedText) continue;
      if (selected !== undefined) return undefined;
      selected = item;
    }
  }
  return selected;
}

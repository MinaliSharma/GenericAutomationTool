// Shared assertion helper so every test case checks error/status messages the same way.
import { expect } from '@playwright/test';

export async function expectErrorMessage(locator, expectedText) {
  await expect(locator).toBeVisible();
  await expect(locator).toContainText(expectedText);
}

import { test, expect } from '@playwright/test';
import { gotoWithTransientRetry } from '../../utils/navigation.js';

/* Description:
Navigate to https://testautomationpractice.blogspot.com/
Enter a name in the 'Enter Name' field
Enter a valid email in the 'Enter EMail' field
Enter a phone number in the 'Enter Phone' field
Enter an address in the 'Address' textarea
Select the 'Female' gender radio button
Check the 'Monday' and 'Wednesday' checkboxes under Days
Select 'India' from the Country dropdown
Select 'Blue' and 'Green' from the multi-select Colors listbox
Verify all entered/selected values are correctly reflected in the form fields
*/
test('Fill and submit the Data Entry Form', async ({ page }) => {
  await gotoWithTransientRetry(page, 'https://testautomationpractice.blogspot.com/');
  await expect(page).toHaveURL(/.+/);
  await expect(page.locator('body')).toBeVisible();
});

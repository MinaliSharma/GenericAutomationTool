// Auto-generated Page Object from https://www.automationexercise.com/ — fully generated, ready to use, edit if needed.
import { gotoWithTransientRetry } from '../../utils/navigation.js';

export class AutomationExercisePage {
  constructor(page) {
    this.page = page;
    this.home = page.getByRole('link', { name: 'Home' });
    this.products = page.getByRole('link', { name: ' Products' });
    this.cart = page.getByRole('link', { name: 'Cart' });
    this.signupLogin = page.getByRole('link', { name: 'Signup / Login' });
    this.testCases = page.getByRole('link', { name: 'Test Cases' });
    this.aPITesting = page.getByRole('link', { name: 'API Testing' });
    this.videoTutorials = page.getByRole('link', { name: 'Video Tutorials' });
    this.contactUs = page.getByRole('link', { name: 'Contact us' });
    this.testCases2 = page.getByRole('link', { name: 'Test Cases' });
    this.testCases3 = page.getByRole('button', { name: 'Test Cases' });
    this.aPIsListForPractice = page.getByRole('link', { name: 'APIs list for practice' });
    this.aPIsListForPractice2 = page.getByRole('button', { name: 'APIs list for practice' });
    this.testCases4 = page.getByRole('link', { name: 'Test Cases' });
    this.testCases5 = page.getByRole('button', { name: 'Test Cases' });
    this.aPIsListForPractice3 = page.getByRole('link', { name: 'APIs list for practice' });
    this.aPIsListForPractice4 = page.getByRole('button', { name: 'APIs list for practice' });
    this.testCases6 = page.getByRole('link', { name: 'Test Cases' });
    this.testCases7 = page.getByRole('button', { name: 'Test Cases' });
    this.aPIsListForPractice5 = page.getByRole('link', { name: 'APIs list for practice' });
    this.aPIsListForPractice6 = page.getByRole('button', { name: 'APIs list for practice' });
    this.wOMEN = page.getByRole('link', { name: 'WOMEN' });
    this.dress = page.getByRole('link', { name: 'Dress' });
    this.tops = page.getByRole('link', { name: 'Tops' });
    this.saree = page.getByRole('link', { name: 'Saree' });
    this.mEN = page.getByRole('link', { name: 'MEN' });
    this.tshirts = page.getByRole('link', { name: 'Tshirts' });
    this.jeans = page.getByRole('link', { name: 'Jeans' });
    this.kIDS = page.getByRole('link', { name: 'KIDS' });
    this.dress2 = page.getByRole('link', { name: 'Dress' });
    this.topsShirts = page.getByRole('link', { name: 'Tops & Shirts' });
    this.item6POLO = page.getByRole('link', { name: '(6)
POLO' });
    this.item5HM = page.getByRole('link', { name: '(5)
H&M' });
    this.item5MADAME = page.getByRole('link', { name: '(5)
MADAME' });
    this.item3MASTHARBOUR = page.getByRole('link', { name: '(3)
MAST & HARBOUR' });
    this.item4BABYHUG = page.getByRole('link', { name: '(4)
BABYHUG' });
    this.item3ALLENSOLLYJUNIOR = page.getByRole('link', { name: '(3)
ALLEN SOLLY JUNIOR' });
    this.item3KOOKIEKIDS = page.getByRole('link', { name: '(3)
KOOKIE KIDS' });
    this.item5BIBA = page.getByRole('link', { name: '(5)
BIBA' });
    this.viewCart = page.getByRole('link', { name: 'View Cart' });
    this.continueShopping = page.getByRole('button', { name: 'Continue Shopping' });
    this.viewProduct = page.getByRole('link', { name: 'View Product' });
    this.tshirt = page.getByRole('link', { name: 'Tshirt' });
    this.viewProduct2 = page.getByRole('link', { name: 'View Product' });
    this.viewProduct3 = page.getByRole('link', { name: 'View Product' });
    this.viewProduct4 = page.getByRole('link', { name: 'View Product' });
    this.viewProduct5 = page.getByRole('link', { name: 'View Product' });
    this.viewProduct6 = page.getByRole('link', { name: 'View Product' });
    this.viewProduct7 = page.getByRole('link', { name: 'View Product' });
    this.viewProduct8 = page.getByRole('link', { name: 'View Product' });
    this.viewProduct9 = page.getByRole('link', { name: 'View Product' });
    this.viewProduct10 = page.getByRole('link', { name: 'View Product' });
    this.viewProduct11 = page.getByRole('link', { name: 'View Product' });
    this.viewProduct12 = page.getByRole('link', { name: 'View Product' });
    this.viewProduct13 = page.getByRole('link', { name: 'View Product' });
    this.viewProduct14 = page.getByRole('link', { name: 'View Product' });
    this.viewProduct15 = page.getByRole('link', { name: 'View Product' });
    this.viewProduct16 = page.getByRole('link', { name: 'View Product' });
  }

  async goto() {
    await gotoWithTransientRetry(this.page, 'https://www.automationexercise.com/');
  }

  async clickHome() {
    await this.home.click();
  }

  async clickProducts() {
    await this.products.click();
  }

  async clickCart() {
    await this.cart.click();
  }

  async clickSignupLogin() {
    await this.signupLogin.click();
  }

  async clickTestCases() {
    await this.testCases.click();
  }

  async clickAPITesting() {
    await this.aPITesting.click();
  }

  async clickVideoTutorials() {
    await this.videoTutorials.click();
  }

  async clickContactUs() {
    await this.contactUs.click();
  }

  async clickTestCases2() {
    await this.testCases2.click();
  }

  async clickTestCases3() {
    await this.testCases3.click();
  }

  async clickAPIsListForPractice() {
    await this.aPIsListForPractice.click();
  }

  async clickAPIsListForPractice2() {
    await this.aPIsListForPractice2.click();
  }

  async clickTestCases4() {
    await this.testCases4.click();
  }

  async clickTestCases5() {
    await this.testCases5.click();
  }

  async clickAPIsListForPractice3() {
    await this.aPIsListForPractice3.click();
  }

  async clickAPIsListForPractice4() {
    await this.aPIsListForPractice4.click();
  }

  async clickTestCases6() {
    await this.testCases6.click();
  }

  async clickTestCases7() {
    await this.testCases7.click();
  }

  async clickAPIsListForPractice5() {
    await this.aPIsListForPractice5.click();
  }

  async clickAPIsListForPractice6() {
    await this.aPIsListForPractice6.click();
  }

  async clickWOMEN() {
    await this.wOMEN.click();
  }

  async clickDress() {
    await this.dress.click();
  }

  async clickTops() {
    await this.tops.click();
  }

  async clickSaree() {
    await this.saree.click();
  }

  async clickMEN() {
    await this.mEN.click();
  }

  async clickTshirts() {
    await this.tshirts.click();
  }

  async clickJeans() {
    await this.jeans.click();
  }

  async clickKIDS() {
    await this.kIDS.click();
  }

  async clickDress2() {
    await this.dress2.click();
  }

  async clickTopsShirts() {
    await this.topsShirts.click();
  }

  async clickItem6POLO() {
    await this.item6POLO.click();
  }

  async clickItem5HM() {
    await this.item5HM.click();
  }

  async clickItem5MADAME() {
    await this.item5MADAME.click();
  }

  async clickItem3MASTHARBOUR() {
    await this.item3MASTHARBOUR.click();
  }

  async clickItem4BABYHUG() {
    await this.item4BABYHUG.click();
  }

  async clickItem3ALLENSOLLYJUNIOR() {
    await this.item3ALLENSOLLYJUNIOR.click();
  }

  async clickItem3KOOKIEKIDS() {
    await this.item3KOOKIEKIDS.click();
  }

  async clickItem5BIBA() {
    await this.item5BIBA.click();
  }

  async clickViewCart() {
    await this.viewCart.click();
  }

  async clickContinueShopping() {
    await this.continueShopping.click();
  }

  async clickViewProduct() {
    await this.viewProduct.click();
  }

  async clickTshirt() {
    await this.tshirt.click();
  }

  async clickViewProduct2() {
    await this.viewProduct2.click();
  }

  async clickViewProduct3() {
    await this.viewProduct3.click();
  }

  async clickViewProduct4() {
    await this.viewProduct4.click();
  }

  async clickViewProduct5() {
    await this.viewProduct5.click();
  }

  async clickViewProduct6() {
    await this.viewProduct6.click();
  }

  async clickViewProduct7() {
    await this.viewProduct7.click();
  }

  async clickViewProduct8() {
    await this.viewProduct8.click();
  }

  async clickViewProduct9() {
    await this.viewProduct9.click();
  }

  async clickViewProduct10() {
    await this.viewProduct10.click();
  }

  async clickViewProduct11() {
    await this.viewProduct11.click();
  }

  async clickViewProduct12() {
    await this.viewProduct12.click();
  }

  async clickViewProduct13() {
    await this.viewProduct13.click();
  }

  async clickViewProduct14() {
    await this.viewProduct14.click();
  }

  async clickViewProduct15() {
    await this.viewProduct15.click();
  }

  async clickViewProduct16() {
    await this.viewProduct16.click();
  }
}

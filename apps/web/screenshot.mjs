import { chromium } from "playwright";

const shots = [
  { url: "http://localhost:3000/preview.html?model=mario", theme: "light", out: "preview-mario-light.png" },
  { url: "http://localhost:3000/preview.html?model=mario", theme: "dark", out: "preview-mario-dark.png" },
  { url: "http://localhost:3000/preview.html?model=zelda", theme: "light", out: "preview-zelda-light.png" },
];

const browser = await chromium.launch();
for (const s of shots) {
  const page = await browser.newPage({ viewport: { width: 820, height: 1000 }, deviceScaleFactor: 2 });
  await page.goto(s.url, { waitUntil: "networkidle" });
  await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), s.theme);
  await page.waitForTimeout(400);
  await page.screenshot({ path: s.out, fullPage: true });
  await page.close();
  console.log("shot", s.out);
}
await browser.close();

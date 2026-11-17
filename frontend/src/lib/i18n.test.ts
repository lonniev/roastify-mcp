/** The Design Bench's words in every language say what English says: the same keys, {{places}} and <tags/>. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { LANGUAGES, localeProblems, setLanguage, translate } from "@tollbooth-dpyc/web";
import english from "../i18n/en.ts";
import { registerRoastify, WORDS } from "../i18n/index.ts";

for (const { code } of LANGUAGES.filter((l) => l.code !== "en")) {
  test(`${code}: every message is there, with English's {{places}} and <tags/>`, async () => {
    const locale = (await import(`../i18n/${code}.ts`)).default;
    assert.deepEqual(localeProblems(english, locale), []);
  });
}

test("no message keeps a single-brace {place} or a raw ${…}", () => {
  for (const [key, text] of Object.entries(english)) assert.doesNotMatch(text, /(^|[^{])\{\w+\}(?!\})|\$\{/, key);
});

test("Roastify's words are read through the package, in the chosen language", async () => {
  await registerRoastify();
  const key = Object.keys(english).find((k) => !/_(one|other)$/.test(k) && !english[k as keyof typeof english].includes("{{"))!;
  assert.equal(translate(key, undefined, WORDS), english[key as keyof typeof english]);
  await setLanguage("fr");
  const fr = (await import("../i18n/fr.ts")).default as Record<string, string>;
  assert.equal(translate(key, undefined, WORDS), fr[key]);
  await setLanguage("en");
});

test("a count picks its plural in English", async () => {
  await registerRoastify();
  assert.equal(translate("views.designs.sizes", { count: 1 }, WORDS), "1 size");
  assert.equal(translate("views.designs.sizes", { count: 3 }, WORDS), "3 sizes");
  assert.equal(translate("views.bench.repeated", { text: "Our story", count: 2 }, WORDS), "“Our story” prints in 2 places.");
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {fontSuggestions, starterThemes, themeVariables, validateTheme} from './theme.mjs';

function luminance(hex) {
  const channels = hex.slice(1).match(/../g).map(c => Number.parseInt(c, 16) / 255)
    .map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
function contrast(first, second) {
  const a = luminance(first), b = luminance(second);
  return (Math.max(a,b) + 0.05) / (Math.min(a,b) + 0.05);
}

test('three portable starters have readable text, action labels and links', () => {
  assert.deepEqual(starterThemes.map(row => row.id), ['canopy', 'tide', 'ember']);
  for (const {theme} of starterThemes) {
    assert.deepEqual(validateTheme(JSON.parse(JSON.stringify(theme))), theme);
    const {tokens} = theme;
    for (const background of ['bg','panel']) {
      for (const foreground of ['fg','muted','accent','danger','success']) {
        assert.ok(contrast(tokens[background], tokens[foreground]) >= 4.5, theme.name + ': ' + background + '/' + foreground);
      }
    }
    assert.ok(contrast(tokens.accentInk,tokens.accent) >= 4.5);
    assert.equal(Object.keys(themeVariables(theme)).length, 11);
  }
});

test('import accepts installed Unicode families and rejects unknown fields or CSS', () => {
  const {theme} = starterThemes[0];
  for (const font of [...fontSuggestions, '黑体', "L'Archivo"]) {
    const custom = {...theme,tokens:{...theme.tokens,fontBody:font}};
    assert.equal(validateTheme(custom).tokens.fontBody,font);
  }
  for (const font of ['url(https://example.test/font)', 'x; color: red','foo, serif',' inherited ', 'a'.repeat(65)]) {
    assert.throws(() => themeVariables({...theme,tokens:{...theme.tokens,fontBody:font}}));
  }
  for (const input of [{...theme,version:2}, {...theme,name:'a\nb'}, {...theme,uri:'https://example.test/'},
    {...theme,tokens:{...theme.tokens,accent:'red'}}, {...theme,tokens:{...theme.tokens,url:'https://example.test/logo'}}, {name:'incomplete'}]) {
    assert.throws(() => validateTheme(input));
  }
});

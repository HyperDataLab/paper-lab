import { describe, expect, it } from 'vitest';
import { segmentSentences, sliceCp, tokenize } from './index';
import type { Token } from '../schemas/text';

type Expected = [string, Token['kind']][];
function check(text: string, expected: Expected, sentenceCount?: number) {
  const tokens = tokenize(text);
  expect(tokens.map(({ text: value, kind }) => [value, kind])).toEqual(expected);
  for (const token of tokens) expect(sliceCp(text, token.start, token.end)).toBe(token.text);
  if (sentenceCount !== undefined) expect(segmentSentences(text)).toHaveLength(sentenceCount);
}

describe('AC-11 tokenizer and sentence regressions', () => {
  it.each<[string, Expected]>([
    [
      'It decreased by -3 units.',
      [
        ['It', 'word'],
        ['decreased', 'word'],
        ['by', 'word'],
        ['-3', 'number'],
        ['units', 'word'],
        ['.', 'punct'],
      ],
    ],
    [
      'Values were -0.5 and +2.',
      [
        ['Values', 'word'],
        ['were', 'word'],
        ['-0.5', 'number'],
        ['and', 'word'],
        ['+2', 'number'],
        ['.', 'punct'],
      ],
    ],
    [
      '2010-2019',
      [
        ['2010', 'number'],
        ['-', 'punct'],
        ['2019', 'number'],
      ],
    ],
    [
      '5-10',
      [
        ['5', 'number'],
        ['-', 'punct'],
        ['10', 'number'],
      ],
    ],
    [
      'a -b',
      [
        ['a', 'word'],
        ['-', 'punct'],
        ['b', 'word'],
      ],
    ],
    [
      'x-3',
      [
        ['x', 'word'],
        ['-', 'punct'],
        ['3', 'number'],
      ],
    ],
    [
      'Data from 2010-2019 were used.',
      [
        ['Data', 'word'],
        ['from', 'word'],
        ['2010', 'number'],
        ['-', 'punct'],
        ['2019', 'number'],
        ['were', 'word'],
        ['used', 'word'],
        ['.', 'punct'],
      ],
    ],
    [
      'We added 5-10 mg of NaCl.',
      [
        ['We', 'word'],
        ['added', 'word'],
        ['5', 'number'],
        ['-', 'punct'],
        ['10', 'number'],
        ['mg', 'word'],
        ['of', 'word'],
        ['NaCl', 'word'],
        ['.', 'punct'],
      ],
    ],
    [
      'The x-ray and COVID-19 cases.',
      [
        ['The', 'word'],
        ['x-ray', 'word'],
        ['and', 'word'],
        ['COVID-19', 'word'],
        ['cases', 'word'],
        ['.', 'punct'],
      ],
    ],
    [
      'IL-6 CO2 H2O Ti-6Al-4V 3D',
      [
        ['IL-6', 'word'],
        ['CO2', 'word'],
        ['H2O', 'word'],
        ['Ti-6Al-4V', 'word'],
        ['3D', 'word'],
      ],
    ],
    [
      '3.5-fold',
      [
        ['3.5', 'number'],
        ['-', 'punct'],
        ['fold', 'word'],
      ],
    ],
    [
      'p<0.05',
      [
        ['p', 'word'],
        ['<', 'symbol'],
        ['0.05', 'number'],
      ],
    ],
    [
      'n = -3',
      [
        ['n', 'word'],
        ['=', 'symbol'],
        ['-3', 'number'],
      ],
    ],
    [
      '(-0.5, 1.2)',
      [
        ['(', 'punct'],
        ['-0.5', 'number'],
        [',', 'punct'],
        ['1.2', 'number'],
        [')', 'punct'],
      ],
    ],
    [
      '− 3.2 degC',
      [
        ['−', 'symbol'],
        ['3.2', 'number'],
        ['degC', 'word'],
      ],
    ],
    [
      '± 0.4',
      [
        ['±', 'symbol'],
        ['0.4', 'number'],
      ],
    ],
    ['10^-3', [['10^-3', 'number']]],
    [
      'x−3 y+4 z±5',
      [
        ['x', 'word'],
        ['−', 'symbol'],
        ['3', 'number'],
        ['y', 'word'],
        ['+', 'symbol'],
        ['4', 'number'],
        ['z', 'word'],
        ['±', 'symbol'],
        ['5', 'number'],
      ],
    ],
    [
      'Samples (collected in 2019 and 2020) were dried.',
      [
        ['Samples', 'word'],
        ['(', 'punct'],
        ['collected', 'word'],
        ['in', 'word'],
        ['2019', 'number'],
        ['and', 'word'],
        ['2020', 'number'],
        [')', 'punct'],
        ['were', 'word'],
        ['dried', 'word'],
        ['.', 'punct'],
      ],
    ],
    [
      '(n = 2010)',
      [
        ['(', 'punct'],
        ['n', 'word'],
        ['=', 'symbol'],
        ['2010', 'number'],
        [')', 'punct'],
      ],
    ],
    [
      '(in 2019)',
      [
        ['(', 'punct'],
        ['in', 'word'],
        ['2019', 'number'],
        [')', 'punct'],
      ],
    ],
    [
      '(Table 2, 2019 data)',
      [
        ['(', 'punct'],
        ['Table', 'word'],
        ['2', 'number'],
        [',', 'punct'],
        ['2019', 'number'],
        ['data', 'word'],
        [')', 'punct'],
      ],
    ],
  ])('classifies %s', (text, expected) => check(text, expected));

  it.each(['', ' ', '\t', '(', '[', '{', '=', '<', '>', ',', ';', ':', '/', '≈', '~'])(
    'AC-11 accepts signed numbers immediately after %j',
    (prefix) => {
      for (const sign of ['-', '+', '−', '±']) {
        expect(tokenize(`${prefix}${sign}3`).at(-1)).toMatchObject({ text: `${sign}3`, kind: 'number' });
      }
    },
  );

  it.each([
    '[12]',
    '[3-5, 8]',
    '(Smith et al., 2010)',
    '(Smith and Lee 2019; Wu 2020a)',
    '(see Smith, 2010, pp. 12-15)',
    '(e.g., Smith and van der Lee 2019, 2020; cf. Wu in press)',
    '(2019)',
    '(2019a, 2020)',
    '(Smith, n.d., p. 12)',
  ])('recognizes citation %s', (text) => check(text, [[text, 'citation']]));

  it.each<[string, number, Expected]>([
    [
      'We measured plot A. The results differed.',
      2,
      [
        ['We', 'word'],
        ['measured', 'word'],
        ['plot', 'word'],
        ['A', 'word'],
        ['.', 'punct'],
        ['The', 'word'],
        ['results', 'word'],
        ['differed', 'word'],
        ['.', 'punct'],
      ],
    ],
    [
      'J. Schimel wrote.',
      1,
      [
        ['J', 'word'],
        ['.', 'punct'],
        ['Schimel', 'word'],
        ['wrote', 'word'],
        ['.', 'punct'],
      ],
    ],
    [
      'J. P. Schimel wrote.',
      1,
      [
        ['J', 'word'],
        ['.', 'punct'],
        ['P', 'word'],
        ['.', 'punct'],
        ['Schimel', 'word'],
        ['wrote', 'word'],
        ['.', 'punct'],
      ],
    ],
    [
      'E. coli grew.',
      1,
      [
        ['E', 'word'],
        ['.', 'punct'],
        ['coli', 'word'],
        ['grew', 'word'],
        ['.', 'punct'],
      ],
    ],
    [
      'Plot A. In addition results changed.',
      2,
      [
        ['Plot', 'word'],
        ['A', 'word'],
        ['.', 'punct'],
        ['In', 'word'],
        ['addition', 'word'],
        ['results', 'word'],
        ['changed', 'word'],
        ['.', 'punct'],
      ],
    ],
  ])('segments %s', (text, count, expected) => check(text, expected, count));
});

import { buildBody, schemaToFields, valuesFrom } from './formFields';
const fields = schemaToFields({
  required: ['query', 'n'],
  properties: {
    query: { type: 'string' },
    n: { type: 'integer', minimum: 1, maximum: 5, default: 3 },
    flag: { type: 'boolean', default: true },
    mode: { type: 'string', enum: ['a', 'b'] },
    ids: { type: 'array', items: { type: 'string' } },
    extra: { type: 'object' },
  },
});
it('PG-03 creates controls and prefills defaults and examples', () => {
  expect(fields.map((field) => field.kind)).toEqual([
    'string',
    'integer',
    'boolean',
    'enum',
    'array',
    'json',
  ]);
  expect(fields[0]?.multiline).toBe(true);
  expect(valuesFrom(fields, { ids: ['a', 'b'] })).toMatchObject({ n: '3', flag: true, ids: 'a\nb' });
});
it('PG-04 coerces valid values and reports invalid values', () => {
  expect(
    buildBody(fields, { query: 'x', n: '4', flag: false, mode: 'a', ids: 'a\nb', extra: '{"x":1}' }),
  ).toEqual({
    body: { query: 'x', n: 4, flag: false, mode: 'a', ids: ['a', 'b'], extra: { x: 1 } },
    errors: {},
  });
  expect(buildBody(fields, { query: '', n: '5.2', mode: 'c', extra: '{' }).errors).toEqual({
    query: expect.any(String),
    n: expect.any(String),
    mode: expect.any(String),
    extra: expect.any(String),
  });
});

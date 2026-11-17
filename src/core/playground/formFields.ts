export type Field = {
  name: string;
  kind: 'string' | 'number' | 'integer' | 'boolean' | 'enum' | 'array' | 'json';
  required: boolean;
  multiline: boolean;
  options: string[];
  minimum?: number;
  maximum?: number;
  defaultValue?: unknown;
};
export type Values = Record<string, string | boolean>;
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function schemaToFields(schema: Record<string, unknown>): Field[] {
  const properties = object(schema.properties) ? schema.properties : {};
  const required = Array.isArray(schema.required) ? schema.required : [];
  return Object.entries(properties).map(([name, value]) => {
    const prop = object(value) ? value : {};
    const options =
      Array.isArray(prop.enum) && prop.enum.every((item: unknown) => typeof item === 'string')
        ? (prop.enum as string[])
        : [];
    const type = prop.type;
    const kind: Field['kind'] = options.length
      ? 'enum'
      : type === 'string' || type === 'number' || type === 'integer' || type === 'boolean'
        ? type
        : type === 'array' && object(prop.items) && prop.items.type === 'string'
          ? 'array'
          : 'json';
    return {
      name,
      kind,
      required: required.includes(name),
      multiline: ['question', 'gap_statement', 'citation', 'topic', 'query'].includes(name),
      options,
      ...(typeof prop.minimum === 'number' ? { minimum: prop.minimum } : {}),
      ...(typeof prop.maximum === 'number' ? { maximum: prop.maximum } : {}),
      ...('default' in prop ? { defaultValue: prop.default } : {}),
    };
  });
}
export function valuesFrom(fields: Field[], source: Record<string, unknown> = {}): Values {
  return Object.fromEntries(
    fields.map((field) => {
      const value = source[field.name] ?? field.defaultValue;
      return [
        field.name,
        field.kind === 'boolean'
          ? value === true
          : value === undefined
            ? ''
            : field.kind === 'array' && Array.isArray(value)
              ? value.join('\n')
              : field.kind === 'json'
                ? JSON.stringify(value, null, 2)
                : String(value),
      ];
    }),
  );
}
export function buildBody(
  fields: Field[],
  values: Values,
): { body: Record<string, unknown>; errors: Record<string, string> } {
  const body: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  for (const field of fields) {
    const raw = values[field.name];
    if (field.kind === 'boolean') {
      body[field.name] = raw === true;
      continue;
    }
    const text = typeof raw === 'string' ? raw : '';
    if (!text.trim()) {
      if (field.required) errors[field.name] = 'Trường này là bắt buộc.';
      continue;
    }
    if (field.kind === 'number' || field.kind === 'integer') {
      const number = Number(text);
      if (
        !Number.isFinite(number) ||
        (field.kind === 'integer' && !Number.isInteger(number)) ||
        (field.minimum !== undefined && number < field.minimum) ||
        (field.maximum !== undefined && number > field.maximum)
      )
        errors[field.name] = 'Số không hợp lệ hoặc nằm ngoài giới hạn.';
      else body[field.name] = number;
    } else if (field.kind === 'array') {
      const items = text
        .split(/\r?\n/u)
        .map((item) => item.trim())
        .filter(Boolean);
      if (field.required && !items.length) errors[field.name] = 'Trường này là bắt buộc.';
      else body[field.name] = items;
    } else if (field.kind === 'json') {
      try {
        body[field.name] = JSON.parse(text) as unknown;
      } catch {
        errors[field.name] = 'JSON không hợp lệ.';
      }
    } else if (field.kind === 'enum' && !field.options.includes(text))
      errors[field.name] = 'Lựa chọn không hợp lệ.';
    else body[field.name] = text;
  }
  return { body, errors };
}

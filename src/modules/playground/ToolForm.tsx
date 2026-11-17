import type { Field, Values } from '@/core/playground/formFields';
import { TextField } from '@/shared/ui/TextField';
import { Checkbox } from '@/shared/ui/Checkbox';
import { Select } from '@/shared/ui/Select';

export function ToolForm({
  fields,
  values,
  errors,
  change,
}: {
  fields: Field[];
  values: Values;
  errors: Record<string, string>;
  change: (name: string, value: string | boolean) => void;
}) {
  return (
    <>
      {fields.map((field) => {
        const label = `${field.name}${field.required ? ' *' : ''}`;
        const value = values[field.name];
        if (field.kind === 'boolean')
          return (
            <Checkbox
              key={field.name}
              checked={value === true}
              onChange={(event) => change(field.name, event.target.checked)}
            >
              {label}
            </Checkbox>
          );
        if (field.kind === 'enum')
          return (
            <div key={field.name}>
              <Select
                label={label}
                required={field.required}
                value={typeof value === 'string' ? value : ''}
                onChange={(event) => change(field.name, event.target.value)}
              >
                <option value="">Chọn…</option>
                {field.options.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </Select>
              {errors[field.name] && <p role="alert">{errors[field.name]}</p>}
            </div>
          );
        const common = {
          label,
          value: typeof value === 'string' ? value : '',
          required: field.required,
          error: errors[field.name],
          onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
            change(field.name, event.target.value),
        };
        return field.multiline || field.kind === 'array' || field.kind === 'json' ? (
          <TextField
            key={field.name}
            {...common}
            multiline
            hint={
              field.kind === 'array'
                ? 'Mỗi dòng một giá trị.'
                : field.kind === 'json'
                  ? 'Nhập JSON.'
                  : undefined
            }
          />
        ) : (
          <TextField
            key={field.name}
            {...common}
            type={field.kind === 'number' || field.kind === 'integer' ? 'number' : 'text'}
            min={field.minimum}
            max={field.maximum}
            step={field.kind === 'integer' ? 1 : 'any'}
          />
        );
      })}
    </>
  );
}

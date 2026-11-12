import {
  Children,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEventHandler,
  type KeyboardEvent,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';
import { Check, ChevronDown } from 'lucide-react';
import styles from './ui.module.css';

type OptionProps = {
  value?: string | number;
  children?: ReactNode;
  disabled?: boolean;
  title?: string;
};

type Option = {
  value: string;
  label: string;
  disabled: boolean;
  title?: string;
};

type Props = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> & {
  label: string;
  size?: 'md' | 'sm';
  inline?: boolean;
  /** Keeps the label for screen readers only, for toolbars where the value says what the control is. */
  hideLabel?: boolean;
};

function textContent(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textContent).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) return textContent(node.props.children);
  return '';
}

function optionValue(value: string | number | readonly string[] | undefined, fallback: string): string {
  if (Array.isArray(value)) return value[0] ?? fallback;
  return value === undefined ? fallback : String(value);
}

export function Select({
  label,
  size = 'md',
  inline = false,
  hideLabel = false,
  id,
  className = '',
  children,
  value,
  defaultValue,
  onChange,
  onFocus,
  onBlur,
  onKeyDown,
  disabled = false,
  required,
  title,
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedBy,
  ...nativeProps
}: Props) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const labelId = `${controlId}-label`;
  const listId = `${controlId}-listbox`;
  const nativeRef = useRef<HTMLSelectElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const typeahead = useRef('');
  const typeaheadTimer = useRef<number | undefined>(undefined);
  const options = Children.toArray(children).flatMap((child): Option[] => {
    if (!isValidElement<OptionProps>(child) || child.type !== 'option') return [];
    const labelText = textContent(child.props.children);
    return [
      {
        value: String(child.props.value ?? labelText),
        label: labelText,
        disabled: Boolean(child.props.disabled),
        ...(child.props.title ? { title: child.props.title } : {}),
      },
    ];
  });
  const firstEnabledIndex = options.findIndex((option) => !option.disabled);
  const currentValue = optionValue(value, optionValue(defaultValue, options[0]?.value ?? ''));
  const selectedIndex = options.findIndex((option) => option.value === currentValue);
  const [uncontrolledValue, setUncontrolledValue] = useState(
    optionValue(defaultValue, options[0]?.value ?? ''),
  );
  const selectedValue = value === undefined ? uncontrolledValue : String(value);
  const selectedOption = options.find((option) => option.value === selectedValue);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(selectedIndex >= 0 ? selectedIndex : firstEnabledIndex);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open]);

  useEffect(
    () => () => {
      if (typeaheadTimer.current !== undefined) window.clearTimeout(typeaheadTimer.current);
    },
    [],
  );

  function show() {
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : firstEnabledIndex);
    setOpen(true);
  }

  function choose(option: Option) {
    if (disabled || option.disabled) return;
    if (value === undefined) setUncontrolledValue(option.value);
    const nativeSelect = nativeRef.current;
    if (nativeSelect) {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
      if (setter) setter.call(nativeSelect, option.value);
      else nativeSelect.value = option.value;
      nativeSelect.dispatchEvent(new Event('change', { bubbles: true }));
    }
    setOpen(false);
  }

  function moveActive(direction: -1 | 1) {
    const enabled = options.flatMap((option, index) => (option.disabled ? [] : [index]));
    if (enabled.length === 0) return;
    const position = enabled.indexOf(activeIndex);
    const next = (position + direction + enabled.length) % enabled.length;
    setActiveIndex(enabled[next] ?? enabled[0] ?? -1);
  }

  function keyDown(event: KeyboardEvent<HTMLButtonElement>) {
    onKeyDown?.(event as unknown as KeyboardEvent<HTMLSelectElement>);
    if (event.defaultPrevented) return;
    if (event.key === 'Tab') {
      setOpen(false);
      return;
    }
    if (event.key === 'Escape') {
      if (open) {
        event.preventDefault();
        setOpen(false);
      }
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        show();
        if (event.key === 'ArrowDown') moveActive(1);
      } else {
        moveActive(event.key === 'ArrowDown' ? 1 : -1);
      }
      return;
    }
    if (open && event.key === 'Home') {
      event.preventDefault();
      setActiveIndex(firstEnabledIndex);
      return;
    }
    if (open && event.key === 'End') {
      event.preventDefault();
      const lastEnabled = options.reduce((last, option, index) => (option.disabled ? last : index), -1);
      setActiveIndex(lastEnabled);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (!open) {
        show();
        return;
      }
      const activeOption = options[activeIndex];
      if (activeOption) choose(activeOption);
      return;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      typeahead.current += event.key.toLocaleLowerCase();
      if (typeaheadTimer.current !== undefined) window.clearTimeout(typeaheadTimer.current);
      typeaheadTimer.current = window.setTimeout(() => (typeahead.current = ''), 700);
      const start = Math.max(selectedIndex, 0);
      const next = [...options.slice(start + 1), ...options.slice(0, start + 1)].findIndex(
        (option) => !option.disabled && option.label.toLocaleLowerCase().startsWith(typeahead.current),
      );
      if (next >= 0) {
        const index = (start + 1 + next) % options.length;
        setActiveIndex(index);
        setOpen(true);
      }
    }
  }

  return (
    <div className={`${styles.field} ${inline ? styles.fieldInline : ''} ${className}`}>
      <span id={labelId} className={hideLabel ? styles.srOnly : styles.selectLabel} onClick={show}>
        {label}
      </span>
      <div className={`${styles.selectWrap} ${inline ? styles.fieldInline : ''}`} ref={rootRef}>
        <button
          id={controlId}
          type="button"
          role="combobox"
          className={`${styles.selectButton} ${size === 'sm' ? styles.selectButtonSm : ''}`}
          aria-labelledby={labelId}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={open && activeIndex >= 0 ? `${listId}-option-${activeIndex}` : undefined}
          aria-required={required || undefined}
          aria-invalid={ariaInvalid || undefined}
          aria-describedby={ariaDescribedBy}
          disabled={disabled}
          title={title}
          onClick={() => (open ? setOpen(false) : show())}
          onFocus={onFocus as unknown as React.FocusEventHandler<HTMLButtonElement>}
          onBlur={onBlur as unknown as React.FocusEventHandler<HTMLButtonElement>}
          onKeyDown={keyDown}
        >
          <span className={styles.selectValue}>{selectedOption?.label ?? ''}</span>
          <ChevronDown
            aria-hidden="true"
            className={`${styles.selectChevron} ${open ? styles.selectChevronOpen : ''}`}
            size={16}
          />
        </button>
        <select
          {...nativeProps}
          ref={nativeRef}
          id={`${controlId}-native`}
          aria-label={label}
          aria-hidden="true"
          tabIndex={-1}
          className={styles.selectNative}
          disabled={disabled}
          required={required}
          onChange={onChange as ChangeEventHandler<HTMLSelectElement>}
          {...(value !== undefined ? { value } : { defaultValue })}
        >
          {children}
        </select>
        {open && (
          <div id={listId} className={styles.selectMenu} role="listbox" aria-labelledby={labelId}>
            {options.map((option, index) => (
              <div
                id={`${listId}-option-${index}`}
                key={`${option.value}-${index}`}
                role="option"
                aria-selected={option.value === selectedValue}
                aria-disabled={option.disabled || undefined}
                title={option.title}
                className={`${styles.selectOption} ${index === activeIndex ? styles.selectOptionActive : ''}`}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => !option.disabled && setActiveIndex(index)}
                onClick={() => choose(option)}
              >
                <span>{option.label}</span>
                {option.value === selectedValue && <Check size={15} aria-hidden="true" />}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

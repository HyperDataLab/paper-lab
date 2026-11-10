import { fireEvent, screen } from '@testing-library/react';

/** Selects an option through the shared custom select's keyboard and pointer-facing UI. */
export function chooseSelectOption(label: string, option: string) {
  const combobox = screen.getByRole('combobox', { name: label });
  if (combobox.getAttribute('aria-expanded') !== 'true') {
    fireEvent.pointerDown(combobox);
    fireEvent.click(combobox);
  }
  fireEvent.click(screen.getByRole('option', { name: option }));
}

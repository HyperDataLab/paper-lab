const KEY = 'pl.scholar.email';

export function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value);
}

export function getScholarEmail() {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** An empty value clears it. Returns false when the address is invalid or storage is unavailable. */
export function saveScholarEmail(value: string) {
  const email = value.trim();
  if (email && !isValidEmail(email)) return false;
  try {
    if (email) localStorage.setItem(KEY, email);
    else localStorage.removeItem(KEY);
    return true;
  } catch {
    return false;
  }
}

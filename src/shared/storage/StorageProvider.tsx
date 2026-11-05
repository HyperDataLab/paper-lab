import { createContext, useContext, useState, type ReactNode } from 'react';
import { createDb } from './db';
import { createRepositories, type Repositories } from './repositories';
const Context = createContext<Repositories | null>(null);
export function StorageProvider({
  children,
  repositories,
}: {
  children: ReactNode;
  repositories?: Repositories;
}) {
  const [value] = useState(() => repositories ?? createRepositories(createDb()));
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
// The provider and its hook form one public storage entry point.
// eslint-disable-next-line react-refresh/only-export-components
export function useRepositories() {
  const value = useContext(Context);
  if (!value) throw new Error('StorageProvider is missing');
  return value;
}

import { useEffect, useState } from 'react';
import type { Repositories } from '@/shared/storage/repositories';
import { loadCalibration, type CalibrationData } from './data';
export function useCalibration(repo: Repositories, refreshKey?: unknown) {
  const [data, setData] = useState<CalibrationData>();
  useEffect(() => {
    let active = true;
    void loadCalibration(repo)
      .then((value) => {
        if (active) setData(value);
      })
      .catch(() => {
        if (active) setData(undefined);
      });
    return () => {
      active = false;
    };
  }, [repo, refreshKey]);
  return data;
}

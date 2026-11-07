import evaluate from '@/modules/evaluate';
import revise from '@/modules/revise';
import generate from '@/modules/generate';
import history from '@/modules/history';
import transfer from '@/modules/transfer';
import calibration from '@/modules/calibration';
import settings from '@/modules/settings';
import paperImport from '@/modules/paper-import';

export const modules = [evaluate, revise, generate, paperImport, history, transfer, calibration, settings];

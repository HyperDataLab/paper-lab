import { findBenchmark, findDesign, findMetric, findThreat } from '../researchDesign/bank/readSnapshot';
import type { BankDoc } from '../researchDesign/bank/snapshot';
import {
  addCondition,
  addDataset,
  addMetric,
  addVariable,
  datasetFromBank,
  editCondition,
  editDataset,
  editMetric,
  metricFromBank,
  setHypothesisVariables,
} from '../researchDesign/draft/measureOps';
import {
  addThreat,
  designFromBank,
  editThreat,
  setDesign,
  type DraftResult,
} from '../researchDesign/draft/ops';
import { addAnalysis, setRunMatrix } from '../researchDesign/draft/planOps';
import type { Draft, DesignCandidate } from '../researchDesign/draft/schema';
import { analysisMethod } from '../researchDesign/plan/schema';
import {
  acceptedInputs,
  canResume,
  contentOf,
  currentArtifact,
  designSource,
  matchesDesignSource,
} from './artifacts';
import { copyHypotheses } from './copy';
import { bankDesignInputs, pinDesignBank, validDesign } from './experiment-design';
import type { Run } from './record';
import { RunTransitionError } from './run';

export async function prepareDesignApplication(run: Run, bank: BankDoc | null) {
  const artifact = currentArtifact(run, 'S10');
  const prior = acceptedInputs(run, 'S10');
  if (artifact?.status !== 'accepted' || !artifact.selectionHash || !prior.S8 || !(await canResume(run)))
    throw new RunTransitionError('S10 must be accepted first');
  const value = contentOf('S10', artifact);
  const snapshot = await pinDesignBank(bankDesignInputs(bank));
  if (snapshot?.hash !== value.bank?.hash || !validDesign(value, prior))
    throw new RunTransitionError('INVALID_DESIGN');
  const source = designSource(run.id, artifact);
  const hypotheses = prior.S8.hypotheses;
  const ref = (id?: string | null) => (id && bank ? { id, release: bank.release } : null);

  return (draft: Draft): Draft => {
    const previous = draft.autoresearchDesign;
    if (previous && matchesDesignSource(previous.context, run.id, artifact)) return draft;
    let next = copyHypotheses(draft, run);
    const candidates: DesignCandidate[] = [];
    const mark = (section: DesignCandidate['section'], id: string, label: string) =>
      candidates.push({ section, id, label, status: 'candidate' });
    const apply = (result: DraftResult) => {
      if (!result.ok) throw new RunTransitionError(result.error);
      next = result.doc;
    };

    const bankDesign = value.design.id && findDesign(bank, value.design.id);
    const selectedDesign =
      bankDesign && bank
        ? designFromBank(bankDesign, bank.release)
        : { name: 'Custom design', assignment: null, bank: null };
    if (!next.design || next.design.bank?.id !== selectedDesign.bank?.id)
      apply(setDesign(next, selectedDesign));
    else if (selectedDesign.bank && next.design.bank?.release !== selectedDesign.bank.release)
      apply(setDesign(next, { ...next.design, bank: selectedDesign.bank }));
    mark('design', 'design', next.design?.name ?? selectedDesign.name);
    mark('design', 'compute', 'Compute');
    for (const [kind, rows] of [
      ['Baseline', value.baselines],
      ['Method', value.methods],
      ['Ablation', value.ablations],
    ] as const)
      rows.forEach(({ name }, i) => mark('design', `${kind}:${i}`, `${kind} · ${name}`));
    value.threats.forEach(({ bankRef, mitigation }, index) => {
      const name = (bankRef && findThreat(bank, bankRef)?.name) || `Threat to validity ${index + 1}`;
      const current = next.threats.find((row) => (bankRef ? row.bank?.id === bankRef : row.name === name));
      const id = current?.id ?? `t-${next.next.t}`;
      if (current) apply(editThreat(next, id, { name, mitigation }));
      else apply(addThreat(next, { name, mitigation, bank: ref(bankRef) }));
      mark('design', id, name);
    });

    const datasets = new Map<string, string>();
    for (const row of value.datasets) {
      const item = row.bankRef && findBenchmark(bank, row.bankRef);
      const existing = next.datasets.find((d) => d.name === row.name);
      const id = existing?.id ?? `d-${next.next.d}`;
      const fields = {
        ...(item && bank
          ? datasetFromBank(item, bank.release)
          : { version: null, sha256: null, benchmark: null }),
        name: row.name,
        source: row.source,
        split: row.split,
      };
      if (existing)
        apply(
          editDataset(next, id, {
            ...fields,
            version: existing.version,
            sha256: existing.source === row.source && existing.split === row.split ? existing.sha256 : null,
            benchmark: fields.benchmark ?? existing.benchmark,
          }),
        );
      else apply(addDataset(next, fields));
      datasets.set(row.name, id);
      mark('measurement', id, row.name);
    }
    const conditions = new Map<string, string>();
    for (const row of value.conditions) {
      const existing = next.conditions.find((c) => c.name === row.name);
      const id = existing?.id ?? `c-${next.next.c}`;
      if (existing) apply(editCondition(next, id, row));
      else apply(addCondition(next, row));
      conditions.set(row.name, id);
      mark('measurement', id, row.name);
    }
    const variables = new Map<string, string>();
    for (const row of value.metrics) {
      const item = row.bankRef && findMetric(bank, row.bankRef);
      const existing = next.metrics.find((m) => m.name === row.name);
      const id = existing?.id ?? `m-${next.next.m}`;
      const goal = {
        higher_better: 'maximize',
        lower_better: 'minimize',
        target_value: 'target',
        descriptive: null,
      } as const;
      const fields = {
        ...(item && bank
          ? metricFromBank(item, bank.release)
          : { unit: '', bank: null, protocol: '', aggregation: null }),
        name: row.name,
        key: /^[A-Za-z0-9_\-. /]{1,250}$/u.test(row.name) ? row.name : '',
        goal: goal[row.direction],
        protocolBank: ref(row.protocolRef),
      };
      if (existing)
        apply(
          editMetric(next, id, {
            ...fields,
            key: existing.key || fields.key,
            unit: existing.unit || fields.unit,
            protocol: existing.protocol,
            aggregation: existing.aggregation,
            bank: fields.bank ?? existing.bank,
            protocolBank: fields.protocolBank ?? existing.protocolBank,
          }),
        );
      else apply(addMetric(next, fields));
      const variable = next.variables.find((v) => v.role === 'dependent' && v.metric === id);
      const variableId = variable?.id ?? `v-${next.next.v}`;
      if (!variable)
        apply(
          addVariable(next, {
            name: row.name,
            role: 'dependent',
            construct: '',
            metric: id,
            levels: [],
          }),
        );
      variables.set(row.name, variableId);
      mark('measurement', id, row.name);
      mark('measurement', variableId, `Variable · ${row.name}`);
    }

    const lookup = (ids: Map<string, string>, keys: string[]) =>
      keys.map((key) => {
        const id = ids.get(key);
        if (!id) throw new RunTransitionError('INVALID_DESIGN');
        return id;
      });
    const mapping = hypotheses.map((h) => {
      const match =
        next.hypotheses.find(
          (item) =>
            item.autoresearch?.runId === run.id &&
            item.autoresearch.hypothesisId === h.id &&
            item.statement === h.statement,
        ) ?? next.hypotheses.find((item) => item.statement === h.statement);
      if (!match) throw new RunTransitionError('Missing hypothesis in draft');
      const linked = lookup(
        variables,
        value.metrics.filter((m) => m.hypothesisIds.includes(h.id)).map((m) => m.name),
      );
      apply(
        setHypothesisVariables(next, match.id, {
          independent: match.independent,
          dependent: [...match.dependent, ...linked],
        }),
      );
      mark('measurement', match.id, match.statement);
      return {
        id: match.id,
        sourceId: h.id,
        outcome: h.outcome,
        estimand: h.estimand,
        prediction: h.prediction,
        ...h.falsification,
      };
    });
    const hypothesisIds = new Map(mapping.map(({ sourceId, id }) => [sourceId, id]));
    const hypothesisId = (sourceId: string) => lookup(hypothesisIds, [sourceId])[0] ?? '';
    const baseline = value.conditions.filter((c) => c.baseline);
    const method = value.conditions.filter((c) => !c.baseline);
    const defaultConditions =
      baseline.length === 1 && method.length === 1 ? [...method, ...baseline].map((c) => c.name) : [];
    for (const row of value.analysis) {
      const hypothesis = hypothesisId(row.hypothesisId);
      const method = analysisMethod.safeParse(row.test);
      const variableIds = lookup(
        variables,
        row.metric
          ? [row.metric]
          : value.metrics.filter((m) => m.hypothesisIds.includes(row.hypothesisId)).map((m) => m.name),
      );
      const conditionIds = lookup(conditions, row.conditions ?? defaultConditions);
      const existing = next.analyses.find(
        (a) =>
          a.hypothesis === hypothesis &&
          a.method === (method.data ?? null) &&
          a.alpha === row.alpha &&
          a.correction === row.correction &&
          a.variables.join() === variableIds.join() &&
          a.conditions.join() === conditionIds.join(),
      );
      const id = existing?.id ?? `a-${next.next.a}`;
      if (!existing)
        apply(
          addAnalysis(next, {
            hypothesis,
            method: method.data ?? null,
            variables: variableIds,
            conditions: conditionIds,
            parameters: {},
            assumptions: [],
            missingPolicy: 'fail',
            alpha: row.alpha,
            correction: row.correction,
          }),
        );
      if (!candidates.some((candidate) => candidate.id === id))
        mark('analyses', id, `${row.test} · ${row.hypothesisId}`);
    }
    apply(
      setRunMatrix(next, {
        ...next.runMatrix,
        conditions: [...next.runMatrix.conditions, ...conditions.values()],
        datasets: [...next.runMatrix.datasets, ...datasets.values()],
      }),
    );
    mark('runs', 'runMatrix', 'Ma trận chạy');
    const retained =
      previous?.candidates.filter(
        (row) =>
          row.status === 'candidate' &&
          /^[tmdcvah]-\d+$/u.test(row.id) &&
          !candidates.some(({ id }) => id === row.id),
      ) ?? [];

    return {
      ...next,
      autoresearchDesign: {
        context: {
          ...source,
          rationale: value.design.rationale,
          compute: value.compute,
          baselines: value.baselines,
          methods: value.methods.map((m) => ({ ...m, hypothesisIds: m.hypothesisIds.map(hypothesisId) })),
          ablations: value.ablations.map((a) => ({ ...a, hypothesisId: hypothesisId(a.hypothesisId) })),
          licenses: value.datasets.flatMap((d) =>
            d.license ? [{ datasetId: lookup(datasets, [d.name])[0] ?? '', license: d.license }] : [],
          ),
          hypotheses: mapping,
        },
        candidates: [...candidates, ...retained],
      },
    };
  };
}

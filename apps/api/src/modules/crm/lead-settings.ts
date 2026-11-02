import type { Types } from 'mongoose';
import {
  DEFAULT_LEAD_SOURCE_LABELS,
  DEFAULT_LEAD_STAGE_LABELS,
  DEFAULT_LOST_REASONS,
  LEAD_SOURCES,
  type LeadSettingsInput,
} from '@erp/shared';
import { badRequest } from '../../utils/errors';
import { Company } from '../companies/company.model';

export interface LeadSettings {
  sources: { key: string; label: string; active: boolean }[];
  stageLabels: Record<string, string>;
  lostReasons: string[];
}

export function defaultLeadSettings(): LeadSettings {
  return {
    sources: LEAD_SOURCES.map((key) => ({ key, label: DEFAULT_LEAD_SOURCE_LABELS[key] ?? key, active: true })),
    stageLabels: { ...DEFAULT_LEAD_STAGE_LABELS },
    lostReasons: [...DEFAULT_LOST_REASONS],
  };
}

/** The company's lead sources, stage labels and lost reasons, falling back to the built-in defaults. */
export async function getLeadSettings(companyId: Types.ObjectId): Promise<LeadSettings> {
  const company = await Company.findById(companyId).select('leadSettings').lean();
  const saved = company?.leadSettings as Partial<LeadSettings> | undefined;
  const defaults = defaultLeadSettings();
  return {
    sources: saved?.sources?.length ? saved.sources : defaults.sources,
    stageLabels: { ...defaults.stageLabels, ...(saved?.stageLabels ?? {}) },
    lostReasons: saved?.lostReasons ?? defaults.lostReasons,
  };
}

export async function saveLeadSettings(companyId: Types.ObjectId, input: LeadSettingsInput) {
  // 'other' must always exist: inbound integrations and imports fall back to it.
  const sources = input.sources.some((s) => s.key === 'other')
    ? input.sources
    : [...input.sources, { key: 'other', label: 'Other', active: true }];
  await Company.updateOne({ _id: companyId }, { $set: { leadSettings: { ...input, sources } } });
  return getLeadSettings(companyId);
}

/** Rejects unknown sources. Inactive sources stay valid for existing leads but cannot be chosen for new ones. */
export async function assertLeadSource(companyId: Types.ObjectId, source: string | undefined, isNew: boolean) {
  if (!source) return;
  const { sources } = await getLeadSettings(companyId);
  const found = sources.find((s) => s.key === source);
  if (!found || (isNew && !found.active))
    throw badRequest('Choose one of the configured lead sources', [{ path: 'source', message: 'Unknown lead source' }]);
}

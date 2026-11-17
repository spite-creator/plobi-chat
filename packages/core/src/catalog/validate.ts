/**
 * Catalog health check shown in the admin when settings change.
 */
import { profileHasPhase } from '../machines/phase.js';
import { stageTypeMap, eventFitsStageType } from '../describe/stage-type-map.js';
import type { Catalog } from './types.js';

export interface CatalogIssue {
  readonly severity: 'error' | 'warning';
  readonly code:
    | 'phase_unreachable'
    | 'event_unused'
    | 'event_phase_not_in_profile'
    | 'requirement_template_missing'
    | 'requirement_event_missing'
    | 'requirement_phase_not_in_profile'
    | 'requirement_phase_missing'
    | 'incident_type_missing';
  readonly subject: string;
  readonly message: string;
}

export function validateCatalog(catalog: Catalog): CatalogIssue[] {
  const issues: CatalogIssue[] = [];
  const stageTypes = Object.values(catalog.stageTypes);

  for (const st of stageTypes) {
    const map = stageTypeMap(catalog, st.code);
    for (const t of map?.transitions ?? []) {
      if (!t.automatic && t.events.length === 0) {
        issues.push({
          severity: 'warning',
          code: 'phase_unreachable',
          subject: st.code,
          message: `No event moves ${st.code} from ${t.from ?? 'none'} to ${t.to}`,
        });
      }
    }
  }

  for (const ev of Object.values(catalog.eventTypes)) {
    const fitting = stageTypes.filter((st) => eventFitsStageType(ev, st));
    // An empty list of stage types means "deliberately not bound yet" (general started / completed).
    const unbound = ev.scope?.stageTypes?.length === 0;
    const stageBound = !unbound && (ev.action === 'phase' || ev.action === 'skip' || ev.action === 'waive');
    if (stageBound && fitting.length === 0) {
      issues.push({ severity: 'error', code: 'event_unused', subject: ev.code, message: `${ev.code} fits no stage type` });
    }
    if (ev.action === 'phase' && ev.setsPhase) {
      const target = ev.setsPhase;
      if (fitting.length > 0 && !fitting.some((st) => profileHasPhase(st.profile, target))) {
        issues.push({
          severity: 'error',
          code: 'event_phase_not_in_profile',
          subject: ev.code,
          message: `${ev.code} sets ${target}, which none of its stage types has`,
        });
      }
    }
    if (ev.incidentType && !catalog.incidentTypes[ev.incidentType]) {
      issues.push({
        severity: 'error',
        code: 'incident_type_missing',
        subject: ev.code,
        message: `${ev.code} refers to unknown incident type ${ev.incidentType}`,
      });
    }
  }

  for (const rule of catalog.requirementRules) {
    const tpl = catalog.requirementTemplates[rule.template];
    if (!tpl) {
      issues.push({
        severity: 'error',
        code: 'requirement_template_missing',
        subject: rule.template,
        message: `Rule refers to unknown template ${rule.template}`,
      });
      continue;
    }
    if (tpl.kind !== 'info' && !tpl.beforePhase) {
      issues.push({
        severity: 'error',
        code: 'requirement_phase_missing',
        subject: tpl.code,
        message: `${tpl.code} must say before which phase it is required`,
      });
    }
    if (tpl.kind === 'event' && (!tpl.eventType || !catalog.eventTypes[tpl.eventType])) {
      issues.push({
        severity: 'error',
        code: 'requirement_event_missing',
        subject: tpl.code,
        message: `${tpl.code} needs event ${tpl.eventType ?? '(none)'}, which does not exist`,
      });
    }
    for (const code of rule.stageTypes ?? []) {
      const st = catalog.stageTypes[code];
      if (st && tpl.captureFromPhase && !profileHasPhase(st.profile, tpl.captureFromPhase)) {
        issues.push({
          severity: 'error',
          code: 'requirement_phase_not_in_profile',
          subject: tpl.code,
          message: `${tpl.code} counts evidence from ${tpl.captureFromPhase}, which ${code} never reaches`,
        });
      }
    }
  }

  return issues;
}

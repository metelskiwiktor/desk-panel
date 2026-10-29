import { createHash } from 'node:crypto';
import { appointmentQuerySchema, appointmentReference, calendarProposalSchema } from '../src/appointment-contract';
import { panelToolName } from '../src/cockpit-contract';

/** Cards reconstructed live or from Hermes history bind to identical content, including the provider reading's ref. */
export function stableAppointmentCardId(messageId: string, name: string, input: string, output: unknown): string | null {
  try {
    const tool = panelToolName(name);
    if (tool !== 'panel_znanylekarz' && tool !== 'panel_calendar_propose') return null;
    const plan = (tool === 'panel_znanylekarz' ? appointmentQuerySchema : calendarProposalSchema).parse(JSON.parse(input));
    const ref = tool === 'panel_znanylekarz' ? appointmentReference(output) : null;
    if (tool === 'panel_znanylekarz' && !ref) return null;
    return `${messageId}:v-${createHash('sha256').update(JSON.stringify({ tool, plan, ref })).digest('hex').slice(0, 16)}`;
  } catch { return null; }
}

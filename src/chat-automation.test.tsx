import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { automationLabel, automationPrompt, type ChatAutomation, type ChatMessage } from './chat-contract';
import { cockpitMessage } from './cockpit/live';
import { AutomationLabel, toThreadMessage } from './cockpit/Thread';

const automation: ChatAutomation = { source: 'cezar', reason: 'task Cezara zakończony' };

describe('an automation turn', () => {
  it('looks different from a user message and keeps its marker through the cockpit and the thread', () => {
    const message: ChatMessage = { id: 'u1', role: 'user', at: 1, text: 'Task Cezara: x', automation };
    const cockpit = cockpitMessage(message);
    expect(cockpit).toMatchObject({ role: 'user', automation });
    const thread = toThreadMessage(cockpit);
    expect(thread.role).toBe('user');
    expect((thread.metadata?.custom as { automation?: ChatAutomation }).automation).toEqual(automation);
    expect(thread.content).toEqual([{ type: 'text', text: 'Task Cezara: x' }]);

    const plain = cockpitMessage({ id: 'u2', role: 'user', at: 2, text: 'Zwykła wiadomość' });
    expect(plain.automation).toBeUndefined();
    expect((toThreadMessage(plain).metadata?.custom as { automation?: ChatAutomation }).automation).toBeUndefined();
  });

  it('shows the small label and prefixes what the model reads', () => {
    render(<AutomationLabel automation={automation} />);
    expect(screen.getByText('Automatyka · Cezar')).toBeTruthy();
    expect(automationLabel(automation)).toBe('Automatyka · Cezar');
    expect(automationPrompt('Task Cezara: x', automation)).toBe('[Automatyka · Cezar] task Cezara zakończony\nTask Cezara: x');
  });
});

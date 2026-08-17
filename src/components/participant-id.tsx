/**
 * A participant code with its label attached.
 *
 * The code alone reads as a random string, so the word travels with it everywhere it appears.
 * The label is deliberately small and set in the body font: it explains the code without
 * competing with it, leaving the monospaced characters as the thing the eye lands on.
 */
export function ParticipantId({ id }: { id: string }) {
  return (
    <span className="participant-id">
      <span className="participant-id-label">Participant</span>
      {id}
    </span>
  );
}

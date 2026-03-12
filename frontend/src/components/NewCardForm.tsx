import { useState, type FormEvent } from "react";

const initialFormState = { title: "", details: "" };

type NewCardFormProps = {
  onAdd: (title: string, details: string) => void;
};

export const NewCardForm = ({ onAdd }: NewCardFormProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [formState, setFormState] = useState(initialFormState);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!formState.title.trim()) {
      return;
    }
    onAdd(formState.title.trim(), formState.details.trim());
    setFormState(initialFormState);
    setIsOpen(false);
  };

  return (
    <div className="mt-4">
      {isOpen ? (
        <form
          onSubmit={handleSubmit}
          className="rounded-[24px] border border-[rgba(3,33,71,0.08)] bg-[rgba(255,255,255,0.78)] p-4 shadow-[0_18px_34px_rgba(3,33,71,0.08)]"
        >
          <div className="space-y-3">
            <input
              value={formState.title}
              onChange={(event) =>
                setFormState((prev) => ({ ...prev, title: event.target.value }))
              }
              placeholder="Card title"
              className="w-full rounded-2xl border border-[rgba(3,33,71,0.08)] bg-white px-3 py-3 text-sm font-medium text-[var(--navy-dark)] outline-none transition focus:border-[rgba(32,157,215,0.36)]"
              required
            />
            <textarea
              value={formState.details}
              onChange={(event) =>
                setFormState((prev) => ({ ...prev, details: event.target.value }))
              }
              placeholder="Details"
              rows={3}
              className="w-full resize-none rounded-2xl border border-[rgba(3,33,71,0.08)] bg-white px-3 py-3 text-sm text-[var(--gray-text)] outline-none transition focus:border-[rgba(32,157,215,0.36)]"
            />
          </div>

          <div className="mt-4 flex items-center gap-2">
            <button
              type="submit"
              className="rounded-full bg-[linear-gradient(135deg,_var(--secondary-purple),_#9157a9)] px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.24em] text-white transition hover:-translate-y-0.5 hover:shadow-[0_16px_28px_rgba(117,57,145,0.26)]"
            >
              Add card
            </button>
            <button
              type="button"
              onClick={() => {
                setIsOpen(false);
                setFormState(initialFormState);
              }}
              className="rounded-full border border-[rgba(3,33,71,0.1)] bg-white px-3 py-2.5 text-xs font-semibold uppercase tracking-[0.22em] text-[var(--gray-text)] transition hover:text-[var(--navy-dark)]"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="w-full rounded-full border border-dashed border-[rgba(3,33,71,0.14)] bg-[rgba(255,255,255,0.66)] px-3 py-3 text-xs font-semibold uppercase tracking-[0.24em] text-[var(--primary-blue)] transition hover:-translate-y-0.5 hover:border-[var(--primary-blue)] hover:bg-white"
        >
          Add a card
        </button>
      )}
    </div>
  );
};

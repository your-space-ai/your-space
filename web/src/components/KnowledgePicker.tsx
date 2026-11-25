// Picking the knowledge bases an app is given (journey 014), in the install review and on the app's
// page. Each one is a folder of the app's at `<path>/<name>`.
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { errorMessage } from "../apps-api.ts";
import { knowledgeQuery } from "../knowledge-api.ts";

export function KnowledgePicker({
  path,
  selected,
  onChange,
  disabled = false,
}: {
  path: string;
  selected: string[];
  onChange: (names: string[]) => void;
  /** While a save of the picks is under way, so a change made meanwhile isn't lost when it ends. */
  disabled?: boolean;
}) {
  const knowledge = useQuery(knowledgeQuery);
  if (knowledge.isError) {
    return (
      <p className="notice error" role="alert">
        {errorMessage(knowledge.error)}
      </p>
    );
  }
  if (!knowledge.data) return <p className="muted">Loading…</p>;
  const list = knowledge.data.knowledgeBases;
  if (list.length === 0) {
    return (
      <p className="muted">
        You have no knowledge base yet. <Link to="/knowledge">Create one in Knowledge</Link>, then give it to the app on its page.
      </p>
    );
  }
  const toggle = (name: string, on: boolean) => onChange(on ? [...selected, name].sort() : selected.filter((n) => n !== name));
  return (
    <fieldset className="knowledge-picker" disabled={disabled}>
      <legend className="visually-hidden">Knowledge bases</legend>
      {list.map((base) => (
        <label key={base.name} className="checkbox" data-knowledge-choice={base.name}>
          <input type="checkbox" checked={selected.includes(base.name)} onChange={(event) => toggle(base.name, event.target.checked)} />
          {base.title}
          <code className="muted small">
            {path}/{base.name}
          </code>
        </label>
      ))}
    </fieldset>
  );
}

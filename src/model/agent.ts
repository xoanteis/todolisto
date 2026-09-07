// Mirror of the tag-based part of the Rust agent for the in-browser backend
// and the review UI helpers.

import type { Session } from "../backend/types";

export interface Item {
  text: string;
  entry_id: string | null;
  due: string | null;
}

export interface Proposal {
  title: string;
  summary: string;
  todos: Item[];
  facts: Item[];
  questions: Item[];
  decisions: Item[];
  ideas: Item[];
  source: string;
}

export interface Selection {
  title: string | null;
  summary: boolean;
  todos: number[];
  facts: number[];
  questions: number[];
  decisions: number[];
  ideas: number[];
}

export interface Applied {
  summary: string | null;
  todos: Item[];
  facts: Item[];
  questions: Item[];
  decisions: Item[];
  ideas: Item[];
}

export interface DigestItem {
  id: string;
  text: string;
  session_id: string;
  session_title: string | null;
  ts: string;
  entry_id: string | null;
  due: string | null;
  done: boolean;
}

export interface Digest {
  todos: DigestItem[];
  facts: DigestItem[];
  questions: DigestItem[];
  decisions: DigestItem[];
  ideas: DigestItem[];
}

export const CATEGORIES = ["todos", "facts", "questions", "decisions", "ideas"] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  todos: "To do",
  facts: "Facts",
  questions: "Open questions",
  decisions: "Decisions",
  ideas: "Ideas",
};

const TAGS: Record<string, Category> = {
  todo: "todos",
  todos: "todos",
  tarefa: "todos",
  tarea: "todos",
  data: "facts",
  fact: "facts",
  facts: "facts",
  dato: "facts",
  datos: "facts",
  q: "questions",
  question: "questions",
  pregunta: "questions",
  dubida: "questions",
  dúbida: "questions",
  duda: "questions",
  decision: "decisions",
  decisión: "decisions",
  decisions: "decisions",
  idea: "ideas",
  ideas: "ideas",
};

export function stripTags(text: string): string {
  return text
    .split(/\s+/)
    .filter((w) => !(w.startsWith("#") && w.length > 1 && /\p{L}/u.test(w[1])))
    .join(" ")
    .trim();
}

export function proposalFromTags(session: Session): Proposal {
  const first = session.entries[0];
  const firstLine = first ? stripTags(first.text.split("\n")[0]) : "";
  const proposal: Proposal = {
    title: Array.from(firstLine).length > 80 ? `${Array.from(firstLine).slice(0, 79).join("").trimEnd()}…` : firstLine,
    summary: "",
    todos: [],
    facts: [],
    questions: [],
    decisions: [],
    ideas: [],
    source: "tags",
  };
  for (const entry of session.entries) {
    const categories = [...new Set(entry.tags.map((t) => TAGS[t]).filter(Boolean))] as Category[];
    for (const category of categories) {
      proposal[category].push({ text: stripTags(entry.text), entry_id: entry.id, due: null });
    }
  }
  return proposal;
}

/** Everything selected: what the review panel starts from. */
export function selectAll(proposal: Proposal): Selection {
  return {
    title: proposal.title || null,
    summary: proposal.summary.trim().length > 0,
    todos: proposal.todos.map((_, i) => i),
    facts: proposal.facts.map((_, i) => i),
    questions: proposal.questions.map((_, i) => i),
    decisions: proposal.decisions.map((_, i) => i),
    ideas: proposal.ideas.map((_, i) => i),
  };
}

export function appliedOf(session: Session): Applied | null {
  const action = [...session.actions].reverse().find((a) => a.type === "agent");
  if (!action || !action.data || typeof action.data !== "object") return null;
  const d = action.data as Partial<Applied>;
  return {
    summary: d.summary ?? null,
    todos: d.todos ?? [],
    facts: d.facts ?? [],
    questions: d.questions ?? [],
    decisions: d.decisions ?? [],
    ideas: d.ideas ?? [],
  };
}

export function digestOf(sessions: Session[], done: Record<string, string>): Digest {
  const out: Digest = { todos: [], facts: [], questions: [], decisions: [], ideas: [] };
  const singular: Record<Category, string> = { todos: "todo", facts: "fact", questions: "question", decisions: "decision", ideas: "idea" };
  for (const session of [...sessions].reverse()) {
    const applied = appliedOf(session);
    if (!applied) continue;
    for (const category of CATEGORIES) {
      applied[category].forEach((item, index) => {
        const id = `${session.header.id}:${singular[category]}:${index}`;
        const entry = item.entry_id ? session.entries.find((e) => e.id === item.entry_id) : undefined;
        out[category].push({
          id,
          text: item.text,
          session_id: session.header.id,
          session_title: session.end?.title ?? session.header.title ?? null,
          ts: entry?.ts ?? session.header.started,
          entry_id: item.entry_id,
          due: item.due,
          done: id in done,
        });
      });
    }
  }
  return out;
}

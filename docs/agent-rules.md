# Agent Rules for Token Efficiency

These rules are intended for AI agents working in this repository.

## Default operating mode
- Do **not** scan the entire repository.
- Begin with `docs/project-map.md`.
- Restrict reads to files directly relevant to the task.

## Hard limits
- Open at most 3 files initially.
- If still unclear, ask exactly 1 clarifying question.
- Avoid proposing multiple alternatives unless requested.

## Response format defaults
- Keep responses concise.
- Prefer bullet points/checklists over long prose.
- Provide only actionable output (patch, commands, short summary).

## Change scope control
- Modify only requested files/paths.
- Do not refactor unrelated modules.
- Add brief notes in docs when introducing new folders.

## Suggested user prompt snippet
Use this in task requests:

> Token-saving mode: restrict to `<target paths>`, do not browse the full repo, ask 1 question if context is missing, and return only the minimal patch and test command.

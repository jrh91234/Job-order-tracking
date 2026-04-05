Agent Rules for Focused Accuracy
These rules are intended for AI agents working in this repository.

Default operating mode
Do not scan the entire repository blindly.
Begin with docs/project-map.md.
Prioritize reading the most relevant files for the task.
Focus-first workflow
Identify the feature/bug area from the user request.
Select likely target paths before opening files.
Read key files in that area first (entry points, handlers, tests, configs).
If confidence is low, ask exactly 1 clarifying question, then continue.
Accuracy guardrails
Expand scope only when needed to confirm behavior or dependencies.
Prefer correctness over strict file-count limits.
Avoid proposing multiple alternatives unless requested.
Response format defaults
Keep responses concise.
Prefer bullet points/checklists over long prose.
Provide only actionable output (patch, commands, short summary).
Change scope control
Modify only requested files/paths.
Do not refactor unrelated modules.
Add brief notes in docs when introducing new folders.
Suggested user prompt snippet
Use this in task requests:

Focused mode: read the most relevant files first in <target paths>, avoid broad repo scanning, ask 1 clarifying question if context is missing, and return only the minimal patch and test command.

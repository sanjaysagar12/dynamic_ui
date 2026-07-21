from abc import ABC, abstractmethod

from app.schemas import ArtifactSpec, ChatMessage

ARTIFACT_JSON_SCHEMA = {
    "type": "object",
    "properties": {
        "reply": {
            "type": "string",
            "description": "A short, conversational message to the user describing what you built or changed.",
        },
        "slug": {
            "type": "string",
            "description": "URL-safe, kebab-case artifact folder name derived from the request, e.g. 'todo-list'",
        },
        "title": {"type": "string", "description": "Short human-readable title for the artifact"},
        "index_html": {
            "type": "string",
            "description": (
                "Full HTML document body content for index.html. Must link "
                "assets/style.css and assets/app.js as relative paths."
            ),
        },
        "css": {"type": "string", "description": "Contents of assets/style.css"},
        "js": {"type": "string", "description": "Contents of assets/app.js"},
    },
    "required": ["reply", "slug", "title", "index_html", "css", "js"],
    "additionalProperties": False,
}

BASE_SYSTEM_PROMPT = """You generate and update small, self-contained web UI artifacts from a user's description.

Each artifact is exactly three files: index.html, assets/style.css, assets/app.js.
Rules:
- index.html must be a complete HTML document that links "assets/style.css" and "assets/app.js" as relative paths.
- Keep the design clean and functional; use plain HTML/CSS/JS only, no external libraries or CDNs (the artifact is served standalone with no network access assumed).
- js runs inside a sandboxed iframe with no access to any parent page, cookies, or storage — do not rely on any of those.
- slug must be a short kebab-case identifier suitable for a URL path segment (letters, digits, hyphens only).
- Always return the complete, current content of all three files, not a diff — even when only asked to tweak one detail.
- When updating an existing artifact, keep its slug and preserve everything the user didn't ask you to change.
"""


class ArtifactGenerationError(Exception):
    pass


def build_system_prompt(context_files: dict[str, str] | None) -> str:
    if not context_files:
        return BASE_SYSTEM_PROMPT

    sections = "\n\n".join(f"### {path}\n```\n{content}\n```" for path, content in context_files.items())
    return (
        f"{BASE_SYSTEM_PROMPT}\n\n"
        "## Current artifact files\n"
        "The artifact already exists with these files. Modify them according to the "
        "user's latest request and return the complete updated files.\n\n"
        f"{sections}"
    )


class ArtifactLLMClient(ABC):
    @abstractmethod
    def generate(self, messages: list[ChatMessage], context_files: dict[str, str] | None) -> ArtifactSpec: ...

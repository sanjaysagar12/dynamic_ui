import json

import anthropic
from anthropic import Anthropic

from app.schemas import ArtifactSpec, ChatMessage
from app.services.providers.base import (
    ARTIFACT_JSON_SCHEMA,
    ArtifactGenerationError,
    ArtifactLLMClient,
    build_system_prompt,
)


class ClaudeArtifactGenerator(ArtifactLLMClient):
    def __init__(self, model: str) -> None:
        self._model = model
        self._client = Anthropic()

    def generate(self, messages: list[ChatMessage], context_files: dict[str, str] | None) -> ArtifactSpec:
        system_prompt = build_system_prompt(context_files)

        try:
            with self._client.messages.stream(
                model=self._model,
                max_tokens=8000,
                thinking={"type": "adaptive"},
                system=system_prompt,
                messages=[{"role": m.role, "content": m.content} for m in messages],
                output_config={"format": {"type": "json_schema", "schema": ARTIFACT_JSON_SCHEMA}},
            ) as stream:
                response = stream.get_final_message()
        except TypeError as exc:
            # Raised by the SDK when no credentials resolve (no API key / auth token / profile).
            raise ArtifactGenerationError(f"Anthropic client misconfigured: {exc}") from exc
        except anthropic.APIError as exc:
            raise ArtifactGenerationError(f"Claude request failed: {exc}") from exc

        if response.stop_reason == "refusal":
            raise ArtifactGenerationError("Claude declined to generate this artifact")

        text_blocks = [block.text for block in response.content if block.type == "text"]
        if not text_blocks:
            raise ArtifactGenerationError(f"Claude returned no text output (stop_reason={response.stop_reason})")

        try:
            data = json.loads("".join(text_blocks))
            return ArtifactSpec.model_validate(data)
        except (json.JSONDecodeError, ValueError) as exc:
            raise ArtifactGenerationError(f"Claude returned an invalid artifact spec: {exc}") from exc

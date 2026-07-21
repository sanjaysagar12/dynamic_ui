import json

from google import genai
from google.genai import errors as genai_errors
from google.genai import types

from app.schemas import ArtifactSpec, ChatMessage
from app.services.providers.base import ArtifactGenerationError, ArtifactLLMClient, build_system_prompt

_ROLE_MAP = {"user": "user", "assistant": "model"}


class GeminiArtifactGenerator(ArtifactLLMClient):
    def __init__(self, model: str, api_key: str | None) -> None:
        if not api_key:
            raise ArtifactGenerationError("GEMINI_API_KEY is not set")
        self._model = model
        self._client = genai.Client(api_key=api_key)

    def generate(self, messages: list[ChatMessage], context_files: dict[str, str] | None) -> ArtifactSpec:
        system_prompt = build_system_prompt(context_files)
        contents = [
            types.Content(role=_ROLE_MAP[m.role], parts=[types.Part.from_text(text=m.content)]) for m in messages
        ]

        try:
            response = self._client.models.generate_content(
                model=self._model,
                contents=contents,
                config=types.GenerateContentConfig(
                    system_instruction=system_prompt,
                    response_mime_type="application/json",
                    response_schema=ArtifactSpec,
                ),
            )
        except genai_errors.APIError as exc:
            raise ArtifactGenerationError(f"Gemini request failed: {exc}") from exc

        if response.parsed is not None:
            return response.parsed  # type: ignore[return-value]

        if not response.text:
            raise ArtifactGenerationError("Gemini returned no output")

        try:
            data = json.loads(response.text)
            return ArtifactSpec.model_validate(data)
        except (json.JSONDecodeError, ValueError) as exc:
            raise ArtifactGenerationError(f"Gemini returned an invalid artifact spec: {exc}") from exc

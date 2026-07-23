import json

from google import genai
from google.genai import errors as genai_errors
from google.genai import types

from app.schemas import ArtifactSpec, ChatMessage
from app.services.providers.base import (
    GET_SCHEMA_TOOL_DESCRIPTION,
    GET_SCHEMA_TOOL_NAME,
    ArtifactGenerationError,
    ArtifactLLMClient,
    build_system_prompt,
    format_schema_for_tool_result,
    validate_artifact_spec,
)
from app.services.tool_client import ToolServiceClient, ToolServiceError

_ROLE_MAP = {"user": "user", "assistant": "model"}

_GET_SCHEMA_DECLARATION = types.FunctionDeclaration(
    name=GET_SCHEMA_TOOL_NAME,
    description=GET_SCHEMA_TOOL_DESCRIPTION,
    parameters=types.Schema(type=types.Type.OBJECT, properties={}),
)

_MAX_TOOL_ITERATIONS = 3


class GeminiArtifactGenerator(ArtifactLLMClient):
    def __init__(self, model: str, api_key: str | None, tool_client: ToolServiceClient) -> None:
        if not api_key:
            raise ArtifactGenerationError("GEMINI_API_KEY is not set")
        self._model = model
        self._client = genai.Client(api_key=api_key)
        self._tool_client = tool_client

    def generate(self, messages: list[ChatMessage], context_files: dict[str, str] | None) -> ArtifactSpec:
        system_prompt = build_system_prompt(context_files)
        contents = [
            types.Content(role=_ROLE_MAP[m.role], parts=[types.Part.from_text(text=m.content)]) for m in messages
        ]

        try:
            contents = self._run_tool_loop(system_prompt, contents)

            response = self._client.models.generate_content(
                model=self._model,
                contents=contents,
                config=types.GenerateContentConfig(
                    system_instruction=system_prompt,
                    response_mime_type="application/json",
                    response_schema=ArtifactSpec,
                    max_output_tokens=16000,
                ),
            )
        except genai_errors.APIError as exc:
            raise ArtifactGenerationError(f"Gemini request failed: {exc}") from exc

        finish_reason = response.candidates[0].finish_reason if response.candidates else None
        if finish_reason == types.FinishReason.MAX_TOKENS:
            # The JSON got cut off mid-string, which json.loads() below would
            # otherwise report as a confusing parse error.
            raise ArtifactGenerationError(
                "Gemini's response was cut off before finishing (hit the output token limit) — "
                "try a simpler request or ask for less verbose markup."
            )

        if response.parsed is not None:
            spec = response.parsed  # type: ignore[assignment]
        else:
            if not response.text:
                raise ArtifactGenerationError("Gemini returned no output")

            try:
                data = json.loads(response.text)
                spec = ArtifactSpec.model_validate(data)
            except (json.JSONDecodeError, ValueError) as exc:
                raise ArtifactGenerationError(f"Gemini returned an invalid artifact spec: {exc}") from exc

        validate_artifact_spec(spec)
        return spec

    def _run_tool_loop(self, system_prompt: str, contents: list["types.Content"]) -> list["types.Content"]:
        for _ in range(_MAX_TOOL_ITERATIONS):
            response = self._client.models.generate_content(
                model=self._model,
                contents=contents,
                config=types.GenerateContentConfig(
                    system_instruction=system_prompt,
                    tools=[types.Tool(function_declarations=[_GET_SCHEMA_DECLARATION])],
                ),
            )

            candidate_content = response.candidates[0].content if response.candidates else None
            function_calls = [part.function_call for part in (candidate_content.parts if candidate_content else []) if part.function_call]

            if not function_calls:
                break

            contents.append(candidate_content)

            response_parts = [
                types.Part.from_function_response(name=call.name, response={"result": self._execute_tool(call.name)})
                for call in function_calls
            ]
            contents.append(types.Content(role="user", parts=response_parts))

        return contents

    def _execute_tool(self, name: str) -> str:
        if name != GET_SCHEMA_TOOL_NAME:
            return f"Unknown tool: {name}"
        try:
            tables = self._tool_client.get_schema()
            return format_schema_for_tool_result(tables)
        except ToolServiceError as exc:
            return f"Schema lookup failed: {exc}. Proceed without relying on exact table/column names."
